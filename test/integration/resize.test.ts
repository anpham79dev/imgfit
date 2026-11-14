import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resize, type ResizeOptions } from "../../src/index.js";
import { animatedGif, fakeApng, halves, listFiles, near, pixel, rgba, solid, tempDir } from "../helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(path.join(dir, "raw"), { recursive: true });
});
afterEach(async () => cleanup());

const base = (o: Partial<ResizeOptions>): ResizeOptions => ({
  inputs: ["raw"],
  output: "out",
  width: 256,
  height: 256,
  mode: "fit",
  format: "keep",
  cwd: dir,
  ...o,
});

const raw = (f: string) => path.join(dir, "raw", f);
const out = (f: string) => path.join(dir, "out", f);

describe("resize: hình học", () => {
  it("fit giữ tỷ lệ và không phóng to", async () => {
    await solid(raw("wide.jpg"), 2000, 1000, "#336699");
    await solid(raw("tiny.jpg"), 100, 50, "#336699");
    const r = await resize(base({ width: 512, height: 1024 }));
    expect(r.status).toBe("ok");
    expect(r.files.find((f) => f.file.endsWith("wide.jpg"))?.outputPx).toEqual([512, 256]);
    expect(r.files.find((f) => f.file.endsWith("tiny.jpg"))?.outputPx).toEqual([100, 50]);
    expect((await sharp(out("wide.jpg")).metadata()).width).toBe(512);
  });

  it("cover ra đúng W×H", async () => {
    await solid(raw("a.jpg"), 1200, 800, "#336699");
    const r = await resize(base({ mode: "cover", width: 256, height: 128, format: "webp" }));
    expect(r.status).toBe("ok");
    const m = await sharp(out("a.webp")).metadata();
    expect([m.format, m.width, m.height]).toEqual(["webp", 256, 128]);
  });

  it("pad ra đúng W×H, nền trong suốt cho PNG và màu nền cho JPG", async () => {
    await solid(raw("a.jpg"), 400, 200, "#0000ff");
    await resize(base({ mode: "pad", width: 200, height: 200, format: "png" }));
    expect((await pixel(out("a.png"), 100, 5)).a).toBe(0);
    expect(near(await pixel(out("a.png"), 100, 100), [0, 0, 255])).toBe(true);

    await resize(base({ mode: "pad", width: 200, height: 200, format: "jpg", background: "#ff0000", output: "out2" }));
    expect(near(await pixel(path.join(dir, "out2", "a.jpg"), 100, 5), [255, 0, 0])).toBe(true);
  });

  it("áp EXIF orientation trước khi resize (orientation 6)", async () => {
    // Lưu 200×100: trái đỏ, phải xanh. Orientation 6 = xoay 90° theo chiều kim đồng hồ khi hiển thị
    // → hiển thị 100×200: trên đỏ, dưới xanh.
    await halves(raw("rot.jpg"), 200, 100, "#ff0000", "#0000ff", 6);
    const r = await resize(base({ width: 100, height: 200, format: "png" }));
    expect(r.files[0]?.inputPx).toEqual([100, 200]);
    expect(r.files[0]?.outputPx).toEqual([100, 200]);
    expect(near(await pixel(out("rot.png"), 50, 20), [255, 0, 0])).toBe(true);
    expect(near(await pixel(out("rot.png"), 50, 180), [0, 0, 255])).toBe(true);
    expect((await sharp(out("rot.png")).metadata()).orientation).toBeUndefined();
  });

  it("orientation mirrored (2) lật ngang", async () => {
    await halves(raw("mir.jpg"), 200, 100, "#ff0000", "#0000ff", 2);
    await resize(base({ width: 200, height: 100, format: "png" }));
    expect(near(await pixel(out("mir.png"), 20, 50), [0, 0, 255])).toBe(true);
    expect(near(await pixel(out("mir.png"), 180, 50), [255, 0, 0])).toBe(true);
  });

  it("cover + focal point giữ đúng vùng", async () => {
    // 400×100 xanh dương, ô xanh lá ở x=300..400
    await sharp({ create: { width: 400, height: 100, channels: 3, background: "#0000ff" } })
      .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: "#00ff00" } }, left: 300, top: 0 }])
      .png()
      .toFile(raw("f.png"));
    await resize(base({ mode: "cover", width: 50, height: 50, focalPoint: { x: 0.875, y: 0.5 }, position: "focal" }));
    expect(near(await pixel(out("f.png"), 25, 25), [0, 255, 0])).toBe(true);
    expect(near(await pixel(out("f.png"), 2, 2), [0, 255, 0])).toBe(true);
  });

  it("cover center không lấy vùng mép", async () => {
    await sharp({ create: { width: 400, height: 100, channels: 3, background: "#0000ff" } })
      .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: "#00ff00" } }, left: 300, top: 0 }])
      .png()
      .toFile(raw("f.png"));
    await resize(base({ mode: "cover", width: 50, height: 50 }));
    expect(near(await pixel(out("f.png"), 25, 25), [0, 0, 255])).toBe(true);
  });
});

describe("resize: ảnh nhỏ hơn target", () => {
  beforeEach(async () => solid(raw("small.jpg"), 100, 80, "#00aa00"));

  it("cover mặc định báo E_SMALL_INPUT, không ghi gì", async () => {
    const r = await resize(base({ mode: "cover" }));
    expect(r.status).toBe("failed");
    expect(r.files[0]?.errors[0]?.code).toBe("E_SMALL_INPUT");
    expect(await listFiles(path.join(dir, "out"))).toEqual([]);
  });

  it("cover + keep chỉ crop đúng tỷ lệ", async () => {
    const r = await resize(base({ mode: "cover", smallInput: "keep" }));
    expect(r.files[0]?.outputPx).toEqual([80, 80]);
    expect(r.files[0]?.warnings.map((w) => w.code)).toContain("W_SMALL_INPUT_KEPT");
  });

  it("cover + pad ra đúng W×H không phóng to", async () => {
    const r = await resize(base({ mode: "cover", smallInput: "pad", format: "png" }));
    expect(r.files[0]?.outputPx).toEqual([256, 256]);
    expect((await pixel(out("small.png"), 2, 2)).a).toBe(0);
    expect(near(await pixel(out("small.png"), 128, 128), [0, 170, 0])).toBe(true);
  });

  it("upscale=true thì phóng to", async () => {
    const r = await resize(base({ mode: "cover", upscale: true }));
    expect(r.files[0]?.outputPx).toEqual([256, 256]);
  });
});

describe("resize: định dạng và alpha", () => {
  it("alpha → JPG flatten lên nền trắng có cảnh báo", async () => {
    await rgba(raw("a.png"), 100, 100, 0);
    const r = await resize(base({ format: "jpg" }));
    const codes = r.files[0]?.warnings.map((w) => w.code);
    expect(codes).toContain("W_ALPHA_FLATTENED");
    expect(codes).toContain("W_DEFAULT_BACKGROUND");
    expect(near(await pixel(out("a.jpg"), 50, 50), [255, 255, 255])).toBe(true);
  });

  it("PNG trong suốt giữ alpha", async () => {
    await rgba(raw("a.png"), 100, 100, 0.5);
    await resize(base({ format: "png" }));
    const p = await pixel(out("a.png"), 50, 50);
    expect(p.a).toBeGreaterThan(100);
    expect(p.a).toBeLessThan(160);
  });

  it("format keep theo NỘI DUNG file, không theo đuôi (PNG bị đổi đuôi .jpg)", async () => {
    await solid(raw("fake.jpg"), 100, 100, "#123456", "png");
    const r = await resize(base({}));
    expect(r.files[0]?.destination).toBe("out/fake.png");
    expect((await sharp(out("fake.png")).metadata()).format).toBe("png");
  });

  it("đuôi trong --name không khớp format bị chặn", async () => {
    await solid(raw("a.jpg"), 100, 100, "#123456");
    const r = await resize(base({ format: "webp", name: "{name}.png" }));
    expect(r.files[0]?.errors[0]?.code).toBe("E_EXTENSION_MISMATCH");
    expect(await listFiles(path.join(dir, "out"))).toEqual([]);
  });

  it("bỏ metadata mặc định", async () => {
    await sharp({ create: { width: 50, height: 50, channels: 3, background: "#fff" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret" } })
      .toFile(raw("exif.jpg"));
    await resize(base({}));
    expect((await sharp(out("exif.jpg")).metadata()).exif).toBeUndefined();
  });
});

describe("resize: input lỗi", () => {
  it("file hỏng, rỗng, ảnh động bị từ chối với mã riêng; file tốt vẫn được xử lý", async () => {
    await solid(raw("good.jpg"), 300, 300, "#abcdef");
    const goodBytes = await readFile(raw("good.jpg"));
    await writeFile(raw("truncated.jpg"), goodBytes.subarray(0, Math.floor(goodBytes.length / 3)));
    await writeFile(raw("empty.png"), Buffer.alloc(0));
    await writeFile(raw("text.webp"), "không phải ảnh");
    await fakeApng(raw("anim.png"));
    await animatedGif(raw("anim.gif"));

    const r = await resize(base({ format: "jpg" }));
    const code = (name: string) => r.files.find((f) => f.file.endsWith(name))?.errors[0]?.code;
    expect(r.status).toBe("failed");
    expect(r.files.find((f) => f.file.endsWith("good.jpg"))?.status).toBe("created");
    expect(code("empty.png")).toBe("E_INPUT_CORRUPT");
    expect(code("text.webp")).toBe("E_INPUT_UNSUPPORTED");
    expect(code("anim.png")).toBe("E_INPUT_ANIMATED");
    expect(code("anim.gif")).toBe("E_INPUT_ANIMATED");
    expect(["E_INPUT_CORRUPT", "E_INPUT_UNSUPPORTED"]).toContain(code("truncated.jpg"));
    expect(await listFiles(path.join(dir, "out"))).toEqual(["good.jpg"]);
  });

  it("ảnh vượt giới hạn pixel", async () => {
    await solid(raw("big.jpg"), 500, 500, "#fff");
    const r = await resize(base({ limitInputPixels: 1000 }));
    expect(r.files[0]?.errors[0]?.code).toBe("E_INPUT_TOO_LARGE");
  });
});

describe("resize: ghi file an toàn", () => {
  it("trùng đích (khác đuôi, khác hoa/thường) → dừng cả batch, không ghi gì", async () => {
    await solid(raw("Photo.jpg"), 300, 300, "#f00");
    await solid(raw("photo.png"), 300, 300, "#0f0", "png");
    await solid(raw("other.jpg"), 300, 300, "#00f");
    const r = await resize(base({ format: "webp" }));
    expect(r.status).toBe("aborted");
    expect(r.errors[0]?.code).toBe("E_OUTPUT_COLLISION");
    expect(r.files.find((f) => f.file.endsWith("other.jpg"))?.status).toBe("cancelled");
    expect(await listFiles(path.join(dir, "out"))).toEqual([]);
  });

  it("output trùng file nguồn bị chặn", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    const before = await readFile(raw("a.jpg"));
    const r = await resize(base({ output: "raw", onConflict: "replace" }));
    expect(r.status).toBe("aborted");
    expect(r.errors[0]?.code).toBe("E_OUTPUT_SAME_AS_SOURCE");
    expect(await readFile(raw("a.jpg"))).toEqual(before);
  });

  it("mặc định không đè file có sẵn; --overwrite thay; --backup lưu bản cũ", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    await mkdir(path.join(dir, "out"));
    await writeFile(out("a.jpg"), "cũ");

    const r1 = await resize(base({}));
    expect(r1.files[0]?.errors[0]?.code).toBe("E_OUTPUT_CONFLICT");
    expect(await readFile(out("a.jpg"), "utf8")).toBe("cũ");

    const r2 = await resize(base({ onConflict: "replace", backup: true }));
    expect(r2.files[0]?.status).toBe("replaced");
    expect((await sharp(out("a.jpg")).metadata()).format).toBe("jpeg");
    const backups = await listFiles(path.join(dir, ".imgfit", "backups"));
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(dir, ".imgfit", "backups", backups[0] as string), "utf8")).toBe("cũ");
  });

  it("skip-existing bỏ qua có cảnh báo", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    await mkdir(path.join(dir, "out"));
    await writeFile(out("a.jpg"), "cũ");
    const r = await resize(base({ onConflict: "skip" }));
    expect(r.status).toBe("ok");
    expect(r.files[0]?.status).toBe("skipped");
    expect(r.files[0]?.warnings[0]?.code).toBe("W_SKIP_EXISTING_UNVERIFIED");
  });

  it("dry-run không tạo thư mục/file nào và báo outputBytes = null", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    const r = await resize(base({ dryRun: true, mode: "cover", width: 128, height: 64 }));
    expect(r.dryRun).toBe(true);
    expect(r.files[0]?.status).toBe("planned");
    expect(r.files[0]?.outputPx).toEqual([128, 64]);
    expect(r.files[0]?.outputBytes).toBeNull();
    await expect(stat(path.join(dir, "out"))).rejects.toThrow();
  });

  it("không để lại file tạm; tên Unicode/khoảng trắng/reserved", async () => {
    await solid(raw("ảnh đẹp 1.jpg"), 300, 300, "#f00");
    await solid(raw("CON.jpg"), 300, 300, "#0f0");
    const r = await resize(base({}));
    expect(r.status).toBe("ok");
    const files = await listFiles(path.join(dir, "out"));
    expect(files).toEqual(["_CON.jpg", "ảnh đẹp 1.jpg".normalize("NFC")].sort());
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("đệ quy với {dir} giữ cấu trúc thư mục", async () => {
    await mkdir(raw("a/b"), { recursive: true });
    await solid(raw("a/b/x.jpg"), 300, 300, "#f00");
    await solid(raw("y.jpg"), 300, 300, "#f00");
    const r = await resize(base({ recursive: true, name: "{dir}/{name}-{w}.{ext}" }));
    expect(r.status).toBe("ok");
    expect(await listFiles(path.join(dir, "out"))).toEqual(["a/b/x-256.jpg", "y-256.jpg"]);
  });

  it("glob input", async () => {
    await mkdir(raw("sub"), { recursive: true });
    await solid(raw("sub/x.jpg"), 300, 300, "#f00");
    await solid(raw("y.png"), 300, 300, "#f00", "png");
    const r = await resize(base({ inputs: ["raw/**/*.jpg"], name: "{dir}/{name}.{ext}" }));
    expect(r.files.map((f) => f.destination)).toEqual(["out/sub/x.jpg"]);
  });

  it("fingerprint ổn định với cùng input + options, đổi khi đổi options", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    const r1 = await resize(base({ output: "o1" }));
    const r2 = await resize(base({ output: "o2" }));
    const r3 = await resize(base({ output: "o3", quality: 50 }));
    expect(r1.files[0]?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r1.files[0]?.fingerprint).toBe(r2.files[0]?.fingerprint);
    expect(r1.files[0]?.fingerprint).not.toBe(r3.files[0]?.fingerprint);
  });

  it("hủy giữa chừng: ảnh chưa bắt đầu → cancelled, ảnh đã ghi vẫn nguyên", async () => {
    for (let i = 0; i < 6; i++) await solid(raw(`p${i}.jpg`), 400, 400, "#f00");
    const ac = new AbortController();
    const r = await resize(
      base({
        jobs: 1,
        signal: ac.signal,
        onEvent: (e) => {
          if (e.type === "done" && e.completed === 2) ac.abort();
        },
      }),
    );
    expect(r.status).toBe("cancelled");
    expect(r.summary.created).toBeGreaterThanOrEqual(2);
    expect(r.summary.cancelled).toBeGreaterThan(0);
    for (const f of r.files.filter((x) => x.status === "created")) {
      expect((await sharp(path.join(dir, f.destination as string)).metadata()).width).toBe(256);
    }
  });

  it("hai file cùng nội dung, khác tên đều được xử lý", async () => {
    await solid(raw("a.jpg"), 300, 300, "#f00");
    await copyFile(raw("a.jpg"), raw("b.jpg"));
    const r = await resize(base({}));
    expect(r.summary.created).toBe(2);
  });
});
