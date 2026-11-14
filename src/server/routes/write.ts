/**
 * Review-then-commit writes into the project.
 * preview: dry-run → plan hash + single-use nonce (5 min). commit: re-plan; if the hash differs the project
 * changed since review → E_STALE_CONFIRMATION. Commits always run with backups.
 */
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { run } from "../../commands/run.js";
import { ImgfitError } from "../../core/errors.js";
import type { Report } from "../../core/report.js";
import type { ServerContext } from "../context.js";
import { body, route } from "../http.js";

const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/** Hash of exactly what the user reviewed (destination, status, action, fingerprint, error codes). */
function planHash(report: Report, overwrite: boolean): string {
  const files = report.files.map((f) => [f.destination, f.status, f.action, f.fingerprint, f.errors.map((e) => e.code)]);
  return createHash("sha256").update(JSON.stringify({ overwrite, files })).digest("hex");
}

export function writeRoutes(ctx: ServerContext): Router {
  const r = Router();
  const plan = (config: string, overwrite: boolean) =>
    run({ config, dryRun: true, ...(overwrite ? { onConflict: "replace" as const } : {}), ...(ctx.env ? { env: ctx.env } : {}) });

  r.post(
    "/write/preview",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const overwrite = body<{ overwrite: boolean }>(req).overwrite === true;
      const report = await plan(cfg.file, overwrite);
      const nonce = randomBytes(18).toString("base64url");
      const expires = Date.now() + CONFIRMATION_TTL_MS;
      ctx.confirmations.set(nonce, { hash: planHash(report, overwrite), overwrite, expires });
      res.json({ nonce, expiresAt: new Date(expires).toISOString(), overwrite, report });
    }),
  );

  r.post(
    "/write/commit",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const nonce = body<{ nonce: string }>(req).nonce ?? "";
      const confirmation = ctx.confirmations.get(nonce);
      ctx.confirmations.delete(nonce); // single use
      if (!confirmation || confirmation.expires < Date.now()) {
        throw new ImgfitError("E_STALE_CONFIRMATION", "Xác nhận đã hết hạn hoặc không hợp lệ; xem trước lại");
      }
      if (planHash(await plan(cfg.file, confirmation.overwrite), confirmation.overwrite) !== confirmation.hash) {
        throw new ImgfitError("E_STALE_CONFIRMATION", "Dự án đã thay đổi kể từ lúc xem trước; xem trước và xác nhận lại");
      }
      const b = ctx.batches.start("project", async (batch, onEvent) =>
        run({
          config: cfg.file,
          backup: true,
          ...(confirmation.overwrite ? { onConflict: "replace" as const } : {}),
          ...(ctx.env ? { env: ctx.env } : {}),
          signal: batch.controller.signal,
          onEvent,
        }),
      );
      res.status(202).json({ batchId: b.id });
    }),
  );

  return r;
}
