import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError } from "../core/errors.js";
import { isInside } from "../core/paths.js";
import { newFileResult } from "../core/report.js";
import { renderTemplate } from "../core/template.js";
import type { Point } from "../image/geometry.js";
import type { TransformOptions } from "../image/options.js";
import { assertExtension, displayPath, fail, type Job, prepareJob } from "../pipeline/job.js";
import type { ProjectConfig, ResolvedRule } from "./config/types.js";
import { destKeyFor, matchSources, type SourceMatch } from "./sources.js";
import { loadCrops, loadNames } from "./state/user-data.js";

export interface ManifestMeta {
  rule: string;
  preset: string;
  /** source relative to roots.input (posix, NFC) — key of names/crops */
  sourceRel: string;
  /** destination relative to the project root (posix) — key of managed/cache */
  destKey: string;
  dir: string;
  id?: string;
}

export interface ManifestJob extends Job {
  meta: ManifestMeta & Record<string, unknown>;
}

export interface Manifest {
  jobs: ManifestJob[];
  names: Map<string, Map<string, string>>;
  crops: Map<string, Point>;
}

/** A focal point from imgfit.crops.json only applies to cover presets. */
function withFocal(t: TransformOptions, focal: Point | undefined): TransformOptions {
  return focal && t.mode === "cover" ? { ...t, position: "focal", focalPoint: focal } : t;
}

/** Renders and validates the destination of a prepared job. */
function assignDestination(cfg: ProjectConfig, rule: ResolvedRule, j: ManifestJob): void {
  const plan = j.plan;
  if (!plan) return;
  if (!cfg.allowedFormats.includes(plan.outputFormat)) {
    throw new ImgfitError("E_FORMAT_NOT_ALLOWED", `Profile "${cfg.profile}" không cho phép output ${plan.outputFormat}; đặt "format" trong preset "${j.meta.preset}"`);
  }
  if (rule.to.includes("{id}") && j.meta.id === undefined) {
    throw new ImgfitError("E_NAME_MISSING", `Chưa có id cho "${j.meta.sourceRel}" trong ${path.basename(rule.namesFile ?? "names")}`, { source: j.meta.sourceRel });
  }
  const rel = renderTemplate(rule.to, {
    name: path.parse(j.source).name,
    ext: plan.outputFormat,
    w: j.transform.width,
    h: j.transform.height,
    preset: j.meta.preset,
    dir: j.meta.dir,
    ...(j.meta.id !== undefined ? { id: j.meta.id } : {}),
  });
  const dest = path.resolve(cfg.outputRoot, rel);
  if (!isInside(cfg.outputRoot, dest)) throw new ImgfitError("E_PATH_UNSAFE", `Đích nằm ngoài roots.output: ${rel}`);
  j.result.destination = displayPath(cfg.dir, dest);
  assertExtension(dest, plan.outputFormat, j.result.destination);
  j.dest = dest;
  j.meta.destKey = destKeyFor(cfg, dest);
}

/**
 * Builds the manifest: every (source × preset) of every rule becomes a job that is probed, planned and
 * has a destination. Per-file errors live in job.result; nothing is written.
 */
export async function buildManifest(cfg: ProjectConfig, opts: { filter?: (m: SourceMatch) => boolean } = {}): Promise<Manifest> {
  const names = new Map<string, Map<string, string>>();
  for (const r of cfg.rules) if (r.namesFile && !names.has(r.namesFile)) names.set(r.namesFile, await loadNames(r.namesFile));
  const crops = await loadCrops(cfg.cropsPath);
  const rules = new Map(cfg.rules.map((r) => [r.id, r]));

  const jobs: ManifestJob[] = [];
  for (const m of await matchSources(cfg)) {
    if (opts.filter && !opts.filter(m)) continue;
    const rule = rules.get(m.rule);
    if (!rule) continue;
    const id = rule.namesFile ? names.get(rule.namesFile)?.get(m.rel) : undefined;
    for (const presetName of rule.presets) {
      const preset = cfg.presets.get(presetName);
      if (!preset) continue;
      jobs.push({
        source: m.abs,
        transform: withFocal(preset.transform, crops.get(m.rel)),
        result: newFileResult(displayPath(cfg.dir, m.abs), { rule: rule.id, preset: presetName }),
        meta: { rule: rule.id, preset: presetName, sourceRel: m.rel, destKey: "", dir: m.dir, ...(id !== undefined ? { id } : {}) },
      });
    }
  }

  const limit = pLimit(cfg.jobs);
  await Promise.all(
    jobs.map((j) =>
      limit(async () => {
        await prepareJob(j);
        if (j.result.status === "failed") return;
        try {
          assignDestination(cfg, rules.get(j.meta.rule) as ResolvedRule, j);
        } catch (err) {
          fail(j.result, err);
        }
      }),
    ),
  );
  return { jobs, names, crops };
}
