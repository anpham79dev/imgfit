import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { probe } from "../image/probe.js";
import { sharp } from "../image/sharp.js";
import { sanitizeSegment } from "../core/paths.js";

export const LIMITS = {
  fileBytes: 50 * 1024 * 1024,
  filesPerRequest: 500,
  filesPerSession: 5000,
  sessionBytes: 2 * 1024 * 1024 * 1024,
  sessions: 20,
  /** Keep at least this much free space on the temp volume. */
  minFreeBytes: 512 * 1024 * 1024,
  sessionIdleMs: 2 * 60 * 60 * 1000,
  previewMax: 2048,
};

export const TEMP_PREFIX = "imgfit-ui-";

export interface UploadedFile {
  id: string;
  /** Original name (sanitised, NFC) — used for {name} and display. */
  name: string;
  path: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
}

export interface Session {
  id: string;
  dir: string;
  files: Map<string, UploadedFile>;
  bytes: number;
  lastUsed: number;
}

export const newId = (bytes = 9) => randomBytes(bytes).toString("base64url");
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
export function assertId(id: string | undefined, what: string): string {
  if (!id || !ID_RE.test(id)) throw new ImgfitError("E_NOT_FOUND", `${what} không tồn tại`);
  return id;
}

/** Per-session temp directories (0700) with size limits, cleaned up on idle TTL and on shutdown. */
export class SessionStore {
  readonly sessions = new Map<string, Session>();
  private constructor(readonly base: string) {}

  static async create(): Promise<SessionStore> {
    await SessionStore.sweepStale();
    const base = await mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    return new SessionStore(base);
  }

  /** Removes temp directories left behind by crashed runs (older than 24h). */
  static async sweepStale(): Promise<void> {
    const tmp = os.tmpdir();
    const entries = await readdir(tmp).catch(() => [] as string[]);
    for (const name of entries) {
      if (!name.startsWith(TEMP_PREFIX)) continue;
      const p = path.join(tmp, name);
      const st = await stat(p).catch(() => undefined);
      if (st?.isDirectory() && Date.now() - st.mtimeMs > 24 * 60 * 60 * 1000) await rm(p, { recursive: true, force: true });
    }
  }

  async open(): Promise<Session> {
    if (this.sessions.size >= LIMITS.sessions) await this.sweep(true);
    if (this.sessions.size >= LIMITS.sessions) throw new ImgfitError("E_USAGE", `Quá ${LIMITS.sessions} phiên đang mở; đóng bớt tab hoặc khởi động lại`);
    const id = newId();
    const dir = path.join(this.base, id);
    await mkdir(path.join(dir, "uploads"), { recursive: true, mode: 0o700 });
    const s: Session = { id, dir, files: new Map(), bytes: 0, lastUsed: Date.now() };
    this.sessions.set(id, s);
    return s;
  }

  get(id: string | undefined): Session {
    const s = this.sessions.get(assertId(id, "Phiên"));
    if (!s) throw new ImgfitError("E_NOT_FOUND", "Phiên không tồn tại hoặc đã hết hạn");
    s.lastUsed = Date.now();
    return s;
  }

  file(s: Session, fileId: string | undefined): UploadedFile {
    const f = s.files.get(assertId(fileId, "File"));
    if (!f) throw new ImgfitError("E_NOT_FOUND", "File không tồn tại trong phiên");
    return f;
  }

  async assertSpace(incoming: number): Promise<void> {
    const fs = await statfs(this.base).catch(() => undefined);
    if (fs && fs.bavail * fs.bsize < incoming + LIMITS.minFreeBytes) throw new ImgfitError("E_DISK_FULL", "Ổ đĩa tạm sắp đầy; từ chối upload");
  }

  /** Validates an upload by content (sharp), never by name/MIME. Invalid files are deleted. */
  async accept(s: Session, tmpPath: string, originalName: string, bytes: number): Promise<UploadedFile> {
    try {
      if (s.files.size >= LIMITS.filesPerSession) throw new ImgfitError("E_USAGE", `Phiên đã có ${LIMITS.filesPerSession} file`);
      if (s.bytes + bytes > LIMITS.sessionBytes) throw new ImgfitError("E_USAGE", "Phiên vượt giới hạn dung lượng");
      const p = await probe(tmpPath);
      const id = newId();
      const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 6);
      const finalPath = path.join(s.dir, "uploads", `${id}${ext}`);
      await rename(tmpPath, finalPath);
      const base = path.basename(originalName.replace(/\\/g, "/"));
      const f: UploadedFile = {
        id,
        name: sanitizeSegment(base),
        path: finalPath,
        bytes,
        width: p.width,
        height: p.height,
        format: p.format,
        hasAlpha: p.hasAlpha,
      };
      s.files.set(id, f);
      s.bytes += bytes;
      return f;
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
  }

  /** EXIF-oriented WebP thumbnail, cached per session. Used by the thumbnail grid and the crop editor. */
  async image(s: Session, f: UploadedFile, max: number): Promise<string> {
    return renderImage(f.path, path.join(s.dir, "thumbs"), `${f.id}-${max}`, max);
  }

  async close(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    await rm(s.dir, { recursive: true, force: true });
  }

  async sweep(force = false): Promise<void> {
    const now = Date.now();
    const list = [...this.sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of list) {
      if (now - s.lastUsed > LIMITS.sessionIdleMs || (force && this.sessions.size >= LIMITS.sessions)) await this.close(s.id);
    }
  }

  async destroy(): Promise<void> {
    this.sessions.clear();
    await rm(this.base, { recursive: true, force: true });
  }
}

const MAX_RE = /^\d{2,4}$/;
export function parseMax(v: unknown, fallback: number): number {
  if (typeof v !== "string" || !MAX_RE.test(v)) return fallback;
  return Math.min(LIMITS.previewMax, Math.max(16, Number(v)));
}

/** Renders a preview image (auto-orient, fit inside max, WebP) into a cache directory; returns its path. */
export async function renderImage(source: string, cacheDir: string, key: string, max: number): Promise<string> {
  const out = path.join(cacheDir, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.webp`);
  const st = await stat(out).catch(() => undefined);
  const src = await stat(source);
  if (st && st.mtimeMs >= src.mtimeMs) return out;
  await mkdir(cacheDir, { recursive: true });
  await sharp(source, { failOn: "error" }).autoOrient().resize(max, max, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
  return out;
}
