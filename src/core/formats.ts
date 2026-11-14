import { ImgfitError } from "./errors.js";

export const OUTPUT_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type FormatOption = OutputFormat | "keep";

/** Đuôi file được quét khi input là thư mục. */
export const INPUT_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "tif", "tiff", "gif"] as const;

/**
 * Định dạng input được nhận (theo `metadata().format` của sharp, tức là theo nội dung file chứ không theo đuôi).
 * `heif` chỉ được nhận khi nén AV1 (tức AVIF); HEIC chưa được hỗ trợ ở v1.
 */
const ACCEPTED_INPUT = new Set(["jpeg", "png", "webp", "tiff", "gif", "heif"]);

export interface DetectedFormat {
  /** Tên định dạng thân thiện: jpeg | png | webp | tiff | gif | avif */
  name: string;
  /** Định dạng output tương ứng khi `format: keep`, hoặc null nếu không giữ được. */
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
      // tiff, gif: đọc được nhưng không có encoder output tương ứng trong v1
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

/** Tên định dạng mà sharp báo lại khi đọc file output, để kiểm tra bytes khớp với đuôi. */
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

export function supportsAlpha(format: OutputFormat): boolean {
  return format !== "jpg";
}
