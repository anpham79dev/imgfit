/**
 * One unit of work — a source image, a transform and a destination — and the shared steps every
 * front-end (resize / run / exec / web UI) uses:
 *   prepare (probe + plan) → preflight collisions → encode to a temp file → verify → publish safely.
 */
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ImgfitError, type Issue, normalizeError, warning } from "../core/errors.js";
import { fingerprint, hashFile } from "../core/fingerprint.js";
import { assertSafeDestination, collisionKey, isInside, toPosix } from "../core/paths.js";
import type { FileResult } from "../core/report.js";
import { transformToFile } from "../image/encode.js";
import { EXTENSIONS_FOR, type OutputFormat } from "../image/formats.js";
import { effectiveOptions, type TransformOptions } from "../image/options.js";
import { planTransform, type TransformPlan } from "../image/plan.js";
import { probe, type ProbeResult } from "../image/probe.js";
import { safeUnlink, tempPathFor } from "../io/fs.js";
import { type OnConflict, publish, type PublishOutcome } from "../io/publish.js";

export interface Job {
  source: string;
  dest?: string;
  transform: TransformOptions;
  result: FileResult;
  probe?: ProbeResult;
  plan?: TransformPlan;
  /** caller-specific data (rule, sourceRel, …) */
  meta?: Record<string, unknown>;
}

/** Posix path relative to `base` when inside it, otherwise absolute. */
export function displayPath(base: string, abs: string): string {
  return toPosix(isInside(base, abs) ? path.relative(base, abs) || "." : abs);
}

export function fail(r: FileResult, err: unknown): void {
  r.status = "failed";
  r.errors.push(normalizeError(err, { path: r.file }).toIssue());
}

/** Probe + plan. Errors are recorded in job.result (never thrown). */
export async function prepareJob(job: Job): Promise<void> {
  const r = job.result;
  const t0 = Date.now();
  try {
    const p = await probe(job.source, job.transform.limitInputPixels);
    job.probe = p;
    r.inputBytes = p.bytes;
    r.inputPx = [p.width, p.height];
    const plan = planTransform(p, job.transform);
    job.plan = plan;
    r.format = plan.outputFormat;
    r.warnings.push(...plan.warnings);
    if (plan.skip) {
      r.status = "skipped";
      r.format = null;
    } else {
      r.outputPx = [plan.outputSize.width, plan.outputSize.height];
    }
  } catch (err) {
    fail(r, err);
  }
  r.elapsedMs += Date.now() - t0;
}

/** Asserts the destination extension matches the real output format. */
export function assertExtension(dest: string, format: OutputFormat, shown: string): void {
  if (!EXTENSIONS_FOR[format].includes(path.extname(dest).toLowerCase())) {
    throw new ImgfitError("E_EXTENSION_MISMATCH", `Đuôi "${path.extname(dest)}" không khớp định dạng ${format}; dùng {ext} trong template`, {
      destination: shown,
    });
  }
}

/**
 * Batch-wide preflight: several jobs writing the same destination (case-insensitive + NFC), or a destination
 * equal to some source. Returns batch-level issues and marks the affected jobs failed.
 * If anything is returned the caller MUST NOT write anything.
 */
export function detectCollisions(jobs: Job[]): Issue[] {
  const batchErrors: Issue[] = [];
  const byKey = new Map<string, Job[]>();
  const sourceKeys = new Set(jobs.map((j) => collisionKey(j.source)));
  for (const j of jobs) {
    if (!j.dest || j.result.status !== "planned") continue;
    const key = collisionKey(j.dest);
    if (sourceKeys.has(key)) {
      const issue = new ImgfitError("E_OUTPUT_SAME_AS_SOURCE", `Output trùng với một file nguồn: ${j.result.destination}`, {
        destination: j.result.destination,
      }).toIssue();
      j.result.status = "failed";
      j.result.errors.push(issue);
      batchErrors.push(issue);
    }
    byKey.set(key, [...(byKey.get(key) ?? []), j]);
  }
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const issue = new ImgfitError("E_OUTPUT_COLLISION", `${list.length} input cùng ghi vào ${list[0]?.result.destination}`, {
      destination: list[0]?.result.destination,
      inputs: list.map((j) => j.result.file),
    }).toIssue();
    batchErrors.push(issue);
    for (const j of list) {
      j.result.status = "failed";
      j.result.errors.push(issue);
    }
  }
  return batchErrors;
}

export async function jobFingerprint(job: Job): Promise<string> {
  return fingerprint(job.source, effectiveOptions(job.transform, (job.plan as TransformPlan).outputFormat));
}

export interface ProcessOptions {
  outputRoot: string;
  onConflict: OnConflict;
  backupFile?: string;
}

export interface ProcessOutcome {
  outcome: PublishOutcome;
  bytes: number;
  width: number;
  height: number;
  /** sha256 of the published output (recorded in managed state / cache) */
  hash: string;
}

/** Why the source bytes cannot replace a larger output, or null when they can. */
function sourceSwapBlocker(job: Job): string | null {
  const p = job.probe as ProbeResult;
  const t = job.transform;
  if (t.keepSmallerSource === false) return "keepSmallerSource=false";
  if (p.orientation !== 1) return "ảnh gốc có EXIF orientation, phải xoay";
  if (t.stripMetadata !== false && (p.hasMetadata || p.hasProfile)) return "ảnh gốc có metadata/ICC cần xóa";
  if (p.space !== "srgb" && p.space !== "b-w") return `ảnh gốc ở không gian màu ${p.space}, phải chuyển sRGB`;
  return null;
}

/**
 * keepSmallerSource: same format + same size but larger than the input → use the input bytes when nothing
 * else would change. Mutates `temp` and the result's warnings; returns the bytes now in `temp`.
 */
async function preferSmallerSource(job: Job, temp: string, encodedBytes: number): Promise<number> {
  const p = job.probe as ProbeResult;
  const plan = job.plan as TransformPlan;
  const sameShape = plan.outputFormat === p.detected.keepAs && plan.outputSize.width === p.width && plan.outputSize.height === p.height;
  if (!sameShape || encodedBytes <= p.bytes) return encodedBytes;
  const blocker = sourceSwapBlocker(job);
  const details = { encodedBytes, sourceBytes: p.bytes, usedSource: blocker === null, ...(blocker ? { reason: blocker } : {}) };
  if (blocker) {
    job.result.warnings.push(warning("W_OUTPUT_LARGER", `Output (${encodedBytes} B) nặng hơn ảnh gốc (${p.bytes} B) nhưng không dùng được ảnh gốc: ${blocker}`, details));
    return encodedBytes;
  }
  await copyFile(job.source, temp);
  job.result.warnings.push(warning("W_OUTPUT_LARGER", `Output (${encodedBytes} B) nặng hơn ảnh gốc (${p.bytes} B) cùng định dạng và kích thước; đã dùng ảnh gốc`, details));
  return p.bytes;
}

/** Encode → verify → (keep smaller source) → publish. Throws ImgfitError on failure; always removes the temp file. */
export async function processJob(job: Job, opts: ProcessOptions): Promise<ProcessOutcome> {
  const dest = job.dest as string;
  const temp = tempPathFor(dest);
  try {
    await assertSafeDestination(opts.outputRoot, dest);
    await mkdir(path.dirname(dest), { recursive: true });
    await assertSafeDestination(opts.outputRoot, dest);
    const out = await transformToFile(job.source, temp, job.probe as ProbeResult, job.plan as TransformPlan, job.transform);
    out.bytes = await preferSmallerSource(job, temp, out.bytes);
    const hash = `sha256:${await hashFile(temp)}`;
    await assertSafeDestination(opts.outputRoot, dest);
    const outcome = await publish(temp, dest, { onConflict: opts.onConflict, ...(opts.backupFile ? { backupFile: opts.backupFile } : {}) });
    return { outcome, bytes: out.bytes, width: out.width, height: out.height, hash };
  } finally {
    await safeUnlink(temp);
  }
}

/** Encodes to a caller-chosen file without publishing (UI previews). */
export async function encodeTo(job: Job, file: string): Promise<{ bytes: number; width: number; height: number; hash: string }> {
  const out = await transformToFile(job.source, file, job.probe as ProbeResult, job.plan as TransformPlan, job.transform);
  return { ...out, hash: `sha256:${await hashFile(file)}` };
}
