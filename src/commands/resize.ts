import { stat } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError } from "../core/errors.js";
import { isInside } from "../core/paths.js";
import { newFileResult, type Report } from "../core/report.js";
import { renderTemplate, validateTemplate } from "../core/template.js";
import { type TransformOptions, validateTransformOptions } from "../image/options.js";
import { collectInputs } from "../io/inputs.js";
import type { OnConflict } from "../io/publish.js";
import { executeJobs, type ProgressEvent } from "../pipeline/batch.js";
import { assertExtension, displayPath, fail, type Job, prepareJob } from "../pipeline/job.js";

export const DEFAULT_JOBS = 4;
export const MAX_JOBS = 64;
export const DEFAULT_NAME_TEMPLATE = "{name}.{ext}";

export interface ResizeOptions extends TransformOptions {
  /** Files, directories or globs. Relative paths resolve against `cwd`. */
  inputs: string[];
  /** Output directory. */
  output: string;
  /** Descend into sub-directories when an input is a directory. */
  recursive?: boolean;
  /** Output name template, default "{name}.{ext}". Placeholders: {name} {ext} {w} {h} {preset} {dir}. */
  name?: string;
  /** Preset label recorded in the report and available as {preset}. */
  preset?: string;
  /** Images processed in parallel, default 4. */
  jobs?: number;
  /** Plan only: no directories, no files written. */
  dryRun?: boolean;
  /** When the destination exists: error (default) | replace | skip. */
  onConflict?: OnConflict;
  /** Back up the existing file before replacing it. */
  backup?: boolean;
  /** Backup directory, default `<cwd>/.imgfit/backups`. */
  backupDir?: string;
  /** Working directory, default process.cwd(). */
  cwd?: string;
  signal?: AbortSignal;
  onEvent?: (event: ProgressEvent) => void;
}

export function validateJobs(jobs: number): void {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > MAX_JOBS) {
    throw new ImgfitError("E_USAGE", `jobs phải là số nguyên trong [1, ${MAX_JOBS}], nhận ${jobs}`);
  }
}

export function validateResizeOptions(opts: ResizeOptions): void {
  validateTransformOptions(opts);
  if (!opts.output || opts.output.trim() === "") throw new ImgfitError("E_USAGE", "Cần --output <thư mục>");
  validateJobs(opts.jobs ?? DEFAULT_JOBS);
  if (opts.onConflict && !["error", "replace", "skip"].includes(opts.onConflict)) {
    throw new ImgfitError("E_USAGE", `onConflict không hợp lệ: ${opts.onConflict}`);
  }
  validateTemplate(opts.name ?? DEFAULT_NAME_TEMPLATE);
}

async function assertOutputDir(outputRoot: string, shown: string): Promise<void> {
  const st = await stat(outputRoot).catch(() => undefined);
  // a missing directory is created on first write (never during dry-run)
  if (st && !st.isDirectory()) throw new ImgfitError("E_USAGE", `--output không phải thư mục: ${shown}`);
}

/**
 * Ad-hoc batch resize (no config). Collect inputs → probe + plan each → render destinations → shared
 * executor (collision preflight, bounded parallelism, safe publish).
 * Usage errors and missing inputs throw ImgfitError; per-file errors are in the report.
 */
export async function resize(opts: ResizeOptions): Promise<Report> {
  const startedAt = new Date();
  validateResizeOptions(opts);
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const outputRoot = path.resolve(cwd, opts.output);
  const template = opts.name ?? DEFAULT_NAME_TEMPLATE;
  const concurrency = opts.jobs ?? DEFAULT_JOBS;
  await assertOutputDir(outputRoot, opts.output);

  const inputs = await collectInputs(opts.inputs, { cwd, recursive: opts.recursive ?? false });
  const jobs: Job[] = inputs.map((input) => ({
    source: input.abs,
    transform: opts,
    result: newFileResult(displayPath(cwd, input.abs), { preset: opts.preset ?? null }),
    meta: { dir: input.dir },
  }));

  const limit = pLimit(concurrency);
  await Promise.all(
    jobs.map((j) =>
      limit(async () => {
        await prepareJob(j);
        if (j.result.status !== "planned" || !j.plan) return;
        try {
          const rel = renderTemplate(template, {
            name: path.parse(j.source).name,
            ext: j.plan.outputFormat,
            w: opts.width,
            h: opts.height,
            ...(opts.preset ? { preset: opts.preset } : {}),
            dir: (j.meta?.dir as string) ?? "",
          });
          const dest = path.resolve(outputRoot, rel);
          if (!isInside(outputRoot, dest)) throw new ImgfitError("E_PATH_UNSAFE", `Đích nằm ngoài --output: ${rel}`);
          j.result.destination = displayPath(cwd, dest);
          assertExtension(dest, j.plan.outputFormat, j.result.destination);
          j.dest = dest;
        } catch (err) {
          fail(j.result, err);
        }
      }),
    ),
  );

  return executeJobs("resize", startedAt, jobs, {
    outputRoot,
    onConflict: opts.onConflict ?? "error",
    concurrency,
    dryRun: opts.dryRun ?? false,
    backup: opts.backup ?? false,
    backupRoot: path.resolve(cwd, opts.backupDir ?? ".imgfit/backups"),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
  });
}
