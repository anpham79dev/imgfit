/**
 * Bounded-concurrency execution of prepared jobs with explicit destinations, plus progress events.
 * Used by `resize`, `exec` and the web UI's quick mode (no managed state). `run` has its own decision
 * step (managed/unchanged) but emits the same events.
 */
import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError, warning } from "../core/errors.js";
import { assertSafeDestination } from "../core/paths.js";
import { type FileResult, makeReport, type Report } from "../core/report.js";
import type { OnConflict } from "../io/publish.js";
import { resolveDisplayName, isContentNamed } from "./content-name.js";
import { detectCollisions, fail, type Job, jobFingerprint, processJob } from "./job.js";

export type ProgressEventType = "queued" | "processing" | "done" | "skipped" | "failed" | "cancelled";

export interface ProgressEvent {
  type: ProgressEventType;
  file: string;
  destination: string | null;
  completed: number;
  total: number;
  bytesSaved: number;
  /** The file's result (present for done/skipped/failed/cancelled). */
  result?: FileResult;
}

/** Unique, sortable id for one run (used for backup folders). */
export function runId(date: Date): string {
  return `${date.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
}

/** Tracks completion counters and turns them into ProgressEvents. */
export class Progress {
  completed = 0;
  bytesSaved = 0;
  constructor(
    private readonly total: number,
    private readonly onEvent?: (event: ProgressEvent) => void,
  ) {}

  emit(type: ProgressEventType, r: FileResult): void {
    if (type !== "queued" && type !== "processing") this.completed += 1;
    this.onEvent?.({
      type,
      file: r.file,
      destination: r.destination,
      completed: this.completed,
      total: this.total,
      bytesSaved: this.bytesSaved,
      ...(type === "queued" || type === "processing" ? {} : { result: r }),
    });
  }

  /** Announces every job: already-final ones as skipped/failed, the rest as queued. */
  announce(jobs: Job[]): void {
    for (const j of jobs) {
      if (j.result.status === "planned") this.emit("queued", j.result);
      else this.emit(j.result.status === "skipped" ? "skipped" : "failed", j.result);
    }
  }
}

export interface ExecuteOptions {
  outputRoot: string;
  onConflict: OnConflict;
  concurrency: number;
  dryRun: boolean;
  backup: boolean;
  backupRoot: string;
  signal?: AbortSignal;
  onEvent?: (event: ProgressEvent) => void;
}

/** Resolves existing-destination handling before spending CPU on encoding. */
async function preflightDestination(j: Job, o: ExecuteOptions): Promise<void> {
  await assertSafeDestination(o.outputRoot, j.dest as string);
  if (isContentNamed(j.dest as string)) {
    j.result.action = "create"; // the name is only known after encoding
    return;
  }
  const exists = await lstat(j.dest as string).then(
    () => true,
    () => false,
  );
  j.result.action = exists ? "replace" : "create";
  if (exists && o.onConflict === "error") {
    throw new ImgfitError("E_OUTPUT_CONFLICT", `Đích đã tồn tại: ${j.result.destination}. Dùng --overwrite để thay hoặc --skip-existing để bỏ qua`, {
      destination: j.result.destination,
    });
  }
  if (exists && o.onConflict === "skip") {
    j.result.status = "skipped";
    j.result.action = null;
    j.result.warnings.push(warning("W_SKIP_EXISTING_UNVERIFIED", "Bỏ qua vì đích đã tồn tại; imgfit KHÔNG kiểm tra output cũ có đúng không"));
  }
}

/**
 * Runs prepared jobs that already have destinations: collision preflight, existing-destination policy,
 * then bounded parallel processing. A collision aborts the whole batch before anything is written.
 */
export async function executeJobs(command: string, startedAt: Date, jobs: Job[], o: ExecuteOptions): Promise<Report> {
  const files = () => jobs.map((j) => j.result);
  const batchErrors = detectCollisions(jobs);
  if (batchErrors.length > 0) {
    for (const j of jobs) if (j.result.status === "planned" && !o.dryRun) j.result.status = "cancelled";
    return makeReport({ command, startedAt, dryRun: o.dryRun, files: files(), errors: batchErrors });
  }

  for (const j of jobs) {
    if (j.result.status !== "planned" || !j.dest) continue;
    try {
      await preflightDestination(j, o);
    } catch (err) {
      fail(j.result, err);
      j.result.action = null;
    }
  }
  if (o.dryRun) return makeReport({ command, startedAt, dryRun: true, files: files() });

  const id = runId(startedAt);
  const progress = new Progress(jobs.length, o.onEvent);
  progress.announce(jobs);
  const limit = pLimit(o.concurrency);

  await Promise.all(
    jobs
      .filter((j) => j.result.status === "planned")
      .map((j) =>
        limit(async () => {
          const r = j.result;
          if (o.signal?.aborted) {
            r.status = "cancelled";
            progress.emit("cancelled", r);
            return;
          }
          const t0 = Date.now();
          progress.emit("processing", r);
          try {
            const rel = path.relative(o.outputRoot, j.dest as string);
            const res = await processJob(j, {
              outputRoot: o.outputRoot,
              onConflict: o.onConflict,
              ...(o.backup ? { backupFile: path.join(o.backupRoot, id, rel) } : {}),
            });
            r.status = res.outcome;
            j.dest = res.destination;
            if (r.destination) r.destination = resolveDisplayName(r.destination, res.hash.slice("sha256:".length));
            if (res.sameContent) {
              r.action = null;
              r.outputBytes = res.bytes;
              r.outputPx = [res.width, res.height];
              r.warnings.push(warning("W_SAME_CONTENT_EXISTS", "Đích theo hash nội dung đã tồn tại (cùng nội dung); không ghi lại"));
            } else if (res.outcome === "skipped") {
              r.warnings.push(warning("W_SKIP_EXISTING_UNVERIFIED", "Đích vừa được tạo bởi tiến trình khác; đã bỏ qua"));
            } else {
              r.action = res.outcome === "created" ? "create" : "replace";
              r.outputBytes = res.bytes;
              r.outputPx = [res.width, res.height];
              r.fingerprint = await jobFingerprint(j);
              progress.bytesSaved += (r.inputBytes ?? 0) - res.bytes;
            }
          } catch (err) {
            fail(r, err);
          }
          r.elapsedMs += Date.now() - t0;
          progress.emit(r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "done", r);
        }),
      ),
  );

  return makeReport({ command, startedAt, dryRun: false, files: files(), cancelled: jobs.some((j) => j.result.status === "cancelled") });
}
