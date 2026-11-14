/**
 * User-authored, committed data keyed by source path (relative to roots.input, NFC):
 * - imgfit.names.json — source → id for the {id} placeholder
 * - imgfit.crops.json — source → focal point for cover presets
 * Invalid files are reported (E_CONFIG_INVALID), never silently dropped.
 */
import path from "node:path";
import { ImgfitError } from "../../core/errors.js";
import type { Point } from "../../image/geometry.js";
import { writeJsonAtomic } from "../../io/fs.js";
import { isObject, readJsonIfExists, STATE_SCHEMA_VERSION } from "./json.js";

async function readSection(file: string, section: "names" | "crops", example: string): Promise<Record<string, unknown> | undefined> {
  let raw: unknown;
  try {
    raw = await readJsonIfExists(file);
  } catch (err) {
    throw new ImgfitError("E_CONFIG_INVALID", `Không đọc được ${file}: ${(err as Error).message}`, { path: file });
  }
  if (raw === undefined) return undefined;
  if (!isObject(raw) || raw.schemaVersion !== STATE_SCHEMA_VERSION || !isObject(raw[section])) {
    throw new ImgfitError("E_CONFIG_INVALID", `${path.basename(file)} sai cấu trúc (cần ${example})`, { path: file });
  }
  return raw[section] as Record<string, unknown>;
}

export async function loadNames(file: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const section = await readSection(file, "names", '{"schemaVersion":1,"names":{"<nguồn>":"<id>"}}');
  for (const [k, v] of Object.entries(section ?? {})) {
    if (typeof v !== "string" || v.trim() === "") throw new ImgfitError("E_CONFIG_INVALID", `${path.basename(file)}: id của "${k}" phải là chuỗi khác rỗng`);
    map.set(k.normalize("NFC"), v);
  }
  return map;
}

export async function saveNames(file: string, names: Map<string, string>): Promise<void> {
  await writeJsonAtomic(file, { schemaVersion: STATE_SCHEMA_VERSION, names: Object.fromEntries(names) });
}

const isPoint = (v: unknown): v is Point => isObject(v) && [v.x, v.y].every((n) => typeof n === "number" && n >= 0 && n <= 1);

export async function loadCrops(file: string): Promise<Map<string, Point>> {
  const map = new Map<string, Point>();
  const section = await readSection(file, "crops", '{"schemaVersion":1,"crops":{"<nguồn>":{"x":0.5,"y":0.5}}}');
  for (const [k, v] of Object.entries(section ?? {})) {
    if (!isPoint(v)) throw new ImgfitError("E_CONFIG_INVALID", `${path.basename(file)}: focal của "${k}" phải là {x, y} trong [0,1]`);
    map.set(k.normalize("NFC"), { x: v.x, y: v.y });
  }
  return map;
}

export async function saveCrops(file: string, crops: Map<string, Point>): Promise<void> {
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  await writeJsonAtomic(file, {
    schemaVersion: STATE_SCHEMA_VERSION,
    crops: Object.fromEntries([...crops].map(([k, p]) => [k, { x: round(p.x), y: round(p.y) }])),
  });
}
