import { ImgfitError } from "../core/errors.js";
import { type FormatOption, type OutputFormat, validateFormatOption } from "./formats.js";
import { type CropPosition, type Mode, type Point, SMALL_INPUT_POLICIES, type SmallInputPolicy } from "./geometry.js";
import type { WatermarkSpec } from "./watermark.js";

/** Default input pixel limit (≈ 268 MP, same as sharp's default). Guards against decompression bombs. */
export const DEFAULT_LIMIT_INPUT_PIXELS = 268_402_689;

export const DEFAULT_QUALITY: Record<OutputFormat, number> = { jpg: 80, png: 100, webp: 82, avif: 50 };

/** Everything that determines how one image is transformed. */
export interface TransformOptions {
  width: number;
  height: number;
  mode: Mode;
  format: FormatOption;
  /** 1–100. Defaults per format (jpg 80, webp 82, avif 50). PNG only uses it with palette=true. */
  quality?: number;
  /** Default false: never enlarge small inputs. */
  upscale?: boolean;
  /** Input smaller than the target (see isSmallInput). Default depends on mode: fit → keep, cover/pad → error. skip = no output. */
  smallInput?: SmallInputPolicy;
  /** Cover only. Default center. */
  position?: CropPosition;
  /** Normalised [0,1] coordinates on the auto-oriented image; required when position=focal. */
  focalPoint?: Point;
  /** Background for pad and for flattening alpha into JPG. Hex: #rgb, #rrggbb, #rrggbbaa. */
  background?: string;
  /** Sharpen sigma (0.3–10). Unset = no sharpening. */
  sharpen?: number;
  /** Default true: drop EXIF/XMP/ICC after converting to sRGB. */
  stripMetadata?: boolean;
  png?: { compressionLevel?: number; palette?: boolean };
  /**
   * Default true. When the output has the same format and size as the input but is LARGER, publish the
   * source bytes instead — only if that changes nothing else (no metadata to strip, orientation 1,
   * no watermark). Either way the report gets W_OUTPUT_LARGER.
   */
  keepSmallerSource?: boolean;
  /** progressive: default true (renders gradually on slow connections, usually a little smaller). */
  jpeg?: { progressive?: boolean };
  limitInputPixels?: number;
  /** Logo composited after resizing (see image/watermark.ts). null = explicitly none (overrides a preset). */
  watermark?: WatermarkSpec | null;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseColor(value: string): Rgba {
  const v = value.trim();
  if (!HEX.test(v)) {
    throw new ImgfitError("E_USAGE", `Màu nền không hợp lệ "${value}". Dùng hex: #rgb, #rrggbb hoặc #rrggbbaa`);
  }
  let hex = v.slice(1);
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), alpha: hex.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
}

export function validateTransformOptions(opts: TransformOptions): void {
  const intIn = (name: string, v: number | undefined, min: number, max: number) => {
    if (v === undefined) return;
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new ImgfitError("E_USAGE", `${name} phải là số nguyên trong [${min}, ${max}], nhận ${v}`);
    }
  };
  intIn("width", opts.width, 1, 65_535);
  intIn("height", opts.height, 1, 65_535);
  intIn("quality", opts.quality, 1, 100);
  intIn("png.compressionLevel", opts.png?.compressionLevel, 0, 9);
  if (!["fit", "cover", "pad"].includes(opts.mode)) throw new ImgfitError("E_USAGE", `mode không hợp lệ: ${opts.mode}`);
  validateFormatOption(opts.format);
  if (opts.smallInput && !SMALL_INPUT_POLICIES.includes(opts.smallInput)) {
    throw new ImgfitError("E_USAGE", `smallInput không hợp lệ: ${opts.smallInput}`);
  }
  if (opts.position && !["center", "top", "attention", "focal"].includes(opts.position)) {
    throw new ImgfitError("E_USAGE", `position không hợp lệ: ${opts.position}`);
  }
  if (opts.position === "focal" && !opts.focalPoint) {
    throw new ImgfitError("E_USAGE", "position=focal cần focalPoint {x, y}");
  }
  if (opts.focalPoint) {
    const { x, y } = opts.focalPoint;
    if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new ImgfitError("E_USAGE", `focalPoint phải nằm trong [0,1], nhận (${x}, ${y})`);
    }
  }
  if (opts.sharpen !== undefined && !(Number.isFinite(opts.sharpen) && opts.sharpen >= 0.3 && opts.sharpen <= 10)) {
    throw new ImgfitError("E_USAGE", `sharpen (sigma) phải trong [0.3, 10], nhận ${opts.sharpen}`);
  }
  if (opts.background !== undefined) parseColor(opts.background);
}

/** The options that affect output bytes — one input of the fingerprint. */
export function effectiveOptions(t: TransformOptions, outputFormat: OutputFormat): Record<string, unknown> {
  return {
    width: t.width,
    height: t.height,
    mode: t.mode,
    format: outputFormat,
    quality: t.quality,
    upscale: t.upscale ?? false,
    smallInput: t.smallInput,
    position: t.position,
    focalPoint: t.focalPoint,
    background: t.background,
    sharpen: t.sharpen,
    stripMetadata: t.stripMetadata ?? true,
    png: t.png,
    progressive: outputFormat === "jpg" ? (t.jpeg?.progressive ?? true) : undefined,
    keepSmallerSource: t.keepSmallerSource ?? true,
    watermark: t.watermark ? { ...t.watermark } : undefined,
  };
}
