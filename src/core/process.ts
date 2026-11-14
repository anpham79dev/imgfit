import { open, stat } from "node:fs/promises";
import sharp from "sharp";
import type { Metadata } from "sharp";
import { ImgfitError, type Issue, normalizeError, warning } from "./errors.js";
import { type DetectedFormat, detectInputFormat, type FormatOption, type OutputFormat, resolveOutputFormat, sharpNameFor, supportsAlpha } from "./formats.js";
import {
  aspectCropRect,
  centerOffsets,
  type CropPosition,
  fitInside,
  focalForPosition,
  isSmallInput,
  type Mode,
  orientedSize,
  type Point,
  type Rect,
  type Size,
  type SmallInputPolicy,
} from "./geometry.js";

// libvips mặc định giữ file handle đã mở trong cache. Trên Windows điều đó khóa file nguồn và file tạm
// (không xóa/rename được → EBUSY). Chỉ tắt cache FILE HANDLE; cache bộ nhớ/operation giữ nguyên mặc định.
sharp.cache({ files: 0 });

/** Giới hạn mặc định số pixel input (≈ 268 MP, bằng mặc định của sharp). */
export const DEFAULT_LIMIT_INPUT_PIXELS = 268_402_689;

export const DEFAULT_QUALITY: Record<OutputFormat, number> = { jpg: 85, png: 100, webp: 82, avif: 50 };

export interface TransformOptions {
  width: number;
  height: number;
  mode: Mode;
  format: FormatOption;
  /** 1–100. Mặc định theo format: jpg 85, webp 82, avif 50. PNG chỉ dùng khi palette=true. */
  quality?: number;
  /** Mặc định false: không phóng to ảnh nhỏ. */
  upscale?: boolean;
  /** Mặc định theo mode: fit → keep, cover/pad → error. */
  smallInput?: SmallInputPolicy;
  /** Chỉ dùng cho cover. Mặc định center. */
  position?: CropPosition;
  /** Tọa độ chuẩn hóa [0,1] trên ảnh đã auto-orient; bắt buộc khi position=focal. */
  focalPoint?: Point;
  /** Màu nền cho pad và khi flatten alpha → JPG. Hex: #rgb, #rrggbb, #rrggbbaa. */
  background?: string;
  /** Sigma của sharpen (0.3–10). Không đặt = không sharpen. */
  sharpen?: number;
  /** Mặc định true: bỏ EXIF/XMP/ICC sau khi chuyển về sRGB. */
  stripMetadata?: boolean;
  png?: { compressionLevel?: number; palette?: boolean };
  limitInputPixels?: number;
}

export interface ProbeResult {
  /** Định dạng thật theo nội dung file (không theo đuôi). */
  format: string;
  detected: DetectedFormat;
  /** Kích thước sau khi áp EXIF orientation. */
  width: number;
  height: number;
  /** Kích thước lưu trong file (trước orientation). */
  storedWidth: number;
  storedHeight: number;
  orientation: number;
  hasAlpha: boolean;
  pages: number;
  space: string;
  hasProfile: boolean;
  bytes: number;
}

type PlanKind =
  | { kind: "inside"; size: Size }
  | { kind: "cover"; position: CropPosition; rect?: Rect }
  | { kind: "crop-only"; position: CropPosition; rect: Rect }
  | { kind: "contain"; inner: Size };

export interface TransformPlan {
  outputFormat: OutputFormat;
  outputSize: Size;
  op: PlanKind;
  flatten: boolean;
  background: { r: number; g: number; b: number; alpha: number };
  warnings: Issue[];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseColor(value: string): { r: number; g: number; b: number; alpha: number } {
  const v = value.trim();
  if (!HEX.test(v)) {
    throw new ImgfitError("E_USAGE", `Màu nền không hợp lệ "${value}". Dùng hex: #rgb, #rrggbb hoặc #rrggbbaa`);
  }
  let hex = v.slice(1);
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
  const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), alpha: hex.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
}

/** APNG có chunk `acTL` trước `IDAT`. sharp chỉ đọc frame đầu nên phải tự phát hiện để từ chối. */
async function isAnimatedPng(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(8);
    let pos = 8; // bỏ qua signature
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

export function validateTransformOptions(opts: TransformOptions): void {
  const intIn = (name: string, v: number | undefined, min: number, max: number) => {
    if (v === undefined) return;
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new ImgfitError("E_USAGE", `${name} phải là số nguyên trong [${min}, ${max}], nhận ${v}`);
    }
  };
  intIn("width", opts.width, 1, 65_535);
  intIn("height", opts.height, 1, 65_535);
  intIn("quality", opts.quality, 1, 100);
  intIn("png.compressionLevel", opts.png?.compressionLevel, 0, 9);
  if (!["fit", "cover", "pad"].includes(opts.mode)) throw new ImgfitError("E_USAGE", `mode không hợp lệ: ${opts.mode}`);
  if (opts.smallInput && !["error", "keep", "pad"].includes(opts.smallInput)) {
    throw new ImgfitError("E_USAGE", `smallInput không hợp lệ: ${opts.smallInput}`);
  }
  if (opts.position && !["center", "top", "attention", "focal"].includes(opts.position)) {
    throw new ImgfitError("E_USAGE", `position không hợp lệ: ${opts.position}`);
  }
  if (opts.position === "focal" && !opts.focalPoint) {
    throw new ImgfitError("E_USAGE", "position=focal cần focalPoint {x, y}");
  }
  if (opts.focalPoint) {
    const { x, y } = opts.focalPoint;
    if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
      throw new ImgfitError("E_USAGE", `focalPoint phải nằm trong [0,1], nhận (${x}, ${y})`);
    }
  }
  if (opts.sharpen !== undefined && !(Number.isFinite(opts.sharpen) && opts.sharpen >= 0.3 && opts.sharpen <= 10)) {
    throw new ImgfitError("E_USAGE", `sharpen (sigma) phải trong [0.3, 10], nhận ${opts.sharpen}`);
  }
  if (opts.background !== undefined) parseColor(opts.background);
}

/**
 * Lập kế hoạch transform — hàm thuần, không I/O. Dùng chung cho dry-run và xử lý thật,
 * nên kích thước báo trong dry-run luôn khớp kết quả.
 */
export function planTransform(src: ProbeResult, opts: TransformOptions): TransformPlan {
  const warnings: Issue[] = [];
  const outputFormat = resolveOutputFormat(opts.format, src.detected);
  const target: Size = { width: opts.width, height: opts.height };
  const source: Size = { width: src.width, height: src.height };
  const allowUp = opts.upscale === true;
  const policy: SmallInputPolicy = opts.smallInput ?? (opts.mode === "fit" ? "keep" : "error");
  const position: CropPosition = opts.position ?? (opts.focalPoint ? "focal" : "center");
  const small = !allowUp && isSmallInput(source, target, opts.mode);

  let op: PlanKind;
  let outputSize: Size;

  if (small) {
    if (policy === "error") {
      throw new ImgfitError(
        "E_SMALL_INPUT",
        `Ảnh nguồn ${source.width}×${source.height} nhỏ hơn target ${target.width}×${target.height} (mode ${opts.mode}); không phóng to. ` +
          `Dùng smallInput=keep|pad hoặc upscale=true nếu chấp nhận.`,
        { source, target, mode: opts.mode },
      );
    }
    if (policy === "pad") {
      const inner = fitInside(source, target, false);
      op = { kind: "contain", inner };
      outputSize = target;
      warnings.push(warning("W_SMALL_INPUT_PADDED", `Ảnh nhỏ hơn target, đã đệm nền lên ${target.width}×${target.height} thay vì phóng to`));
    } else if (opts.mode === "cover") {
      const rect = aspectCropRect(source, target, focalForPosition(position, opts.focalPoint));
      op = { kind: "crop-only", position, rect };
      outputSize = { width: rect.width, height: rect.height };
      warnings.push(warning("W_SMALL_INPUT_KEPT", `Ảnh nhỏ hơn target, chỉ crop đúng tỷ lệ: ${rect.width}×${rect.height}`));
    } else {
      const size = fitInside(source, target, false);
      op = { kind: "inside", size };
      outputSize = size;
      if (opts.mode === "pad") {
        warnings.push(warning("W_SMALL_INPUT_KEPT", `Ảnh nhỏ hơn target, giữ nguyên ${size.width}×${size.height}, không đệm nền`));
      }
    }
  } else if (opts.mode === "fit") {
    const size = fitInside(source, target, allowUp);
    op = { kind: "inside", size };
    outputSize = size;
  } else if (opts.mode === "cover") {
    op =
      position === "focal"
        ? { kind: "cover", position, rect: aspectCropRect(source, target, focalForPosition("focal", opts.focalPoint)) }
        : { kind: "cover", position };
    outputSize = target;
  } else {
    op = { kind: "contain", inner: fitInside(source, target, allowUp) };
    outputSize = target;
  }

  const needsBackground = outputFormat === "jpg" && (src.hasAlpha || op.kind === "contain");
  let background = { r: 0, g: 0, b: 0, alpha: 0 };
  if (opts.background) {
    background = parseColor(opts.background);
  } else if (!supportsAlpha(outputFormat)) {
    background = { r: 255, g: 255, b: 255, alpha: 1 };
    if (needsBackground) {
      warnings.push(warning("W_DEFAULT_BACKGROUND", "JPG không có alpha; dùng nền mặc định #ffffff. Đặt background để chọn màu khác"));
    }
  }
  if (outputFormat === "jpg") background = { ...background, alpha: 1 };

  const flatten = outputFormat === "jpg" && src.hasAlpha;
  if (flatten) warnings.push(warning("W_ALPHA_FLATTENED", "Ảnh có alpha, đã flatten lên nền khi xuất JPG (mất trong suốt)"));
  if (opts.stripMetadata === false) warnings.push(warning("W_METADATA_KEPT", "Giữ metadata (EXIF/XMP/ICC) — có thể chứa thông tin cá nhân như GPS"));

  return { outputFormat, outputSize, op, flatten, background, warnings };
}

function sharpPosition(position: CropPosition): string | number {
  switch (position) {
    case "top":
      return "north";
    case "attention":
      return sharp.strategy.attention;
    default:
      return "centre";
  }
}

export interface TransformResult {
  bytes: number;
  width: number;
  height: number;
}

/** Encode ra `outFile` (thường là file tạm) rồi đọc lại để xác minh định dạng và kích thước. */
export async function transformToFile(
  input: string,
  outFile: string,
  src: ProbeResult,
  plan: TransformPlan,
  opts: TransformOptions,
): Promise<TransformResult> {
  let img = sharp(input, { limitInputPixels: opts.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS, failOn: "error" }).autoOrient();

  const { op } = plan;
  switch (op.kind) {
    case "inside":
      if (op.size.width !== src.width || op.size.height !== src.height) {
        img = img.resize(op.size.width, op.size.height, { fit: "fill" });
      }
      break;
    case "cover":
      img = op.rect
        ? img.extract(op.rect).resize(opts.width, opts.height, { fit: "fill" })
        : img.resize(opts.width, opts.height, { fit: "cover", position: sharpPosition(op.position) });
      break;
    case "crop-only":
      img =
        op.position === "focal" || op.position === "top" || op.position === "center"
          ? img.extract(op.rect)
          : img.resize(op.rect.width, op.rect.height, { fit: "cover", position: sharpPosition(op.position) });
      break;
    case "contain": {
      if (op.inner.width !== src.width || op.inner.height !== src.height) {
        img = img.resize(op.inner.width, op.inner.height, { fit: "fill" });
      }
      const off = centerOffsets(op.inner, plan.outputSize);
      if (off.top || off.bottom || off.left || off.right) {
        img = img.extend({ ...off, background: plan.background });
      }
      break;
    }
  }

  if (opts.sharpen !== undefined) img = img.sharpen({ sigma: opts.sharpen });
  if (plan.flatten) img = img.flatten({ background: plan.background });
  if (opts.stripMetadata === false) img = img.keepMetadata();
  else img = img.toColourspace("srgb");

  switch (plan.outputFormat) {
    case "jpg":
      img = img.jpeg({ quality: opts.quality ?? DEFAULT_QUALITY.jpg, mozjpeg: false });
      break;
    case "png": {
      const palette = opts.png?.palette ?? false;
      img = img.png({
        compressionLevel: opts.png?.compressionLevel ?? 6,
        palette,
        ...(palette ? { quality: opts.quality ?? DEFAULT_QUALITY.png } : {}),
      });
      break;
    }
    case "webp":
      img = img.webp({ quality: opts.quality ?? DEFAULT_QUALITY.webp });
      break;
    case "avif":
      img = img.avif({ quality: opts.quality ?? DEFAULT_QUALITY.avif });
      break;
  }

  try {
    await img.toFile(outFile);
  } catch (err) {
    const e = normalizeError(err, { path: input });
    if (e.code === "E_PERMISSION" || e.code === "E_DISK_FULL") throw e;
    throw e.code === "E_INTERNAL" ? new ImgfitError("E_WRITE_FAILED", e.message, { path: outFile }) : e;
  }

  let check: Metadata;
  try {
    check = await sharp(outFile).metadata();
  } catch (err) {
    throw new ImgfitError("E_OUTPUT_INVALID", `Không đọc lại được output vừa ghi: ${(err as Error).message}`, { path: outFile });
  }
  if (check.format !== sharpNameFor(plan.outputFormat)) {
    throw new ImgfitError("E_OUTPUT_INVALID", `Output có định dạng ${check.format}, mong đợi ${plan.outputFormat}`, { path: outFile });
  }
  if (check.width !== plan.outputSize.width || check.height !== plan.outputSize.height) {
    throw new ImgfitError(
      "E_OUTPUT_INVALID",
      `Output ${check.width}×${check.height} không khớp kế hoạch ${plan.outputSize.width}×${plan.outputSize.height}`,
      { path: outFile },
    );
  }
  const st = await stat(outFile);
  return { bytes: st.size, width: check.width, height: check.height };
}
