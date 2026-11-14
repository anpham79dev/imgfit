/**
 * Toán hình học thuần (không I/O) cho resize/crop. Mọi tọa độ tính trên ảnh ĐÃ auto-orient theo EXIF.
 */

export type Mode = "fit" | "cover" | "pad";
export type SmallInputPolicy = "error" | "keep" | "pad";
export type CropPosition = "center" | "top" | "attention" | "focal";

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

export interface Point {
  x: number;
  y: number;
}

/** EXIF orientation 5–8 xoay 90°/270° nên đổi chỗ rộng/cao. */
export function orientedSize(width: number, height: number, orientation: number | undefined): Size {
  if (orientation !== undefined && orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Ảnh nguồn có "nhỏ hơn target" theo nghĩa của từng mode không (tức là cần phóng to mới đạt target):
 * - fit/pad: cả hai chiều đều nhỏ hơn khung (scale = min(W/w, H/h) > 1)
 * - cover: chỉ cần một chiều nhỏ hơn khung (scale = max(W/w, H/h) > 1)
 */
export function isSmallInput(src: Size, target: Size, mode: Mode): boolean {
  const sx = target.width / src.width;
  const sy = target.height / src.height;
  return mode === "cover" ? Math.max(sx, sy) > 1 : Math.min(sx, sy) > 1;
}

/** Kích thước vừa khung, giữ tỷ lệ. Không phóng to khi allowUpscale=false. Luôn >= 1px. */
export function fitInside(src: Size, box: Size, allowUpscale: boolean): Size {
  let scale = Math.min(box.width / src.width, box.height / src.height);
  if (!allowUpscale) scale = Math.min(scale, 1);
  return {
    width: clampInt(Math.round(src.width * scale), 1, allowUpscale ? Number.MAX_SAFE_INTEGER : src.width),
    height: clampInt(Math.round(src.height * scale), 1, allowUpscale ? Number.MAX_SAFE_INTEGER : src.height),
  };
}

/**
 * Hình chữ nhật lớn nhất trong ảnh nguồn có đúng tỷ lệ target, đặt sao cho focal point
 * nằm giữa khung nhiều nhất có thể, rồi clamp trong biên ảnh.
 */
export function aspectCropRect(src: Size, target: Size, focal: Point): Rect {
  const ratio = target.width / target.height;
  let width: number;
  let height: number;
  if (src.width / src.height > ratio) {
    height = src.height;
    width = Math.round(src.height * ratio);
  } else {
    width = src.width;
    height = Math.round(src.width / ratio);
  }
  width = clampInt(width, 1, src.width);
  height = clampInt(height, 1, src.height);

  const fx = clamp01(focal.x) * src.width;
  const fy = clamp01(focal.y) * src.height;
  const left = clampInt(Math.round(fx - width / 2), 0, src.width - width);
  const top = clampInt(Math.round(fy - height / 2), 0, src.height - height);
  return { left, top, width, height };
}

/** Focal point tương ứng với position có sẵn (dùng cho crop thủ công). */
export function focalForPosition(position: CropPosition, focal?: Point): Point {
  switch (position) {
    case "top":
      return { x: 0.5, y: 0 };
    case "focal":
      return focal ?? { x: 0.5, y: 0.5 };
    default:
      return { x: 0.5, y: 0.5 };
  }
}

/** Vị trí đặt ảnh con ở giữa canvas khi pad. */
export function centerOffsets(inner: Size, canvas: Size): { top: number; bottom: number; left: number; right: number } {
  const dx = Math.max(0, canvas.width - inner.width);
  const dy = Math.max(0, canvas.height - inner.height);
  const left = Math.floor(dx / 2);
  const top = Math.floor(dy / 2);
  return { left, right: dx - left, top, bottom: dy - top };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(v)));
}
