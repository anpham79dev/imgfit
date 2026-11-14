import { readFile } from "node:fs/promises";

export const STATE_SCHEMA_VERSION = 1;

/** Parsed JSON, or undefined when the file does not exist. Other read/parse errors propagate. */
export async function readJsonIfExists(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text.replace(/^﻿/, ""));
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
