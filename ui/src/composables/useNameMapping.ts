import { computed, type Ref, ref, watch } from "vue";
import { api, errorMessage } from "../api";
import type { ProjectInfo, ProjectReport } from "../types";

/** id mapping for rules that use {id}: pick a rule, load its current mapping, save a new one. */
export function useNameMapping(info: Ref<ProjectInfo>, report: Ref<ProjectReport | null>, onSaved: () => Promise<void>, onError: (message: string) => void) {
  const rules = computed(() => info.value.rules?.filter((r) => r.names) ?? []);
  const rule = ref("");
  const names = ref<Record<string, string>>({});

  /** Sources of the selected rule, in the stable order the mapper uses for "one id per line". */
  const sources = computed(() => {
    const set = new Set<string>();
    for (const f of report.value?.files ?? []) if (f.rule === rule.value) set.add(f.sourceRel);
    return [...set].sort();
  });

  watch(
    rules,
    (r) => {
      if (!rule.value && r[0]) rule.value = r[0].id;
    },
    { immediate: true },
  );

  watch(
    rule,
    async (id) => {
      if (!id) return;
      try {
        names.value = (await api.get<{ names: Record<string, string> }>(`/api/v1/project/names?rule=${encodeURIComponent(id)}`)).names;
      } catch (e) {
        onError(errorMessage(e));
      }
    },
    { immediate: true },
  );

  async function save(mapping: Record<string, string>) {
    try {
      await api.put("/api/v1/project/names", { rule: rule.value, names: mapping });
      names.value = mapping;
      await onSaved();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return { rules, rule, names, sources, save };
}
