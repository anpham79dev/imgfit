/**
 * Turns "presets from imgfit.json + inline overrides" into concrete transforms. Shared by resize, exec and
 * the HTTP front-ends, so a preset means the same thing everywhere.
 */
import { ImgfitError } from "../core/errors.js";
import { type TransformOptions, validateTransformOptions } from "../image/options.js";
import type { WatermarkSpec } from "../image/watermark.js";
import type { PresetConfigSet } from "./types.js";

/** One output per input: which preset (if any), its file-name prefix and the final transform. */
export interface Variant {
  preset: string | null;
  prefix: string;
  transform: TransformOptions;
}

/** Every TransformOptions key, in a stable order (used to pick overrides). */
export const TRANSFORM_KEYS = [
  "width",
  "height",
  "mode",
  "format",
  "quality",
  "upscale",
  "smallInput",
  "position",
  "focalPoint",
  "background",
  "sharpen",
  "stripMetadata",
  "png",
  "jpeg",
  "keepSmallerSource",
  "limitInputPixels",
  "watermark",
] as const satisfies ReadonlyArray<keyof TransformOptions>;

/** The TransformOptions fields that are set (not undefined) in `o`. */
export function pickTransform(o: Partial<TransformOptions>): Partial<TransformOptions> {
  const out: Record<string, unknown> = {};
  for (const k of TRANSFORM_KEYS) if (o[k] !== undefined) out[k] = o[k];
  return out as Partial<TransformOptions>;
}

/** A focal point implies position=focal unless a position was given explicitly. */
function finish(t: TransformOptions, overrides: Partial<TransformOptions>): TransformOptions {
  if (t.focalPoint && !overrides.position) t.position = "focal";
  validateTransformOptions(t);
  return t;
}

/**
 * - presets given: each preset overlaid with the overrides (only fields that are set)
 * - no presets: the overrides alone; width/height required, mode defaults to fit, format to keep
 */
/** Overrides as callers give them: a watermark may be named (looked up in imgfit.json) or null (none). */
export type TransformOverrides = Omit<Partial<TransformOptions>, "watermark"> & { watermark?: WatermarkSpec | string | null };

/** True when resolving these overrides needs imgfit.json. */
export const needsConfig = (presetNames: string[] | undefined, overrides: TransformOverrides): boolean => !!presetNames?.length || typeof overrides.watermark === "string";

export function resolveVariants(presetNames: string[] | undefined, overrides: TransformOverrides, cfg: PresetConfigSet | undefined): Variant[] {
  const { watermark: wm, ...rest } = overrides;
  const o = pickTransform(rest);
  if (typeof wm === "string") {
    const spec = cfg?.watermarks.get(wm);
    if (!spec) throw new ImgfitError("E_USAGE", `Watermark "${wm}" không có trong ${cfg?.file ?? "imgfit.json"}`, { available: [...(cfg?.watermarks.keys() ?? [])] });
    o.watermark = spec;
  } else if (wm !== undefined) {
    o.watermark = wm;
  }
  if (!presetNames || presetNames.length === 0) {
    if (o.width === undefined || o.height === undefined) throw new ImgfitError("E_USAGE", "Cần kích thước (--size / size) hoặc preset (--preset / preset)");
    return [{ preset: null, prefix: "", transform: finish({ mode: "fit", format: "keep", ...o } as TransformOptions, o) }];
  }
  const seen = new Set<string>();
  return presetNames.map((name) => {
    if (seen.has(name)) throw new ImgfitError("E_USAGE", `Preset "${name}" bị lặp`);
    seen.add(name);
    const p = cfg?.presets.get(name);
    if (!p) throw new ImgfitError("E_USAGE", `Preset "${name}" không có trong ${cfg?.file ?? "imgfit.json"}`, { available: [...(cfg?.presets.keys() ?? [])] });
    try {
      return { preset: name, prefix: p.prefix, transform: finish({ ...p.transform, ...o }, o) };
    } catch (err) {
      throw new ImgfitError("E_USAGE", `preset "${name}": ${(err as Error).message}`);
    }
  });
}
