import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImgfitError } from "../core/errors.js";
import { toPosix } from "../core/paths.js";
import { sampleConfig } from "../project/config/samples.js";
import { CONFIG_FILENAME, type Profile } from "../project/config/types.js";

export { sampleConfig } from "../project/config/samples.js";

export interface InitOptions {
  cwd?: string;
  profile?: Profile;
  /** Overwrite an existing imgfit.json / imgfit.schema.json. */
  force?: boolean;
}

export type InitFileStatus = "created" | "overwritten" | "updated" | "unchanged" | "skipped";

export interface InitResult {
  schemaVersion: 1;
  command: "init";
  profile: Profile;
  files: Array<{ path: string; status: InitFileStatus }>;
}

export const GITIGNORE_LINES = [".imgfit/", "*.imgfit-*.tmp"];

const exists = async (p: string) => (await stat(p).catch(() => undefined)) !== undefined;

async function writeConfig(file: string, profile: Profile, force: boolean): Promise<InitFileStatus> {
  const had = await exists(file);
  if (had && !force) return "skipped";
  await writeFile(file, `${JSON.stringify(sampleConfig(profile), null, 2)}\n`, "utf8");
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

async function updateGitignore(file: string): Promise<InitFileStatus> {
  const text = await readFile(file, "utf8").catch(() => "");
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return "unchanged";
  const prefix = text === "" || text.endsWith("\n") ? "" : "\n";
  await writeFile(file, `${text}${prefix}# imgfit (cache, backup, lock, file tạm)\n${missing.join("\n")}\n`, "utf8");
  return text === "" ? "created" : "updated";
}

/** `imgfit init`: imgfit.json + imgfit.schema.json + .gitignore entries. Never overwrites without `force`. */
export async function init(opts: InitOptions = {}): Promise<InitResult> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const profile = opts.profile ?? "generic";
  if (!["generic", "web", "unity"].includes(profile)) throw new ImgfitError("E_USAGE", `profile không hợp lệ: ${profile}`);
  const rel = (p: string) => toPosix(path.relative(cwd, p));
  const force = opts.force ?? false;

  const configPath = path.join(cwd, CONFIG_FILENAME);
  const schemaPath = path.join(cwd, "imgfit.schema.json");
  return {
    schemaVersion: 1,
    command: "init",
    profile,
    files: [
      { path: rel(configPath), status: await writeConfig(configPath, profile, force) },
      { path: rel(schemaPath), status: await writeSchema(schemaPath, force) },
      { path: ".gitignore", status: await updateGitignore(path.join(cwd, ".gitignore")) },
    ],
  };
}
