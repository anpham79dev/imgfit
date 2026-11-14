import type { ErrorCode } from "./errors.js";
import type { Report } from "./report.js";

/** Exit codes — public contract for CI and for every language calling the CLI. */
export const EXIT = {
  OK: 0,
  /** At least one file failed processing/check, or the batch was aborted (collision). */
  FAILED: 1,
  /** Bad arguments or config, or input not found. */
  USAGE: 2,
  /** Permission/environment problem that prevents the command from running. */
  ENVIRONMENT: 3,
  /** Cancelled (Ctrl+C / SIGINT). */
  CANCELLED: 130,
} as const;

export function exitCodeForError(code: ErrorCode): number {
  switch (code) {
    case "E_USAGE":
    case "E_INPUT_NOT_FOUND":
    case "E_CONFIG_NOT_FOUND":
    case "E_CONFIG_INVALID":
    case "E_FORMAT_NOT_ALLOWED":
      return EXIT.USAGE;
    case "E_PERMISSION":
    case "E_DISK_FULL":
    case "E_INTERNAL":
    case "E_LOCKED":
      return EXIT.ENVIRONMENT;
    case "E_CANCELLED":
      return EXIT.CANCELLED;
    default:
      return EXIT.FAILED;
  }
}

export function exitCodeFor(report: Report): number {
  switch (report.status) {
    case "ok":
      return EXIT.OK;
    case "cancelled":
      return EXIT.CANCELLED;
    default:
      return EXIT.FAILED;
  }
}
