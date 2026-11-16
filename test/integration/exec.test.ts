import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec, init, loadConfig, parseExecSpec } from "../../src/index.js";
import type { Report } from "../../src/index.js";
import { runCli, solid, tempDir } from "../helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

const cfgBase = () => ({
  schemaVersion: 2,
  presets: {
    thumb: { size: [64, 64], mode: "cover", format: "webp" },
    big: { size: [200, 200], mode: "fit", format: "jpg", quality: 80 },
  } as Record<string, Record<string, unknown>>,
});

async function writeConfig(cfg: object = cfgBase()): Promise<void> {
  await writeFile(path.join(dir, "imgfit.json"), JSON.stringify(cfg, null, 2));
}
const codes = (r: Report) => r.files.flatMap((f) => f.errors.map((e) => e.code));

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(path.join(dir, "src-img", "sub"), { recursive: true });
  await solid(path.join(dir, "src-img", "a.jpg"), 300, 200, "#ff0000");
  await solid(path.join(dir, "src-img", "sub", "b.png"), 200, 300, "#00ff00", "png");
  await writeConfig();
});
afterEach(async () => cleanup());

describe("init", () => {
  it("tạo imgfit.json hợp lệ + schema; không ghi đè nếu không --force", async () => {
    const d = await tempDir();
    try {
      const r1 = await init({ cwd: d.dir });
      expect(r1.files.map((f) => f.status)).toEqual(["created", "created"]);
      const cfg = await loadConfig(path.join(d.dir, "imgfit.json"));
      expect([...cfg.presets.keys()]).toContain("L");
      await writeFile(path.join(d.dir, "imgfit.json"), "{}");
      const r2 = await init({ cwd: d.dir });
      expect(r2.files.map((f) => f.status)).toEqual(["skipped", "unchanged"]);
      expect(await readFile(path.join(d.dir, "imgfit.json"), "utf8")).toBe("{}");
      expect((await init({ cwd: d.dir, force: true })).files[0]?.status).toBe("overwritten");
    } finally {
      await d.cleanup();
    }
  });
});

describe("config validation", () => {
  const bad = async (mutate: (c: ReturnType<typeof cfgBase>) => unknown) => {
    const c = cfgBase();
    const m = mutate(c);
    await writeConfig((m ?? c) as object);
    await expect(loadConfig(path.join(dir, "imgfit.json"))).rejects.toMatchObject({ code: "E_CONFIG_INVALID" });
  };

  it("trường lạ, schemaVersion cũ, size sai, chế độ project cũ bị từ chối", async () => {
    await bad((c) => ({ ...c, extra: 1 }));
    await bad((c) => ({ ...c, schemaVersion: 1 }));
    await bad((c) => ({ ...c, rules: [] }));
    await bad((c) => void (c.presets.thumb!.size = [0, 10]));
    await bad((c) => void (c.presets.thumb!.position = "focal"));
  });

  it("CLI: config lỗi → exit 2; không có config → E_CONFIG_NOT_FOUND", async () => {
    const job = JSON.stringify({ schemaVersion: 1, jobs: [{ input: "src-img/a.jpg", output: "o/a.webp", preset: "thumb" }] });
    await writeFile(path.join(dir, "job.json"), job);
    await writeFile(path.join(dir, "imgfit.json"), "{ not json");
    expect((await runCli(["exec", "--file", "job.json"], dir)).code).toBe(2);
    const empty = await tempDir();
    try {
      await writeFile(path.join(empty.dir, "job.json"), job);
      const r = await runCli(["exec", "--file", "job.json"], empty.dir);
      expect(r.code).toBe(2);
      expect(JSON.parse(r.stdout).errors[0].code).toBe("E_CONFIG_NOT_FOUND");
    } finally {
      await empty.cleanup();
    }
  });
});

describe("exec", () => {
  it("job inline + preset từ config; NDJSON qua CLI", async () => {
    const spec = await parseExecSpec(
      JSON.stringify({
        schemaVersion: 1,
        jobs: [
          { input: "src-img/a.jpg", output: "o/a.png", size: [50, 50], mode: "cover", format: "png" },
          { input: "src-img/a.jpg", output: "o/a-thumb.webp", preset: "thumb" },
        ],
      }),
    );
    const r = await exec(spec, { cwd: dir });
    expect(r.summary.created).toBe(2);
    expect((await sharp(path.join(dir, "o/a.png")).metadata()).width).toBe(50);

    await writeFile(path.join(dir, "job.json"), JSON.stringify({ schemaVersion: 1, jobs: [{ input: "src-img/a.jpg", output: "o/x.jpg", size: [10, 10] }] }));
    const cli = await runCli(["exec", "--file", "job.json"], dir);
    expect(cli.code).toBe(0);
    const lines = cli.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["progress", "progress", "result", "summary"]);
    expect(lines.at(-1).status).toBe("ok");
  });

  it("job sai schema / ra ngoài root / trùng đích", async () => {
    await expect(parseExecSpec('{"schemaVersion":1,"jobs":[{"input":"a"}]}')).rejects.toMatchObject({ code: "E_USAGE" });
    const r = await exec({ schemaVersion: 1, jobs: [{ input: "src-img/a.jpg", output: "../escape.jpg", size: [10, 10] }] }, { cwd: dir });
    expect(codes(r)).toContain("E_PATH_UNSAFE");
    const r2 = await exec(
      {
        schemaVersion: 1,
        jobs: [
          { input: "src-img/a.jpg", output: "o/same.jpg", size: [10, 10] },
          { input: "src-img/sub/b.png", output: "o/SAME.jpg", size: [10, 10], format: "jpg" },
        ],
      },
      { cwd: dir },
    );
    expect(r2.status).toBe("aborted");
  });
});
