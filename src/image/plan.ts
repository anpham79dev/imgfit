import { ImgfitError, type Issue, warning } from "../core/errors.js";
import { type OutputFormat, resolveOutputFormat, supportsAlpha } from "./formats.js";
import { aspectCropRect, type CropPosition, fitInside, focalForPosition, isSmallInput, type Rect, type Size, type SmallInputPolicy } from "./geometry.js";
import { parseColor, type Rgba, type TransformOptions } from "./options.js";
import type { ProbeResult } from "./probe.js";

/** The concrete operation the encoder performs. */
export type PlanOp =
  /** resize to an exact size that already preserves the aspect ratio */
  | { kind: "inside"; size: Size }
  /** fill the target; `rect` is set for manual (focal) crops */
  | { kind: "cover"; position: CropPosition; rect?: Rect }
  /** small input + keep: crop to the target ratio without resizing */
  | { kind: "crop-only"; position: CropPosition; rect: Rect }
  /** resize to `inner`, then pad to the output size */
  | { kind: "contain"; inner: Size };

export interface TransformPlan {
  outputFormat: OutputFormat;
  outputSize: Size;
  op: PlanOp;
  flatten: boolean;
  background: Rgba;
  warnings: Issue[];
}

/**
 * Plans a transform — pure, no I/O. Shared by dry-run and real processing,
 * so the size reported by a dry-run always matches the real output.
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

  const { op, outputSize } = small ? planSmallInput(source, target, opts, policy, position, warnings) : planNormal(source, target, opts, allowUp, position);

  const background = resolveBackground(opts, outputFormat, src.hasAlpha || op.kind === "contain", warnings);
  const flatten = outputFormat === "jpg" && src.hasAlpha;
  if (flatten) warnings.push(warning("W_ALPHA_FLATTENED", "Ảnh có alpha, đã flatten lên nền khi xuất JPG (mất trong suốt)"));
  if (opts.stripMetadata === false) warnings.push(warning("W_METADATA_KEPT", "Giữ metadata (EXIF/XMP/ICC) — có thể chứa thông tin cá nhân như GPS"));

  return { outputFormat, outputSize, op, flatten, background, warnings };
}

interface Planned {
  op: PlanOp;
  outputSize: Size;
}

function planNormal(source: Size, target: Size, opts: TransformOptions, allowUp: boolean, position: CropPosition): Planned {
  if (opts.mode === "fit") {
    const size = fitInside(source, target, allowUp);
    return { op: { kind: "inside", size }, outputSize: size };
  }
  if (opts.mode === "cover") {
    const op: PlanOp =
      position === "focal"
        ? { kind: "cover", position, rect: aspectCropRect(source, target, focalForPosition("focal", opts.focalPoint)) }
        : { kind: "cover", position };
    return { op, outputSize: target };
  }
  return { op: { kind: "contain", inner: fitInside(source, target, allowUp) }, outputSize: target };
}

function planSmallInput(source: Size, target: Size, opts: TransformOptions, policy: SmallInputPolicy, position: CropPosition, warnings: Issue[]): Planned {
  if (policy === "error") {
    throw new ImgfitError(
      "E_SMALL_INPUT",
      `Ảnh nguồn ${source.width}×${source.height} nhỏ hơn target ${target.width}×${target.height} (mode ${opts.mode}); không phóng to. ` +
        `Dùng smallInput=keep|pad hoặc upscale=true nếu chấp nhận.`,
      { source, target, mode: opts.mode },
    );
  }
  if (policy === "pad") {
    warnings.push(warning("W_SMALL_INPUT_PADDED", `Ảnh nhỏ hơn target, đã đệm nền lên ${target.width}×${target.height} thay vì phóng to`));
    return { op: { kind: "contain", inner: fitInside(source, target, false) }, outputSize: target };
  }
  if (opts.mode === "cover") {
    const rect = aspectCropRect(source, target, focalForPosition(position, opts.focalPoint));
    warnings.push(warning("W_SMALL_INPUT_KEPT", `Ảnh nhỏ hơn target, chỉ crop đúng tỷ lệ: ${rect.width}×${rect.height}`));
    return { op: { kind: "crop-only", position, rect }, outputSize: { width: rect.width, height: rect.height } };
  }
  const size = fitInside(source, target, false);
  if (opts.mode === "pad") warnings.push(warning("W_SMALL_INPUT_KEPT", `Ảnh nhỏ hơn target, giữ nguyên ${size.width}×${size.height}, không đệm nền`));
  return { op: { kind: "inside", size }, outputSize: size };
}

/** Transparent by default; JPG has no alpha, so it gets an opaque background (white unless specified). */
function resolveBackground(opts: TransformOptions, format: OutputFormat, needsFill: boolean, warnings: Issue[]): Rgba {
  let background: Rgba = { r: 0, g: 0, b: 0, alpha: 0 };
  if (opts.background) {
    background = parseColor(opts.background);
  } else if (!supportsAlpha(format)) {
    background = { r: 255, g: 255, b: 255, alpha: 1 };
    if (needsFill && format === "jpg") {
      warnings.push(warning("W_DEFAULT_BACKGROUND", "JPG không có alpha; dùng nền mặc định #ffffff. Đặt background để chọn màu khác"));
    }
  }
  return format === "jpg" ? { ...background, alpha: 1 } : background;
}
