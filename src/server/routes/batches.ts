/**
 * Background batches: start (quick mode), status, SSE progress, cancel, retry, downloads and ZIP.
 */
import path from "node:path";
import { Router } from "express";
import { ImgfitError } from "../../core/errors.js";
import type { Point } from "../../image/geometry.js";
import { writeZip } from "../../io/zip.js";
import type { Batch } from "../batches.js";
import type { ServerContext } from "../context.js";
import { body, isPoint, parseTransform, route } from "../http.js";
import { type QuickRequest, quickJob, startQuickBatch } from "../quick-batch.js";
import { notFound } from "../security.js";
import { assertId } from "../sessions.js";

export function batchRoutes(ctx: ServerContext): Router {
  const r = Router();

  const getBatch = (id: string | undefined): Batch => {
    const b = ctx.batches.get(assertId(id, "Batch"));
    if (!b) throw notFound("Batch");
    return b;
  };

  /** Starts a quick batch over the given files (default: every file of the session). */
  function start(request: QuickRequest): { batchId: string; total: number } {
    const s = ctx.sessions.get(request.sessionId);
    const t = parseTransform(request.options);
    const jobs = request.fileIds.map((id) => quickJob(ctx, s, id, t, isPoint(request.focal[id]) ? (request.focal[id] as Point) : undefined));
    const b = startQuickBatch(ctx, s, jobs, t, request);
    return { batchId: b.id, total: jobs.length };
  }

  r.post(
    "/batches",
    route((req, res) => {
      const b = body<{ sessionId: string; fileIds: unknown; options: unknown; focal: Record<string, unknown> }>(req);
      const s = ctx.sessions.get(b.sessionId);
      const fileIds = Array.isArray(b.fileIds) && b.fileIds.length > 0 ? (b.fileIds as string[]) : [...s.files.keys()];
      if (fileIds.length === 0) throw new ImgfitError("E_USAGE", "Chưa có file nào trong phiên");
      const focal = b.focal && typeof b.focal === "object" ? b.focal : {};
      res.status(202).json(start({ sessionId: s.id, fileIds, options: b.options, focal }));
    }),
  );

  r.get(
    "/batches/:id",
    route((req, res) => {
      const b = getBatch(req.params.id as string);
      res.json({ id: b.id, kind: b.kind, status: b.status, report: b.report ?? null, error: b.error ?? null, outputs: b.outputs.map(({ index, name }) => ({ index, name })) });
    }),
  );

  /** SSE; EventSource reconnects with Last-Event-ID and receives only the events it missed. */
  r.get("/batches/:id/events", (req, res, next) => {
    try {
      const b = getBatch(req.params.id as string);
      const last = Number(req.headers["last-event-id"] ?? req.query.lastEventId ?? 0);
      ctx.batches.subscribe(b, res, Number.isFinite(last) ? last : 0);
    } catch (err) {
      next(err);
    }
  });

  r.post(
    "/batches/:id/cancel",
    route((req, res) => {
      const b = getBatch(req.params.id as string);
      b.controller.abort();
      res.status(202).json({ status: b.status });
    }),
  );

  /** Re-runs only the failed/cancelled files of a finished quick batch, with the same settings. */
  r.post(
    "/batches/:id/retry",
    route((req, res) => {
      const b = getBatch(req.params.id as string);
      if (b.kind !== "quick" || !b.report || !b.request) throw new ImgfitError("E_USAGE", "Chỉ retry được batch resize nhanh đã chạy xong");
      const request = b.request as QuickRequest;
      const failedIds = b.report.files
        .map((f, i) => (f.status === "failed" || f.status === "cancelled" ? request.fileIds[i] : undefined))
        .filter((x): x is string => !!x);
      if (failedIds.length === 0) throw new ImgfitError("E_USAGE", "Không có file lỗi để retry");
      res.status(202).json(start({ ...request, fileIds: failedIds }));
    }),
  );

  r.get(
    "/batches/:id/files/:index",
    route((req, res) => {
      const b = getBatch(req.params.id as string);
      const o = b.outputs.find((x) => x.index === Number(req.params.index));
      if (!o) throw notFound("Output");
      if (req.query.download === "1") res.attachment(path.basename(o.name));
      res.sendFile(o.file);
    }),
  );

  /** Streams a ZIP of the batch outputs; entry names come from the sanitised manifest. */
  r.get(
    "/batches/:id/archive",
    route(async (req, res) => {
      const b = getBatch(req.params.id as string);
      if (b.status === "running") throw new ImgfitError("E_USAGE", "Batch chưa xong");
      if (b.outputs.length === 0) throw new ImgfitError("E_USAGE", "Batch không có output");
      res.setHeader("Content-Type", "application/zip");
      res.attachment(`imgfit-${b.id}.zip`);
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      await writeZip(
        res,
        b.outputs.map((o) => ({ name: o.name, file: o.file })),
        ac.signal,
      ).catch((err: unknown) => {
        if (!ac.signal.aborted) throw err;
      });
      res.end();
    }),
  );

  return r;
}
