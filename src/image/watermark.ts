/**
 * Watermark: a logo composited AFTER resizing, scaled uniformly (never distorted, never cropped) relative to
 * the output width, anchored at one of 9 positions with an offset in % of the output or px.
 */
import { ImgfitError } from "../core/errors.js";
import type { Size } from "./geometry.js";

export const WATERMARK_POSITIONS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

/** "15%" (of the output side) or "24px" / 24 (pixels). */
export type Length = string | number;

/** A watermark as written in imgfit.json (`watermarks.<name>`). */
export interface WatermarkConfig {
  /** Logo image, relative to imgfit.json. PNG with alpha recommended. */
  file: string;
  /** Default bottom-right. */
  position?: WatermarkPosition;
  /** [x, y] distance from the anchored edges; % of output width/height or px. Default ["2%", "2%"]. */
  offset?: [Length, Length];
  /** Logo width; % of output width or px. Height follows the logo's aspect ratio. Default "15%". */
  width?: Length;
  /** Skip the watermark when the output is smaller than [w, h] in either dimension. */
  minOutput?: [number, number];
  /** 0–1, default 1. */
  opacity?: number;
}

/** Resolved watermark, ready for the engine: absolute logo path and its pixel size. */
export interface WatermarkSpec {
  name: string;
  file: string;
  logoWidth: number;
  logoHeight: number;
  position: WatermarkPosition;
  offset: [Length, Length];
  width: Length;
  minOutput?: [number, number];
  opacity: number;
}

/** Where the logo goes on one output (reported in FileResult.watermark). */
export type WatermarkPlacement = { name: string; left: number; top: number; width: number; height: number } | { name: string; skipped: string };

const LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(%|px)?\s*$/;

/** Parses a Length; throws E_USAGE for anything else. */
export function parseLength(v: Length, field: string): { value: number; unit: "%" | "px" } {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return { value: v, unit: "px" };
  const m = typeof v === "string" ? LENGTH.exec(v) : null;
  if (!m) throw new ImgfitError("E_USAGE", `${field}: dùng "15%" hoặc "24px", nhận ${JSON.stringify(v)}`);
  const value = Number(m[1]);
  const unit = m[2] === "%" ? "%" : "px";
  if (unit === "%" && value > 100) throw new ImgfitError("E_USAGE", `${field}: phần trăm phải ≤ 100%, nhận ${v}`);
  return { value, unit };
}

const toPx = (v: Length, side: number, field: string): number => {
  const l = parseLength(v, field);
  return l.unit === "%" ? (l.value / 100) * side : l.value;
};

/** Validates the user-facing fields (logo size is checked when the file is read). */
export function validateWatermarkConfig(name: string, c: WatermarkConfig): void {
  const where = `watermark "${name}"`;
  if (c.position && !WATERMARK_POSITIONS.includes(c.position)) throw new ImgfitError("E_USAGE", `${where}: position không hợp lệ: ${c.position}`);
  parseLength(c.width ?? "15%", `${where}.width`);
  for (const [i, v] of (c.offset ?? ["2%", "2%"]).entries()) parseLength(v, `${where}.offset[${i}]`);
  if (c.opacity !== undefined && !(c.opacity > 0 && c.opacity <= 1)) throw new ImgfitError("E_USAGE", `${where}: opacity phải trong (0, 1], nhận ${c.opacity}`);
}

/**
 * Pure placement: logo width from `width`, height from the logo's aspect ratio, shrunk uniformly if it would
 * not fit inside the output, then anchored and clamped inside the output. Never distorts, never crops.
 */
export function planWatermark(output: Size, w: WatermarkSpec): WatermarkPlacement {
  if (w.minOutput && (output.width < w.minOutput[0] || output.height < w.minOutput[1])) {
    return { name: w.name, skipped: `output ${output.width}×${output.height} nhỏ hơn minOutput ${w.minOutput[0]}×${w.minOutput[1]}` };
  }
  const ratio = w.logoHeight / w.logoWidth;
  let lw = toPx(w.width, output.width, "watermark.width");
  let lh = lw * ratio;
  const shrink = Math.min(1, output.width / lw, output.height / lh);
  lw = Math.max(1, Math.floor(lw * shrink));
  lh = Math.max(1, Math.min(output.height, Math.round(lw * ratio)));

  const ox = Math.round(toPx(w.offset[0], output.width, "watermark.offset[0]"));
  const oy = Math.round(toPx(w.offset[1], output.height, "watermark.offset[1]"));
  const [v, h] = w.position === "center" ? ["center", "center"] : w.position.includes("-") ? w.position.split("-") : ["top", "bottom"].includes(w.position) ? [w.position, "center"] : ["center", w.position];
  const left = h === "left" ? ox : h === "right" ? output.width - lw - ox : Math.round((output.width - lw) / 2);
  const top = v === "top" ? oy : v === "bottom" ? output.height - lh - oy : Math.round((output.height - lh) / 2);
  const clamp = (n: number, max: number) => Math.min(Math.max(0, n), max);
  return { name: w.name, left: clamp(left, output.width - lw), top: clamp(top, output.height - lh), width: lw, height: lh };
}

export const isPlaced = (p: WatermarkPlacement | null | undefined): p is Extract<WatermarkPlacement, { left: number }> => !!p && "left" in p;
