<script setup lang="ts">
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ files: [File[]] }>();
const over = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const dirInput = ref<HTMLInputElement | null>(null);

/** Recursively reads dropped directories (webkitGetAsEntry). */
async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

async function onDrop(ev: DragEvent) {
  over.value = false;
  const items = ev.dataTransfer?.items;
  const out: File[] = [];
  if (items && items.length && typeof items[0]?.webkitGetAsEntry === "function") {
    const entries = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
    for (const e of entries) await walk(e, out);
  } else if (ev.dataTransfer?.files) out.push(...ev.dataTransfer.files);
  if (out.length) emit("files", out);
}

function onPick(ev: Event) {
  const input = ev.target as HTMLInputElement;
  if (input.files?.length) emit("files", [...input.files]);
  input.value = "";
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ over, disabled }"
    @dragover.prevent="over = true"
    @dragleave.prevent="over = false"
    @drop.prevent="onDrop"
  >
    <p><strong>Kéo thả ảnh hoặc thư mục vào đây</strong></p>
    <p class="muted">JPG, PNG, WebP, AVIF, TIFF, GIF (một frame) · tối đa 50 MB/file</p>
    <div class="row center">
      <button type="button" :disabled="disabled" @click="fileInput?.click()">Chọn file…</button>
      <button type="button" :disabled="disabled" @click="dirInput?.click()">Chọn thư mục…</button>
    </div>
    <input ref="fileInput" type="file" multiple accept="image/*,.avif" hidden @change="onPick" />
    <input ref="dirInput" type="file" webkitdirectory hidden @change="onPick" />
  </div>
</template>
