/**
 * Quick mode: temporary sessions, uploads, thumbnails and single-file previews.
 */
import path from "node:path";
import { Router } from "express";
import { normalizeError } from "../../core/errors.js";
import { sanitizeSegment } from "../../core/paths.js";
import { encodeTo, prepareJob } from "../../pipeline/job.js";
import type { ServerContext } from "../context.js";
import { body, isPoint, parseTransform, route } from "../http.js";
import { quickJob } from "../quick-batch.js";
import { notFound } from "../security.js";
import { assertId, LIMITS, parseMax } from "../sessions.js";
import { createUploader } from "../upload.js";

export function sessionRoutes(ctx: ServerContext): Router {
  const r = Router();
  const { sessions } = ctx;
  const upload = createUploader(sessions);

  r.post(
    "/sessions",
    route(async (_req, res) => {
      const s = await sessions.open();
      res.status(201).json({ id: s.id, limits: { fileBytes: LIMITS.fileBytes, filesPerRequest: LIMITS.filesPerRequest, sessionBytes: LIMITS.sessionBytes } });
    }),
  );

  r.delete(
    "/sessions/:id",
    route(async (req, res) => {
      await sessions.close(assertId(req.params.id as string, "Phiên"));
      res.status(204).end();
    }),
  );

  /** Every file is validated by content; invalid ones are reported individually and deleted. */
  r.post(
    "/sessions/:id/uploads",
    route(async (req, res) => {
      const s = sessions.get(req.params.id as string);
      await sessions.assertSpace(Number(req.headers["content-length"] ?? 0));
      const accepted = [];
      const rejected = [];
      for (const f of await upload(req, res)) {
        try {
          const u = await sessions.accept(s, f.path, f.originalname, f.size);
          accepted.push({ id: u.id, name: u.name, bytes: u.bytes, width: u.width, height: u.height, format: u.format, hasAlpha: u.hasAlpha });
        } catch (err) {
          rejected.push({ name: sanitizeSegment(path.basename(f.originalname)), error: normalizeError(err).toIssue() });
        }
      }
      res.status(201).json({ accepted, rejected });
    }),
  );

  r.get(
    "/sessions/:id/files",
    route((req, res) => {
      const s = sessions.get(req.params.id as string);
      res.json({ files: [...s.files.values()].map(({ path: _p, ...rest }) => rest) });
    }),
  );

  r.get(
    "/sessions/:id/files/:fileId/image",
    route(async (req, res) => {
      const s = sessions.get(req.params.id as string);
      const f = sessions.file(s, req.params.fileId as string);
      res.type("image/webp").sendFile(await sessions.image(s, f, parseMax(req.query.max, 256)));
    }),
  );

  /** Encodes one file with the current options — same pipeline as the real output. */
  r.post(
    "/sessions/:id/preview",
    route(async (req, res) => {
      const b = body<{ fileId: string; options: unknown; focal: unknown }>(req);
      const s = sessions.get(req.params.id as string);
      const f = sessions.file(s, b.fileId);
      const job = quickJob(ctx, s, f.id, parseTransform(b.options), isPoint(b.focal) ? b.focal : undefined);
      await prepareJob(job);
      if (job.result.status !== "planned" || !job.plan) {
        res.status(400).json({ errors: job.result.errors, warnings: job.result.warnings });
        return;
      }
      const { id, file } = ctx.previews.allocate(job.plan.outputFormat);
      const out = await encodeTo(job, file);
      const url = ctx.previews.register(id, file);
      res.json({ previewId: id, url, bytes: out.bytes, width: out.width, height: out.height, inputBytes: f.bytes, format: job.plan.outputFormat, warnings: job.result.warnings });
    }),
  );

  r.get(
    "/previews/:id",
    route((req, res) => {
      const file = ctx.previews.get(req.params.id as string);
      if (!file) throw notFound("Preview");
      res.sendFile(file);
    }),
  );

  return r;
}
