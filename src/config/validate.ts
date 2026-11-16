import { readFile } from "node:fs/promises";
import Ajv2020Module from "ajv/dist/2020.js";
import { type ErrorCode, ImgfitError } from "../core/errors.js";

type Validate = ((data: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string; params?: unknown }> | null };

const cache = new Map<string, Validate>();

/** Ajv (draft 2020-12) validator for a file in schema/, cached by name. */
export async function schemaValidator(name: "config" | "job"): Promise<Validate> {
  const hit = cache.get(name);
  if (hit) return hit;
  const schema = JSON.parse(await readFile(new URL(`../../schema/${name}.schema.json`, import.meta.url), "utf8"));
  // ajv ships CJS; under NodeNext the default export may be nested
  const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as new (o: object) => { compile: (s: object) => Validate };
  // strictRequired is off: `anyOf: [{required: [...]}]` patterns in job.schema.json are intentional
  const v = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true }).compile(schema);
  cache.set(name, v);
  return v;
}

/** Validates `data`; on failure throws `code` with every problem listed in details.problems. */
export async function validateWith<T>(name: "config" | "job", data: unknown, label: string, code: ErrorCode): Promise<T> {
  const v = await schemaValidator(name);
  if (!v(data)) {
    const problems = (v.errors ?? []).map((e) => {
      const extra = e.params && typeof e.params === "object" && "additionalProperty" in e.params ? ` (${(e.params as { additionalProperty: string }).additionalProperty})` : "";
      return `${e.instancePath || "/"} ${e.message ?? ""}${extra}`;
    });
    throw new ImgfitError(code, `${label} không hợp lệ:\n  - ${problems.join("\n  - ")}`, { problems });
  }
  return data as T;
}
