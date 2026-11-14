import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "./errors.js";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// Ký tự cấm trên Windows + ký tự điều khiển. Áp cho mọi OS để output portable.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_SEGMENT = 200;

/**
 * Làm sạch một segment tên file/thư mục để dùng được trên Windows, macOS, Linux:
 * Unicode NFC, bỏ ký tự cấm, bỏ dấu chấm/khoảng trắng cuối, tránh tên reserved (CON, NUL…).
 */
export function sanitizeSegment(input: string): string {
  let s = input.normalize("NFC").replace(FORBIDDEN_CHARS, "_");
  s = s.replace(/[. ]+$/u, "");
  s = s.replace(/^ +/u, "");
  if (s === "" || s === "." || s === "..") s = "_";
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT);
  return s;
}

/**
 * Khóa so sánh trùng đích. Luôn không phân biệt hoa/thường + NFC, kể cả trên Linux,
 * để output commit được lên repo dùng chung với Windows/macOS.
 */
export function collisionKey(p: string): string {
  return toPosix(p).normalize("NFC").toLowerCase();
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** true nếu `child` nằm trong (hoặc bằng) `parent`; cả hai phải là đường dẫn tuyệt đối đã resolve. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Cha gần nhất đang tồn tại của một đường dẫn (để realpath khi đích chưa được tạo). */
async function nearestExisting(p: string): Promise<string> {
  let current = p;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Kiểm tra `target` nằm trong `root` sau khi giải quyết `..` VÀ symlink/junction.
 * Gọi lại ngay trước thao tác ghi (giảm cửa sổ TOCTOU; không loại bỏ hoàn toàn được trên Node).
 */
export async function assertSafeDestination(root: string, target: string): Promise<void> {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (!isInside(absRoot, absTarget)) {
    throw new ImgfitError("E_PATH_UNSAFE", `Đường dẫn output nằm ngoài thư mục output: ${absTarget}`, { root: absRoot, target: absTarget });
  }

  const realRootBase = await nearestExisting(absRoot);
  const realRoot = path.join(await realpath(realRootBase), path.relative(realRootBase, absRoot));
  const existing = await nearestExisting(absTarget);
  const realExisting = await realpath(existing);
  const realTarget = path.join(realExisting, path.relative(existing, absTarget));
  if (!isInside(realRoot, realTarget)) {
    throw new ImgfitError("E_PATH_UNSAFE", `Output đi qua symlink/junction ra ngoài thư mục output: ${absTarget}`, {
      root: realRoot,
      target: realTarget,
    });
  }

  try {
    const st = await lstat(absTarget);
    if (st.isSymbolicLink()) {
      throw new ImgfitError("E_PATH_UNSAFE", `Không ghi đè lên symlink: ${absTarget}`, { target: absTarget });
    }
    if (st.isDirectory()) {
      throw new ImgfitError("E_OUTPUT_CONFLICT", `Đích là một thư mục: ${absTarget}`, { target: absTarget });
    }
  } catch (err) {
    if (err instanceof ImgfitError) throw err;
    // ENOENT: đích chưa tồn tại — bình thường
  }
}
