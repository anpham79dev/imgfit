import type { ErrorCode } from "./errors.js";
import type { Report } from "./report.js";

/** Exit code — hợp đồng công khai cho CI và cho mọi ngôn ngữ gọi CLI. */
export const EXIT = {
  OK: 0,
  /** Có ít nhất một file xử lý/check thất bại, hoặc batch bị dừng vì trùng đích. */
  FAILED: 1,
  /** Sai tham số, cấu hình, hoặc không tìm thấy input. */
  USAGE: 2,
  /** Lỗi quyền truy cập/môi trường khiến lệnh không chạy được. */
  ENVIRONMENT: 3,
  /** Bị hủy (Ctrl+C / SIGINT). */
  CANCELLED: 130,
} as const;

export function exitCodeForError(code: ErrorCode): number {
  switch (code) {
    case "E_USAGE":
    case "E_INPUT_NOT_FOUND":
      return EXIT.USAGE;
    case "E_PERMISSION":
    case "E_DISK_FULL":
    case "E_INTERNAL":
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
