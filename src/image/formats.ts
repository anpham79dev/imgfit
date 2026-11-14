import { ImgfitError } from "../core/errors.js";

export const OUTPUT_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type FormatOption = OutputFormat | "keep";

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

export function parseFormatOption(value: string): FormatOption {
  const v = value.trim().toLowerCase();
  if (v === "keep") return "keep";
  if (v === "jpeg") return "jpg";
  if ((OUTPUT_FORMATS as readonly string[]).includes(v)) return v as OutputFormat;
  throw new ImgfitError("E_USAGE", `--format không hợp lệ: "${value}". Chọn: keep, ${OUTPUT_FORMATS.join(", ")}`);
}

export function resolveOutputFormat(option: FormatOption, detected: DetectedFormat): OutputFormat {
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
