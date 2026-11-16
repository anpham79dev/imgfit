import { existsSync } from "node:fs";
import { Router } from "express";
import { versions } from "../../version.js";
import type { ServerContext } from "../context.js";
import { route } from "../http.js";

/** Built-in presets offered in quick mode (L/LL mirror common imgproxy-style size rules). */
export const QUICK_PRESETS = {
  "thumb-256": { width: 256, height: 256, mode: "cover", format: "webp", quality: 82 },
  "avatar-256-jpg": { width: 256, height: 256, mode: "cover", format: "jpg", quality: 90, position: "attention" },
  "web-1920": { width: 1920, height: 1080, mode: "fit", format: "jpg" },
  "icon-512-png": { width: 512, height: 512, mode: "pad", format: "png" },
  "L-640x480": { width: 640, height: 480, mode: "fit", format: "jpg", quality: 80 },
  "LL-1600x1200": { width: 1600, height: 1200, mode: "fit", format: "jpg", quality: 80 },
} as const;

export function systemRoutes(ctx: ServerContext): Router {
  const r = Router();

  r.get("/health", (_req, res) => {
    res.json({ ok: true, versions: versions(), config: existsSync(ctx.configFile) });
  });

  r.get(
    "/presets",
    route(async (_req, res) => {
      const config = await ctx
        .loadPresets()
        .then((cfg) => Object.fromEntries([...cfg.presets].map(([k, p]) => [k, { ...p.transform }])))
        .catch(() => ({})); // no/invalid imgfit.json → built-in presets only
      res.json({ quick: QUICK_PRESETS, config });
    }),
  );

  return r;
}
