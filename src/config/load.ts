import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { type TransformOptions, validateTransformOptions } from "../image/options.js";
import { sharp } from "../image/sharp.js";
import { validateWatermarkConfig, type WatermarkConfig, type WatermarkSpec } from "../image/watermark.js";
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

/** Validates a watermark and reads its logo's size (the logo path is relative to imgfit.json). */
export async function resolveWatermark(name: string, c: WatermarkConfig, dir: string): Promise<WatermarkSpec> {
  try {
    validateWatermarkConfig(name, c);
  } catch (err) {
    throw new ImgfitError("E_CONFIG_INVALID", (err as Error).message);
  }
  const file = path.resolve(dir, c.file);
  let meta: { width?: number; height?: number };
  try {
    meta = await sharp(await readFile(file)).metadata();
  } catch (err) {
    throw new ImgfitError("E_CONFIG_INVALID", `watermark "${name}": không đọc được logo ${c.file}: ${(err as Error).message}`, { path: file });
  }
  if (!meta.width || !meta.height) throw new ImgfitError("E_CONFIG_INVALID", `watermark "${name}": logo ${c.file} không có kích thước`);
  return {
    name,
    file,
    logoWidth: meta.width,
    logoHeight: meta.height,
    position: c.position ?? "bottom-right",
    offset: c.offset ?? ["2%", "2%"],
    width: c.width ?? "15%",
    ...(c.minOutput ? { minOutput: c.minOutput } : {}),
    opacity: c.opacity ?? 1,
  };
}

/** Preset over tool defaults, then validated with the same rules as CLI options. */
export function resolvePreset(name: string, p: PresetConfig, watermarks: Map<string, WatermarkSpec> = new Map()): ResolvedPreset {
  const watermark = p.watermark ? watermarks.get(p.watermark) : undefined;
  if (p.watermark && !watermark) throw new ImgfitError("E_CONFIG_INVALID", `preset "${name}": watermark "${p.watermark}" không có trong "watermarks"`);
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
    ...(watermark ? { watermark } : {}),
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
  const dir = path.dirname(abs);
  const watermarks = new Map<string, WatermarkSpec>();
  for (const [name, w] of Object.entries(raw.watermarks ?? {})) watermarks.set(name, await resolveWatermark(name, w, dir));
  const presets = new Map<string, ResolvedPreset>();
  for (const [name, p] of Object.entries(raw.presets)) presets.set(name, resolvePreset(name, p, watermarks));
  return { file: abs, dir, presets, watermarks };
}
