/**
 * .imgfit/cache.json — DELETABLE. Fast signature (size + mtime → hash) so outputs are not re-hashed every run.
 * A corrupt or outdated cache is discarded and rebuilt (with a warning); it can never cause a wrong skip.
 */
import { stat } from "node:fs/promises";
import { type Issue, warning } from "../../core/errors.js";
import { hashFile } from "../../core/fingerprint.js";
import { writeJsonAtomic } from "../../io/fs.js";
import { isObject, readJsonIfExists, STATE_SCHEMA_VERSION } from "./json.js";

export interface CacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
}

export class CacheStore {
  private dirty = false;

  private constructor(
    readonly file: string,
    private readonly entries: Map<string, CacheEntry>,
    readonly warnings: Issue[],
  ) {}

  static async load(file: string): Promise<CacheStore> {
    const map = new Map<string, CacheEntry>();
    try {
      const raw = await readJsonIfExists(file);
      if (raw === undefined) return new CacheStore(file, map, []);
      if (!isObject(raw) || raw.schemaVersion !== STATE_SCHEMA_VERSION || !isObject(raw.entries)) throw new Error("sai cấu trúc");
      for (const [k, v] of Object.entries(raw.entries)) {
        if (isObject(v) && typeof v.size === "number" && typeof v.mtimeMs === "number" && typeof v.hash === "string") {
          map.set(k, v as unknown as CacheEntry);
        }
      }
      return new CacheStore(file, map, []);
    } catch (err) {
      return new CacheStore(file, new Map(), [warning("W_STATE_REBUILT", `Cache ${file} không hợp lệ (${(err as Error).message}); dựng lại`)]);
    }
  }

  private set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
    this.dirty = true;
  }

  /** Current sha256 of a file: from cache when size + mtime match, otherwise re-hashed (and cached). */
  async hashOf(key: string, file: string): Promise<string | null> {
    const st = await stat(file).catch(() => undefined);
    if (!st) return null;
    const c = this.entries.get(key);
    if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.hash;
    const hash = `sha256:${await hashFile(file)}`;
    this.set(key, { size: st.size, mtimeMs: st.mtimeMs, hash });
    return hash;
  }

  /** Records the hash of a file imgfit just wrote. */
  async record(key: string, file: string, hash: string): Promise<void> {
    const st = await stat(file);
    this.set(key, { size: st.size, mtimeMs: st.mtimeMs, hash });
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJsonAtomic(this.file, { schemaVersion: STATE_SCHEMA_VERSION, entries: Object.fromEntries(this.entries) });
  }
}
