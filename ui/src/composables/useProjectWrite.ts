import { ref } from "vue";
import { api, ApiError, errorMessage, type Report } from "../api";
import { useBatch } from "./useBatch";

/**
 * Review → commit flow. `preview` returns the plan and a single-use nonce bound to its hash;
 * `commit` sends the nonce. A stale confirmation (project changed) triggers a fresh preview.
 */
export function useProjectWrite(totalHint: () => number, onDone: () => Promise<void>, onError: (message: string) => void) {
  const plan = ref<Report | null>(null);
  const nonce = ref<string | null>(null);
  const expiresAt = ref<string | null>(null);
  const overwrite = ref(false);
  const busy = ref(false);
  const batch = useBatch();

  async function preview() {
    busy.value = true;
    try {
      const r = await api.post<{ nonce: string; expiresAt: string; report: Report }>("/api/v1/write/preview", { overwrite: overwrite.value });
      plan.value = r.report;
      nonce.value = r.nonce;
      expiresAt.value = r.expiresAt;
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      busy.value = false;
    }
  }

  async function commit() {
    if (!nonce.value) return;
    busy.value = true;
    try {
      const r = await api.post<{ batchId: string }>("/api/v1/write/commit", { nonce: nonce.value });
      nonce.value = null;
      plan.value = null;
      batch.watch(r.batchId, totalHint(), () => {
        busy.value = false;
        void onDone();
      });
    } catch (e) {
      busy.value = false;
      nonce.value = null;
      onError(errorMessage(e));
      if (e instanceof ApiError && e.issues[0]?.code === "E_STALE_CONFIRMATION") await preview();
    }
  }

  return { plan, expiresAt, overwrite, busy, batch, preview, commit };
}
