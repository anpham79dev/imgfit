/**
 * Stable error/warning codes. Part of the public contract (README, result.schema.json):
 * codes may be added, but an existing code must not change meaning without bumping schemaVersion.
 */
export const ERROR_CODES = [
  // usage / input
  "E_USAGE",
  "E_INPUT_NOT_FOUND",
  "E_INPUT_UNSUPPORTED",
  "E_INPUT_CORRUPT",
  "E_INPUT_ANIMATED",
  "E_INPUT_TOO_LARGE",
  "E_SMALL_INPUT",
  "E_FORMAT_UNSUPPORTED",
  // output / filesystem
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
  // config / project
  "E_CONFIG_NOT_FOUND",
  "E_CONFIG_INVALID",
  "E_FORMAT_NOT_ALLOWED",
  "E_NAME_MISSING",
  "E_LOCKED",
  // run / check
  "E_OUTPUT_MODIFIED",
  "E_OUTPUT_MISSING",
  "E_OUTPUT_STALE",
  "E_OUTPUT_NOT_REPRODUCIBLE",
  "E_DIMENSIONS_MISMATCH",
  "E_FORMAT_MISMATCH",
  "E_BUDGET_EXCEEDED",
  // web UI
  "E_FORBIDDEN",
  "E_NOT_FOUND",
  "E_STALE_CONFIRMATION",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const WARNING_CODES = [
  "W_ALPHA_FLATTENED",
  "W_DEFAULT_BACKGROUND",
  "W_SMALL_INPUT_KEPT",
  "W_SMALL_INPUT_PADDED",
  "W_SKIP_EXISTING_UNVERIFIED",
  "W_METADATA_KEPT",
  "W_BLOCK_ROUNDED",
  "W_OUTPUT_UNMANAGED",
  "W_OUTPUT_ORPHAN",
  "W_OUTPUT_MODIFIED",
  "W_DUPLICATE_SOURCE",
  "W_VERSION_MISMATCH",
  "W_STALE_LOCK",
  "W_STATE_REBUILT",
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

const ERRNO_MAP: Record<string, ErrorCode> = {
  ENOENT: "E_INPUT_NOT_FOUND",
  EACCES: "E_PERMISSION",
  EPERM: "E_PERMISSION",
  EROFS: "E_PERMISSION",
  ENOSPC: "E_DISK_FULL",
  EDQUOT: "E_DISK_FULL",
  EEXIST: "E_OUTPUT_CONFLICT",
  ABORT_ERR: "E_CANCELLED",
};

/** libvips/sharp messages that indicate unreadable or damaged input data. */
const CORRUPT_HINTS = ["premature end", "corrupt", "truncated", "bad seek", "read error", "invalid", "not a png", "vipsjpeg", "libspng", "crc"];

/** Converts any error (Node errno, sharp/libvips, ImgfitError) into an ImgfitError with a stable code. */
export function normalizeError(err: unknown, context?: { path?: string }): ImgfitError {
  if (err instanceof ImgfitError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const details = context?.path ? { path: context.path } : undefined;

  const mapped = ERRNO_MAP[errnoCode(err) ?? ""];
  if (mapped) return new ImgfitError(mapped, message, details);

  const lower = message.toLowerCase();
  if (lower.includes("unsupported image format") || lower.includes("input buffer contains unsupported")) {
    return new ImgfitError("E_INPUT_UNSUPPORTED", message, details);
  }
  if (lower.includes("pixel limit")) return new ImgfitError("E_INPUT_TOO_LARGE", message, details);
  if (lower.includes("input file is missing")) return new ImgfitError("E_INPUT_NOT_FOUND", message, details);
  if (CORRUPT_HINTS.some((h) => lower.includes(h))) return new ImgfitError("E_INPUT_CORRUPT", message, details);
  return new ImgfitError("E_INTERNAL", message, details);
}
