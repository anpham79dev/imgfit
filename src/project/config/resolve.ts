/**
 * Turns validated imgfit.json data into resolved presets/rules, enforcing the semantic rules the JSON
 * Schema cannot express (references, template constraints, profile whitelist).
 */
import path from "node:path";
import { ImgfitError } from "../../core/errors.js";
import { validateTemplate } from "../../core/template.js";
import type { OutputFormat } from "../../image/formats.js";
import type { SmallInputPolicy } from "../../image/geometry.js";
import { type TransformOptions, validateTransformOptions } from "../../image/options.js";
import type { ConfigDefaults, PresetConfig, Profile, ResolvedPreset, ResolvedRule, RuleConfig } from "./types.js";

const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

/** Expands ${VAR} only when VAR is listed in the config's `env`. Nothing else is ever evaluated. */
export function expandEnv(value: string, allowed: Set<string>, env: NodeJS.ProcessEnv, field: string): string {
  return value.replace(/\$\{([^}]*)\}/g, (_m, name: string) => {
    if (!allowed.has(name)) {
      throw new ImgfitError("E_CONFIG_INVALID", `${field} dùng \${${name}} nhưng "${name}" không có trong "env" của config`);
    }
    const v = env[name];
    if (v === undefined || v === "") {
      throw new ImgfitError(
        "E_CONFIG_INVALID",
        `Biến môi trường ${name} chưa được đặt (dùng trong ${field}). ` + `PowerShell: $env:${name}="D:\\path"  ·  bash/WSL: export ${name}=/path`,
      );
    }
    return v;
  });
}

/** Merges preset over config defaults over tool defaults, then validates. */
export function resolvePreset(name: string, p: PresetConfig, d: ConfigDefaults, profile: Profile, allowed: OutputFormat[], budgetKB?: number): ResolvedPreset {
  const quality = p.quality ?? d.quality;
  const smallInput: SmallInputPolicy | undefined = p.smallInput ?? d.smallInput;
  const background = p.background ?? d.background;
  const transform: TransformOptions = {
    width: p.size[0],
    height: p.size[1],
    mode: p.mode ?? "fit",
    format: p.format ?? "keep",
    upscale: p.upscale ?? d.upscale ?? false,
    stripMetadata: p.stripMetadata ?? d.stripMetadata ?? true,
    ...(quality !== undefined ? { quality } : {}),
    ...(smallInput ? { smallInput } : {}),
    ...(background ? { background } : {}),
    ...(p.crop?.position ? { position: p.crop.position } : {}),
    ...(p.sharpen !== undefined ? { sharpen: p.sharpen } : {}),
    ...(p.png ? { png: p.png } : {}),
    ...(p.blockMultiple ? { blockMultiple: p.blockMultiple } : {}),
  };
  try {
    validateTransformOptions(transform);
  } catch (err) {
    throw new ImgfitError("E_CONFIG_INVALID", `preset "${name}": ${(err as Error).message}`);
  }
  if (transform.format !== "keep" && !allowed.includes(transform.format)) {
    throw new ImgfitError("E_FORMAT_NOT_ALLOWED", `preset "${name}": profile "${profile}" không cho phép format ${transform.format} (cho phép: ${allowed.join(", ")})`);
  }
  return { name, transform, maxFileKB: p.maxFileKB ?? budgetKB };
}

/** Validates rules against each other and against the resolved presets. */
export function resolveRules(rules: RuleConfig[], presets: Map<string, ResolvedPreset>, projectDir: string): ResolvedRule[] {
  const ids = new Set<string>();
  return rules.map((r) => {
    if (ids.has(r.id)) throw new ImgfitError("E_CONFIG_INVALID", `rule.id trùng: "${r.id}"`);
    ids.add(r.id);
    const ps = asArray(r.preset);
    for (const p of ps) if (!presets.has(p)) throw new ImgfitError("E_CONFIG_INVALID", `rule "${r.id}": preset "${p}" không tồn tại`);
    try {
      validateTemplate(r.to);
    } catch (err) {
      throw new ImgfitError("E_CONFIG_INVALID", `rule "${r.id}".to: ${(err as Error).message}`);
    }
    if (ps.length > 1 && !r.to.includes("{preset}")) {
      throw new ImgfitError("E_CONFIG_INVALID", `rule "${r.id}" có nhiều preset nên "to" phải chứa {preset} (nếu không các preset sẽ ghi trùng một file)`);
    }
    if (r.to.includes("{id}") && !r.names) {
      throw new ImgfitError("E_CONFIG_INVALID", `rule "${r.id}" dùng {id} nhưng chưa khai báo "names" (vd. "imgfit.names.json")`);
    }
    for (const g of asArray(r.from)) {
      if (path.isAbsolute(g) || /^[a-zA-Z]:/.test(g) || g.split("/").includes("..")) {
        throw new ImgfitError("E_CONFIG_INVALID", `rule "${r.id}".from phải tương đối theo roots.input, không chứa "..": ${g}`);
      }
    }
    return {
      id: r.id,
      from: asArray(r.from),
      exclude: r.exclude ?? [],
      presets: ps,
      to: r.to,
      namesFile: r.names ? path.resolve(projectDir, r.names) : undefined,
    };
  });
}

/** IMGFIT_JOBS, validated. */
export function envJobs(env: NodeJS.ProcessEnv): number | undefined {
  if (env.IMGFIT_JOBS === undefined) return undefined;
  const n = Number(env.IMGFIT_JOBS);
  if (!(Number.isInteger(n) && n >= 1 && n <= 64)) throw new ImgfitError("E_USAGE", `IMGFIT_JOBS phải là số nguyên 1–64, nhận "${env.IMGFIT_JOBS}"`);
  return n;
}
