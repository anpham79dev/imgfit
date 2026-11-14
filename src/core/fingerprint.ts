import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { versions } from "../version.js";

/** Tăng khi thay đổi pipeline làm khác bytes output với cùng input + options. */
export const PIPELINE_VERSION = 1;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export async function hashFile(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/**
 * Fingerprint = SHA256(source bytes || options hiệu lực (canonical JSON) || pipelineVersion || sharp || libvips).
 * Đổi bất kỳ thành phần nào → fingerprint đổi → (từ Đợt 2) cache biết phải xử lý lại.
 */
export async function fingerprint(file: string, effectiveOptions: unknown): Promise<string> {
  const sourceHash = await hashFile(file);
  const v = versions();
  const h = createHash("sha256");
  h.update(sourceHash);
  h.update("\u0000");
  h.update(JSON.stringify(canonical(effectiveOptions)));
  h.update("\u0000");
  h.update(`pipeline=${PIPELINE_VERSION};sharp=${v.sharp};libvips=${v.libvips}`);
  return `sha256:${h.digest("hex")}`;
}
