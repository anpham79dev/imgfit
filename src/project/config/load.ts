import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImgfitError, type Issue, warning } from "../../core/errors.js";
import type { OnConflict } from "../../io/publish.js";
import { TOOL_VERSION } from "../../version.js";
import { envJobs, expandEnv, resolvePreset, resolveRules } from "./resolve.js";
import { CONFIG_FILENAME, type ConfigFile, PROFILE_FORMATS, type Profile, type ProjectConfig, type ResolvedPreset, VERSION_PIN_FILENAME } from "./types.js";
import { validateWith } from "./validate.js";

/** Validates config data against config.schema.json; throws E_CONFIG_INVALID listing every problem. */
export async function validateConfigShape(data: unknown, file = CONFIG_FILENAME): Promise<ConfigFile> {
  return validateWith<ConfigFile>("config", data, file, "E_CONFIG_INVALID");
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  /** CLI overrides (highest precedence). */
  jobs?: number;
  onConflict?: OnConflict;
}

async function readConfigJson(abs: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(abs, "utf8")).replace(/^﻿/, ""));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không tìm thấy ${abs}`);
    throw new ImgfitError("E_CONFIG_INVALID", `${path.basename(abs)} không phải JSON hợp lệ: ${(err as Error).message}`);
  }
}

async function versionPinWarning(dir: string): Promise<Issue | undefined> {
  const pin = (await readFile(path.join(dir, VERSION_PIN_FILENAME), "utf8").catch(() => ""))?.trim();
  if (!pin || pin === TOOL_VERSION) return undefined;
  return warning("W_VERSION_MISMATCH", `Dự án pin imgfit ${pin} (${VERSION_PIN_FILENAME}) nhưng đang chạy ${TOOL_VERSION}`);
}

/**
 * Loads and fully resolves a project config.
 * Precedence: CLI > IMGFIT_* environment > imgfit.json > profile > tool defaults.
 */
export async function loadConfig(file: string, opts: LoadOptions = {}): Promise<ProjectConfig> {
  const env = opts.env ?? process.env;
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  const raw = await validateConfigShape(await readConfigJson(abs), path.basename(abs));

  const profile: Profile = raw.profile ?? "generic";
  const allowedFormats = PROFILE_FORMATS[profile];
  const allowedEnv = new Set(raw.env ?? []);

  const presets = new Map<string, ResolvedPreset>();
  for (const [name, p] of Object.entries(raw.presets)) {
    presets.set(name, resolvePreset(name, p, raw.defaults ?? {}, profile, allowedFormats, raw.budget?.maxFileKB));
  }

  const warnings: Issue[] = [];
  const pin = await versionPinWarning(dir);
  if (pin) warnings.push(pin);

  return {
    file: abs,
    dir,
    raw,
    profile,
    allowedFormats,
    inputRoot: path.resolve(dir, expandEnv(raw.roots?.input ?? ".", allowedEnv, env, "roots.input")),
    outputRoot: path.resolve(dir, expandEnv(raw.roots?.output ?? ".", allowedEnv, env, "roots.output")),
    stateDir: path.join(dir, ".imgfit"),
    cachePath: path.resolve(dir, raw.cache?.path ?? ".imgfit/cache.json"),
    cropsPath: path.resolve(dir, raw.cropOverrides?.path ?? "imgfit.crops.json"),
    managedPath: path.resolve(dir, raw.managed?.path ?? "imgfit.managed.json"),
    presets,
    rules: resolveRules(raw.rules, presets, dir),
    jobs: opts.jobs ?? envJobs(env) ?? raw.defaults?.jobs ?? 4,
    onConflict: opts.onConflict ?? raw.defaults?.onConflict ?? "error",
    warnings,
  };
}
