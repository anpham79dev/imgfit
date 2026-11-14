/**
 * Project mode: config summary, manifest (= run --dry-run), source/output images, previews,
 * focal points (imgfit.crops.json) and id mapping (names files).
 * Paths are never taken verbatim from the client: sources must be matched by a rule and outputs must
 * belong to the latest manifest.
 */
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { run } from "../../commands/run.js";
import { ImgfitError, normalizeError } from "../../core/errors.js";
import { collisionKey, isInside, sanitizeSegment, toPosix } from "../../core/paths.js";
import { displayPath, encodeTo } from "../../pipeline/job.js";
import { CONFIG_FILENAME, type ProjectConfig, type ResolvedRule } from "../../project/config/types.js";
import { buildManifest } from "../../project/manifest.js";
import { matchSources, type SourceMatch } from "../../project/sources.js";
import { loadCrops, loadNames, saveCrops, saveNames } from "../../project/state/user-data.js";
import type { ServerContext } from "../context.js";
import { body, isPoint, route } from "../http.js";
import { notFound } from "../security.js";
import { parseMax, renderImage } from "../sessions.js";

async function sourcesByRel(cfg: ProjectConfig): Promise<Map<string, SourceMatch>> {
  return new Map((await matchSources(cfg)).map((m) => [m.rel, m]));
}

function namesRule(cfg: ProjectConfig, id: unknown): ResolvedRule & { namesFile: string } {
  const rule = cfg.rules.find((r) => r.id === id);
  if (!rule?.namesFile) throw new ImgfitError("E_USAGE", `Rule "${String(id)}" không có file names`);
  return rule as ResolvedRule & { namesFile: string };
}

/** Validates a source → id mapping: sources belong to the rule, ids are non-empty and unique after sanitising. */
function mappingProblems(entries: Array<readonly [string, string]>, sources: Set<string>, ruleId: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [src, id] of entries) {
    if (!sources.has(src)) problems.push(`"${src}" không thuộc rule ${ruleId}`);
    if (!id) problems.push(`"${src}" chưa có id`);
    const key = collisionKey(sanitizeSegment(id));
    if (id && seen.has(key)) problems.push(`id "${id}" trùng giữa "${seen.get(key)}" và "${src}"`);
    seen.set(key, src);
  }
  return problems;
}

export function projectRoutes(ctx: ServerContext): Router {
  const r = Router();
  const cacheDir = (name: string) => path.join(ctx.sessions.base, name);
  const imageKey = (abs: string, max: number) => `${createHash("sha1").update(abs).digest("hex")}-${max}`;

  r.get(
    "/project",
    route(async (_req, res) => {
      try {
        const cfg = await ctx.loadProject();
        res.json({
          configured: true,
          root: toPosix(ctx.root),
          config: CONFIG_FILENAME,
          profile: cfg.profile,
          inputRoot: displayPath(cfg.dir, cfg.inputRoot),
          outputRoot: displayPath(cfg.dir, cfg.outputRoot),
          presets: Object.fromEntries([...cfg.presets].map(([k, p]) => [k, p.transform])),
          rules: cfg.rules.map((x) => ({ id: x.id, presets: x.presets, to: x.to, from: x.from, names: x.namesFile ? displayPath(cfg.dir, x.namesFile) : null })),
          warnings: cfg.warnings,
        });
      } catch (err) {
        res.json({ configured: false, root: toPosix(ctx.root), error: normalizeError(err).toIssue() });
      }
    }),
  );

  /** Manifest = `run --dry-run` + source info for display/crop/naming. Refreshes the output allowlist. */
  r.get(
    "/project/manifest",
    route(async (_req, res) => {
      const cfg = await ctx.loadProject();
      const report = await run({ config: cfg.file, dryRun: true, ...(ctx.env ? { env: ctx.env } : {}) });
      const crops = await loadCrops(cfg.cropsPath);
      ctx.knownDests = new Map();
      const files = report.files.map((f) => {
        const sourceRel = toPosix(path.relative(cfg.inputRoot, path.resolve(cfg.dir, f.file))).normalize("NFC");
        if (f.destination) ctx.knownDests.set(f.destination, sourceRel);
        return { ...f, sourceRel, focal: crops.get(sourceRel) ?? null, mode: f.preset ? (cfg.presets.get(f.preset)?.transform.mode ?? null) : null };
      });
      res.json({ report: { ...report, files } });
    }),
  );

  r.get(
    "/project/image",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const src = typeof req.query.source === "string" ? req.query.source.normalize("NFC") : "";
      const m = (await sourcesByRel(cfg)).get(src);
      if (!m) throw new ImgfitError("E_FORBIDDEN", "Nguồn không thuộc rule nào của dự án");
      const max = parseMax(req.query.max, 256);
      res.type("image/webp").sendFile(await renderImage(m.abs, cacheDir("_project"), imageKey(m.abs, max), max));
    }),
  );

  r.get(
    "/project/output",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const dest = typeof req.query.dest === "string" ? req.query.dest : "";
      const abs = path.resolve(cfg.dir, dest);
      if (!ctx.knownDests.has(dest) || !isInside(cfg.outputRoot, abs)) throw new ImgfitError("E_FORBIDDEN", "Output không thuộc manifest");
      if (!(await stat(abs).catch(() => undefined))) throw notFound("Output");
      const max = parseMax(req.query.max, 512);
      res.type("image/webp").sendFile(await renderImage(abs, cacheDir("_project_out"), imageKey(abs, max), max));
    }),
  );

  /** Encodes what `run` would write for one output, without touching the project. */
  r.post(
    "/project/preview",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const dest = body<{ dest: string }>(req).dest ?? "";
      const sourceRel = ctx.knownDests.get(dest);
      if (sourceRel === undefined) throw new ImgfitError("E_FORBIDDEN", "Output không thuộc manifest");
      const { jobs } = await buildManifest(cfg, { filter: (m) => m.rel === sourceRel });
      const job = jobs.find((j) => j.meta.destKey === dest);
      if (!job) throw new ImgfitError("E_FORBIDDEN", "Output không thuộc manifest");
      if (job.result.status === "failed" || !job.plan) {
        res.status(400).json({ errors: job.result.errors });
        return;
      }
      const { id, file } = ctx.previews.allocate(job.plan.outputFormat);
      const out = await encodeTo(job, file);
      const url = ctx.previews.register(id, file);
      res.json({ previewId: id, url, bytes: out.bytes, width: out.width, height: out.height, inputBytes: job.result.inputBytes, warnings: job.result.warnings });
    }),
  );

  r.put(
    "/project/crops",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const b = body<{ source: string; focal: unknown }>(req);
      const src = (b.source ?? "").normalize("NFC");
      if (!(await sourcesByRel(cfg)).has(src)) throw new ImgfitError("E_FORBIDDEN", "Nguồn không thuộc rule nào của dự án");
      const crops = await loadCrops(cfg.cropsPath);
      if (b.focal === null) crops.delete(src);
      else if (isPoint(b.focal)) crops.set(src, b.focal);
      else throw new ImgfitError("E_USAGE", "focal phải là {x, y} trong [0,1] hoặc null để xóa");
      await saveCrops(cfg.cropsPath, crops);
      res.json({ source: src, focal: crops.get(src) ?? null, file: displayPath(cfg.dir, cfg.cropsPath) });
    }),
  );

  r.get(
    "/project/names",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const rule = namesRule(cfg, req.query.rule);
      const sources = (await matchSources(cfg)).filter((m) => m.rule === rule.id).map((m) => m.rel);
      const names = await loadNames(rule.namesFile);
      res.json({ rule: rule.id, sources, names: Object.fromEntries(sources.filter((s) => names.has(s)).map((s) => [s, names.get(s)])) });
    }),
  );

  /** Replaces the mapping of one rule's sources; entries for other rules in the same file are kept. */
  r.put(
    "/project/names",
    route(async (req, res) => {
      const cfg = await ctx.loadProject();
      const b = body<{ rule: string; names: Record<string, unknown> }>(req);
      const rule = namesRule(cfg, b.rule);
      const sources = new Set((await matchSources(cfg)).filter((m) => m.rule === rule.id).map((m) => m.rel));
      const entries = Object.entries(b.names ?? {}).map(([k, v]) => [k.normalize("NFC"), typeof v === "string" ? v.trim() : ""] as const);
      const missing = [...sources].filter((s) => !entries.some(([k]) => k === s));
      const problems = mappingProblems(entries, sources, rule.id);
      if (problems.length > 0) {
        res.status(400).json({ errors: [{ code: "E_USAGE", message: "Mapping không hợp lệ", details: { problems } }], missing });
        return;
      }
      const names = await loadNames(rule.namesFile);
      for (const s of sources) names.delete(s);
      for (const [src, id] of entries) names.set(src, id);
      await saveNames(rule.namesFile, names);
      res.json({ saved: entries.length, missing, file: displayPath(cfg.dir, rule.namesFile) });
    }),
  );

  return r;
}
