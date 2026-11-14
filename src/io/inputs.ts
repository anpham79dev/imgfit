import { stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { ImgfitError } from "../core/errors.js";
import { toPosix } from "../core/paths.js";
import { INPUT_EXTENSIONS } from "../image/formats.js";

export interface InputFile {
  /** Absolute path. */
  abs: string;
  /** Root of the input (the directory passed in, or the static part of the glob). */
  base: string;
  /** Sub-directory relative to `base`, posix ("" when directly inside base). */
  dir: string;
}

export interface CollectOptions {
  cwd: string;
  recursive?: boolean;
}

const EXT_GLOB = `*.{${INPUT_EXTENSIONS.join(",")}}`;

/** Leading non-glob part of a pattern (e.g. "raw/photos/**\/*.jpg" → "raw/photos"). */
export function staticBase(pattern: string): string {
  const parts = pattern.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (fg.isDynamicPattern(part)) break;
    out.push(part);
  }
  // a fully static pattern ends with a file name, which is not part of the base
  if (out.length === parts.length) out.pop();
  return out.join("/") || ".";
}

/**
 * Each input may be a file, a directory (image extensions; --recursive to descend) or a glob.
 * Globs always use "/" (on Windows "\" is converted). Symlinks are not followed while scanning.
 * Results are de-duplicated and sorted for stable output.
 */
export async function collectInputs(inputs: string[], opts: CollectOptions): Promise<InputFile[]> {
  if (inputs.length === 0) throw new ImgfitError("E_USAGE", "Cần ít nhất một input (file, thư mục hoặc glob)");
  const seen = new Map<string, InputFile>();

  for (const raw of inputs) {
    const asPath = path.resolve(opts.cwd, raw);
    const st = await stat(asPath).catch(() => undefined);

    if (st?.isFile()) {
      add(seen, { abs: asPath, base: path.dirname(asPath), dir: "" });
      continue;
    }

    if (st?.isDirectory()) {
      const pattern = opts.recursive ? `**/${EXT_GLOB}` : EXT_GLOB;
      const found = await fg(pattern, { cwd: asPath, onlyFiles: true, caseSensitiveMatch: false, followSymbolicLinks: false, dot: false });
      for (const rel of found) {
        add(seen, { abs: path.resolve(asPath, rel), base: asPath, dir: toPosix(path.dirname(rel)).replace(/^\.$/, "") });
      }
      continue;
    }

    const pattern = process.platform === "win32" ? raw.replace(/\\/g, "/") : raw;
    if (!fg.isDynamicPattern(pattern)) {
      throw new ImgfitError("E_INPUT_NOT_FOUND", `Không tìm thấy input: ${raw}`, { input: raw });
    }
    const base = path.resolve(opts.cwd, staticBase(pattern));
    const found = await fg(pattern, { cwd: opts.cwd, onlyFiles: true, caseSensitiveMatch: false, followSymbolicLinks: false, absolute: true });
    if (found.length === 0) {
      throw new ImgfitError("E_INPUT_NOT_FOUND", `Glob không khớp file nào: ${raw}`, { input: raw });
    }
    for (const f of found) {
      const abs = path.resolve(f);
      add(seen, { abs, base, dir: toPosix(path.relative(base, path.dirname(abs))) });
    }
  }

  return [...seen.values()].sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0));
}

/** De-duplicates by absolute path; case-insensitive on Windows/macOS filesystems. */
function add(map: Map<string, InputFile>, file: InputFile): void {
  const key = process.platform === "win32" || process.platform === "darwin" ? file.abs.toLowerCase() : file.abs;
  if (!map.has(key)) map.set(key, file);
}
