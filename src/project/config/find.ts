import { stat } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../../core/errors.js";
import { CONFIG_FILENAME } from "./types.js";

/** Locates imgfit.json: explicit argument → IMGFIT_CONFIG → walk up from cwd to the filesystem root. */
export async function findConfig(cwd: string, explicit?: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const given = explicit ?? env.IMGFIT_CONFIG;
  if (given) {
    const abs = path.resolve(cwd, given);
    const st = await stat(abs).catch(() => undefined);
    if (st?.isDirectory()) return findConfig(abs, path.join(abs, CONFIG_FILENAME), {});
    if (!st?.isFile()) throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không tìm thấy config: ${given}`, { path: abs });
    return abs;
  }
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if ((await stat(candidate).catch(() => undefined))?.isFile()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ImgfitError("E_CONFIG_NOT_FOUND", `Không tìm thấy ${CONFIG_FILENAME} trong ${cwd} hoặc thư mục cha. Tạo bằng: imgfit init`);
}
