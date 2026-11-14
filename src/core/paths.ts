import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "./errors.js";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// Characters forbidden on Windows + control characters. Applied on every OS so outputs stay portable.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_SEGMENT = 200;

/**
 * Sanitises one file/directory name segment so it works on Windows, macOS and Linux:
 * Unicode NFC, forbidden characters replaced, trailing dots/spaces removed, reserved names (CON, NUL…) avoided.
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
 * Key used to detect destination collisions. Always case-insensitive + NFC, even on Linux,
 * so outputs can be committed to a repo shared with Windows/macOS.
 */
export function collisionKey(p: string): string {
  return toPosix(p).normalize("NFC").toLowerCase();
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** True if `child` is inside (or equal to) `parent`; both must be resolved absolute paths. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Nearest existing ancestor of a path (to realpath a destination that does not exist yet). */
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
 * Asserts that `target` stays inside `root` after resolving `..` AND symlinks/junctions.
 * Called again right before writing (narrows the TOCTOU window; Node cannot eliminate it entirely).
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
    // ENOENT: the destination does not exist yet — expected
  }
}
