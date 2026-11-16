/**
 * Commander argument parsers. They throw InvalidArgumentError so commander reports usage errors (exit 2).
 */
import { InvalidArgumentError } from "commander";
import { type FormatOption, type OutputFormat, parseFormatOption, parseOutputFormat } from "../image/formats.js";

export function intArg(name: string, min: number, max: number) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new InvalidArgumentError(`${name} phải là số nguyên trong [${min}, ${max}]`);
    return n;
  };
}

/** "256x256", "256×256" or "512" (square). */
export function parseSize(value: string): { width: number; height: number } {
  const m = /^\s*(\d+)\s*(?:[x×*]\s*(\d+))?\s*$/i.exec(value);
  if (!m) throw new InvalidArgumentError('dùng dạng WxH (vd. "256x256") hoặc N cho ảnh vuông');
  const width = Number(m[1]);
  const height = Number(m[2] ?? m[1]);
  if (width < 1 || height < 1 || width > 65_535 || height > 65_535) throw new InvalidArgumentError("mỗi chiều phải trong [1, 65535]");
  return { width, height };
}

/** "x,y" with both in [0,1]. */
export function parseFocal(value: string): { x: number; y: number } {
  const m = /^\s*([0-9.]+)\s*,\s*([0-9.]+)\s*$/.exec(value);
  const x = Number(m?.[1]);
  const y = Number(m?.[2]);
  if (!m || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new InvalidArgumentError('dùng dạng "x,y" với x, y trong [0,1] (vd. "0.5,0.3")');
  }
  return { x, y };
}

export function parseSigma(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.3 || n > 10) throw new InvalidArgumentError("sigma phải trong [0.3, 10]");
  return n;
}

export function parseFormat(value: string): FormatOption {
  try {
    return parseFormatOption(value);
  } catch (err) {
    throw new InvalidArgumentError((err as Error).message);
  }
}

/** "png,webp" → ["png", "webp"]. */
export function parseFormatList(value: string): OutputFormat[] {
  try {
    const list = value.split(",").filter((v) => v.trim() !== "").map(parseOutputFormat);
    if (list.length === 0) throw new Error("danh sách rỗng");
    return [...new Set(list)];
  } catch (err) {
    throw new InvalidArgumentError((err as Error).message);
  }
}
