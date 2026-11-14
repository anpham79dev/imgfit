/**
 * imgfit.managed.json — COMMITTED. Which outputs imgfit owns: decides conflicts, detects hand edits and staleness.
 * Unlike the cache it must survive fresh clones, so it is never rebuilt silently.
 */
import path from "node:path";
import { ImgfitError } from "../../core/errors.js";
import { writeJsonAtomic } from "../../io/fs.js";
import { isObject, readJsonIfExists, STATE_SCHEMA_VERSION } from "./json.js";

export interface ManagedEntry {
  rule: string;
  preset: string;
  /** Source, relative to roots.input (posix). */
  source: string;
  /** Fingerprint at write time; null when adopted (never produced by imgfit). */
  fingerprint: string | null;
  /** sha256 of the output when imgfit wrote/adopted it. */
  hash: string;
  updatedAt: string;
}

export class ManagedStore {
  private dirty = false;

  private constructor(
    readonly file: string,
    readonly outputs: Map<string, ManagedEntry>,
  ) {}

  static async load(file: string): Promise<ManagedStore> {
    const name = path.basename(file);
    let raw: unknown;
    try {
      raw = await readJsonIfExists(file);
    } catch (err) {
      throw new ImgfitError("E_CONFIG_INVALID", `Không đọc được ${name}: ${(err as Error).message}`, { path: file });
    }
    const map = new Map<string, ManagedEntry>();
    if (raw === undefined) return new ManagedStore(file, map);
    if (!isObject(raw) || raw.schemaVersion !== STATE_SCHEMA_VERSION || !isObject(raw.outputs)) {
      throw new ImgfitError("E_CONFIG_INVALID", `${name} sai cấu trúc (cần {"schemaVersion":1,"outputs":{…}})`, { path: file });
    }
    for (const [k, v] of Object.entries(raw.outputs)) {
      if (!isObject(v) || typeof v.hash !== "string" || typeof v.rule !== "string") {
        throw new ImgfitError("E_CONFIG_INVALID", `${name}: mục "${k}" sai cấu trúc`, { path: file });
      }
      map.set(k, v as unknown as ManagedEntry);
    }
    return new ManagedStore(file, map);
  }

  get(key: string): ManagedEntry | undefined {
    return this.outputs.get(key);
  }

  set(key: string, entry: ManagedEntry): void {
    this.outputs.set(key, entry);
    this.dirty = true;
  }

  delete(key: string): void {
    if (this.outputs.delete(key)) this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await writeJsonAtomic(this.file, { schemaVersion: STATE_SCHEMA_VERSION, outputs: Object.fromEntries(this.outputs) });
  }
}
