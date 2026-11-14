import { open, stat } from "node:fs/promises";
import type { Metadata } from "sharp";
import { ImgfitError, normalizeError } from "../core/errors.js";
import { type DetectedFormat, detectInputFormat } from "./formats.js";
import { orientedSize } from "./geometry.js";
import { DEFAULT_LIMIT_INPUT_PIXELS } from "./options.js";
import { sharp } from "./sharp.js";

export interface ProbeResult {
  /** Real format, by file content (not extension). */
  format: string;
  detected: DetectedFormat;
  /** Size after applying EXIF orientation (what a viewer sees). */
  width: number;
  height: number;
  /** Size as stored in the file (before orientation). */
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  hasAlpha: boolean;
  pages: number;
  space: string;
  hasProfile: boolean;
  bytes: number;
}

/** APNG files carry an `acTL` chunk before `IDAT`. sharp only decodes the first frame, so detect it ourselves. */
async function isAnimatedPng(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(8);
    let pos = 8; // skip the PNG signature
    for (let i = 0; i < 64; i++) {
      const { bytesRead } = await fh.read(buf, 0, 8, pos);
      if (bytesRead < 8) return false;
      const len = buf.readUInt32BE(0);
      const type = buf.toString("latin1", 4, 8);
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND") return false;
      pos += 12 + len;
    }
    return false;
  } finally {
    await fh.close();
  }
}

/** Reads and validates image metadata without decoding pixels. Throws ImgfitError with a stable code. */
export async function probe(file: string, limitInputPixels = DEFAULT_LIMIT_INPUT_PIXELS): Promise<ProbeResult> {
  let bytes: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new ImgfitError("E_INPUT_NOT_FOUND", `Không phải file: ${file}`, { path: file });
    bytes = st.size;
  } catch (err) {
    throw normalizeError(err, { path: file });
  }
  if (bytes === 0) throw new ImgfitError("E_INPUT_CORRUPT", `File rỗng (0 byte): ${file}`, { path: file });

  let meta: Metadata;
  try {
    meta = await sharp(file, { limitInputPixels, failOn: "error" }).metadata();
  } catch (err) {
    throw normalizeError(err, { path: file });
  }

  const detected = detectInputFormat(meta.format, meta.compression);
  const pages = meta.pages ?? 1;
  if (pages > 1 || (meta.format === "png" && (await isAnimatedPng(file)))) {
    throw new ImgfitError("E_INPUT_ANIMATED", `Ảnh động (nhiều frame) chưa được hỗ trợ ở v1: ${file}`, { path: file, pages });
  }
  if (!meta.width || !meta.height) {
    throw new ImgfitError("E_INPUT_CORRUPT", `Không đọc được kích thước ảnh: ${file}`, { path: file });
  }
  if (meta.width * meta.height > limitInputPixels) {
    throw new ImgfitError("E_INPUT_TOO_LARGE", `Ảnh vượt giới hạn ${limitInputPixels} pixel: ${file}`, { path: file });
  }

  const orientation = meta.orientation ?? 1;
  const o = orientedSize(meta.width, meta.height, orientation);
  return {
    format: detected.name,
    detected,
    width: o.width,
    height: o.height,
    storedWidth: meta.width,
    storedHeight: meta.height,
    orientation,
    hasAlpha: meta.hasAlpha,
    pages,
    space: meta.space,
    hasProfile: meta.hasProfile,
    bytes,
  };
}
