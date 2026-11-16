/**
 * keepSmallerSource: never publish an output that is larger than an identical-shape source.
 */
import { copyFile } from "node:fs/promises";
import { warning } from "../core/errors.js";
import type { TransformPlan } from "../image/plan.js";
import type { ProbeResult } from "../image/probe.js";
import type { Job } from "./job.js";

/** Why the source bytes cannot replace a larger output, or null when they can. */
function sourceSwapBlocker(job: Job): string | null {
  const p = job.probe as ProbeResult;
  const t = job.transform;
  if (t.keepSmallerSource === false) return "keepSmallerSource=false";
  if (p.orientation !== 1) return "ảnh gốc có EXIF orientation, phải xoay";
  if (t.stripMetadata !== false && (p.hasMetadata || p.hasProfile)) return "ảnh gốc có metadata/ICC cần xóa";
  if (p.space !== "srgb" && p.space !== "b-w") return `ảnh gốc ở không gian màu ${p.space}, phải chuyển sRGB`;
  return null;
}

/**
 * keepSmallerSource: same format + same size but larger than the input → use the input bytes when nothing
 * else would change. Mutates `temp` and the result's warnings; returns the bytes now in `temp`.
 */
export async function preferSmallerSource(job: Job, temp: string, encodedBytes: number): Promise<number> {
  const p = job.probe as ProbeResult;
  const plan = job.plan as TransformPlan;
  const sameShape = plan.outputFormat === p.detected.keepAs && plan.outputSize.width === p.width && plan.outputSize.height === p.height;
  if (!sameShape || encodedBytes <= p.bytes) return encodedBytes;
  const blocker = sourceSwapBlocker(job);
  const details = { encodedBytes, sourceBytes: p.bytes, usedSource: blocker === null, ...(blocker ? { reason: blocker } : {}) };
  if (blocker) {
    job.result.warnings.push(warning("W_OUTPUT_LARGER", `Output (${encodedBytes} B) nặng hơn ảnh gốc (${p.bytes} B) nhưng không dùng được ảnh gốc: ${blocker}`, details));
    return encodedBytes;
  }
  await copyFile(job.source, temp);
  job.result.warnings.push(warning("W_OUTPUT_LARGER", `Output (${encodedBytes} B) nặng hơn ảnh gốc (${p.bytes} B) cùng định dạng và kích thước; đã dùng ảnh gốc`, details));
  return p.bytes;
}
