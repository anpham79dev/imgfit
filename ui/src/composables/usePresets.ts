import { ref } from "vue";
import { api, type TransformForm } from "../api";

export interface PresetOption {
  key: string;
  label: string;
  group: "quick" | "config";
  value: Partial<TransformForm>;
}

/** Built-in presets + the presets of imgfit.json (when it exists). */
export function usePresets() {
  const presets = ref<PresetOption[]>([]);
  async function load() {
    const r = await api.get<{ quick: Record<string, Partial<TransformForm>>; config: Record<string, Partial<TransformForm>> }>("/api/v1/presets");
    presets.value = [
      ...Object.entries(r.config).map(([k, v]) => ({ key: `config:${k}`, label: k, group: "config" as const, value: v })),
      ...Object.entries(r.quick).map(([k, v]) => ({ key: `quick:${k}`, label: k, group: "quick" as const, value: v })),
    ];
  }
  return { presets, load };
}
