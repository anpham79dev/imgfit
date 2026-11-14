import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError, type Issue, warning } from "../core/errors.js";
import { fingerprintFromHash, hashFile } from "../core/fingerprint.js";
import { collisionKey } from "../core/paths.js";
import { type FileResult, makeReport, newFileResult, type Report } from "../core/report.js";
import { effectiveOptions } from "../image/options.js";
import type { TransformPlan } from "../image/plan.js";
import { displayPath, encodeTo } from "../pipeline/job.js";
import { orphanWarning } from "../project/analysis.js";
import type { ProjectConfig, ResolvedPreset } from "../project/config/types.js";
import { buildManifest, type ManifestJob } from "../project/manifest.js";
import { assertInputRoot, openProject, type ProjectOptions } from "../project/open.js";
import { CacheStore } from "../project/state/cache.js";
import { ManagedStore } from "../project/state/managed.js";
import { validateOutput } from "../project/verify.js";

export { validateOutput } from "../project/verify.js";

export type CheckMode = "standard" | "output-only" | "reproducible";

export interface CheckOptions extends ProjectOptions {
  /** standard (default, needs sources) | output-only (outputs + imgfit.managed.json only) | reproducible (re-encode into temp, compare checksums) */
  mode?: CheckMode;
  /** Treat warnings as failures. */
  strict?: boolean;
  /**
   * Only check outputs/sources related to these paths (e.g. staged files in a pre-commit hook).
   * If imgfit.json / names / crops / managed is among them, everything is checked.
   */
  paths?: string[];
}

interface CheckContext {
  cfg: ProjectConfig;
  managed: ManagedStore;
  /** read-only use: the cache is never saved by `check` */
  cache: CacheStore;
  strict: boolean;
  /** undefined = check everything */
  wanted: ((...files: string[]) => boolean) | undefined;
}

const issue = (code: ConstructorParameters<typeof ImgfitError>[0], message: string): Issue => new ImgfitError(code, message).toIssue();

function finalize(r: FileResult, strict: boolean): void {
  if (r.errors.length > 0) r.status = "fail";
  else if (r.warnings.length > 0) r.status = strict ? "fail" : "warn";
  else r.status = "pass";
}

/** Builds the path filter for pre-commit use; touching any project file disables filtering. */
function pathFilter(cfg: ProjectConfig, cwd: string, paths: string[] | undefined): CheckContext["wanted"] {
  if (!paths || paths.length === 0) return undefined;
  const abs = paths.map((p) => path.resolve(cwd, p));
  const projectFiles = [cfg.file, cfg.cropsPath, cfg.managedPath, ...cfg.rules.map((r) => r.namesFile).filter((f): f is string => !!f)].map(collisionKey);
  if (abs.some((p) => projectFiles.includes(collisionKey(p)))) return undefined;
  const keys = new Set(abs.map(collisionKey));
  return (...files) => files.some((f) => keys.has(collisionKey(f)));
}

/**
 * output-only: validates format/size/budget/checksum against imgfit.managed.json.
 * It does NOT prove crops are right or sources unchanged (documented limitation).
 */
async function checkOutputOnly(ctx: CheckContext): Promise<FileResult[]> {
  const { cfg, managed, cache, strict } = ctx;
  const files: FileResult[] = [];
  const limit = pLimit(cfg.jobs);
  await Promise.all(
    [...managed.outputs.entries()].map(([key, entry]) =>
      limit(async () => {
        const dest = path.resolve(cfg.dir, key);
        const src = path.resolve(cfg.inputRoot, entry.source);
        if (ctx.wanted && !ctx.wanted(dest, src)) return;
        const r = newFileResult(displayPath(cfg.dir, src), { destination: displayPath(cfg.dir, dest), rule: entry.rule, preset: entry.preset, fingerprint: entry.fingerprint });
        files.push(r);
        const preset = cfg.presets.get(entry.preset);
        if (!preset || !cfg.rules.some((x) => x.id === entry.rule)) {
          r.warnings.push(warning("W_OUTPUT_ORPHAN", `Rule "${entry.rule}" / preset "${entry.preset}" không còn trong config`));
        } else {
          const v = await validateOutput(cfg, dest, preset);
          Object.assign(r, { outputBytes: v.bytes, outputPx: v.px, format: v.format });
          r.errors.push(...v.errors);
          if (v.bytes !== null && (await cache.hashOf(key, dest)) !== entry.hash) {
            r.errors.push(issue("E_OUTPUT_MODIFIED", "Output khác với bản imgfit đã ghi (bị sửa tay hoặc chưa chạy lại imgfit run)"));
          }
        }
        finalize(r, strict);
      }),
    ),
  );
  return files.sort((a, b) => ((a.destination ?? "") < (b.destination ?? "") ? -1 : 1));
}

/** Checks one manifest job against the plan, managed state and (optionally) a fresh re-encode. */
async function checkJob(ctx: CheckContext, j: ManifestJob, reencodeTo: string | undefined): Promise<void> {
  const r = j.result;
  r.fingerprint = null;
  if (r.status === "failed" || !j.dest || !j.plan) return;
  const plan = j.plan as TransformPlan;
  const v = await validateOutput(ctx.cfg, j.dest, ctx.cfg.presets.get(j.meta.preset) as ResolvedPreset, {
    format: plan.outputFormat,
    width: plan.outputSize.width,
    height: plan.outputSize.height,
  });
  r.errors.push(...v.errors);
  r.outputBytes = v.bytes;
  r.outputPx = v.px;
  if (v.bytes === null) return;

  const fp = fingerprintFromHash(await hashFile(j.source), effectiveOptions(j.transform, plan.outputFormat));
  r.fingerprint = fp;
  const entry = ctx.managed.get(j.meta.destKey);
  const current = await ctx.cache.hashOf(j.meta.destKey, j.dest);
  if (!entry) {
    r.warnings.push(warning("W_OUTPUT_UNMANAGED", "Output tồn tại nhưng chưa có trong imgfit.managed.json (chạy imgfit run --adopt hoặc imgfit run)"));
  } else if (current !== entry.hash) {
    r.errors.push(issue("E_OUTPUT_MODIFIED", "Output khác với bản imgfit đã ghi (bị sửa tay?)"));
  } else if (entry.fingerprint !== fp) {
    const why = entry.fingerprint === null ? "Output được adopt, chưa từng do imgfit tạo — chạy imgfit run" : "Nguồn, preset, focal point hoặc version engine đã đổi — chạy imgfit run";
    r.errors.push(issue("E_OUTPUT_STALE", why));
  }

  if (reencodeTo && (await encodeTo(j, reencodeTo)).hash !== current) {
    r.errors.push(issue("E_OUTPUT_NOT_REPRODUCIBLE", "Encode lại từ nguồn cho kết quả khác byte với output trong repo (khác version sharp/libvips/OS hoặc output bị sửa)"));
  }
}

/**
 * `imgfit check`: READ-ONLY. Never encodes into the project, never writes cache/managed/crops, takes no lock.
 * The report fails when any file is `fail` (or `warn` with --strict).
 */
export async function check(opts: CheckOptions = {}): Promise<Report> {
  const startedAt = new Date();
  const cfg = await openProject(opts);
  const mode: CheckMode = opts.mode ?? "standard";
  const warnings: Issue[] = [...cfg.warnings];
  const ctx: CheckContext = {
    cfg,
    managed: await ManagedStore.load(cfg.managedPath),
    cache: await CacheStore.load(cfg.cachePath),
    strict: opts.strict ?? false,
    wanted: pathFilter(cfg, path.resolve(opts.cwd ?? process.cwd()), opts.paths),
  };

  if (mode === "output-only") {
    return makeReport({ command: "check", startedAt, dryRun: false, files: await checkOutputOnly(ctx), warnings });
  }

  await assertInputRoot(cfg, ' (CI không có ảnh nguồn? dùng "--check-mode output-only")');
  const { jobs } = await buildManifest(cfg, ctx.wanted ? { filter: (m) => (ctx.wanted as NonNullable<CheckContext["wanted"]>)(m.abs) } : {});
  const tmp = mode === "reproducible" ? await mkdtemp(path.join(os.tmpdir(), "imgfit-check-")) : undefined;
  try {
    const limit = pLimit(cfg.jobs);
    await Promise.all(
      jobs.map((j, idx) =>
        limit(async () => {
          await checkJob(ctx, j, tmp && j.dest ? path.join(tmp, `${idx}${path.extname(j.dest)}`) : undefined);
          finalize(j.result, ctx.strict);
        }),
      ),
    );
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }

  if (!ctx.wanted) {
    const orphans = orphanWarning(jobs, ctx.managed);
    if (orphans) warnings.push(orphans);
  }
  return makeReport({ command: "check", startedAt, dryRun: false, files: jobs.map((j) => j.result), warnings });
}
