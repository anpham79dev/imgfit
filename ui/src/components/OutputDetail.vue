<script setup lang="ts">
import { formatBytes, type Point } from "../api";
import type { ManifestItem, PreviewResult } from "../types";
import CompareSlider from "./CompareSlider.vue";
import CropEditor from "./CropEditor.vue";

/** Detail of one project output: focal-point editor (cover) and current-vs-new comparison. */
defineProps<{
  item: ManifestItem;
  target: { width: number; height: number };
  preview: PreviewResult | null;
  previewError: string | null;
  /** an output already exists on disk to compare against */
  hasCurrent: boolean;
  sourceUrl: string;
  currentUrl: string | null;
}>();
const emit = defineEmits<{ "update:focal": [Point | null] }>();
</script>

<template>
  <section class="card">
    <h3>{{ item.destination ?? item.file }}</h3>
    <p class="muted">rule {{ item.rule }} · preset {{ item.preset }} · {{ item.mode }}</p>
    <CropEditor v-if="item.mode === 'cover'" :src="sourceUrl" :target="target" :focal="item.focal" @update:focal="emit('update:focal', $event)" />
    <template v-if="preview">
      <CompareSlider
        :before="hasCurrent && currentUrl ? currentUrl : sourceUrl"
        :before-label="hasCurrent ? 'Output hiện tại' : 'Nguồn'"
        :after="preview.url"
        after-label="Sẽ ghi"
      />
      <p class="muted">
        {{ preview.width }}×{{ preview.height }} · {{ formatBytes(preview.bytes) }}
        <span v-for="w in preview.warnings" :key="w.code" class="warn"> · {{ w.code }}</span>
      </p>
    </template>
    <p v-else-if="previewError" class="err">{{ previewError }}</p>
  </section>
</template>
