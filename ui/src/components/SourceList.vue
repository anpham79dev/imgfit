<script setup lang="ts">

export interface SourceItem {
  id: string;
  name: string;
  thumb: string;
  sub?: string;
  status?: string;
  hasFocal?: boolean;
}

defineProps<{ items: SourceItem[]; selected: string | null }>();
const emit = defineEmits<{ select: [string] }>();
</script>

<template>
  <ul class="source-list">
    <li
      v-for="it in items"
      :key="it.id"
      :class="[{ selected: it.id === selected }, it.status ? `st-${it.status}` : '']"
      tabindex="0"
      @click="emit('select', it.id)"
      @keydown.enter="emit('select', it.id)"
    >
      <!-- lazily loaded thumbnails: never the full-resolution originals -->
      <img :src="it.thumb" loading="lazy" decoding="async" :alt="it.name" />
      <span class="name" :title="it.name">{{ it.name }}</span>
      <span v-if="it.sub" class="sub">{{ it.sub }}</span>
      <span v-if="it.hasFocal" class="badge" title="Có focal point">◎</span>
      <span v-if="it.status" class="status">{{ it.status }}</span>
    </li>
  </ul>
</template>
