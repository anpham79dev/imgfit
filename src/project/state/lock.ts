import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImgfitError, type Issue, warning } from "../../core/errors.js";

/** A lock older than this is considered stale (process died without cleaning up). */
export const LOCK_TTL_MS = 60 * 60 * 1000;

interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
  command: string;
}

export interface Lock {
  release: () => Promise<void>;
  warnings: Issue[];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM"; // exists, but owned by someone else
  }
}

async function readLock(file: string): Promise<LockInfo | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LockInfo;
  } catch {
    return undefined;
  }
}

const isStale = (cur: LockInfo | undefined) =>
  !cur || Date.now() - Date.parse(cur.startedAt) > LOCK_TTL_MS || (cur.host === os.hostname() && !alive(cur.pid));

/**
 * Project-wide lock at `.imgfit/locks/<name>.lock`, created with the exclusive "wx" flag.
 * A lock held by a dead process (same host) or past its TTL is replaced, with a W_STALE_LOCK warning.
 */
export async function acquireLock(stateDir: string, name: string, command: string): Promise<Lock> {
  const dir = path.join(stateDir, "locks");
  const file = path.join(dir, `${name}.lock`);
  await mkdir(dir, { recursive: true });
  const info: LockInfo = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command };
  const warnings: Issue[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, JSON.stringify(info), { flag: "wx" });
      return {
        warnings,
        release: async () => {
          const cur = await readLock(file);
          // only remove the lock if it is still ours
          if (cur?.pid === info.pid && cur.host === info.host) await unlink(file).catch(() => undefined);
        },
      };
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
    const cur = await readLock(file);
    if (!isStale(cur)) {
      throw new ImgfitError("E_LOCKED", `Dự án đang được imgfit khác xử lý (pid ${cur?.pid} trên ${cur?.host}, lệnh ${cur?.command}, từ ${cur?.startedAt})`, {
        lock: file,
      });
    }
    warnings.push(warning("W_STALE_LOCK", `Bỏ lock cũ của pid ${cur?.pid ?? "?"} (process không còn chạy hoặc quá hạn)`));
    await unlink(file).catch(() => undefined);
  }
  throw new ImgfitError("E_LOCKED", `Không lấy được lock ${file}`, { lock: file });
}
