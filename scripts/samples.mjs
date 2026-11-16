/**
 * Generated sample images for behavior tests (test/behavior) and the comparison script (scripts/compare).
 * Everything is synthesized with sharp, so no copyrighted photos are needed. Content is "photo-like":
 * blurred noise (texture that is hard to compress) + gradients + hard edges (where resampling and
 * compression artifacts show).
 *
 *   import { makeSamples } from "./samples.mjs";
 *   const list = await makeSamples("samples", { huge: true });
 */
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

sharp.cache({ files: 0 });

/** Photo-like RGB pixels as a sharp pipeline (not yet encoded). */
async function photo(width, height, hue = 210) {
  const noise = await sharp({ create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 70 } } })
    .blur(Math.max(1, Math.round(Math.min(width, height) / 400)))
    .png({ compressionLevel: 0 })
    .toBuffer();
  const r = Math.min(width, height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,35%)"/><stop offset="1" stop-color="hsl(${(hue + 120) % 360},70%,65%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)" opacity="0.75"/>
    <circle cx="${width * 0.3}" cy="${height * 0.4}" r="${r * 0.18}" fill="#fff" opacity="0.85"/>
    <rect x="${width * 0.55}" y="${height * 0.2}" width="${width * 0.3}" height="${height * 0.5}" fill="none" stroke="#111" stroke-width="${Math.max(2, r / 150)}"/>
    <path d="M0 ${height * 0.85} L${width} ${height * 0.65}" stroke="#ff0" stroke-width="${Math.max(1, r / 300)}"/>
  </svg>`;
  // fine grain (sensor-like noise) so file sizes resemble real photos
  const grain = await sharp({ create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 28 } } })
    .blur(0.5)
    .png({ compressionLevel: 0 })
    .toBuffer();
  const base = await sharp(noise).composite([{ input: Buffer.from(svg.replace('opacity="0.75"', 'opacity="0.55"')), blend: "over" }]).png({ compressionLevel: 0 }).toBuffer();
  return sharp(base).composite([{ input: grain, blend: "soft-light" }]);
}

/** Logo with alpha and a non-4:3 aspect (3:1), so distortion or cropping in watermarking is obvious. */
async function logo(file) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200">
    <rect x="4" y="4" width="592" height="192" rx="24" fill="#0a5" fill-opacity="0.85" stroke="#fff" stroke-width="8"/>
    <circle cx="100" cy="100" r="60" fill="#fff"/>
    <rect x="200" y="70" width="340" height="60" fill="#fff"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

const jpg = (q = 92) => (img) => img.jpeg({ quality: q });

/**
 * Sample set. `expect` documents what the sample is for; the tests assert the behavior.
 * The 54 MP sample is only generated with { huge: true } (slow, ~150 MB of pixels).
 */
export const SAMPLES = [
  { name: "landscape-3000x2000.jpg", w: 3000, h: 2000, enc: jpg(), why: "ảnh ngang thường" },
  { name: "portrait-2000x3000.jpg", w: 2000, h: 3000, enc: jpg(), why: "ảnh dọc" },
  { name: "near-square-2000x1900.jpg", w: 2000, h: 1900, enc: jpg(), why: "ảnh ngang gần vuông: resize theo chiều rộng sẽ vượt khung 1600×1200" },
  { name: "square-2000x2000.jpg", w: 2000, h: 2000, enc: jpg(), why: "ảnh vuông" },
  { name: "panorama-6000x1000.jpg", w: 6000, h: 1000, enc: jpg(), why: "ảnh rất ngang" },
  { name: "tall-1000x5000.jpg", w: 1000, h: 5000, enc: jpg(), why: "ảnh rất dọc" },
  { name: "small-300x200.jpg", w: 300, h: 200, enc: jpg(), why: "nhỏ hơn mọi khung: không được phóng to" },
  { name: "medium-1000x700.jpg", w: 1000, h: 700, enc: jpg(), why: "nhỏ hơn LL (1600×1200), lớn hơn L (640×480)" },
  { name: "transparent-1200x800.png", w: 1200, h: 800, alpha: true, enc: (img) => img.png(), why: "PNG trong suốt: sang JPG phải nền trắng" },
  { name: "opaque-1200x800.png", w: 1200, h: 800, enc: (img) => img.png(), why: "PNG không alpha (ảnh chụp lưu PNG)" },
  { name: "exif-6.jpg", w: 3000, h: 2000, orientation: 6, enc: jpg(), why: "EXIF orientation 6: hiển thị 2000×3000" },
  { name: "exif-8.jpg", w: 3000, h: 2000, orientation: 8, enc: jpg(), why: "EXIF orientation 8: hiển thị 2000×3000" },
  { name: "cmyk-2400x1600.jpg", w: 2400, h: 1600, enc: (img) => img.toColourspace("cmyk").jpeg({ quality: 92 }), why: "JPEG CMYK: phải chuyển sRGB" },
  { name: "gps-2400x1600.jpg", w: 2400, h: 1600, gps: true, enc: jpg(), why: "có EXIF GPS: phải bị xóa" },
  { name: "webp-2400x1600.webp", w: 2400, h: 1600, enc: (img) => img.webp({ quality: 85 }), why: "input WebP" },
  { name: "static-800x600.gif", w: 800, h: 600, enc: (img) => img.gif(), why: "GIF tĩnh: không giữ được định dạng → fallback" },
  { name: "scan-1200x800.tiff", w: 1200, h: 800, enc: (img) => img.tiff(), why: "TIFF: không giữ được định dạng → fallback" },
  { name: "fake-ext-png.jpg", w: 1200, h: 800, enc: (img) => img.png(), why: "PNG mang đuôi .jpg: định dạng theo nội dung" },
  { name: "precompressed-640x480-q55.jpg", w: 640, h: 480, enc: (img) => img.jpeg({ quality: 55, mozjpeg: true }), why: "JPG nhỏ đã nén sẵn: encode lại q80 dễ nặng hơn" },
  { name: "precompressed-1600x1200-q50.jpg", w: 1600, h: 1200, enc: (img) => img.jpeg({ quality: 50, mozjpeg: true }), why: "JPG nén sẵn đúng khung LL" },
  { name: "huge-9000x6000.jpg", w: 9000, h: 6000, huge: true, enc: jpg(85), why: "rất lớn (54 MP)" },
];

async function build(file, s, i) {
  let img = await photo(s.w, s.h, (i * 37) % 360);
  if (s.alpha) {
    // soft transparent border + fully transparent corner
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}"><ellipse cx="${s.w / 2}" cy="${s.h / 2}" rx="${s.w * 0.45}" ry="${s.h * 0.42}" fill="#fff"/></svg>`,
    );
    const rgb = await img.removeAlpha().png().toBuffer();
    img = sharp(rgb).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]);
  }
  // round-trip through a lossless buffer so EXIF/colour options apply to the final encode only
  img = sharp(await img.png({ compressionLevel: 0 }).toBuffer());
  if (s.alpha === undefined) img = img.removeAlpha();
  if (s.orientation) img = img.withMetadata({ orientation: s.orientation });
  if (s.gps) {
    img = img.withExif({
      IFD0: { Make: "imgfit-samples", Model: "synthetic" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "10/1 46/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "106/1 41/1 0/1" },
    });
  }
  const tmp = `${file}.tmp`;
  await s.enc(img).toFile(tmp);
  await rename(tmp, file);
}

/**
 * Writes the sample set into `dir` (skips files that already exist) plus `brand/logo.png`.
 * Returns [{ name, file, why }].
 */
export async function makeSamples(dir, { huge = false, only } = {}) {
  await mkdir(path.join(dir, "brand"), { recursive: true });
  const logoFile = path.join(dir, "brand", "logo.png");
  if (!(await stat(logoFile).catch(() => null))) await logo(logoFile);
  const list = SAMPLES.filter((s) => (huge || !s.huge) && (!only || only.includes(s.name)));
  for (const [i, s] of list.entries()) {
    const file = path.join(dir, s.name);
    if (!(await stat(file).catch(() => null))) await build(file, s, i);
  }
  await writeFile(path.join(dir, "README.txt"), `${list.map((s) => `${s.name}\t${s.why}`).join("\n")}\n`);
  return list.map((s) => ({ name: s.name, file: path.join(dir, s.name), why: s.why }));
}

// CLI: node scripts/samples.mjs <dir> [--huge]
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^\/?/, "/")}` || process.argv[1]?.endsWith("samples.mjs")) {
  const dir = process.argv[2] ?? "samples";
  const list = await makeSamples(dir, { huge: process.argv.includes("--huge") });
  for (const s of list) console.log(`${s.name}\t${s.why}`);
}
