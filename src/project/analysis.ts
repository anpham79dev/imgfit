/**
 * Project-wide findings that are reported as warnings (never acted on automatically).
 */
import { type Issue, warning } from "../core/errors.js";
import type { ManifestJob } from "./manifest.js";
import type { ManagedStore } from "./state/managed.js";

/** Managed outputs no rule/source produces any more. imgfit never deletes them. */
export function orphanWarning(jobs: ManifestJob[], managed: ManagedStore): Issue | undefined {
  const produced = new Set(jobs.map((j) => j.meta.destKey).filter(Boolean));
  const orphans = [...managed.outputs.keys()].filter((k) => !produced.has(k));
  if (orphans.length === 0) return undefined;
  return warning("W_OUTPUT_ORPHAN", `${orphans.length} output đang được quản lý nhưng không còn nguồn/rule nào sinh ra (imgfit không tự xóa)`, { outputs: orphans });
}

/** Adds W_DUPLICATE_SOURCE to jobs whose source bytes are identical within the same rule + preset. */
export function flagDuplicateSources(jobs: ManifestJob[], sourceHash: Map<string, string>): void {
  const groups = new Map<string, ManifestJob[]>();
  for (const j of jobs) {
    const h = sourceHash.get(j.source);
    if (!h) continue;
    const key = `${j.meta.rule}\u0000${j.meta.preset}\u0000${h}`;
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sources = list.map((j) => j.meta.sourceRel);
    for (const j of list) {
      const others = sources.filter((s) => s !== j.meta.sourceRel);
      j.result.warnings.push(warning("W_DUPLICATE_SOURCE", `Nguồn trùng nội dung với: ${others.join(", ")}`, { sources }));
    }
  }
}
