import type { Issue } from "../../core/errors.js";
import type { FormatOption, OutputFormat } from "../../image/formats.js";
import type { CropPosition, Mode, SmallInputPolicy } from "../../image/geometry.js";
import type { TransformOptions } from "../../image/options.js";
import type { OnConflict } from "../../io/publish.js";

export const CONFIG_FILENAME = "imgfit.json";
export const VERSION_PIN_FILENAME = ".imgfit-version";

export type Profile = "generic" | "web" | "unity";

/** Output-format whitelist per profile. A profile is only a set of defaults — the core has no framework branches. */
export const PROFILE_FORMATS: Record<Profile, OutputFormat[]> = {
  generic: ["jpg", "png", "webp", "avif"],
  web: ["jpg", "png", "webp", "avif"],
  unity: ["jpg", "png"],
};

// ── shape of imgfit.json (mirrors schema/config.schema.json) ──

export interface PresetConfig {
  size: [number, number];
  mode?: Mode;
  format?: FormatOption;
  quality?: number;
  upscale?: boolean;
  smallInput?: SmallInputPolicy;
  crop?: { position?: Exclude<CropPosition, "focal"> };
  background?: string;
  sharpen?: number;
  stripMetadata?: boolean;
  png?: { compressionLevel?: number; palette?: boolean };
  blockMultiple?: number;
  maxFileKB?: number;
}

export interface RuleConfig {
  id: string;
  from: string | string[];
  exclude?: string[];
  preset: string | string[];
  to: string;
  names?: string;
}

export interface ConfigDefaults {
  upscale?: boolean;
  stripMetadata?: boolean;
  onConflict?: OnConflict;
  jobs?: number;
  smallInput?: SmallInputPolicy;
  background?: string;
  quality?: number;
}

export interface ConfigFile {
  $schema?: string;
  schemaVersion: 1;
  profile?: Profile;
  env?: string[];
  roots?: { input?: string; output?: string };
  defaults?: ConfigDefaults;
  presets: Record<string, PresetConfig>;
  rules: RuleConfig[];
  budget?: { maxFileKB?: number };
  cache?: { path?: string };
  cropOverrides?: { path?: string };
  managed?: { path?: string };
}

// ── resolved, ready-to-use project ──

export interface ResolvedPreset {
  name: string;
  transform: TransformOptions;
  maxFileKB: number | undefined;
}

export interface ResolvedRule {
  id: string;
  from: string[];
  exclude: string[];
  presets: string[];
  to: string;
  namesFile: string | undefined;
}

export interface ProjectConfig {
  /** absolute path of imgfit.json */
  file: string;
  /** directory containing imgfit.json — the project root; every relative path resolves from here */
  dir: string;
  raw: ConfigFile;
  profile: Profile;
  allowedFormats: OutputFormat[];
  inputRoot: string;
  outputRoot: string;
  stateDir: string;
  cachePath: string;
  cropsPath: string;
  managedPath: string;
  presets: Map<string, ResolvedPreset>;
  rules: ResolvedRule[];
  jobs: number;
  onConflict: OnConflict;
  warnings: Issue[];
}
