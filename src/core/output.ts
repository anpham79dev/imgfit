import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ImgfitError, normalizeError } from "./errors.js";

export type OnConflict = "error" | "replace" | "skip";

export interface PublishOptions {
  onConflict: OnConflict;
  /** Nếu có: copy file cũ vào đây trước khi thay. */
  backupFile?: string;
}

export type PublishOutcome = "created" | "replaced" | "skipped";

/**
 * File tạm nằm CÙNG thư mục đích (để rename không đi qua ổ khác), bắt đầu bằng "." và kết thúc ".tmp"
 * để Unity, Vite, webpack… bỏ qua khi watch/import.
 */
export function tempPathFor(dest: string): string {
  const dir = path.dirname(dest);
  const base = path.basename(dest);
  return path.join(dir, `.${base}.imgfit-${randomBytes(6).toString("hex")}.tmp`);
}

function errno(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

/** Windows: editor/IDE/antivirus có thể giữ file vài trăm ms → retry có backoff giới hạn. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = process.platform === "win32" ? [50, 100, 250, 500, 1000] : [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = errno(err);
      const wait = delays[attempt];
      if (wait === undefined || !code || !RETRYABLE.has(code)) throw err;
      await delay(wait);
    }
  }
}

/** Xóa file nếu có; retry khi Windows đang khóa file. Không ném lỗi (dùng để dọn file tạm). */
export async function safeUnlink(file: string): Promise<void> {
  try {
    await withRetry(() => unlink(file));
  } catch {
    // đã không còn, hoặc vẫn bị khóa sau khi retry — file tạm có tên .*.imgfit-*.tmp, an toàn để xóa tay
  }
}

/** Tạo đích mà KHÔNG BAO GIỜ thay file đã tồn tại (chống race giữa preflight và ghi). */
async function createExclusive(temp: string, dest: string): Promise<void> {
  try {
    await link(temp, dest); // hard link thất bại với EEXIST nếu đích đã có — nguyên tử
    await safeUnlink(temp);
    return;
  } catch (err) {
    const code = errno(err);
    if (code === "EEXIST") throw err;
    // Filesystem không hỗ trợ hard link (FAT/exFAT, một số ổ mạng) → copy độc quyền
    if (!code || !["EPERM", "ENOTSUP", "EXDEV", "EINVAL", "ENOSYS", "EMLINK"].includes(code)) throw err;
  }
  await copyFile(temp, dest, constants.COPYFILE_EXCL);
  await safeUnlink(temp);
}

/**
 * Đưa file tạm đã được xác minh vào vị trí đích.
 * - Đích chưa có: tạo độc quyền (không đè nếu có process khác vừa tạo).
 * - Đích đã có: theo onConflict. Replace dùng rename; KHÔNG khẳng định nguyên tử trên mọi OS.
 * Luôn dọn file tạm khi kết thúc, kể cả khi lỗi.
 */
export async function publish(temp: string, dest: string, opts: PublishOptions): Promise<PublishOutcome> {
  try {
    try {
      await createExclusive(temp, dest);
      return "created";
    } catch (err) {
      if (errno(err) !== "EEXIST") throw err;
    }

    if (opts.onConflict === "skip") return "skipped";
    if (opts.onConflict === "error") {
      throw new ImgfitError("E_OUTPUT_CONFLICT", `Đích đã tồn tại: ${dest}. Dùng --overwrite để thay`, { path: dest });
    }

    if (opts.backupFile) {
      await mkdir(path.dirname(opts.backupFile), { recursive: true });
      await withRetry(() => copyFile(dest, opts.backupFile as string, constants.COPYFILE_EXCL));
    }
    await withRetry(() => rename(temp, dest));
    return "replaced";
  } catch (err) {
    if (err instanceof ImgfitError) throw err;
    const e = normalizeError(err, { path: dest });
    throw e.code === "E_INTERNAL" || e.code === "E_INPUT_NOT_FOUND" ? new ImgfitError("E_WRITE_FAILED", e.message, { path: dest }) : e;
  } finally {
    await safeUnlink(temp);
  }
}
