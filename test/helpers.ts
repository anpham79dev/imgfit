import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { main } from "../src/cli/index.js";

export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "imgfit-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function solid(file: string, width: number, height: number, color: string, format: "jpg" | "png" | "webp" = "jpg"): Promise<void> {
  let img = sharp({ create: { width, height, channels: 3, background: color } });
  img = format === "jpg" ? img.jpeg({ quality: 95 }) : format === "png" ? img.png() : img.webp({ quality: 95 });
  await img.toFile(file);
}

/** Two-colour image: `left` half and `right` half, optionally with an EXIF orientation. */
export async function halves(file: string, width: number, height: number, left: string, right: string, orientation?: number): Promise<void> {
  const half = Math.floor(width / 2);
  let img = sharp({ create: { width, height, channels: 3, background: right } }).composite([
    { input: { create: { width: half, height, channels: 3, background: left } }, left: 0, top: 0 },
  ]);
  img = img.png();
  if (orientation) img = img.withMetadata({ orientation });
  // JPEG so the EXIF orientation is reliably preserved
  await img.jpeg({ quality: 95 }).toFile(file);
}

export async function rgba(file: string, width: number, height: number, alpha: number): Promise<void> {
  await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha } } })
    .png()
    .toFile(file);
}

/** Pixel colour at (x, y) of a saved image. */
export async function pixel(file: string, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0, a: data[i + 3] ?? 0 };
}

export function near(actual: { r: number; g: number; b: number }, expected: [number, number, number], tolerance = 40): boolean {
  return Math.abs(actual.r - expected[0]) <= tolerance && Math.abs(actual.g - expected[1]) <= tolerance && Math.abs(actual.b - expected[2]) <= tolerance;
}

/** Turns a plain PNG into a fake APNG (acTL chunk after IHDR) to test animated-image rejection. */
export async function fakeApng(file: string): Promise<void> {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
    .png()
    .toBuffer();
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  const body = Buffer.alloc(8);
  body.writeUInt32BE(2, 0); // num_frames
  body.writeUInt32BE(0, 4); // num_plays
  const type = Buffer.from("acTL", "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, body])) >>> 0, 0);
  await writeFile(file, Buffer.concat([png.subarray(0, ihdrEnd), len, type, body, crc, png.subarray(ihdrEnd)]));
}

export async function animatedGif(file: string): Promise<void> {
  const frame = (c: string) => sharp({ create: { width: 10, height: 10, channels: 3, background: c } }).png().toBuffer();
  const frames = await Promise.all([frame("#f00"), frame("#00f")]);
  await sharp(frames, { join: { animated: true } }).gif().toFile(file);
}

export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
      .sort();
  } catch {
    return [];
  }
}

export async function runCli(argv: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    cwd,
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
  });
  return { code, stdout, stderr };
}
