import { ref } from "vue";
import { api, type TransformForm } from "../api";

export interface PresetOption {
  key: string;
  label: string;
  group: "quick" | "project";
  value: Partial<TransformForm>;
}

/** Built-in presets + the project's presets (when imgfit.json exists). */
export function usePresets() {
  const presets = ref<PresetOption[]>([]);
  async function load() {
    const r = await api.get<{ quick: Record<string, Partial<TransformForm>>; project: Record<string, Partial<TransformForm>> }>("/api/v1/presets");
    presets.value = [
      ...Object.entries(r.project).map(([k, v]) => ({ key: `project:${k}`, label: k, group: "project" as const, value: v })),
      ...Object.entries(r.quick).map(([k, v]) => ({ key: `quick:${k}`, label: k, group: "quick" as const, value: v })),
    ];
  }
  return { presets, load };
}
