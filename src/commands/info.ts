import path from "node:path";
import { toPosix } from "../core/paths.js";
import { RESULT_SCHEMA_VERSION } from "../core/report.js";
import { INPUT_EXTENSIONS, OUTPUT_FORMATS, sharpNameFor } from "../image/formats.js";
import { DEFAULT_LIMIT_INPUT_PIXELS } from "../image/options.js";
import { probe } from "../image/probe.js";
import { sharp } from "../image/sharp.js";
import { versions, type Versions } from "../version.js";

export interface ImageInfo {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  file: string;
  format: string;
  /** Output format used for `--format keep`, or null when it cannot be kept. */
  keepAs: string | null;
  /** Size after EXIF orientation (what a viewer sees). */
  width: number;
  height: number;
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  hasAlpha: boolean;
  space: string;
  hasProfile: boolean;
  bytes: number;
}

/** Reads one image's metadata; writes nothing. Throws ImgfitError for invalid/unsupported images. */
export async function info(file: string, opts: { cwd?: string; limitInputPixels?: number } = {}): Promise<ImageInfo> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const abs = path.resolve(cwd, file);
  const p = await probe(abs, opts.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS);
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    file: toPosix(path.relative(cwd, abs) || abs),
    format: p.format,
    keepAs: p.detected.keepAs,
    width: p.width,
    height: p.height,
    storedWidth: p.storedWidth,
    storedHeight: p.storedHeight,
    orientation: p.orientation,
    hasAlpha: p.hasAlpha,
    space: p.space,
    hasProfile: p.hasProfile,
    bytes: p.bytes,
  };
}

export interface Capabilities {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  versions: Versions;
  /** Input formats imgfit accepts (by content). */
  input: string[];
  /** Extensions scanned when an input is a directory. */
  inputExtensions: string[];
  /** Output formats available in this build. */
  output: string[];
  modes: string[];
  positions: string[];
  /** Raw libvips/sharp support on this machine (for diagnostics). */
  sharpFormats: Record<string, { input: boolean; output: boolean }>;
}

export function capabilities(): Capabilities {
  const f = sharp.format as unknown as Record<string, { input: { file: boolean }; output: { file: boolean } }>;
  const sharpFormats = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { input: Boolean(v.input?.file), output: Boolean(v.output?.file) }]));
  const canRead = (name: string) => sharpFormats[name]?.input ?? false;
  const output = OUTPUT_FORMATS.filter((fmt) => sharpFormats[sharpNameFor(fmt)]?.output ?? false);
  const input = ["jpeg", "png", "webp", "tiff", "gif"].filter(canRead);
  if (canRead("heif")) input.push("avif");
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    versions: versions(),
    input,
    inputExtensions: [...INPUT_EXTENSIONS],
    output,
    modes: ["fit", "cover", "pad"],
    positions: ["center", "top", "attention", "focal"],
    sharpFormats,
  };
}
