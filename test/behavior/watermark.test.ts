/**
 * Watermark behavior on real encodes: placement, no distortion, no cropping, minOutput, presets.
 * Logo: samples/brand/logo.png (600×200, green rounded rectangle with white shapes).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, resize } from "../../src/index.js";
import { near, pixel, runCli } from "../helpers.js";
import { sampleDir } from "./helpers.js";

let dir: string;
let sample: (name: string) => string;
let cleanup: () => Promise<void>;

const config = (wm: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  presets: {
    L: { size: [640, 480], format: "jpg", prefix: "L_", watermark: "brand" },
    LL: { size: [1600, 1200], format: "jpg", prefix: "LL_", watermark: "brand" },
  },
  watermarks: { brand: { file: "samples/brand/logo.png", position: "bottom-left", offset: ["1.5%", "5%"], width: "15%", minOutput: [640, 400], ...wm } },
});

beforeAll(async () => {
  ({ dir, sample, cleanup } = await sampleDir(["landscape-3000x2000.jpg", "portrait-2000x3000.jpg", "near-square-2000x1900.jpg", "small-300x200.jpg", "precompressed-640x480-q55.jpg"]));
  await writeFile(path.join(dir, "imgfit.json"), JSON.stringify(config()));
});
afterAll(async () => cleanup());

const LOGO_GREEN: [number, number, number] = [0, 170, 85];

describe("watermark", () => {
  it("logo gắn sau resize, đúng vị trí, scale đều, không bị cắt — với ảnh ngang, dọc và gần vuông", async () => {
    for (const name of ["landscape-3000x2000.jpg", "portrait-2000x3000.jpg", "near-square-2000x1900.jpg"]) {
      const r = await resize({ inputs: [sample(name)], output: "out/wm", presets: ["LL"], cwd: dir, onConflict: "replace" });
      const f = r.files[0];
      expect(f?.status, name).toBe("created");
      const wm = f?.watermark;
      if (!wm || !("left" in wm)) throw new Error(`no watermark for ${name}`);
      const [w, h] = f?.outputPx ?? [0, 0];
      expect(wm.width).toBe(Math.floor(w * 0.15));
      expect(Math.abs(wm.width / wm.height - 3)).toBeLessThan(0.05); // 600×200 logo stays 3:1
      expect(wm.left).toBe(Math.round(w * 0.015));
      expect(wm.top + wm.height).toBe(h - Math.round(h * 0.05));
      // the logo's green border band is where the plan says (sampled just inside its left edge, mid-height)
      const out = path.resolve(dir, f?.destination ?? "");
      const p = await pixel(out, wm.left + Math.round(wm.width * 0.02), wm.top + Math.round(wm.height / 2));
      expect(near(p, LOGO_GREEN, 60), `${name}: ${JSON.stringify(p)}`).toBe(true);
    }
  });

  it("minOutput: output nhỏ → không gắn, có W_WATERMARK_SKIPPED", async () => {
    const r = await resize({ inputs: [sample("small-300x200.jpg")], output: "out/wm-small", presets: ["L"], cwd: dir });
    const f = r.files[0];
    expect(f?.watermark).toMatchObject({ name: "brand", skipped: expect.any(String) });
    expect(f?.warnings.map((w) => w.code)).toContain("W_WATERMARK_SKIPPED");
  });

  it("có watermark thì không dùng ảnh gốc thay output (keepSmallerSource)", async () => {
    const r = await resize({ inputs: [sample("precompressed-640x480-q55.jpg")], output: "out/wm-pre", presets: ["L"], cwd: dir });
    const f = r.files[0];
    expect(f?.watermark).toHaveProperty("left");
    const larger = f?.warnings.find((w) => w.code === "W_OUTPUT_LARGER");
    if (larger) expect(larger.details).toMatchObject({ usedSource: false, reason: "output có watermark" });
  });

  it("CLI: --no-watermark bỏ watermark của preset; --watermark gắn cho resize thường", async () => {
    const a = JSON.parse((await runCli(["resize", sample("landscape-3000x2000.jpg"), "--preset", "L", "--no-watermark", "-o", "out/cli1", "--json"], dir)).stdout);
    expect(a.files[0].watermark).toBeNull();
    const b = JSON.parse((await runCli(["resize", sample("landscape-3000x2000.jpg"), "-s", "800x600", "-f", "jpg", "--watermark", "brand", "-o", "out/cli2", "--json"], dir)).stdout);
    expect(b.files[0].watermark).toMatchObject({ name: "brand", width: 120 });
    const c = await runCli(["resize", sample("landscape-3000x2000.jpg"), "-s", "800x600", "--watermark", "nope", "-o", "out/cli3", "--json"], dir);
    expect(c.code).toBe(2);
  });

  it("config: logo không tồn tại, opacity sai, preset trỏ watermark lạ → E_CONFIG_INVALID", async () => {
    const bad = async (cfg: object) => {
      await writeFile(path.join(dir, "bad.json"), JSON.stringify(cfg));
      await expect(loadConfig(path.join(dir, "bad.json"))).rejects.toMatchObject({ code: "E_CONFIG_INVALID" });
    };
    await bad(config({ file: "missing.png" }));
    await bad(config({ opacity: 2 }));
    await bad({ ...config(), presets: { L: { size: [10, 10], watermark: "other" } } });
  });
});
