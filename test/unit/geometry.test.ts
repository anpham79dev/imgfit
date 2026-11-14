import { describe, expect, it } from "vitest";
import { aspectCropRect, centerOffsets, fitInside, focalForPosition, isSmallInput, orientedSize } from "../../src/image/geometry.js";

describe("orientedSize", () => {
  it("đổi chiều với orientation 5–8", () => {
    for (const o of [5, 6, 7, 8]) expect(orientedSize(800, 400, o)).toEqual({ width: 400, height: 800 });
  });
  it("giữ nguyên với orientation 1–4 hoặc không có", () => {
    for (const o of [undefined, 1, 2, 3, 4]) expect(orientedSize(800, 400, o)).toEqual({ width: 800, height: 400 });
  });
});

describe("isSmallInput", () => {
  const target = { width: 256, height: 256 };
  it("cover: nhỏ khi một chiều thiếu", () => {
    expect(isSmallInput({ width: 1000, height: 200 }, target, "cover")).toBe(true);
    expect(isSmallInput({ width: 256, height: 256 }, target, "cover")).toBe(false);
  });
  it("fit/pad: nhỏ chỉ khi cả hai chiều thiếu", () => {
    expect(isSmallInput({ width: 1000, height: 200 }, target, "fit")).toBe(false);
    expect(isSmallInput({ width: 100, height: 200 }, target, "fit")).toBe(true);
    expect(isSmallInput({ width: 100, height: 200 }, target, "pad")).toBe(true);
  });
});

describe("fitInside", () => {
  it("thu nhỏ giữ tỷ lệ", () => {
    expect(fitInside({ width: 2000, height: 1000 }, { width: 512, height: 1024 }, false)).toEqual({ width: 512, height: 256 });
    expect(fitInside({ width: 1000, height: 3000 }, { width: 512, height: 1024 }, false)).toEqual({ width: 341, height: 1024 });
  });
  it("không phóng to khi allowUpscale=false", () => {
    expect(fitInside({ width: 100, height: 50 }, { width: 400, height: 400 }, false)).toEqual({ width: 100, height: 50 });
  });
  it("phóng to khi allowUpscale=true", () => {
    expect(fitInside({ width: 100, height: 50 }, { width: 400, height: 400 }, true)).toEqual({ width: 400, height: 200 });
  });
  it("không bao giờ về 0px", () => {
    expect(fitInside({ width: 10_000, height: 1 }, { width: 100, height: 100 }, false)).toEqual({ width: 100, height: 1 });
  });
});

describe("aspectCropRect", () => {
  it("cắt ảnh ngang về vuông ở giữa", () => {
    expect(aspectCropRect({ width: 400, height: 200 }, { width: 1, height: 1 }, { x: 0.5, y: 0.5 })).toEqual({ left: 100, top: 0, width: 200, height: 200 });
  });
  it("giữ focal point trong khung và clamp biên", () => {
    expect(aspectCropRect({ width: 400, height: 100 }, { width: 1, height: 1 }, { x: 0.875, y: 0.5 })).toEqual({ left: 300, top: 0, width: 100, height: 100 });
    expect(aspectCropRect({ width: 400, height: 100 }, { width: 1, height: 1 }, { x: 1, y: 1 })).toEqual({ left: 300, top: 0, width: 100, height: 100 });
    expect(aspectCropRect({ width: 400, height: 100 }, { width: 1, height: 1 }, { x: 0, y: 0 })).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });
  it("focal ở bốn góc với ảnh dọc", () => {
    const src = { width: 100, height: 400 };
    expect(aspectCropRect(src, { width: 1, height: 1 }, { x: 0, y: 0 }).top).toBe(0);
    expect(aspectCropRect(src, { width: 1, height: 1 }, { x: 1, y: 1 }).top).toBe(300);
  });
  it("tỷ lệ không vuông", () => {
    expect(aspectCropRect({ width: 1000, height: 1000 }, { width: 512, height: 1024 }, { x: 0.5, y: 0.5 })).toEqual({ left: 250, top: 0, width: 500, height: 1000 });
  });
});

describe("focalForPosition / centerOffsets", () => {
  it("top = mép trên", () => expect(focalForPosition("top")).toEqual({ x: 0.5, y: 0 }));
  it("chia đều phần đệm, phần lẻ về phải/dưới", () => {
    expect(centerOffsets({ width: 100, height: 51 }, { width: 101, height: 100 })).toEqual({ left: 0, right: 1, top: 24, bottom: 25 });
  });
});
