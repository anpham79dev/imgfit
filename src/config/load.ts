import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { type TransformOptions, validateTransformOptions } from "../image/options.js";
import { CONFIG_FILENAME, type ConfigFile, type PresetConfig, type PresetConfigSet, type ResolvedPreset } from "./types.js";
import { validateWith } from "./validate.js";

/** Validates config data against config.schema.json; throws E_CONFIG_INVALID listing every problem. */
export async function validateConfigShape(data: unknown, file = CONFIG_FILENAME): Promise<ConfigFile> {
  return validateWith<ConfigFile>("config", data, file, "E_CONFIG_INVALID");
}

async function readConfigJson(abs: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(abs, "utf8")).replace(/^﻿/, ""));
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không tìm thấy ${abs}`);
    throw new ImgfitError("E_CONFIG_INVALID", `${path.basename(abs)} không phải JSON hợp lệ: ${(err as Error).message}`);
  }
}

/** Preset over tool defaults, then validated with the same rules as CLI options. */
export function resolvePreset(name: string, p: PresetConfig): ResolvedPreset {
  const transform: TransformOptions = {
    width: p.size[0],
    height: p.size[1],
    mode: p.mode ?? "fit",
    format: p.format ?? "keep",
    upscale: p.upscale ?? false,
    stripMetadata: p.stripMetadata ?? true,
    ...(p.quality !== undefined ? { quality: p.quality } : {}),
    ...(p.smallInput ? { smallInput: p.smallInput } : {}),
    ...(p.background ? { background: p.background } : {}),
    ...(p.position ? { position: p.position } : {}),
    ...(p.sharpen !== undefined ? { sharpen: p.sharpen } : {}),
    ...(p.png ? { png: p.png } : {}),
    ...(p.jpeg ? { jpeg: p.jpeg } : {}),
    ...(p.keepSmallerSource !== undefined ? { keepSmallerSource: p.keepSmallerSource } : {}),
  };
  try {
    validateTransformOptions(transform);
  } catch (err) {
    throw new ImgfitError("E_CONFIG_INVALID", `preset "${name}": ${(err as Error).message}`);
  }
  return { name, prefix: p.prefix ?? "", transform };
}

/** Loads imgfit.json and resolves every preset. */
export async function loadConfig(file: string): Promise<PresetConfigSet> {
  const abs = path.resolve(file);
  const raw = await validateConfigShape(await readConfigJson(abs), path.basename(abs));
  const presets = new Map<string, ResolvedPreset>();
  for (const [name, p] of Object.entries(raw.presets)) presets.set(name, resolvePreset(name, p));
  return { file: abs, dir: path.dirname(abs), presets };
}
