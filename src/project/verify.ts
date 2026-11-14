/**
 * Read-only verification of one output file against its preset (used by `check`).
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "sharp";
import { ImgfitError, type Issue } from "../core/errors.js";
import { EXTENSIONS_FOR, type OutputFormat, outputFormatOf } from "../image/formats.js";
import { sharp } from "../image/sharp.js";
import { displayPath } from "../pipeline/job.js";
import type { ProjectConfig, ResolvedPreset } from "./config/types.js";

export interface Expected {
  format: OutputFormat;
  width: number;
  height: number;
}

export interface Verification {
  errors: Issue[];
  bytes: number | null;
  px: [number, number] | null;
  format: OutputFormat | null;
}

const issue = (code: ConstructorParameters<typeof ImgfitError>[0], message: string, details?: Record<string, unknown>): Issue =>
  new ImgfitError(code, message, details).toIssue();

function formatIssues(cfg: ProjectConfig, file: string, preset: ResolvedPreset, fmt: OutputFormat | null, actual: string | undefined, expected?: Expected): Issue[] {
  if (!fmt) return [issue("E_FORMAT_MISMATCH", `Output có định dạng ${actual}, không phải định dạng output hợp lệ`)];
  const out: Issue[] = [];
  if (!EXTENSIONS_FOR[fmt].includes(path.extname(file).toLowerCase())) out.push(issue("E_FORMAT_MISMATCH", `Bytes là ${fmt} nhưng đuôi file là ${path.extname(file)}`));
  const t = preset.transform;
  const want = expected?.format ?? (t.format === "keep" ? undefined : t.format);
  if (want && fmt !== want) out.push(issue("E_FORMAT_MISMATCH", `Output là ${fmt}, preset "${preset.name}" yêu cầu ${want}`));
  if (!cfg.allowedFormats.includes(fmt)) out.push(issue("E_FORMAT_NOT_ALLOWED", `Profile "${cfg.profile}" không cho phép ${fmt}`));
  return out;
}

/** With a plan (`expected`) sizes must match exactly; without one (output-only) they must satisfy the preset. */
function sizeIssues(preset: ResolvedPreset, px: [number, number], expected?: Expected): Issue[] {
  if (expected) {
    return px[0] !== expected.width || px[1] !== expected.height ? [issue("E_DIMENSIONS_MISMATCH", `Output ${px[0]}×${px[1]}, mong đợi ${expected.width}×${expected.height}`)] : [];
  }
  const t = preset.transform;
  const out: Issue[] = [];
  const exact = t.mode !== "fit" && (t.smallInput ?? "error") !== "keep";
  const ok = exact ? px[0] === t.width && px[1] === t.height : px[0] <= t.width && px[1] <= t.height;
  if (!ok) out.push(issue("E_DIMENSIONS_MISMATCH", `Output ${px[0]}×${px[1]} không hợp với preset "${preset.name}" (${t.mode} ${t.width}×${t.height})`));
  const bm = t.blockMultiple ?? 1;
  if (bm > 1 && (px[0] % bm !== 0 || px[1] % bm !== 0)) out.push(issue("E_DIMENSIONS_MISMATCH", `Kích thước ${px[0]}×${px[1]} không phải bội số của ${bm}`));
  return out;
}

/** Checks existence, real format vs extension/preset/profile, orientation, size and byte budget. */
export async function validateOutput(cfg: ProjectConfig, file: string, preset: ResolvedPreset, expected?: Expected): Promise<Verification> {
  const st = await stat(file).catch(() => undefined);
  if (!st?.isFile()) return { errors: [issue("E_OUTPUT_MISSING", `Thiếu output: ${displayPath(cfg.dir, file)}`)], bytes: null, px: null, format: null };

  let meta: Metadata;
  try {
    meta = await sharp(file).metadata();
  } catch (e) {
    return { errors: [issue("E_OUTPUT_INVALID", `Output không đọc được như ảnh: ${(e as Error).message}`)], bytes: st.size, px: null, format: null };
  }
  const fmt = outputFormatOf(meta.format, meta.compression);
  const px: [number, number] = [meta.width ?? 0, meta.height ?? 0];

  const errors = [...formatIssues(cfg, file, preset, fmt, meta.format, expected), ...sizeIssues(preset, px, expected)];
  if ((meta.orientation ?? 1) !== 1) errors.push(issue("E_OUTPUT_INVALID", `Output còn EXIF orientation ${meta.orientation} (phải được xoay sẵn)`));
  if (preset.maxFileKB !== undefined && st.size > preset.maxFileKB * 1024) {
    errors.push(issue("E_BUDGET_EXCEEDED", `Output ${(st.size / 1024).toFixed(1)} KB vượt ngân sách ${preset.maxFileKB} KB`, { bytes: st.size, maxFileKB: preset.maxFileKB }));
  }
  return { errors, bytes: st.size, px, format: fmt };
}
