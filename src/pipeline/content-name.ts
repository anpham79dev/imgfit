/**
 * Content-addressed output names: `{hash}` in a name template stays as a token until the output is encoded,
 * then becomes the first 16 hex characters of the SHA-256 of the final output bytes.
 */
import path from "node:path";
import { HASH_TOKEN } from "../core/template.js";

export const HASH_LENGTH = 16;

/** True when the file name still contains the unresolved {hash} token. */
export function isContentNamed(dest: string): boolean {
  return path.basename(dest).includes(HASH_TOKEN);
}

/** Replaces the {hash} token in the file name with the content hash. */
export function resolveContentName(dest: string, sha256Hex: string): string {
  return path.join(path.dirname(dest), path.basename(dest).split(HASH_TOKEN).join(sha256Hex.slice(0, HASH_LENGTH)));
}

/** Same as resolveContentName for a display path (posix). */
export function resolveDisplayName(shown: string, sha256Hex: string): string {
  return shown.split(HASH_TOKEN).join(sha256Hex.slice(0, HASH_LENGTH));
}
