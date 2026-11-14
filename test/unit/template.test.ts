import { describe, expect, it } from "vitest";
import { ImgfitError } from "../../src/core/errors.js";
import { parseFormatOption } from "../../src/core/formats.js";
import { collisionKey, isInside, sanitizeSegment } from "../../src/core/paths.js";
import { parseColor } from "../../src/core/process.js";
import { renderTemplate, validateTemplate } from "../../src/core/template.js";

const vars = { name: "photo", ext: "jpg", w: 256, h: 128, dir: "" };

describe("sanitizeSegment", () => {
  it("thay ký tự cấm trên Windows", () => expect(sanitizeSegment('a<b>c:d"e|f?g*h')).toBe("a_b_c_d_e_f_g_h"));
  it("tránh tên reserved của Windows", () => {
    expect(sanitizeSegment("CON")).toBe("_CON");
    expect(sanitizeSegment("nul.jpg")).toBe("_nul.jpg");
    expect(sanitizeSegment("com1")).toBe("_com1");
    expect(sanitizeSegment("console")).toBe("console");
  });
  it("bỏ dấu chấm/khoảng trắng cuối", () => expect(sanitizeSegment("name. . ")).toBe("name"));
  it("chuẩn hóa Unicode NFC", () => expect(sanitizeSegment("Tie\u0302\u0301ng")).toBe("Tiếng".normalize("NFC")));
  it("không bao giờ rỗng hoặc ..", () => {
    expect(sanitizeSegment("")).toBe("_");
    expect(sanitizeSegment("..")).toBe("_");
  });
});

describe("collisionKey / isInside", () => {
  it("không phân biệt hoa/thường và dạng Unicode", () => {
    expect(collisionKey("Out/A.JPG")).toBe(collisionKey("out/a.jpg"));
    expect(collisionKey("e\u0301.jpg")).toBe(collisionKey("\u00e9.jpg"));
  });
  it("isInside", () => {
    expect(isInside("/a/b", "/a/b/c")).toBe(true);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
    expect(isInside("/a/b", "/a")).toBe(false);
  });
});

describe("template", () => {
  it("render mặc định", () => expect(renderTemplate("{name}.{ext}", vars)).toBe("photo.jpg"));
  it("render kích thước và thư mục con", () => {
    expect(renderTemplate("{dir}/{name}-{w}x{h}.{ext}", { ...vars, dir: "a/b" })).toBe("a/b/photo-256x128.jpg");
    expect(renderTemplate("{dir}/{name}.{ext}", vars)).toBe("photo.jpg");
  });
  it("sanitize tên nguồn", () => expect(renderTemplate("{name}.{ext}", { ...vars, name: "a:b|c" })).toBe("a_b_c.jpg"));
  it("{preset} cần preset", () => {
    expect(renderTemplate("{preset}/{name}.{ext}", { ...vars, preset: "thumb" })).toBe("thumb/photo.jpg");
    expect(() => renderTemplate("{preset}/{name}.{ext}", vars)).toThrow(ImgfitError);
  });
  it("từ chối placeholder lạ, .., đường dẫn tuyệt đối, ngoặc lệch", () => {
    for (const t of ["{nam}.{ext}", "../{name}.{ext}", "a/../../{name}.{ext}", "/abs/{name}.{ext}", "C:/x/{name}.{ext}", "{name.{ext}", ""]) {
      expect(() => validateTemplate(t), t).toThrow(ImgfitError);
    }
  });
  it("{dir} chứa .. bị chặn", () => expect(() => renderTemplate("{dir}/{name}.{ext}", { ...vars, dir: "../x" })).toThrow(ImgfitError));
});

describe("parse helpers", () => {
  it("format", () => {
    expect(parseFormatOption("JPEG")).toBe("jpg");
    expect(parseFormatOption("keep")).toBe("keep");
    expect(() => parseFormatOption("gif")).toThrow(ImgfitError);
  });
  it("color", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, alpha: 1 });
    expect(parseColor("#00000080").alpha).toBeCloseTo(0.502, 2);
    expect(() => parseColor("white")).toThrow(ImgfitError);
  });
});
