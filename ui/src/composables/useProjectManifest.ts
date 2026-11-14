import { computed, type Ref, ref, watch } from "vue";
import { api, errorMessage, type Point } from "../api";
import type { ManifestItem, PreviewResult, ProjectInfo, ProjectReport } from "../types";

/** Project manifest (= run --dry-run), the selected output, its preview and focal-point editing. */
export function useProjectManifest(info: Ref<ProjectInfo>, onError: (message: string) => void) {
  const report = ref<ProjectReport | null>(null);
  const loading = ref(false);
  const selected = ref<ManifestItem | null>(null);
  const preview = ref<PreviewResult | null>(null);
  const previewError = ref<string | null>(null);

  async function load() {
    loading.value = true;
    try {
      const r = await api.get<{ report: ProjectReport }>("/api/v1/project/manifest");
      report.value = r.report;
      // keep the selection across reloads
      if (selected.value) selected.value = r.report.files.find((f) => f.destination === selected.value?.destination) ?? null;
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      loading.value = false;
    }
  }

  async function refreshPreview() {
    preview.value = null;
    previewError.value = null;
    if (!selected.value?.destination || selected.value.status === "failed") return;
    try {
      preview.value = await api.post<PreviewResult>("/api/v1/project/preview", { dest: selected.value.destination });
    } catch (e) {
      previewError.value = errorMessage(e);
    }
  }
  watch(selected, refreshPreview);

  /** Saves (or clears) the focal point of the selected source, then reloads manifest + preview. */
  async function setFocal(p: Point | null) {
    if (!selected.value) return;
    try {
      await api.put("/api/v1/project/crops", { source: selected.value.sourceRel, focal: p });
      await load();
      await refreshPreview();
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  /** Target size of the selected output's preset (for the crop frame). */
  const target = computed(() => {
    const p = selected.value?.preset ? info.value.presets?.[selected.value.preset] : undefined;
    return p ? { width: p.width, height: p.height } : { width: 1, height: 1 };
  });

  /** Whether an output already exists on disk to compare against. */
  const hasCurrentOutput = computed(() => !!selected.value && ["unchanged", "planned"].includes(selected.value.status) && selected.value.action !== "create");

  const imageUrl = (src: string, max: number) => `/api/v1/project/image?source=${encodeURIComponent(src)}&max=${max}`;
  const outputUrl = (dest: string, max: number) => `/api/v1/project/output?dest=${encodeURIComponent(dest)}&max=${max}`;

  return { report, loading, selected, preview, previewError, load, setFocal, target, hasCurrentOutput, imageUrl, outputUrl };
}
