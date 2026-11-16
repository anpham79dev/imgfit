/**
 * One test per rule of docs/behavior.md, on generated sample images (scripts/samples.mjs).
 */
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exec, resize, type ResizeOptions } from "../../src/index.js";
import { pixel } from "../helpers.js";
import { hasGps, meta, sampleDir } from "./helpers.js";

let dir: string;
let sample: (name: string) => string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir, sample, cleanup } = await sampleDir([
    "near-square-2000x1900.jpg",
    "small-300x200.jpg",
    "transparent-1200x800.png",
    "exif-6.jpg",
    "cmyk-2400x1600.jpg",
    "gps-2400x1600.jpg",
    "landscape-3000x2000.jpg",
    "fake-ext-png.jpg",
  ]));
});
afterAll(async () => cleanup());

let n = 0;
/** Resizes one sample with preset-like options; returns the output file and its report entry. */
async function one(name: string, o: Partial<ResizeOptions> = {}) {
  const output = path.join(dir, "out", String(n++));
  const r = await resize({ inputs: [sample(name)], output, width: 1600, height: 1200, mode: "fit", format: "jpg", cwd: dir, ...o });
  const f = r.files[0];
  if (!f) throw new Error("no result");
  return { r, f, file: f.destination ? path.resolve(dir, f.destination) : "" };
}

describe("hành vi: kích thước", () => {
  it("fit: cả hai chiều ≤ khung, giữ tỉ lệ (ảnh ngang gần vuông 2000×1900 → 1263×1200, không phải 1600×1520)", async () => {
    const { f, file } = await one("near-square-2000x1900.jpg");
    expect(f.outputPx).toEqual([1263, 1200]);
    const m = await meta(file);
    expect([m.width, m.height]).toEqual([1263, 1200]);
  });

  it("không phóng to ảnh nhỏ (mặc định): 300×200 vào khung 1600×1200 giữ 300×200", async () => {
    const { f } = await one("small-300x200.jpg");
    expect(f.status).toBe("created");
    expect(f.outputPx).toEqual([300, 200]);
  });

  it("smallInput=skip: ảnh nhỏ hơn khung → skipped kèm lý do, không ghi file, không lỗi", async () => {
    const r = await exec(
      {
        schemaVersion: 1,
        jobs: [
          { input: path.relative(dir, sample("small-300x200.jpg")), output: "skip/LL.jpg", size: [1600, 1200], format: "jpg", smallInput: "skip" },
          { input: path.relative(dir, sample("small-300x200.jpg")), output: "skip/L.jpg", size: [200, 100], format: "jpg", smallInput: "skip" },
        ],
      },
      { cwd: dir },
    );
    expect(r.status).toBe("ok");
    const [ll, l] = r.files;
    expect(ll?.status).toBe("skipped");
    expect(ll?.warnings[0]).toMatchObject({ code: "W_SMALL_INPUT_SKIPPED", details: { source: [300, 200], target: [1600, 1200] } });
    expect(ll?.outputBytes).toBeNull();
    expect(l?.status).toBe("created");
    expect(r.summary).toMatchObject({ created: 1, skipped: 1, failed: 0 });
    await expect(readFile(path.join(dir, "skip/LL.jpg"))).rejects.toThrow();
  });

  it("xoay theo EXIF rồi bỏ tag orientation (orientation 6: 3000×2000 lưu → 800×1200 hiển thị)", async () => {
    const { file } = await one("exif-6.jpg");
    const m = await meta(file);
    expect([m.width, m.height]).toEqual([800, 1200]);
    expect(m.orientation ?? 1).toBe(1);
  });

  it("mỗi output resize từ ảnh gốc, không dây chuyền: L trong batch nhiều preset giống hệt L chạy riêng", async () => {
    const src = path.relative(dir, sample("landscape-3000x2000.jpg"));
    const r = await exec(
      {
        schemaVersion: 1,
        jobs: [
          { input: src, output: "chain/LL.jpg", size: [1600, 1200], format: "jpg" },
          { input: src, output: "chain/L.jpg", size: [640, 480], format: "jpg" },
        ],
      },
      { cwd: dir },
    );
    expect(r.status).toBe("ok");
    const alone = await one("landscape-3000x2000.jpg", { width: 640, height: 480 });
    expect(Buffer.compare(await readFile(path.join(dir, "chain/L.jpg")), await readFile(alone.file))).toBe(0);
  });
});

describe("hành vi: màu, nền, metadata", () => {
  it("trong suốt → JPG: nền trắng + W_ALPHA_FLATTENED", async () => {
    const { f, file } = await one("transparent-1200x800.png", { width: 640, height: 480 });
    expect(f.warnings.map((w) => w.code)).toContain("W_ALPHA_FLATTENED");
    const p = await pixel(file, 0, 0);
    expect(p.r).toBeGreaterThan(245);
    expect(p.g).toBeGreaterThan(245);
    expect(p.b).toBeGreaterThan(245);
  });

  it("bỏ metadata (EXIF/GPS) và chuyển sRGB, kể cả JPEG CMYK", async () => {
    const gps = await meta(sample("gps-2400x1600.jpg"));
    expect(hasGps(gps.exif)).toBe(true);
    const a = await meta((await one("gps-2400x1600.jpg")).file);
    expect(a.exif).toBeUndefined();
    const b = await meta((await one("cmyk-2400x1600.jpg")).file);
    expect(b.space).toBe("srgb");
    expect(b.channels).toBe(3);
  });

  it("định dạng theo nội dung file, không theo đuôi (PNG đặt tên .jpg, format keep → .png)", async () => {
    const { f } = await one("fake-ext-png.jpg", { format: "keep" });
    expect(f.format).toBe("png");
    expect(f.destination?.endsWith(".png")).toBe(true);
  });

  it("WebP và AVIF theo preset", async () => {
    for (const format of ["webp", "avif"] as const) {
      const { f, file } = await one("landscape-3000x2000.jpg", { width: 640, height: 480, format });
      expect(f.format).toBe(format);
      expect((await meta(file)).format).toBe(format === "avif" ? "heif" : "webp");
    }
  });
});

describe("hành vi: an toàn", () => {
  it("không bao giờ ghi đè ảnh gốc (E_OUTPUT_SAME_AS_SOURCE), kể cả với --overwrite", async () => {
    await copyFile(sample("small-300x200.jpg"), path.join(dir, "same.jpg"));
    const before = await readFile(path.join(dir, "same.jpg"));
    const r = await resize({ inputs: ["same.jpg"], output: ".", width: 100, height: 100, mode: "fit", format: "jpg", onConflict: "replace", cwd: dir });
    expect(r.status).toBe("aborted");
    expect(r.errors.map((e) => e.code)).toContain("E_OUTPUT_SAME_AS_SOURCE");
    expect(Buffer.compare(before, await readFile(path.join(dir, "same.jpg")))).toBe(0);
  });
});
