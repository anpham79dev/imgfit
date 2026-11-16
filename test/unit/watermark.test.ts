import { describe, expect, it } from "vitest";
import { ImgfitError } from "../../src/core/errors.js";
import { parseLength, planWatermark, WATERMARK_POSITIONS, type WatermarkSpec } from "../../src/image/watermark.js";

/** Logo 600×200 (3:1), like scripts/samples.mjs brand/logo.png. */
const spec = (o: Partial<WatermarkSpec> = {}): WatermarkSpec => ({
  name: "brand",
  file: "logo.png",
  logoWidth: 600,
  logoHeight: 200,
  position: "bottom-left",
  offset: ["1.5%", "5%"],
  width: "15%",
  opacity: 1,
  ...o,
});

describe("planWatermark", () => {
  it("scale đều theo % chiều rộng output, không méo", () => {
    for (const out of [
      { width: 1600, height: 1200 },
      { width: 1600, height: 900 },
      { width: 800, height: 1200 },
      { width: 1263, height: 1200 },
    ]) {
      const p = planWatermark(out, spec());
      if (!("left" in p)) throw new Error("skipped");
      expect(p.width).toBe(Math.floor(out.width * 0.15));
      expect(Math.abs(p.width / p.height - 3)).toBeLessThan(0.05);
    }
  });

  it("bottom-left với offset %: tính theo output, nằm trọn trong ảnh", () => {
    expect(planWatermark({ width: 1600, height: 1200 }, spec())).toEqual({ name: "brand", left: 24, top: 1200 - 80 - 60, width: 240, height: 80 });
  });

  it("đủ 9 vị trí, luôn nằm trọn trong output", () => {
    const out = { width: 1000, height: 500 };
    const seen = new Set<string>();
    for (const position of WATERMARK_POSITIONS) {
      const p = planWatermark(out, spec({ position, offset: ["10px", "10px"] }));
      if (!("left" in p)) throw new Error("skipped");
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + p.width).toBeLessThanOrEqual(out.width);
      expect(p.top + p.height).toBeLessThanOrEqual(out.height);
      seen.add(`${p.left},${p.top}`);
    }
    expect(seen.size).toBe(9);
    const c = planWatermark(out, spec({ position: "center" }));
    expect(c).toMatchObject({ left: (1000 - 150) / 2, top: Math.round((500 - 50) / 2) });
  });

  it("logo quá lớn so với output được thu nhỏ đều (không crop)", () => {
    const p = planWatermark({ width: 300, height: 50 }, spec({ width: "100%" }));
    if (!("left" in p)) throw new Error("skipped");
    expect(p.height).toBeLessThanOrEqual(50);
    expect(p.width).toBeLessThanOrEqual(300);
    expect(Math.abs(p.width / p.height - 3)).toBeLessThan(0.1);
  });

  it("minOutput: output nhỏ hơn ở một chiều → bỏ qua kèm lý do", () => {
    expect(planWatermark({ width: 500, height: 480 }, spec({ minOutput: [640, 480] }))).toMatchObject({ skipped: expect.stringContaining("640×480") });
    expect(planWatermark({ width: 640, height: 480 }, spec({ minOutput: [640, 480] }))).toHaveProperty("left");
  });

  it("px và %", () => {
    expect(parseLength("15%", "w")).toEqual({ value: 15, unit: "%" });
    expect(parseLength("24px", "w")).toEqual({ value: 24, unit: "px" });
    expect(parseLength(24, "w")).toEqual({ value: 24, unit: "px" });
    expect(() => parseLength("abc", "w")).toThrow(ImgfitError);
    expect(() => parseLength("120%", "w")).toThrow(ImgfitError);
    const p = planWatermark({ width: 1000, height: 1000 }, spec({ width: "300px", offset: [0, 0], position: "top-right" }));
    expect(p).toMatchObject({ left: 700, top: 0, width: 300, height: 100 });
  });
});
