import path from "node:path";
import sharp from "sharp";
import { INPUT_EXTENSIONS, OUTPUT_FORMATS } from "../core/formats.js";
import { DEFAULT_LIMIT_INPUT_PIXELS, probe } from "../core/process.js";
import { RESULT_SCHEMA_VERSION } from "../core/report.js";
import { toPosix } from "../core/paths.js";
import { versions, type Versions } from "../version.js";

export interface ImageInfo {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  file: string;
  format: string;
  /** Định dạng dùng khi `--format keep`, null nếu không giữ được. */
  keepAs: string | null;
  /** Kích thước đã áp EXIF orientation (kích thước người xem thấy). */
  width: number;
  height: number;
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  hasAlpha: boolean;
  space: string;
  hasProfile: boolean;
  bytes: number;
}

/** Đọc metadata một ảnh, không ghi gì. Ném ImgfitError nếu ảnh không hợp lệ/không được hỗ trợ. */
export async function info(file: string, opts: { cwd?: string; limitInputPixels?: number } = {}): Promise<ImageInfo> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const abs = path.resolve(cwd, file);
  const p = await probe(abs, opts.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS);
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    file: toPosix(path.relative(cwd, abs) || abs),
    format: p.format,
    keepAs: p.detected.keepAs,
    width: p.width,
    height: p.height,
    storedWidth: p.storedWidth,
    storedHeight: p.storedHeight,
    orientation: p.orientation,
    hasAlpha: p.hasAlpha,
    space: p.space,
    hasProfile: p.hasProfile,
    bytes: p.bytes,
  };
}

export interface Capabilities {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  versions: Versions;
  /** Định dạng imgfit nhận làm input (theo nội dung file). */
  input: string[];
  /** Đuôi file được quét khi input là thư mục. */
  inputExtensions: string[];
  /** Định dạng imgfit xuất được trên bản build hiện tại. */
  output: string[];
  modes: string[];
  positions: string[];
  /** Khả năng thô của libvips/sharp trên máy này (để chẩn đoán). */
  sharpFormats: Record<string, { input: boolean; output: boolean }>;
}

export function capabilities(): Capabilities {
  const f = sharp.format as unknown as Record<string, { input: { file: boolean }; output: { file: boolean } }>;
  const sharpFormats = Object.fromEntries(
    Object.entries(f).map(([k, v]) => [k, { input: Boolean(v.input?.file), output: Boolean(v.output?.file) }]),
  );
  const canWrite = (name: string) => sharpFormats[name]?.output ?? false;
  const canRead = (name: string) => sharpFormats[name]?.input ?? false;
  const output = OUTPUT_FORMATS.filter((fmt) => canWrite(fmt === "jpg" ? "jpeg" : fmt === "avif" ? "heif" : fmt));
  const input = ["jpeg", "png", "webp", "tiff", "gif"].filter(canRead);
  if (canRead("heif")) input.push("avif");
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    versions: versions(),
    input,
    inputExtensions: [...INPUT_EXTENSIONS],
    output,
    modes: ["fit", "cover", "pad"],
    positions: ["center", "top", "attention", "focal"],
    sharpFormats,
  };
}
