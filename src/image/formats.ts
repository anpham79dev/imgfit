import { ImgfitError } from "../core/errors.js";

export const OUTPUT_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
/** Keep the input format when it is in `keep`, otherwise encode as `fallback`. */
export interface KeepFormat {
  keep: OutputFormat[];
  fallback: OutputFormat;
}
/** A fixed output format, "keep" (input format; error when it cannot be kept) or a whitelist with a fallback. */
export type FormatOption = OutputFormat | "keep" | KeepFormat;

/** File extensions scanned when an input is a directory. */
export const INPUT_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "tif", "tiff", "gif"] as const;

/** Accepted extensions per output format (the first one is canonical). */
export const EXTENSIONS_FOR: Record<OutputFormat, string[]> = { jpg: [".jpg", ".jpeg"], png: [".png"], webp: [".webp"], avif: [".avif"] };

/**
 * Accepted input formats, as reported by sharp's `metadata().format` (i.e. by content, not extension).
 * `heif` is only accepted when AV1-compressed (AVIF); HEIC is not supported.
 */
const ACCEPTED_INPUT = new Set(["jpeg", "png", "webp", "tiff", "gif", "heif"]);

export interface DetectedFormat {
  /** Friendly name: jpeg | png | webp | tiff | gif | avif */
  name: string;
  /** Output format used for `format: keep`, or null when it cannot be kept. */
  keepAs: OutputFormat | null;
}

export function detectInputFormat(sharpFormat: string | undefined, compression: string | undefined): DetectedFormat {
  if (!sharpFormat || !ACCEPTED_INPUT.has(sharpFormat)) {
    throw new ImgfitError("E_INPUT_UNSUPPORTED", `Định dạng input không được hỗ trợ: ${sharpFormat ?? "không xác định"}`, {
      format: sharpFormat ?? null,
    });
  }
  if (sharpFormat === "heif") {
    if (compression !== "av1") {
      throw new ImgfitError("E_INPUT_UNSUPPORTED", "HEIC/HEIF (không phải AVIF) chưa được hỗ trợ ở v1", {
        format: "heif",
        compression: compression ?? null,
      });
    }
    return { name: "avif", keepAs: "avif" };
  }
  switch (sharpFormat) {
    case "jpeg":
      return { name: "jpeg", keepAs: "jpg" };
    case "png":
      return { name: "png", keepAs: "png" };
    case "webp":
      return { name: "webp", keepAs: "webp" };
    default:
      // tiff, gif: readable, but there is no matching output encoder
      return { name: sharpFormat, keepAs: null };
  }
}

export function parseOutputFormat(value: string): OutputFormat {
  const v = value.trim().toLowerCase();
  if (v === "jpeg") return "jpg";
  if ((OUTPUT_FORMATS as readonly string[]).includes(v)) return v as OutputFormat;
  throw new ImgfitError("E_USAGE", `Định dạng không hợp lệ: "${value}". Chọn: ${OUTPUT_FORMATS.join(", ")}`);
}

export function parseFormatOption(value: string): FormatOption {
  if (value.trim().toLowerCase() === "keep") return "keep";
  try {
    return parseOutputFormat(value);
  } catch {
    throw new ImgfitError("E_USAGE", `--format không hợp lệ: "${value}". Chọn: keep, ${OUTPUT_FORMATS.join(", ")}`);
  }
}

export function isKeepFormat(option: FormatOption): option is KeepFormat {
  return typeof option === "object" && option !== null;
}

/** Throws E_USAGE when a format option is malformed (JSON input is not typed). */
export function validateFormatOption(option: unknown): void {
  const valid = (f: unknown) => typeof f === "string" && (OUTPUT_FORMATS as readonly string[]).includes(f);
  if (option === "keep" || valid(option)) return;
  if (option && typeof option === "object") {
    const o = option as Partial<KeepFormat>;
    if (Array.isArray(o.keep) && o.keep.length > 0 && o.keep.every(valid) && valid(o.fallback)) return;
  }
  throw new ImgfitError("E_USAGE", `format không hợp lệ: ${JSON.stringify(option)}. Dùng keep, ${OUTPUT_FORMATS.join(", ")} hoặc {"keep": [...], "fallback": "jpg"}`);
}

export function resolveOutputFormat(option: FormatOption, detected: DetectedFormat): OutputFormat {
  if (isKeepFormat(option)) return detected.keepAs && option.keep.includes(detected.keepAs) ? detected.keepAs : option.fallback;
  if (option !== "keep") return option;
  if (!detected.keepAs) {
    throw new ImgfitError(
      "E_FORMAT_UNSUPPORTED",
      `format=keep không giữ được định dạng "${detected.name}"; hãy chỉ định --format (jpg, png, webp, avif)`,
      { input: detected.name },
    );
  }
  return detected.keepAs;
}

/** Format name sharp reports when reading an output file back (to verify bytes match the extension). */
export function sharpNameFor(format: OutputFormat): string {
  switch (format) {
    case "jpg":
      return "jpeg";
    case "avif":
      return "heif";
    default:
      return format;
  }
}

/** Maps sharp metadata back to an output format, or null if it is not one we produce. */
export function outputFormatOf(sharpFormat: string | undefined, compression: string | undefined): OutputFormat | null {
  return OUTPUT_FORMATS.find((f) => sharpNameFor(f) === sharpFormat && (f !== "avif" || compression === "av1")) ?? null;
}

export function supportsAlpha(format: OutputFormat): boolean {
  return format !== "jpg";
}
