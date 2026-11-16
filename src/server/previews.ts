import { mkdir } from "node:fs/promises";
import path from "node:path";
import { assertId, newId } from "./sessions.js";

/** Encoded previews (quick mode). Files live in a private temp directory; ids are random. */
export class PreviewStore {
  private readonly files = new Map<string, string>();

  private constructor(readonly dir: string) {}

  static async create(baseDir: string): Promise<PreviewStore> {
    const dir = path.join(baseDir, "_previews");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return new PreviewStore(dir);
  }

  /** Reserves a file path for a new preview; call `register` once it is written. */
  allocate(ext: string): { id: string; file: string } {
    const id = newId();
    return { id, file: path.join(this.dir, `${id}.${ext}`) };
  }

  register(id: string, file: string): string {
    this.files.set(id, file);
    return `/api/v1/previews/${id}`;
  }

  get(id: string | undefined): string | undefined {
    return this.files.get(assertId(id, "Preview"));
  }
}
