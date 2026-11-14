import { reactive, ref } from "vue";
import { api, ApiError, type Issue } from "../api";

export interface SessionFile {
  id: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const BATCH = 20;

/** Temporary upload session on the server: create, upload in chunks (with progress), list files. */
export function useSession() {
  const id = ref<string | null>(null);
  const files = ref<SessionFile[]>([]);
  const rejected = ref<Array<{ name: string; error: Issue }>>([]);
  const uploading = reactive({ active: false, loaded: 0, total: 0, done: 0, count: 0 });

  async function ensure(): Promise<string> {
    if (id.value) return id.value;
    const s = await api.post<{ id: string }>("/api/v1/sessions");
    id.value = s.id;
    return s.id;
  }

  async function add(list: File[]): Promise<void> {
    const images = list.filter((f) => IMAGE_EXT.test(f.name));
    for (const f of list) if (!IMAGE_EXT.test(f.name)) rejected.value.push({ name: f.name, error: { code: "E_INPUT_UNSUPPORTED", message: "Không phải đuôi ảnh được hỗ trợ" } });
    if (images.length === 0) return;
    const sid = await ensure();
    uploading.active = true;
    uploading.count = images.length;
    uploading.done = 0;
    uploading.total = images.reduce((s, f) => s + f.size, 0);
    uploading.loaded = 0;
    try {
      for (let i = 0; i < images.length; i += BATCH) {
        const chunk = images.slice(i, i + BATCH);
        const base = uploading.loaded;
        try {
          const r = await api.upload<{ accepted: SessionFile[]; rejected: Array<{ name: string; error: Issue }> }>(
            `/api/v1/sessions/${sid}/uploads`,
            chunk,
            (loaded) => (uploading.loaded = base + loaded),
          );
          files.value.push(...r.accepted);
          rejected.value.push(...r.rejected);
        } catch (err) {
          // a whole chunk failed (e.g. over a limit) → report each file and continue with the next chunk
          const issue = err instanceof ApiError ? (err.issues[0] ?? { code: "E_UPLOAD", message: err.message }) : { code: "E_UPLOAD", message: String(err) };
          for (const f of chunk) rejected.value.push({ name: f.name, error: issue });
        }
        uploading.done += chunk.length;
        uploading.loaded = base + chunk.reduce((s, f) => s + f.size, 0);
      }
    } finally {
      uploading.active = false;
    }
  }

  async function clear(): Promise<void> {
    if (id.value) await api.del(`/api/v1/sessions/${id.value}`).catch(() => undefined);
    id.value = null;
    files.value = [];
    rejected.value = [];
  }

  const imageUrl = (fileId: string, max = 256) => (id.value ? `/api/v1/sessions/${id.value}/files/${fileId}/image?max=${max}` : "");

  return { id, files, rejected, uploading, add, clear, imageUrl, ensure };
}
