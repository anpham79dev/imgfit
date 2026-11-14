<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { api, ApiError, cleanTransform, formatBytes, type Issue, type Point, type TransformForm } from "./api";
import BatchProgress from "./components/BatchProgress.vue";
import CompareSlider from "./components/CompareSlider.vue";
import CropEditor from "./components/CropEditor.vue";
import DropZone from "./components/DropZone.vue";
import ErrorSummary from "./components/ErrorSummary.vue";
import PresetForm from "./components/PresetForm.vue";
import ResultTable from "./components/ResultTable.vue";
import SourceList, { type SourceItem } from "./components/SourceList.vue";
import { useBatch } from "./composables/useBatch";
import { usePresets } from "./composables/usePresets";
import { useSession } from "./composables/useSession";

const session = useSession();
const batch = useBatch();
const { presets, load } = usePresets();
onMounted(() => void load().catch(() => undefined));

const form = ref<TransformForm>({ width: 256, height: 256, mode: "cover", format: "webp", quality: null, position: "center", background: "", smallInput: "", upscale: false, stripMetadata: true, name: "" });
const selected = ref<string | null>(null);
const focal = reactive<Record<string, Point>>({});
const preview = ref<{ url: string; bytes: number; width: number; height: number; inputBytes: number; warnings: Issue[] } | null>(null);
const previewError = ref<string | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

const items = computed<SourceItem[]>(() =>
  session.files.value.map((f) => ({
    id: f.id,
    name: f.name,
    thumb: session.imageUrl(f.id, 256),
    sub: `${f.width}×${f.height} · ${formatBytes(f.bytes)}`,
    status: batch.state.perFile[f.name],
    hasFocal: !!focal[f.id],
  })),
);
const current = computed(() => session.files.value.find((f) => f.id === selected.value) ?? null);

async function onFiles(list: File[]) {
  error.value = null;
  try {
    await session.add(list);
    if (!selected.value && session.files.value[0]) selected.value = session.files.value[0].id;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

let previewTimer: number | undefined;
async function refreshPreview() {
  preview.value = null;
  previewError.value = null;
  if (!current.value || !session.id.value) return;
  try {
    const fp = focal[current.value.id];
    preview.value = await api.post(`/api/v1/sessions/${session.id.value}/preview`, {
      fileId: current.value.id,
      options: cleanTransform(form.value),
      ...(fp ? { focal: fp } : {}),
    });
  } catch (e) {
    previewError.value = e instanceof ApiError ? e.issues.map((i) => `${i.code}: ${i.message}`).join("; ") : String(e);
  }
}
// debounce form/focal changes before encoding a preview
watch([form, selected, () => ({ ...focal })], () => {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void refreshPreview(), 350);
}, { deep: true });

async function process(onlySelected: boolean) {
  if (!session.id.value) return;
  busy.value = true;
  error.value = null;
  try {
    const r = await api.post<{ batchId: string; total: number }>("/api/v1/batches", {
      sessionId: session.id.value,
      fileIds: onlySelected && selected.value ? [selected.value] : [],
      options: cleanTransform(form.value),
      focal: { ...focal },
    });
    batch.watch(r.batchId, r.total, () => (busy.value = false));
  } catch (e) {
    busy.value = false;
    error.value = (e as Error).message;
  }
}

function setFocal(p: Point | null) {
  if (!current.value) return;
  if (p) focal[current.value.id] = p;
  else delete focal[current.value.id];
}

async function reset() {
  batch.reset();
  await session.clear();
  selected.value = null;
  for (const k of Object.keys(focal)) delete focal[k];
}
</script>

<template>
  <div class="quick">
    <section class="card">
      <DropZone :disabled="session.uploading.active" @files="onFiles" />
      <div v-if="session.uploading.active" class="batch-progress">
        <div class="bar"><div class="fill" :style="{ width: `${session.uploading.total ? (session.uploading.loaded / session.uploading.total) * 100 : 0}%` }" /></div>
        <span>Đang tải lên {{ session.uploading.done }}/{{ session.uploading.count }} file…</span>
      </div>
      <ErrorSummary :rejected="session.rejected.value" />
      <p v-if="error" class="err">{{ error }}</p>
    </section>

    <div v-if="session.files.value.length" class="layout">
      <aside class="card">
        <h3>Thiết lập</h3>
        <PresetForm v-model="form" :presets="presets" />
        <div class="row">
          <button type="button" class="primary" :disabled="busy" @click="process(false)">Xử lý {{ session.files.value.length }} ảnh</button>
          <button type="button" :disabled="busy || !selected" @click="process(true)">Chỉ ảnh đang chọn</button>
          <button type="button" :disabled="busy" @click="reset">Làm lại</button>
        </div>
      </aside>

      <section class="card">
        <h3>Ảnh ({{ session.files.value.length }})</h3>
        <SourceList :items="items" :selected="selected" @select="selected = $event" />
      </section>

      <section v-if="current" class="card">
        <h3>{{ current.name }}</h3>
        <CropEditor
          v-if="form.mode === 'cover'"
          :src="session.imageUrl(current.id, 1024)"
          :target="{ width: form.width, height: form.height }"
          :focal="focal[current.id] ?? null"
          @update:focal="setFocal"
        />
        <template v-if="preview">
          <CompareSlider :before="session.imageUrl(current.id, 1024)" :after="preview.url" />
          <p class="muted">
            Output {{ preview.width }}×{{ preview.height }} · {{ formatBytes(preview.inputBytes) }} → {{ formatBytes(preview.bytes) }}
            <span v-for="w in preview.warnings" :key="w.code" class="warn"> · {{ w.code }}</span>
          </p>
        </template>
        <p v-else-if="previewError" class="err">{{ previewError }}</p>
        <p v-else class="muted">Đang tạo xem trước…</p>
      </section>
    </div>

    <section v-if="batch.state.status !== 'idle'" class="card">
      <BatchProgress :state="batch.state" @cancel="batch.cancel" @retry="batch.retry(() => (busy = false))" />
      <template v-if="batch.state.report">
        <div class="row">
          <a v-if="batch.state.outputs.length" class="button primary" :href="`/api/v1/batches/${batch.state.id}/archive`">Tải ZIP ({{ batch.state.outputs.length }})</a>
        </div>
        <ErrorSummary :files="batch.state.report.files" :errors="batch.state.report.errors" />
        <ResultTable :files="batch.state.report.files" :download-base="`/api/v1/batches/${batch.state.id}`" :outputs="batch.state.outputs" />
      </template>
    </section>
  </div>
</template>
