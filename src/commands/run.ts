import path from "node:path";
import pLimit from "p-limit";
import { ImgfitError, type Issue } from "../core/errors.js";
import { fingerprintFromHash, hashFile } from "../core/fingerprint.js";
import { makeReport, type Report } from "../core/report.js";
import { effectiveOptions } from "../image/options.js";
import type { TransformPlan } from "../image/plan.js";
import type { OnConflict } from "../io/publish.js";
import { Progress, type ProgressEvent, runId } from "../pipeline/batch.js";
import { detectCollisions, fail, processJob } from "../pipeline/job.js";
import { flagDuplicateSources, orphanWarning } from "../project/analysis.js";
import type { ProjectConfig } from "../project/config/types.js";
import { type DecideContext, decide, decideAdopt } from "../project/decide.js";
import { buildManifest, type ManifestJob } from "../project/manifest.js";
import { assertInputRoot, openProject, type ProjectOptions } from "../project/open.js";
import type { SourceMatch } from "../project/sources.js";
import { CacheStore } from "../project/state/cache.js";
import { acquireLock } from "../project/state/lock.js";
import { ManagedStore } from "../project/state/managed.js";
import { StateSaver } from "../project/state/saver.js";

export type { ProjectOptions } from "../project/open.js";
export { openProject, assertInputRoot } from "../project/open.js";

export interface RunOptions extends ProjectOptions {
  /** CLI override: --overwrite → replace, --skip-existing → skip. */
  onConflict?: OnConflict;
  dryRun?: boolean;
  backup?: boolean;
  /** Take existing outputs at rule destinations under management (no encoding). */
  adopt?: boolean;
  /** Accept adoption without asking (CI). */
  yes?: boolean;
  /** Asks the user before adopting; false = cancel. Without it (and without `yes`) adoption is an error. */
  confirm?: (destinations: string[]) => Promise<boolean>;
  /** Only process matching sources. Orphans are not reported when filtered. */
  filter?: (m: SourceMatch) => boolean;
  signal?: AbortSignal;
  onEvent?: (event: ProgressEvent) => void;
}

interface RunState {
  cfg: ProjectConfig;
  managed: ManagedStore;
  cache: CacheStore;
  jobs: ManifestJob[];
  warnings: Issue[];
}

/** Hashes every source once (fingerprints + duplicate detection) and decides each job's action. */
async function decideAll(st: RunState, adopt: boolean): Promise<Map<string, string>> {
  const limit = pLimit(st.cfg.jobs);
  const pending = new Map<string, Promise<string>>();
  const hashSource = (abs: string) => {
    let p = pending.get(abs);
    if (!p) {
      p = limit(() => hashFile(abs));
      pending.set(abs, p);
    }
    return p;
  };
  const ctx: DecideContext = { managed: st.managed, cache: st.cache, onConflict: st.cfg.onConflict };

  await Promise.all(
    st.jobs.map(async (j) => {
      const r = j.result;
      if (r.status !== "planned" || !j.dest) return;
      try {
        r.fingerprint = fingerprintFromHash(await hashSource(j.source), effectiveOptions(j.transform, (j.plan as TransformPlan).outputFormat));
        await (adopt ? decideAdopt(j, ctx) : decide(j, r.fingerprint, ctx));
      } catch (err) {
        fail(r, err);
      }
    }),
  );

  const hashes = new Map<string, string>();
  for (const [abs, p] of pending) hashes.set(abs, await p);
  return hashes;
}

/** `run --adopt`: records existing outputs (hash only, fingerprint null) after confirmation. */
async function adoptCandidates(st: RunState, opts: RunOptions): Promise<void> {
  const candidates = st.jobs.filter((j) => j.result.action === "adopt");
  if (opts.dryRun || candidates.length === 0) return;
  let ok = opts.yes === true;
  if (!ok) {
    if (!opts.confirm) throw new ImgfitError("E_USAGE", `Có ${candidates.length} output sẽ được adopt; thêm --yes để xác nhận (hoặc chạy trong terminal để được hỏi)`);
    ok = await opts.confirm(candidates.map((j) => j.result.destination ?? ""));
  }
  for (const j of candidates) {
    if (!ok) {
      j.result.status = "skipped";
      continue;
    }
    const hash = (await st.cache.hashOf(j.meta.destKey, j.dest as string)) as string;
    st.managed.set(j.meta.destKey, { rule: j.meta.rule, preset: j.meta.preset, source: j.meta.sourceRel, fingerprint: null, hash, updatedAt: new Date().toISOString() });
    j.result.status = "adopted";
  }
  await st.managed.save();
  await st.cache.save();
}

/** Encodes every job with an action, recording managed/cache state only AFTER each output is published. */
async function processAll(st: RunState, opts: RunOptions, startedAt: Date): Promise<void> {
  const saver = new StateSaver(st.managed, st.cache);
  const id = runId(startedAt);
  const progress = new Progress(st.jobs.length, opts.onEvent);
  progress.announce(st.jobs);
  const limit = pLimit(st.cfg.jobs);

  try {
    await Promise.all(
      st.jobs
        .filter((j) => j.result.status === "planned")
        .map((j) =>
          limit(async () => {
            const r = j.result;
            if (opts.signal?.aborted) {
              r.status = "cancelled";
              progress.emit("cancelled", r);
              return;
            }
            const t0 = Date.now();
            progress.emit("processing", r);
            try {
              const res = await processJob(j, {
                outputRoot: st.cfg.outputRoot,
                onConflict: r.action === "create" ? "error" : "replace",
                ...(opts.backup && r.action === "replace" ? { backupFile: path.join(st.cfg.stateDir, "backups", id, j.meta.destKey) } : {}),
              });
              r.status = res.outcome === "skipped" ? "skipped" : res.outcome;
              r.outputBytes = res.bytes;
              r.outputPx = [res.width, res.height];
              progress.bytesSaved += (r.inputBytes ?? 0) - res.bytes;
              st.managed.set(j.meta.destKey, {
                rule: j.meta.rule,
                preset: j.meta.preset,
                source: j.meta.sourceRel,
                fingerprint: r.fingerprint,
                hash: res.hash,
                updatedAt: new Date().toISOString(),
              });
              await st.cache.record(j.meta.destKey, j.dest as string, res.hash);
              saver.schedule();
            } catch (err) {
              fail(r, err);
            }
            r.elapsedMs += Date.now() - t0;
            progress.emit(r.status === "failed" ? "failed" : "done", r);
          }),
        ),
    );
  } finally {
    await saver.final();
  }
}

/**
 * `imgfit run`: applies the rules in imgfit.json incrementally.
 * - destination missing → create
 * - managed destination: nothing changed and output untouched → unchanged (no encode); changed → replace;
 *   edited by hand → E_OUTPUT_MODIFIED (unless --overwrite)
 * - existing but unmanaged destination → E_OUTPUT_CONFLICT (suggests --adopt / --overwrite)
 */
export async function run(opts: RunOptions = {}): Promise<Report> {
  const startedAt = new Date();
  const cfg = await openProject(opts);
  await assertInputRoot(cfg);
  const dryRun = opts.dryRun ?? false;
  const command = opts.adopt ? "adopt" : "run";
  const warnings: Issue[] = [...cfg.warnings];

  const lock = dryRun ? undefined : await acquireLock(cfg.stateDir, "project", command);
  if (lock) warnings.push(...lock.warnings);
  try {
    const managed = await ManagedStore.load(cfg.managedPath);
    const cache = await CacheStore.load(cfg.cachePath);
    warnings.push(...cache.warnings);
    const { jobs } = await buildManifest(cfg, opts.filter ? { filter: opts.filter } : {});
    const st: RunState = { cfg, managed, cache, jobs, warnings };
    const report = (extra: { errors?: Issue[]; cancelled?: boolean } = {}) =>
      makeReport({ command, startedAt, dryRun, files: jobs.map((j) => j.result), warnings, ...extra });

    const batchErrors = detectCollisions(jobs);
    if (batchErrors.length > 0) {
      for (const j of jobs) if (j.result.status === "planned" && !dryRun) j.result.status = "cancelled";
      return report({ errors: batchErrors });
    }

    flagDuplicateSources(jobs, await decideAll(st, opts.adopt ?? false));
    if (!opts.filter) {
      const orphans = orphanWarning(jobs, managed);
      if (orphans) warnings.push(orphans);
    }

    if (opts.adopt) {
      await adoptCandidates(st, opts);
      return report();
    }
    if (dryRun) return report();

    await processAll(st, opts, startedAt);
    return report({ cancelled: jobs.some((j) => j.result.status === "cancelled") });
  } finally {
    await lock?.release();
  }
}
