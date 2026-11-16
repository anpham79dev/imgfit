/**
 * Quick-mode jobs: uploaded session files → outputs inside the session's private directory.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { isInside, toPosix } from "../core/paths.js";
import { newFileResult } from "../core/report.js";
import { renderTemplate } from "../core/template.js";
import type { Point } from "../image/geometry.js";
import type { TransformOptions } from "../image/options.js";
import { executeJobs } from "../pipeline/batch.js";
import { assertExtension, fail, type Job, prepareJob } from "../pipeline/job.js";
import type { Batch } from "./batches.js";
import type { ServerContext } from "./context.js";
import type { Session } from "./sessions.js";

export type QuickTransform = TransformOptions & { name: string };

/** What a quick batch was started with — kept so failed files can be retried with the same settings. */
export interface QuickRequest {
  sessionId: string;
  fileIds: string[];
  options: unknown;
  focal: Record<string, unknown>;
}

/** One job for an uploaded file; a focal point only applies to cover. */
export function quickJob(ctx: ServerContext, s: Session, fileId: string, t: QuickTransform, focal?: Point): Job {
  const f = ctx.sessions.file(s, fileId);
  const { name: _template, ...base } = t;
  const transform: TransformOptions = focal && t.mode === "cover" ? { ...base, position: "focal", focalPoint: focal } : base;
  return { source: f.path, transform, result: newFileResult(f.name), meta: { fileId: f.id, name: f.name } };
}

async function assignDestinations(jobs: Job[], t: QuickTransform, outDir: string): Promise<void> {
  await Promise.all(
    jobs.map(async (j) => {
      await prepareJob(j);
      if (j.result.status !== "planned" || !j.plan) return;
      try {
        const rel = renderTemplate(t.name, { name: path.parse(j.meta?.name as string).name, ext: j.plan.outputFormat, w: t.width, h: t.height, dir: "" });
        const dest = path.resolve(outDir, rel);
        if (!isInside(outDir, dest)) throw new ImgfitError("E_PATH_UNSAFE", `Đích nằm ngoài thư mục output: ${rel}`);
        j.result.destination = toPosix(rel);
        assertExtension(dest, j.plan.outputFormat, j.result.destination);
        j.dest = dest;
      } catch (err) {
        fail(j.result, err);
      }
    }),
  );
}

/** Starts a background batch writing into `<session>/out/<batchId>/`; outputs are registered for download/ZIP. */
export function startQuickBatch(ctx: ServerContext, s: Session, jobs: Job[], t: QuickTransform, request: QuickRequest): Batch {
  return ctx.batches.start(
    "quick",
    async (b, onEvent) => {
      const outDir = path.join(s.dir, "out", b.id);
      await mkdir(outDir, { recursive: true, mode: 0o700 });
      await assignDestinations(jobs, t, outDir);
      const report = await executeJobs("resize", new Date(), jobs, {
        outputRoot: outDir,
        onConflict: "error",
        concurrency: 4,
        dryRun: false,
        backup: false,
        backupRoot: outDir,
        signal: b.controller.signal,
        onEvent,
      });
      report.files.forEach((f, index) => {
        const j = jobs[index];
        if ((f.status === "created" || f.status === "replaced") && j?.dest) b.outputs.push({ index, name: f.destination as string, file: j.dest });
      });
      return report;
    },
    { sessionId: s.id, request },
  );
}
