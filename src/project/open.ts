import { stat } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import type { OnConflict } from "../io/publish.js";
import { findConfig } from "./config/find.js";
import { loadConfig } from "./config/load.js";
import type { ProjectConfig } from "./config/types.js";

export interface ProjectOptions {
  /** imgfit.json path (or its directory). Default: IMGFIT_CONFIG, then walk up from cwd. */
  config?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  jobs?: number;
}

/** Finds and loads the project config, applying CLI overrides. */
export async function openProject(opts: ProjectOptions & { onConflict?: OnConflict }): Promise<ProjectConfig> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const file = await findConfig(cwd, opts.config, opts.env ?? process.env);
  return loadConfig(file, {
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.jobs !== undefined ? { jobs: opts.jobs } : {}),
    ...(opts.onConflict ? { onConflict: opts.onConflict } : {}),
  });
}

/** Commands that read sources need roots.input to exist; `hint` is appended to the message. */
export async function assertInputRoot(cfg: ProjectConfig, hint = ""): Promise<void> {
  const st = await stat(cfg.inputRoot).catch(() => undefined);
  if (!st?.isDirectory()) {
    throw new ImgfitError("E_INPUT_NOT_FOUND", `Thư mục nguồn roots.input không tồn tại: ${cfg.inputRoot}${hint}`, { path: cfg.inputRoot });
  }
}
