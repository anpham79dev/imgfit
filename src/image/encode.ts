import { readFile, stat } from "node:fs/promises";
import type { Metadata, Sharp } from "sharp";
import { ImgfitError, normalizeError } from "../core/errors.js";
import { type OutputFormat, sharpNameFor } from "./formats.js";
import { centerOffsets, type CropPosition } from "./geometry.js";
import { DEFAULT_LIMIT_INPUT_PIXELS, DEFAULT_QUALITY, type TransformOptions } from "./options.js";
import type { TransformPlan } from "./plan.js";
import type { ProbeResult } from "./probe.js";
import { isPlaced, type WatermarkSpec } from "./watermark.js";
import { sharp } from "./sharp.js";

export interface EncodeResult {
  bytes: number;
  width: number;
  height: number;
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

/** Applies the geometric part of the plan. Order matters: autoOrient → extract → resize → extend. */
function applyGeometry(img: Sharp, src: ProbeResult, plan: TransformPlan, opts: TransformOptions): Sharp {
  const { op } = plan;
  switch (op.kind) {
    case "inside":
      return op.size.width !== src.width || op.size.height !== src.height ? img.resize(op.size.width, op.size.height, { fit: "fill" }) : img;
    case "cover":
      return op.rect
        ? img.extract(op.rect).resize(opts.width, opts.height, { fit: "fill" })
        : img.resize(opts.width, opts.height, { fit: "cover", position: sharpPosition(op.position) });
    case "crop-only":
      return op.position === "attention"
        ? img.resize(op.rect.width, op.rect.height, { fit: "cover", position: sharpPosition(op.position) })
        : img.extract(op.rect);
    case "contain": {
      let out = op.inner.width !== src.width || op.inner.height !== src.height ? img.resize(op.inner.width, op.inner.height, { fit: "fill" }) : img;
      const off = centerOffsets(op.inner, plan.outputSize);
      if (off.top || off.bottom || off.left || off.right) out = out.extend({ ...off, background: plan.background });
      return out;
    }
  }
}

/** Logo bytes, read once per file (from a buffer, so libvips never holds the file open). */
const logoCache = new Map<string, Promise<Buffer>>();
function logoBytes(file: string): Promise<Buffer> {
  let p = logoCache.get(file);
  if (!p) {
    p = readFile(file).catch((err: unknown) => {
      logoCache.delete(file);
      throw new ImgfitError("E_CONFIG_INVALID", `Không đọc được logo watermark ${file}: ${(err as Error).message}`, { path: file });
    });
    logoCache.set(file, p);
  }
  return p;
}

/** The logo at its planned size (uniform scale), sRGB with alpha, opacity applied. */
async function renderLogo(spec: WatermarkSpec, width: number, height: number): Promise<Buffer> {
  let logo = sharp(await logoBytes(spec.file)).resize(width, height, { fit: "fill" }).toColourspace("srgb").ensureAlpha();
  if (spec.opacity < 1) logo = logo.linear([1, 1, 1, spec.opacity], [0, 0, 0, 0]);
  return logo.png().toBuffer();
}

function applyEncoder(img: Sharp, format: OutputFormat, opts: TransformOptions): Sharp {
  switch (format) {
    case "jpg":
      return img.jpeg({ quality: opts.quality ?? DEFAULT_QUALITY.jpg, progressive: opts.jpeg?.progressive ?? true, mozjpeg: false });
    case "png": {
      const palette = opts.png?.palette ?? false;
      return img.png({ compressionLevel: opts.png?.compressionLevel ?? 6, palette, ...(palette ? { quality: opts.quality ?? DEFAULT_QUALITY.png } : {}) });
    }
    case "webp":
      return img.webp({ quality: opts.quality ?? DEFAULT_QUALITY.webp });
    case "avif":
      return img.avif({ quality: opts.quality ?? DEFAULT_QUALITY.avif });
  }
}

/** Encodes into `outFile` (normally a temp file), then reads it back to verify format and size. */
export async function transformToFile(input: string, outFile: string, src: ProbeResult, plan: TransformPlan, opts: TransformOptions): Promise<EncodeResult> {
  let img = sharp(input, { limitInputPixels: opts.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS, failOn: "error" }).autoOrient();
  img = applyGeometry(img, src, plan, opts);
  if (opts.sharpen !== undefined) img = img.sharpen({ sigma: opts.sharpen });
  if (plan.flatten) img = img.flatten({ background: plan.background });
  if (isPlaced(plan.watermark) && opts.watermark) {
    const w = plan.watermark;
    img = img.composite([{ input: await renderLogo(opts.watermark, w.width, w.height), left: w.left, top: w.top }]);
  }
  img = opts.stripMetadata === false ? img.keepMetadata() : img.toColourspace("srgb");
  img = applyEncoder(img, plan.outputFormat, opts);

  try {
    await img.toFile(outFile);
  } catch (err) {
    const e = normalizeError(err, { path: input });
    if (e.code !== "E_INTERNAL") throw e;
    // The probe already read the header, so a non-errno sharp error is almost always a DECODE failure
    // (libvips has many messages: "premature end", "Bogus marker length", "out of order read"…).
    // Only treat it as a write failure when the message explicitly mentions writing/saving the output.
    const writeSide = /\b(write|writing|save|saving|unable to open for write|no space)\b/i.test(e.message);
    throw new ImgfitError(writeSide ? "E_WRITE_FAILED" : "E_INPUT_CORRUPT", e.message, { path: writeSide ? outFile : input });
  }

  return verifyOutput(outFile, plan);
}

async function verifyOutput(outFile: string, plan: TransformPlan): Promise<EncodeResult> {
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
    throw new ImgfitError("E_OUTPUT_INVALID", `Output ${check.width}×${check.height} không khớp kế hoạch ${plan.outputSize.width}×${plan.outputSize.height}`, {
      path: outFile,
    });
  }
  const st = await stat(outFile);
  return { bytes: st.size, width: check.width, height: check.height };
}
