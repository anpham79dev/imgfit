import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFiles, runCli, solid, tempDir } from "../helpers.js";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(path.join(dir, "raw"));
  await solid(path.join(dir, "raw", "a.jpg"), 600, 400, "#336699");
});
afterEach(async () => cleanup());

describe("CLI", () => {
  it("--version và --version --json", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect((await runCli(["--version"], dir)).stdout.trim()).toBe(pkg.version);
    const j = JSON.parse((await runCli(["--version", "--json"], dir)).stdout);
    expect(j).toMatchObject({ schemaVersion: 2, imgfit: pkg.version });
    expect(j.sharp).toBeTruthy();
    expect(j.libvips).toBeTruthy();
  });

  it("resize --json: stdout là đúng một document JSON, exit 0", async () => {
    const r = await runCli(["resize", "raw", "-s", "128x128", "-m", "cover", "-f", "webp", "-o", "out", "--json"], dir);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({ schemaVersion: 2, command: "resize", status: "ok", summary: { created: 1 } });
    expect(report.files[0]).toMatchObject({ file: "raw/a.jpg", destination: "out/a.webp", outputPx: [128, 128], format: "webp" });
    expect(await listFiles(path.join(dir, "out"))).toEqual(["a.webp"]);
  });

  it("--keep png,webp --format jpg: PNG giữ PNG, JPG ra JPG; --keep thiếu --format cụ thể → exit 2", async () => {
    await solid(path.join(dir, "raw", "b.png"), 600, 400, "#336699", "png");
    const r = await runCli(["resize", "raw", "-s", "128", "--keep", "png,webp", "-f", "jpg", "-o", "out", "--json"], dir);
    expect(r.code).toBe(0);
    expect(await listFiles(path.join(dir, "out"))).toEqual(["a.jpg", "b.png"]);
    expect((await runCli(["resize", "raw", "-s", "128", "--keep", "png", "-o", "out2", "--json"], dir)).code).toBe(2);
    expect((await runCli(["resize", "raw", "-s", "128", "--keep", "bmp", "-f", "jpg", "-o", "out2", "--json"], dir)).code).toBe(2);
  });

  it("dry-run không ghi", async () => {
    const r = await runCli(["resize", "raw", "-s", "128", "-o", "out", "--dry-run", "--json"], dir);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).files[0].status).toBe("planned");
    expect(await listFiles(path.join(dir, "out"))).toEqual([]);
  });

  it("file lỗi → exit 1 và report có mã lỗi", async () => {
    const r = await runCli(["resize", "raw", "-s", "1000", "-m", "cover", "-o", "out", "--json"], dir);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).files[0].errors[0].code).toBe("E_SMALL_INPUT");
  });

  it("sai tham số → exit 2, có JSON lỗi khi --json", async () => {
    const r = await runCli(["resize", "raw", "-s", "abc", "-o", "out", "--json"], dir);
    expect(r.code).toBe(2);
    const doc = JSON.parse(r.stdout);
    expect(doc).toMatchObject({ status: "error", errors: [{ code: "E_USAGE" }] });

    expect((await runCli(["resize", "raw", "-s", "10"], dir)).code).toBe(2); // missing --output
    expect((await runCli(["resize", "raw", "-s", "10", "-o", "o", "--overwrite", "--skip-existing"], dir)).code).toBe(2);
    expect((await runCli(["resize", "raw", "-s", "10", "-o", "o", "--name", "../{name}.{ext}"], dir)).code).toBe(2);
    expect((await runCli(["khong-co-lenh"], dir)).code).toBe(2);
  });

  it("input không tồn tại → exit 2, E_INPUT_NOT_FOUND", async () => {
    const r = await runCli(["resize", "nope/", "-s", "10", "-o", "out", "--json"], dir);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).errors[0].code).toBe("E_INPUT_NOT_FOUND");
  });

  it("info --json", async () => {
    const r = await runCli(["info", "raw/a.jpg", "--json"], dir);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ format: "jpeg", keepAs: "jpg", width: 600, height: 400, hasAlpha: false });
  });

  it("capabilities --json", async () => {
    const c = JSON.parse((await runCli(["capabilities", "--json"], dir)).stdout);
    expect(c.output).toEqual(expect.arrayContaining(["jpg", "png", "webp"]));
    expect(c.modes).toEqual(["fit", "cover", "pad"]);
  });

  it("schema result in JSON Schema hợp lệ", async () => {
    const r = await runCli(["schema", "result"], dir);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).title).toBe("imgfit result");
  });

  it("lệnh hoặc schema không tồn tại → E_USAGE, exit 2", async () => {
    for (const argv of [["khong-co", "--json"], ["schema", "khong-co", "--json"]]) {
      const r = await runCli(argv, dir);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(JSON.parse(r.stdout).errors[0].code).toBe("E_USAGE");
    }
  });

  it("output người đọc có tổng kết", async () => {
    const r = await runCli(["resize", "raw", "-s", "64", "-o", "out"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("NEW   raw/a.jpg → out/a.jpg");
    expect(r.stdout).toMatch(/OK: 1 file/);
  });
});
