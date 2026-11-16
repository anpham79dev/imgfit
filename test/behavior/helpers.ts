import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { makeSamples } from "../../scripts/samples.mjs";

/** Generated once per test file into a temp dir (scripts/samples.mjs). */
export async function sampleDir(only: string[]): Promise<{ dir: string; sample: (name: string) => string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "imgfit-behavior-"));
  await makeSamples(path.join(dir, "samples"), { only });
  return {
    dir,
    sample: (name) => path.join(dir, "samples", name),
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  };
}

/** Metadata read from a buffer (no libvips file handle stays open on Windows). */
export async function meta(file: string) {
  return sharp(await readFile(file)).metadata();
}

/** GPS IFD pointer tag (0x8825) in either byte order. */
export const hasGps = (exif: Buffer | undefined): boolean => !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));
