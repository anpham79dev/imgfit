import { randomBytes } from "node:crypto";
import { lstat, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError, type Issue, normalizeError, warning } from "../core/errors.js";
import { fingerprint } from "../core/fingerprint.js";
import type { OutputFormat } from "../core/formats.js";
import { collectInputs, type InputFile } from "../core/inputs.js";
import { type OnConflict, publish, safeUnlink, tempPathFor } from "../core/output.js";
import { assertSafeDestination, collisionKey, isInside, toPosix } from "../core/paths.js";
import { planTransform, probe, type ProbeResult, type TransformOptions, type TransformPlan, transformToFile, validateTransformOptions } from "../core/process.js";
import { type FileResult, makeReport, type Report } from "../core/report.js";
import { renderTemplate, validateTemplate } from "../core/template.js";

export const DEFAULT_JOBS = 4;
export const MAX_JOBS = 64;
export const DEFAULT_NAME_TEMPLATE = "{name}.{ext}";

export type ProgressEventType = "queued" | "processing" | "done" | "skipped" | "failed" | "cancelled";

export interface ProgressEvent {
  type: ProgressEventType;
  file: string;
  destination: string | null;
  completed: number;
  total: number;
  bytesSaved: number;
}

export interface ResizeOptions extends TransformOptions {
  /** File, thư mục hoặc glob. Đường dẫn tương đối tính theo `cwd`. */
  inputs: string[];
  /** Thư mục output. */
  output: string;
  /** Quét thư mục con khi input là thư mục. */
  recursive?: boolean;
  /** Template tên output, mặc định "{name}.{ext}". Placeholder: {name} {ext} {w} {h} {preset} {dir}. */
  name?: string;
  /** Nhãn preset ghi vào report và dùng cho {preset}. */
  preset?: string;
  /** Số ảnh xử lý song song, mặc định 4. */
  jobs?: number;
  /** Chỉ lập kế hoạch: không tạo thư mục, không ghi file nào. */
  dryRun?: boolean;
  /** Khi đích đã tồn tại: error (mặc định) | replace | skip. */
  onConflict?: OnConflict;
  /** Sao lưu file cũ trước khi replace. */
  backup?: boolean;
  /** Thư mục backup, mặc định `<cwd>/.imgfit/backups`. */
  backupDir?: string;
  /** Thư mục làm việc, mặc định process.cwd(). */
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (event: ProgressEvent) => void;
}

const EXT_FOR: Record<OutputFormat, string[]> = { jpg: [".jpg", ".jpeg"], png: [".png"], webp: [".webp"], avif: [".avif"] };

interface Entry {
  input: InputFile;
  result: FileResult;
  probe?: ProbeResult;
  plan?: TransformPlan;
  dest?: string;
  destRel?: string;
}

export function validateResizeOptions(opts: ResizeOptions): void {
  validateTransformOptions(opts);
  if (!opts.output || opts.output.trim() === "") throw new ImgfitError("E_USAGE", "Cần --output <thư mục>");
  const jobs = opts.jobs ?? DEFAULT_JOBS;
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) {
    throw new ImgfitError("E_USAGE", `jobs phải là số nguyên trong [1, ${MAX_JOBS}], nhận ${jobs}`);
  }
  if (opts.onConflict && !["error", "replace", "skip"].includes(opts.onConflict)) {
    throw new ImgfitError("E_USAGE", `onConflict không hợp lệ: ${opts.onConflict}`);
  }
  validateTemplate(opts.name ?? DEFAULT_NAME_TEMPLATE);
}

/** Options ảnh hưởng tới bytes output — dùng cho fingerprint. */
function effectiveOptions(opts: ResizeOptions, plan: TransformPlan): Record<string, unknown> {
  return {
    width: opts.width,
    height: opts.height,
    mode: opts.mode,
    format: plan.outputFormat,
    quality: opts.quality,
    upscale: opts.upscale ?? false,
    smallInput: opts.smallInput,
    position: opts.position,
    focalPoint: opts.focalPoint,
    background: opts.background,
    sharpen: opts.sharpen,
    stripMetadata: opts.stripMetadata ?? true,
    png: opts.png,
  };
}

/**
 * Resize hàng loạt. Quy trình: thu thập input → probe + lập kế hoạch từng file → phát hiện trùng đích
 * (có trùng là dừng toàn bộ, không ghi gì) → xử lý song song có giới hạn → ghi tạm, xác minh, publish an toàn.
 * Lỗi tham số/không tìm thấy input sẽ throw ImgfitError; lỗi từng file nằm trong report.
 */
export async function resize(opts: ResizeOptions): Promise<Report> {
  const startedAt = new Date();
  validateResizeOptions(opts);
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const outputRoot = path.resolve(cwd, opts.output);
  const template = opts.name ?? DEFAULT_NAME_TEMPLATE;
  const onConflict: OnConflict = opts.onConflict ?? "error";
  const jobs = opts.jobs ?? DEFAULT_JOBS;
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const backupRoot = path.resolve(cwd, opts.backupDir ?? ".imgfit/backups");

  try {
    const st = await stat(outputRoot);
    if (!st.isDirectory()) throw new ImgfitError("E_USAGE", `--output không phải thư mục: ${opts.output}`);
  } catch (err) {
    if (err instanceof ImgfitError) throw err;
    // chưa tồn tại: sẽ được tạo khi ghi (không tạo khi dry-run)
  }

  const display = (abs: string) => toPosix(isInside(cwd, abs) ? path.relative(cwd, abs) || "." : abs);

  const inputs = await collectInputs(opts.inputs, { cwd, recursive: opts.recursive ?? false });
  const limit = pLimit(jobs);

  // 1) Probe + plan + render đích (song song, chỉ đọc metadata)
  const entries: Entry[] = await Promise.all(
    inputs.map((input) =>
      limit(async (): Promise<Entry> => {
        const t0 = Date.now();
        const result: FileResult = {
          file: display(input.abs),
          destination: null,
          status: "planned",
          preset: opts.preset ?? null,
          format: null,
          inputBytes: null,
          outputBytes: null,
          inputPx: null,
          outputPx: null,
          elapsedMs: 0,
          fingerprint: null,
          warnings: [],
          errors: [],
        };
        const entry: Entry = { input, result };
        try {
          const p = await probe(input.abs, opts.limitInputPixels);
          entry.probe = p;
          result.inputBytes = p.bytes;
          result.inputPx = [p.width, p.height];
          const plan = planTransform(p, opts);
          entry.plan = plan;
          result.format = plan.outputFormat;
          result.outputPx = [plan.outputSize.width, plan.outputSize.height];
          result.warnings.push(...plan.warnings);

          const rel = renderTemplate(template, {
            name: path.parse(input.abs).name,
            ext: plan.outputFormat,
            w: opts.width,
            h: opts.height,
            ...(opts.preset ? { preset: opts.preset } : {}),
            dir: input.dir,
          });
          const dest = path.resolve(outputRoot, rel);
          if (!isInside(outputRoot, dest)) throw new ImgfitError("E_PATH_UNSAFE", `Đích nằm ngoài --output: ${rel}`);
          if (!EXT_FOR[plan.outputFormat].includes(path.extname(dest).toLowerCase())) {
            throw new ImgfitError("E_EXTENSION_MISMATCH", `Đuôi "${path.extname(dest)}" không khớp định dạng ${plan.outputFormat}; dùng {ext} trong --name`, {
              destination: toPosix(rel),
            });
          }
          entry.dest = dest;
          entry.destRel = rel;
          result.destination = display(dest);
        } catch (err) {
          result.status = "failed";
          result.errors.push(normalizeError(err, { path: result.file }).toIssue());
        }
        result.elapsedMs = Date.now() - t0;
        return entry;
      }),
    ),
  );

  // 2) Preflight toàn batch: trùng đích (không phân biệt hoa/thường, NFC) và đích = nguồn
  const batchErrors: Issue[] = [];
  const byKey = new Map<string, Entry[]>();
  const sourceKeys = new Set(entries.map((e) => collisionKey(e.input.abs)));
  for (const e of entries) {
    if (!e.dest) continue;
    const key = collisionKey(e.dest);
    if (sourceKeys.has(key)) {
      const issue = new ImgfitError("E_OUTPUT_SAME_AS_SOURCE", `Output trùng với một file nguồn: ${e.result.destination}`, {
        destination: e.result.destination,
      }).toIssue();
      e.result.errors.push(issue);
      e.result.status = "failed";
      batchErrors.push(issue);
    }
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const files = list.map((e) => e.result.file);
    const issue = new ImgfitError("E_OUTPUT_COLLISION", `${list.length} input cùng ghi vào ${list[0]?.result.destination}`, {
      destination: list[0]?.result.destination,
      inputs: files,
    }).toIssue();
    batchErrors.push(issue);
    for (const e of list) {
      e.result.status = "failed";
      e.result.errors.push(issue);
    }
  }

  if (batchErrors.length > 0) {
    // Không ghi gì cả. File không liên quan được đánh dấu cancelled (hoặc giữ planned khi dry-run).
    for (const e of entries) {
      if (e.result.status === "planned" && !opts.dryRun) e.result.status = "cancelled";
    }
    return makeReport("resize", startedAt, opts.dryRun ?? false, entries.map((e) => e.result), batchErrors, false);
  }

  // 3) Kiểm tra đích đã tồn tại / an toàn đường dẫn (trước khi tốn CPU encode)
  for (const e of entries) {
    if (e.result.status !== "planned" || !e.dest) continue;
    try {
      await assertSafeDestination(outputRoot, e.dest);
      let exists = false;
      try {
        await lstat(e.dest);
        exists = true;
      } catch {
        exists = false;
      }
      if (exists && onConflict === "error") {
        throw new ImgfitError("E_OUTPUT_CONFLICT", `Đích đã tồn tại: ${e.result.destination}. Dùng --overwrite để thay hoặc --skip-existing để bỏ qua`, {
          destination: e.result.destination,
        });
      }
      if (exists && onConflict === "skip") {
        e.result.status = "skipped";
        e.result.warnings.push(warning("W_SKIP_EXISTING_UNVERIFIED", "Bỏ qua vì đích đã tồn tại; imgfit KHÔNG kiểm tra output cũ có đúng không"));
      }
    } catch (err) {
      e.result.status = "failed";
      e.result.errors.push(normalizeError(err, { path: e.result.destination ?? e.result.file }).toIssue());
    }
  }

  const total = entries.length;
  let completed = 0;
  let bytesSaved = 0;
  const emit = (type: ProgressEventType, r: FileResult) =>
    opts.onEvent?.({ type, file: r.file, destination: r.destination, completed, total, bytesSaved });

  if (opts.dryRun) {
    return makeReport("resize", startedAt, true, entries.map((e) => e.result), [], false);
  }

  for (const e of entries) {
    if (e.result.status !== "planned") {
      completed += 1;
      emit(e.result.status === "skipped" ? "skipped" : "failed", e.result);
    } else {
      emit("queued", e.result);
    }
  }

  // 4) Xử lý song song có giới hạn
  await Promise.all(
    entries
      .filter((e) => e.result.status === "planned")
      .map((e) =>
        limit(async () => {
          const r = e.result;
          if (opts.signal?.aborted) {
            r.status = "cancelled";
            completed += 1;
            emit("cancelled", r);
            return;
          }
          const t0 = Date.now();
          emit("processing", r);
          const dest = e.dest as string;
          const temp = tempPathFor(dest);
          try {
            await mkdir(path.dirname(dest), { recursive: true });
            await assertSafeDestination(outputRoot, dest);
            const out = await transformToFile(e.input.abs, temp, e.probe as ProbeResult, e.plan as TransformPlan, opts);
            await assertSafeDestination(outputRoot, dest);
            const backupFile = opts.backup ? path.join(backupRoot, runId, e.destRel as string) : undefined;
            const outcome = await publish(temp, dest, { onConflict, ...(backupFile ? { backupFile } : {}) });
            r.status = outcome;
            if (outcome === "skipped") {
              r.warnings.push(warning("W_SKIP_EXISTING_UNVERIFIED", "Đích vừa được tạo bởi tiến trình khác; đã bỏ qua"));
            } else {
              r.outputBytes = out.bytes;
              r.outputPx = [out.width, out.height];
              r.fingerprint = await fingerprint(e.input.abs, effectiveOptions(opts, e.plan as TransformPlan));
              bytesSaved += (r.inputBytes ?? 0) - out.bytes;
            }
          } catch (err) {
            await safeUnlink(temp);
            r.status = "failed";
            r.errors.push(normalizeError(err, { path: r.file }).toIssue());
          }
          r.elapsedMs += Date.now() - t0;
          completed += 1;
          emit(r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "done", r);
        }),
      ),
  );

  const cancelled = entries.some((e) => e.result.status === "cancelled");
  return makeReport("resize", startedAt, false, entries.map((e) => e.result), [], cancelled);
}
