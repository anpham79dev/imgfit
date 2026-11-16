import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exec, init, parseExecSpec, run } from "../../src/index.js";
import type { Report } from "../../src/index.js";
import { listFiles, runCli, solid, tempDir } from "../helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

const cfgBase = () => ({
  schemaVersion: 1,
  profile: "web",
  roots: { input: "src-img", output: "out" },
  presets: {
    thumb: { size: [64, 64], mode: "cover", format: "webp" },
    big: { size: [200, 200], mode: "fit", format: "jpg", quality: 80 },
  },
  rules: [{ id: "photos", from: "photos/**/*.{jpg,png}", preset: "thumb", to: "{dir}/{name}.{ext}" }],
});

async function writeConfig(cfg: object = cfgBase()): Promise<void> {
  await writeFile(path.join(dir, "imgfit.json"), JSON.stringify(cfg, null, 2));
}
const src = (f: string) => path.join(dir, "src-img", f);
const out = (f: string) => path.join(dir, "out", f);
const statuses = (r: Report) => Object.fromEntries(r.files.map((f) => [f.destination, f.status]));
const codes = (r: Report) => r.files.flatMap((f) => f.errors.map((e) => e.code));

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(src("photos/sub"), { recursive: true });
  await solid(src("photos/a.jpg"), 300, 200, "#ff0000");
  await solid(src("photos/sub/b.png"), 200, 300, "#00ff00", "png");
  await writeConfig();
});
afterEach(async () => cleanup());

describe("init", () => {
  it("tạo config hợp lệ, schema, .gitignore; không ghi đè nếu không --force", async () => {
    const d = await tempDir();
    try {
      const r1 = await init({ cwd: d.dir, profile: "unity" });
      expect(r1.files.map((f) => f.status)).toEqual(["created", "created", "created"]);
      const cfg = JSON.parse(await readFile(path.join(d.dir, "imgfit.json"), "utf8"));
      expect(cfg.profile).toBe("unity");
      expect(await readFile(path.join(d.dir, ".gitignore"), "utf8")).toContain(".imgfit/");
      await writeFile(path.join(d.dir, "imgfit.json"), "{}");
      const r2 = await init({ cwd: d.dir });
      expect(r2.files[0]?.status).toBe("skipped");
      expect(await readFile(path.join(d.dir, "imgfit.json"), "utf8")).toBe("{}");
      expect(r2.files[2]?.status).toBe("unchanged");
      await init({ cwd: d.dir, force: true });
      // every profile's sample config must pass validation
      for (const profile of ["generic", "web", "unity"] as const) {
        await init({ cwd: d.dir, profile, force: true });
        await mkdir(path.join(d.dir, "images-src"), { recursive: true });
        const rr = await run({ cwd: d.dir, dryRun: true });
        expect(rr.status).toBe("ok");
      }
    } finally {
      await d.cleanup();
    }
  });
});

describe("config validation", () => {
  const bad = async (mutate: (c: ReturnType<typeof cfgBase>) => unknown, code: string) => {
    const c = cfgBase();
    const m = mutate(c);
    await writeConfig((m ?? c) as object);
    await expect(run({ cwd: dir, dryRun: true })).rejects.toMatchObject({ code });
  };

  it("trường lạ, preset thiếu, rule trùng id, template sai", async () => {
    await bad((c) => ({ ...c, extra: 1 }), "E_CONFIG_INVALID");
    await bad((c) => void (c.rules[0]!.preset = "nope"), "E_CONFIG_INVALID");
    await bad((c) => void c.rules.push({ ...c.rules[0]! }), "E_CONFIG_INVALID");
    await bad((c) => void (c.rules[0]!.to = "../{name}.{ext}"), "E_CONFIG_INVALID");
    await bad((c) => void (c.rules[0]!.to = "{id}.{ext}"), "E_CONFIG_INVALID");
    await bad((c) => void ((c.rules[0] as { preset: unknown }).preset = ["thumb", "big"]), "E_CONFIG_INVALID");
    await bad((c) => void ((c.presets.thumb as { size: unknown }).size = [0, 10]), "E_CONFIG_INVALID");
  });

  it("profile unity chặn webp", async () => {
    await bad((c) => void (c.profile = "unity"), "E_FORMAT_NOT_ALLOWED");
  });

  it("env chỉ expand biến được khai báo và đã đặt", async () => {
    const c = { ...cfgBase(), roots: { input: "${IMG_SRC}", output: "out" } };
    await writeConfig(c);
    await expect(run({ cwd: dir, dryRun: true, env: { IMG_SRC: src("") } })).rejects.toMatchObject({ code: "E_CONFIG_INVALID" });
    await writeConfig({ ...c, env: ["IMG_SRC"] });
    await expect(run({ cwd: dir, dryRun: true, env: {} })).rejects.toMatchObject({ code: "E_CONFIG_INVALID" });
    const r = await run({ cwd: dir, dryRun: true, env: { IMG_SRC: path.join(dir, "src-img") } });
    expect(r.summary.planned).toBe(2);
  });

  it("CLI: config lỗi → exit 2; không có config → E_CONFIG_NOT_FOUND", async () => {
    await writeFile(path.join(dir, "imgfit.json"), "{ not json");
    expect((await runCli(["run", "--json"], dir)).code).toBe(2);
    const empty = await tempDir();
    try {
      const r = await runCli(["run", "--json"], empty.dir);
      expect(r.code).toBe(2);
      expect(JSON.parse(r.stdout).errors[0].code).toBe("E_CONFIG_NOT_FOUND");
    } finally {
      await empty.cleanup();
    }
  });
});

describe("run: incremental", () => {
  it("lần hai không encode lại; đổi nguồn/preset/focal/output được bắt đúng", async () => {
    const r1 = await run({ cwd: dir });
    expect(r1.summary.created).toBe(2);
    expect(await listFiles(path.join(dir, "out"))).toEqual(["a.webp", "sub/b.webp"]);
    const m1 = (await stat(out("a.webp"))).mtimeMs;

    const r2 = await run({ cwd: dir });
    expect(r2.summary.unchanged).toBe(2);
    expect((await stat(out("a.webp"))).mtimeMs).toBe(m1);

    // one source changes → only that file
    await solid(src("photos/a.jpg"), 300, 200, "#0000ff");
    const r3 = await run({ cwd: dir });
    expect(statuses(r3)).toEqual({ "out/a.webp": "replaced", "out/sub/b.webp": "unchanged" });

    // preset changes → everything
    const c = cfgBase();
    (c.presets.thumb as { quality?: number }).quality = 50;
    await writeConfig(c);
    expect((await run({ cwd: dir })).summary.replaced).toBe(2);

    // focal point changes → only the file with a crop
    await writeFile(path.join(dir, "imgfit.crops.json"), JSON.stringify({ schemaVersion: 1, crops: { "photos/a.jpg": { x: 0.9, y: 0.5 } } }));
    expect(statuses(await run({ cwd: dir }))).toEqual({ "out/a.webp": "replaced", "out/sub/b.webp": "unchanged" });

    // output deleted → recreated
    await rm(out("sub/b.webp"));
    expect(statuses(await run({ cwd: dir }))["out/sub/b.webp"]).toBe("created");

    // corrupt cache → rebuilt; no wrong skip, no re-encoding of unchanged files
    await writeFile(path.join(dir, ".imgfit", "cache.json"), "garbage");
    const r7 = await run({ cwd: dir });
    expect(r7.warnings.map((w) => w.code)).toContain("W_STATE_REBUILT");
    expect(r7.summary.unchanged).toBe(2);

    // cache removed entirely → still unchanged thanks to imgfit.managed.json (fresh clone)
    await rm(path.join(dir, ".imgfit"), { recursive: true, force: true });
    expect((await run({ cwd: dir })).summary.unchanged).toBe(2);
  });

  it("output bị sửa tay → E_OUTPUT_MODIFIED; --overwrite tạo lại kèm cảnh báo", async () => {
    await run({ cwd: dir });
    await writeFile(out("a.webp"), "hand edited");
    const r = await run({ cwd: dir });
    expect(codes(r)).toContain("E_OUTPUT_MODIFIED");
    expect(await readFile(out("a.webp"), "utf8")).toBe("hand edited");
    const r2 = await run({ cwd: dir, onConflict: "replace", backup: true });
    expect(statuses(r2)["out/a.webp"]).toBe("replaced");
    expect(r2.files.find((f) => f.destination === "out/a.webp")?.warnings.map((w) => w.code)).toContain("W_OUTPUT_MODIFIED");
    const backups = await listFiles(path.join(dir, ".imgfit", "backups"));
    expect(backups.some((b) => b.endsWith("out/a.webp"))).toBe(true);
  });

  it("output có sẵn chưa quản lý → conflict; --adopt cần --yes; adopt rồi run tạo lại", async () => {
    await mkdir(path.join(dir, "out"), { recursive: true });
    await solid(out("a.webp"), 64, 64, "#123456", "webp");
    const r1 = await run({ cwd: dir });
    expect(codes(r1)).toContain("E_OUTPUT_CONFLICT");
    expect(r1.files.find((f) => f.destination === "out/sub/b.webp")?.status).toBe("created");

    await expect(run({ cwd: dir, adopt: true })).rejects.toMatchObject({ code: "E_USAGE" });
    const declined = await run({ cwd: dir, adopt: true, confirm: async () => false });
    expect(statuses(declined)["out/a.webp"]).toBe("skipped");

    const adopted = await run({ cwd: dir, adopt: true, yes: true });
    expect(statuses(adopted)).toEqual({ "out/a.webp": "adopted", "out/sub/b.webp": "unchanged" });
    const managed = JSON.parse(await readFile(path.join(dir, "imgfit.managed.json"), "utf8"));
    expect(managed.outputs["out/a.webp"].fingerprint).toBeNull();

    expect(statuses(await run({ cwd: dir }))["out/a.webp"]).toBe("replaced");
    expect(statuses(await run({ cwd: dir }))["out/a.webp"]).toBe("unchanged");
  });

  it("dry-run không ghi gì (output, managed, cache, lock)", async () => {
    const r = await run({ cwd: dir, dryRun: true });
    expect(r.files.map((f) => f.action)).toEqual(["create", "create"]);
    expect(await listFiles(dir)).toEqual(["imgfit.json", "src-img/photos/a.jpg", "src-img/photos/sub/b.png"]);
  });

  it("{id} theo imgfit.names.json; thiếu id → E_NAME_MISSING", async () => {
    const c = cfgBase();
    c.rules = [{ id: "photos", from: "photos/**/*.{jpg,png}", preset: "thumb", to: "avatars/{id}.{ext}", names: "imgfit.names.json" } as never];
    await writeConfig(c);
    await writeFile(path.join(dir, "imgfit.names.json"), JSON.stringify({ schemaVersion: 1, names: { "photos/a.jpg": "hero-001" } }));
    const r = await run({ cwd: dir });
    expect(statuses(r)["out/avatars/hero-001.webp"]).toBe("created");
    expect(codes(r)).toContain("E_NAME_MISSING");
  });

  it("nhiều preset cho một nguồn với {preset}", async () => {
    const c = cfgBase();
    c.rules = [{ id: "photos", from: "photos/*.jpg", preset: ["thumb", "big"], to: "{preset}/{name}.{ext}" } as never];
    await writeConfig(c);
    const r = await run({ cwd: dir });
    expect(await listFiles(path.join(dir, "out"))).toEqual(["big/a.jpg", "thumb/a.webp"]);
    expect(r.files.find((f) => f.preset === "big")?.outputPx).toEqual([200, 133]);
  });

  it("trùng đích giữa hai rule → dừng, không ghi; nguồn trùng nội dung → cảnh báo", async () => {
    const c = cfgBase();
    c.rules.push({ id: "again", from: "photos/*.jpg", preset: "thumb", to: "{name}.{ext}" });
    await writeConfig(c);
    const r = await run({ cwd: dir });
    expect(r.status).toBe("aborted");
    expect(await listFiles(path.join(dir, "out"))).toEqual([]);

    await writeConfig();
    await solid(src("photos/copy.jpg"), 300, 200, "#ff0000");
    await writeFile(src("photos/copy.jpg"), await readFile(src("photos/a.jpg")));
    const r2 = await run({ cwd: dir });
    expect(r2.files.find((f) => f.file.endsWith("copy.jpg"))?.warnings.map((w) => w.code)).toContain("W_DUPLICATE_SOURCE");
  });

  it("output mồ côi khi bỏ rule → cảnh báo, không xóa", async () => {
    await run({ cwd: dir });
    const c = cfgBase();
    c.rules[0]!.from = "photos/*.jpg";
    await writeConfig(c);
    const r = await run({ cwd: dir });
    expect(r.warnings.map((w) => w.code)).toContain("W_OUTPUT_ORPHAN");
    expect(await listFiles(path.join(dir, "out"))).toContain("sub/b.webp");
  });

  it("blockMultiple làm tròn xuống có cảnh báo", async () => {
    const c = cfgBase();
    (c.presets as Record<string, unknown>).tex = { size: [150, 150], mode: "fit", format: "png", blockMultiple: 4 };
    c.rules[0]!.preset = "tex";
    c.rules[0]!.from = "photos/*.jpg";
    await writeConfig(c);
    const r = await run({ cwd: dir });
    expect(r.files[0]?.outputPx).toEqual([148, 100]);
    expect(r.files[0]?.warnings.map((w) => w.code)).toContain("W_BLOCK_ROUNDED");
  });

  it("lock: tiến trình khác đang chạy → E_LOCKED; lock của process đã chết → cảnh báo và chạy", async () => {
    await mkdir(path.join(dir, ".imgfit", "locks"), { recursive: true });
    const lock = path.join(dir, ".imgfit", "locks", "project.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), command: "run" }));
    await expect(run({ cwd: dir })).rejects.toMatchObject({ code: "E_LOCKED" });
    await writeFile(lock, JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), startedAt: new Date().toISOString(), command: "run" }));
    const r = await run({ cwd: dir });
    expect(r.warnings.map((w) => w.code)).toContain("W_STALE_LOCK");
    expect(await readdir(path.join(dir, ".imgfit", "locks"))).toEqual([]);
  });
});

describe("exec", () => {
  it("job inline + preset từ config; NDJSON qua CLI", async () => {
    const spec = await parseExecSpec(
      JSON.stringify({
        schemaVersion: 1,
        jobs: [
          { input: "src-img/photos/a.jpg", output: "o/a.png", size: [50, 50], mode: "cover", format: "png" },
          { input: "src-img/photos/a.jpg", output: "o/a-thumb.webp", preset: "thumb" },
        ],
      }),
    );
    const r = await exec(spec, { cwd: dir });
    expect(r.summary.created).toBe(2);
    expect((await sharp(path.join(dir, "o/a.png")).metadata()).width).toBe(50);

    await writeFile(path.join(dir, "job.json"), JSON.stringify({ schemaVersion: 1, jobs: [{ input: "src-img/photos/a.jpg", output: "o/x.jpg", size: [10, 10] }] }));
    const cli = await runCli(["exec", "--file", "job.json"], dir);
    expect(cli.code).toBe(0);
    const lines = cli.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["progress", "progress", "result", "summary"]);
    expect(lines.at(-1).status).toBe("ok");
  });

  it("job sai schema / ra ngoài root / trùng đích", async () => {
    await expect(parseExecSpec('{"schemaVersion":1,"jobs":[{"input":"a"}]}')).rejects.toMatchObject({ code: "E_USAGE" });
    const r = await exec(
      { schemaVersion: 1, jobs: [{ input: "src-img/photos/a.jpg", output: "../escape.jpg", size: [10, 10] }] },
      { cwd: dir },
    );
    expect(codes(r)).toContain("E_PATH_UNSAFE");
    const r2 = await exec(
      {
        schemaVersion: 1,
        jobs: [
          { input: "src-img/photos/a.jpg", output: "o/same.jpg", size: [10, 10] },
          { input: "src-img/photos/sub/b.png", output: "o/SAME.jpg", size: [10, 10], format: "jpg" },
        ],
      },
      { cwd: dir },
    );
    expect(r2.status).toBe("aborted");
  });
});
