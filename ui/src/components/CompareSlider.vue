<script setup lang="ts">
import { ref } from "vue";

/** Before/after comparison: same frame and same `contain` fit, so both images always align. */
defineProps<{ before: string; after: string; beforeLabel?: string; afterLabel?: string }>();
const pos = ref(50);
</script>

<template>
  <div class="compare">
    <div class="compare-frame">
      <img :src="before" alt="trước" />
      <img :src="after" alt="sau" class="after" :style="{ clipPath: `inset(0 0 0 ${pos}%)` }" />
      <div class="compare-line" :style="{ left: `${pos}%` }" />
      <span class="tag left">{{ beforeLabel ?? "Trước" }}</span>
      <span class="tag right">{{ afterLabel ?? "Sau" }}</span>
    </div>
    <input v-model.number="pos" type="range" min="0" max="100" aria-label="Vị trí so sánh" />
  </div>
</template>
