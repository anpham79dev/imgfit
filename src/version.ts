import { readFileSync } from "node:fs";
import sharp from "sharp";

// Cùng một đường dẫn tương đối đúng cho cả src/version.ts (test) và dist/version.js (bản build).
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };

export const TOOL_NAME = pkg.name;
export const TOOL_VERSION = pkg.version;

export interface Versions {
  imgfit: string;
  sharp: string;
  libvips: string;
  node: string;
  platform: string;
  arch: string;
}

export function versions(): Versions {
  return {
    imgfit: TOOL_VERSION,
    sharp: sharp.versions.sharp ?? "unknown",
    libvips: sharp.versions.vips,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
}
