import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { toPosix } from "../core/paths.js";
import { CONFIG_FILENAME, CONFIG_SCHEMA_VERSION, type ConfigFile } from "../config/types.js";

export interface InitOptions {
  cwd?: string;
  /** Overwrite an existing imgfit.json / imgfit.schema.json. */
  force?: boolean;
}

export type InitFileStatus = "created" | "overwritten" | "unchanged" | "skipped";

export interface InitResult {
  schemaVersion: 1;
  command: "init";
  files: Array<{ path: string; status: InitFileStatus }>;
}

/** Sample imgfit.json written by `imgfit init`. Relative paths only, nothing machine-specific. */
export function sampleConfig(): ConfigFile {
  return {
    $schema: "./imgfit.schema.json",
    schemaVersion: CONFIG_SCHEMA_VERSION,
    presets: {
      L: { size: [640, 480], mode: "fit", smallInput: "keep", format: { keep: ["png", "webp"], fallback: "jpg" }, prefix: "L_" },
      LL: { size: [1600, 1200], mode: "fit", smallInput: "skip", format: { keep: ["png", "webp"], fallback: "jpg" }, prefix: "LL_" },
      O: { size: [2100, 1400], mode: "fit", smallInput: "keep", format: "jpg" },
    },
  };
}

const exists = async (p: string) => (await stat(p).catch(() => undefined)) !== undefined;

async function writeConfig(file: string, force: boolean): Promise<InitFileStatus> {
  const had = await exists(file);
  if (had && !force) return "skipped";
  await writeFile(file, `${JSON.stringify(sampleConfig(), null, 2)}\n`, "utf8");
  return had ? "overwritten" : "created";
}

/** Writes the schema matching THIS package version, so IDE validation matches the tool. */
async function writeSchema(file: string, force: boolean): Promise<InitFileStatus> {
  const schema = await readFile(new URL("../../schema/config.schema.json", import.meta.url), "utf8");
  const current = await readFile(file, "utf8").catch(() => undefined);
  if (current === schema) return "unchanged";
  if (current !== undefined && !force) return "skipped";
  await writeFile(file, schema, "utf8");
  return current === undefined ? "created" : "overwritten";
}

/** `imgfit init`: imgfit.json (sample presets) + imgfit.schema.json. Never overwrites without `force`. */
export async function init(opts: InitOptions = {}): Promise<InitResult> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const rel = (p: string) => toPosix(path.relative(cwd, p));
  const force = opts.force ?? false;
  const configPath = path.join(cwd, CONFIG_FILENAME);
  const schemaPath = path.join(cwd, "imgfit.schema.json");
  return {
    schemaVersion: 1,
    command: "init",
    files: [
      { path: rel(configPath), status: await writeConfig(configPath, force) },
      { path: rel(schemaPath), status: await writeSchema(schemaPath, force) },
    ],
  };
}
