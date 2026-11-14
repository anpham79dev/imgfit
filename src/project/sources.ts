import path from "node:path";
import fg from "fast-glob";
import { toPosix } from "../core/paths.js";
import { INPUT_EXTENSIONS } from "../image/formats.js";
import { staticBase } from "../io/inputs.js";
import type { ProjectConfig } from "./config/types.js";

export interface SourceMatch {
  rule: string;
  abs: string;
  /** relative to roots.input (posix, NFC) — key of names/crops */
  rel: string;
  /** sub-directory relative to the static part of the matching glob — value of {dir} */
  dir: string;
}

const EXT_SET = new Set(INPUT_EXTENSIONS.map((e) => `.${e}`));

/** Key of managed/cache entries for an absolute path inside the project (posix, relative to the project root). */
export function destKeyFor(cfg: ProjectConfig, abs: string): string {
  return toPosix(path.relative(cfg.dir, abs));
}

/** Sources matched by each rule (image extensions only, no symlinks, no dotfiles), in stable order. */
export async function matchSources(cfg: ProjectConfig): Promise<SourceMatch[]> {
  const out: SourceMatch[] = [];
  for (const rule of cfg.rules) {
    const seen = new Set<string>();
    for (const pattern of rule.from) {
      const base = staticBase(pattern);
      const found = await fg(pattern, { cwd: cfg.inputRoot, onlyFiles: true, caseSensitiveMatch: false, followSymbolicLinks: false, dot: false, ignore: rule.exclude });
      for (const rel of found.sort()) {
        if (!EXT_SET.has(path.extname(rel).toLowerCase())) continue;
        const relN = rel.normalize("NFC");
        if (seen.has(relN.toLowerCase())) continue;
        seen.add(relN.toLowerCase());
        const dir = toPosix(path.posix.relative(base === "." ? "" : base, path.posix.dirname(rel))).replace(/^\.$/, "");
        out.push({ rule: rule.id, abs: path.resolve(cfg.inputRoot, rel), rel: relN, dir });
      }
    }
  }
  return out;
}
