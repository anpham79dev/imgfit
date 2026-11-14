/**
 * Small filesystem helpers shared by publishing, state files and the web UI.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function errnoOf(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

/** Windows: an editor/IDE/antivirus may hold a file for a few hundred ms → bounded retry with backoff. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = process.platform === "win32" ? [50, 100, 250, 500, 1000] : [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = errnoOf(err);
      const wait = delays[attempt];
      if (wait === undefined || !code || !RETRYABLE.has(code)) throw err;
      await delay(wait);
    }
  }
}

/** Deletes a file if present, retrying while Windows holds a lock. Never throws (used for temp cleanup). */
export async function safeUnlink(file: string): Promise<void> {
  try {
    await withRetry(() => unlink(file));
  } catch {
    // already gone, or still locked after retries — temp files are named .*.imgfit-*.tmp and safe to delete by hand
  }
}

/**
 * Temp file in the SAME directory as `dest` (so rename never crosses volumes), starting with "." and ending
 * with ".tmp" so Unity, Vite, webpack… ignore it while watching/importing.
 */
export function tempPathFor(dest: string): string {
  return path.join(path.dirname(dest), `.${path.basename(dest)}.imgfit-${randomBytes(6).toString("hex")}.tmp`);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Atomic JSON write (temp file in the same directory → rename). Keys are sorted for stable diffs. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = tempPathFor(file);
  try {
    await writeFile(temp, `${JSON.stringify(sortKeys(data), null, 2)}\n`, "utf8");
    await withRetry(() => rename(temp, file));
  } finally {
    await safeUnlink(temp);
  }
}
