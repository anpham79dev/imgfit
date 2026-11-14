import { type FSWatcher, watch as fsWatch } from "node:fs";
import path from "node:path";
import { collisionKey, isInside } from "../core/paths.js";
import type { Report } from "../core/report.js";
import type { ProjectConfig } from "../project/config/types.js";
import { openProject } from "../project/open.js";
import { run, type RunOptions } from "./run.js";

export type WatchTrigger = "initial" | "change" | "config";

export interface WatchOptions extends Omit<RunOptions, "filter" | "adopt" | "dryRun"> {
  /** Event coalescing window (ms), default 300. */
  debounceMs?: number;
  /** Called after every run (the first run processes everything). */
  onReport: (report: Report, trigger: WatchTrigger) => void;
  onError?: (err: unknown) => void;
}

/** Files whose change means "re-run everything". */
function projectFileKeys(cfg: ProjectConfig): Set<string> {
  return new Set([cfg.file, cfg.cropsPath, ...cfg.rules.map((r) => r.namesFile).filter((f): f is string => !!f)].map(collisionKey));
}

/**
 * Hidden/temp files (including imgfit's own temp files) and anything under roots.output (our own outputs,
 * when output is nested inside input) must never trigger a new run.
 */
function isIgnored(cfg: ProjectConfig, abs: string): boolean {
  const base = path.basename(abs);
  if (base.startsWith(".") || base.endsWith(".tmp")) return true;
  return cfg.outputRoot !== cfg.inputRoot && isInside(cfg.outputRoot, abs);
}

/** Coalesces filesystem events and runs them one batch at a time. */
class ChangeQueue {
  private pending = new Set<string>();
  private full = false;
  private timer: NodeJS.Timeout | undefined;
  running: Promise<void> = Promise.resolve();

  constructor(
    private readonly debounceMs: number,
    private readonly runBatch: (changed: Set<string> | "all") => Promise<void>,
  ) {}

  add(abs: string, isConfig: boolean): void {
    if (isConfig) this.full = true;
    else this.pending.add(collisionKey(abs));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    this.timer = undefined;
    const batch: Set<string> | "all" = this.full ? "all" : new Set(this.pending);
    this.pending.clear();
    this.full = false;
    this.running = this.running.then(() => this.runBatch(batch));
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * `imgfit run --watch`: one full run, then watch roots.input and the project files.
 * - a source changes → only that source is processed (events coalesced within debounceMs)
 * - imgfit.json / names / crops change → everything is re-run
 * Stops when `signal` aborts.
 */
export async function watch(opts: WatchOptions): Promise<void> {
  const cfg = await openProject(opts);
  const { onReport, onError, debounceMs, ...runOpts } = opts;

  const safeRun = async (filter: RunOptions["filter"], trigger: WatchTrigger) => {
    try {
      onReport(await run({ ...runOpts, ...(filter ? { filter } : {}) }), trigger);
    } catch (err) {
      onError?.(err);
    }
  };

  await safeRun(undefined, "initial");
  if (opts.signal?.aborted) return;

  const projectFiles = projectFileKeys(cfg);
  const queue = new ChangeQueue(debounceMs ?? 300, (changed) =>
    changed === "all" ? safeRun(undefined, "config") : safeRun((m) => changed.has(collisionKey(m.abs)), "change"),
  );

  const watchers: FSWatcher[] = [
    fsWatch(cfg.inputRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const abs = path.resolve(cfg.inputRoot, filename.toString());
      if (!isIgnored(cfg, abs)) queue.add(abs, projectFiles.has(collisionKey(abs)));
    }),
  ];
  if (!isInside(cfg.inputRoot, cfg.dir)) {
    watchers.push(
      fsWatch(cfg.dir, (_event, filename) => {
        if (!filename) return;
        const abs = path.resolve(cfg.dir, filename.toString());
        if (projectFiles.has(collisionKey(abs))) queue.add(abs, true);
      }),
    );
  }

  await new Promise<void>((resolve) => {
    const stop = () => {
      queue.stop();
      for (const w of watchers) w.close();
      void queue.running.then(resolve);
    };
    if (opts.signal?.aborted) stop();
    else opts.signal?.addEventListener("abort", stop, { once: true });
  });
}
