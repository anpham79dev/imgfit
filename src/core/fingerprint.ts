import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { versions } from "../version.js";

/** Bump whenever a pipeline change alters output bytes for the same input + options. */
export const PIPELINE_VERSION = 1;

/** JSON-serialisable value with object keys sorted and undefined fields dropped. */
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

/** Streams the file through SHA-256 (never buffers whole images). Returns hex. */
export async function hashFile(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/**
 * Fingerprint = SHA256(source bytes || effective options (canonical JSON) || pipelineVersion || sharp || libvips).
 * Changing any component changes the fingerprint, so `run` knows it must reprocess.
 */
export async function fingerprint(file: string, effectiveOptions: unknown): Promise<string> {
  return fingerprintFromHash(await hashFile(file), effectiveOptions);
}

/** Same as fingerprint() but with a precomputed source hash (a source with several presets is read once). */
export function fingerprintFromHash(sourceHash: string, effectiveOptions: unknown): string {
  const v = versions();
  const h = createHash("sha256");
  h.update(sourceHash);
  h.update("\u0000");
  h.update(JSON.stringify(canonical(effectiveOptions)));
  h.update("\u0000");
  h.update(`pipeline=${PIPELINE_VERSION};sharp=${v.sharp};libvips=${v.libvips}`);
  return `sha256:${h.digest("hex")}`;
}
