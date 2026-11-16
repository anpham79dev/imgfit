import type { FormatOption } from "../image/formats.js";
import type { CropPosition, Mode, SmallInputPolicy } from "../image/geometry.js";
import type { TransformOptions } from "../image/options.js";

export const CONFIG_FILENAME = "imgfit.json";
export const CONFIG_SCHEMA_VERSION = 2;

// ── shape of imgfit.json (mirrors schema/config.schema.json) ──

export interface PresetConfig {
  size: [number, number];
  /** File-name prefix, available as {prefix} (default template "{prefix}{name}.{ext}"). */
  prefix?: string;
  mode?: Mode;
  format?: FormatOption;
  quality?: number;
  upscale?: boolean;
  smallInput?: SmallInputPolicy;
  position?: Exclude<CropPosition, "focal">;
  background?: string;
  sharpen?: number;
  stripMetadata?: boolean;
  keepSmallerSource?: boolean;
  jpeg?: { progressive?: boolean };
  png?: { compressionLevel?: number; palette?: boolean };
}

export interface ConfigFile {
  $schema?: string;
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  presets: Record<string, PresetConfig>;
}

// ── resolved, ready to use ──

export interface ResolvedPreset {
  name: string;
  prefix: string;
  transform: TransformOptions;
}

export interface PresetConfigSet {
  /** absolute path of imgfit.json */
  file: string;
  /** directory containing imgfit.json; relative paths inside it resolve from here */
  dir: string;
  presets: Map<string, ResolvedPreset>;
}
