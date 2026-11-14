import { reactive, ref } from "vue";
import { api, type Issue, type Report } from "../api";

export interface BatchState {
  id: string | null;
  status: "idle" | "running" | "done" | "error";
  completed: number;
  total: number;
  /** per-file status (by display name) while running */
  perFile: Record<string, string>;
  report: Report | null;
  outputs: Array<{ index: number; name: string }>;
  error: Issue | null;
}

/** Follows a batch over SSE (EventSource reconnects with Last-Event-ID); cancel and retry. */
export function useBatch() {
  const state = reactive<BatchState>({ id: null, status: "idle", completed: 0, total: 0, perFile: {}, report: null, outputs: [], error: null });
  const source = ref<EventSource | null>(null);
  let onDone: (() => void) | undefined;

  function close() {
    source.value?.close();
    source.value = null;
  }

  async function finish() {
    if (!state.id) return;
    const b = await api.get<{ status: string; report: Report | null; error: Issue | null; outputs: Array<{ index: number; name: string }> }>(`/api/v1/batches/${state.id}`);
    state.report = b.report;
    state.outputs = b.outputs;
    state.error = b.error;
    state.status = b.status === "error" ? "error" : "done";
    onDone?.();
  }

  function watch(batchId: string, total: number, done?: () => void) {
    close();
    onDone = done;
    Object.assign(state, { id: batchId, status: "running", completed: 0, total, perFile: {}, report: null, outputs: [], error: null });
    const es = new EventSource(`/api/v1/batches/${batchId}/events`);
    source.value = es;
    es.addEventListener("progress", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { type: string; file: string; completed: number; total: number; status?: string };
      state.completed = d.completed;
      state.total = d.total;
      state.perFile[d.file] = d.status ?? d.type;
    });
    const end = () => {
      close();
      void finish();
    };
    es.addEventListener("done", end);
    es.addEventListener("error", (ev) => {
      // an "error" event with data is a batch failure from the server; without data it is a connection error (EventSource retries)
      if ((ev as MessageEvent).data) end();
      else if (es.readyState === EventSource.CLOSED) end();
    });
  }

  async function cancel() {
    if (state.id && state.status === "running") await api.post(`/api/v1/batches/${state.id}/cancel`);
  }

  async function retry(done?: () => void) {
    if (!state.id) return;
    const r = await api.post<{ batchId: string; total: number }>(`/api/v1/batches/${state.id}/retry`);
    watch(r.batchId, r.total, done);
  }

  function reset() {
    close();
    Object.assign(state, { id: null, status: "idle", completed: 0, total: 0, perFile: {}, report: null, outputs: [], error: null });
  }

  return { state, watch, cancel, retry, reset };
}
