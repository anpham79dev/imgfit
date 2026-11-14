import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODES, WARNING_CODES } from "../../src/index.js";
import { runCli, solid, tempDir } from "../helpers.js";

/** Real reports of every command must match the published schema — other languages generate types from it. */
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (o: object) => {
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
};
const load = async (n: string) => JSON.parse(await readFile(new URL(`../../schema/${n}.schema.json`, import.meta.url), "utf8"));

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  await mkdir(path.join(dir, "img"), { recursive: true });
  await solid(path.join(dir, "img", "a.jpg"), 300, 200, "#f00");
  await solid(path.join(dir, "img", "tiny.jpg"), 10, 10, "#f00");
  await writeFile(
    path.join(dir, "imgfit.json"),
    JSON.stringify({ schemaVersion: 1, roots: { input: "img", output: "out" }, presets: { t: { size: [64, 64], mode: "cover", format: "webp" } }, rules: [{ id: "r", from: "*.jpg", preset: "t", to: "{name}.{ext}" }] }),
  );
});
afterEach(async () => cleanup());

describe("JSON contract", () => {
  it("resize / run / check / dry-run / lỗi tham số đều khớp result.schema.json", async () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(await load("result"));
    const outputs = [
      await runCli(["resize", "img", "-s", "32", "-m", "cover", "-o", "o1", "--json"], dir),
      await runCli(["resize", "img", "-s", "32", "-o", "o2", "--dry-run", "--json"], dir),
      await runCli(["run", "--dry-run", "--json"], dir),
      await runCli(["run", "--json"], dir),
      await runCli(["run", "--json"], dir),
      await runCli(["check", "--json"], dir),
      await runCli(["check", "--check-mode", "output-only", "--json"], dir),
      await runCli(["resize", "img", "-s", "nope", "-o", "x", "--json"], dir),
      await runCli(["run", "--config", "missing.json", "--json"], dir),
    ];
    for (const o of outputs) {
      const doc = JSON.parse(o.stdout);
      const ok = validate(doc);
      expect(ok, `${doc.command}: ${JSON.stringify(validate.errors)}`).toBe(true);
      for (const f of doc.files ?? []) {
        for (const e of f.errors) expect(ERROR_CODES).toContain(e.code);
        for (const w of f.warnings) expect(WARNING_CODES).toContain(w.code);
      }
    }
  });

  it("info --json khớp info.schema.json; config mẫu khớp config.schema.json", async () => {
    const vInfo = new Ajv2020({ strict: false }).compile(await load("info"));
    expect(vInfo(JSON.parse((await runCli(["info", "img/a.jpg", "--json"], dir)).stdout))).toBe(true);
    const vCfg = new Ajv2020({ strict: false }).compile(await load("config"));
    expect(vCfg(JSON.parse(await readFile(path.join(dir, "imgfit.json"), "utf8")))).toBe(true);
    for (const kind of ["config", "result", "info", "job"]) {
      expect(JSON.parse((await runCli(["schema", kind], dir)).stdout).$schema).toContain("2020-12");
    }
  });
});
