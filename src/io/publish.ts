import { constants } from "node:fs";
import { copyFile, link, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { ImgfitError, normalizeError } from "../core/errors.js";
import { errnoOf, safeUnlink, withRetry } from "./fs.js";

export type OnConflict = "error" | "replace" | "skip";

export interface PublishOptions {
  onConflict: OnConflict;
  /** When set: copy the existing file here before replacing it. */
  backupFile?: string;
}

export type PublishOutcome = "created" | "replaced" | "skipped";

/** Errnos meaning "this filesystem cannot hard-link" (FAT/exFAT, some network drives). */
const NO_HARDLINK = new Set(["EPERM", "ENOTSUP", "EXDEV", "EINVAL", "ENOSYS", "EMLINK"]);

/** Creates `dest` WITHOUT ever replacing an existing file (guards the race between preflight and write). */
async function createExclusive(temp: string, dest: string): Promise<void> {
  try {
    await link(temp, dest); // a hard link fails atomically with EEXIST if dest exists
    await safeUnlink(temp);
    return;
  } catch (err) {
    const code = errnoOf(err);
    if (code === "EEXIST" || !code || !NO_HARDLINK.has(code)) throw err;
  }
  await copyFile(temp, dest, constants.COPYFILE_EXCL);
  await safeUnlink(temp);
}

/**
 * Moves a verified temp file into place.
 * - dest missing: exclusive create (never overwrites a file another process just created).
 * - dest present: follow `onConflict`. Replace uses rename; atomicity is NOT claimed on every OS.
 * The temp file is always removed, even on failure.
 */
export async function publish(temp: string, dest: string, opts: PublishOptions): Promise<PublishOutcome> {
  try {
    try {
      await createExclusive(temp, dest);
      return "created";
    } catch (err) {
      if (errnoOf(err) !== "EEXIST") throw err;
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
