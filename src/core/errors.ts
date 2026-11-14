/**
 * Mã lỗi/cảnh báo ổn định. Đây là một phần của hợp đồng công khai (README, result.schema.json):
 * chỉ được thêm mã mới, không đổi nghĩa mã cũ khi chưa tăng schemaVersion.
 */
export const ERROR_CODES = [
  "E_USAGE",
  "E_INPUT_NOT_FOUND",
  "E_INPUT_UNSUPPORTED",
  "E_INPUT_CORRUPT",
  "E_INPUT_ANIMATED",
  "E_INPUT_TOO_LARGE",
  "E_SMALL_INPUT",
  "E_FORMAT_UNSUPPORTED",
  "E_OUTPUT_CONFLICT",
  "E_OUTPUT_COLLISION",
  "E_OUTPUT_SAME_AS_SOURCE",
  "E_OUTPUT_INVALID",
  "E_EXTENSION_MISMATCH",
  "E_PATH_UNSAFE",
  "E_PERMISSION",
  "E_DISK_FULL",
  "E_WRITE_FAILED",
  "E_CANCELLED",
  "E_INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const WARNING_CODES = [
  "W_ALPHA_FLATTENED",
  "W_DEFAULT_BACKGROUND",
  "W_SMALL_INPUT_KEPT",
  "W_SMALL_INPUT_PADDED",
  "W_SKIP_EXISTING_UNVERIFIED",
  "W_METADATA_KEPT",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface Issue {
  code: ErrorCode | WarningCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ImgfitError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ImgfitError";
    this.code = code;
    this.details = details;
  }

  toIssue(): Issue {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }
}

export function warning(code: WarningCode, message: string, details?: Record<string, unknown>): Issue {
  return details ? { code, message, details } : { code, message };
}

function errnoCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}

/** Chuyển lỗi bất kỳ (Node errno, lỗi sharp/libvips, ImgfitError) thành ImgfitError có mã ổn định. */
export function normalizeError(err: unknown, context?: { path?: string }): ImgfitError {
  if (err instanceof ImgfitError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const details = context?.path ? { path: context.path } : undefined;
  const code = errnoCode(err);

  switch (code) {
    case "ENOENT":
      return new ImgfitError("E_INPUT_NOT_FOUND", message, details);
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return new ImgfitError("E_PERMISSION", message, details);
    case "ENOSPC":
    case "EDQUOT":
      return new ImgfitError("E_DISK_FULL", message, details);
    case "EEXIST":
      return new ImgfitError("E_OUTPUT_CONFLICT", message, details);
    case "ABORT_ERR":
      return new ImgfitError("E_CANCELLED", message, details);
    default:
      break;
  }

  const lower = message.toLowerCase();
  if (lower.includes("unsupported image format") || lower.includes("input buffer contains unsupported")) {
    return new ImgfitError("E_INPUT_UNSUPPORTED", message, details);
  }
  if (lower.includes("pixel limit")) {
    return new ImgfitError("E_INPUT_TOO_LARGE", message, details);
  }
  if (lower.includes("input file is missing")) {
    return new ImgfitError("E_INPUT_NOT_FOUND", message, details);
  }
  if (
    lower.includes("premature end") ||
    lower.includes("corrupt") ||
    lower.includes("truncated") ||
    lower.includes("bad seek") ||
    lower.includes("read error") ||
    lower.includes("invalid") ||
    lower.includes("not a png") ||
    lower.includes("vipsjpeg") ||
    lower.includes("libspng") ||
    lower.includes("crc")
  ) {
    return new ImgfitError("E_INPUT_CORRUPT", message, details);
  }
  return new ImgfitError("E_INTERNAL", message, details);
}
