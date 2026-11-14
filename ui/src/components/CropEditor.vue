<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { Point } from "../api";

/**
 * Click to set the focal point. The displayed image is already EXIF-oriented (server auto-orient), so the
 * normalised [0,1] coordinates match the output convention. Correct even when letterboxed (object-fit: contain).
 */
const props = defineProps<{ src: string; target: { width: number; height: number }; focal: Point | null }>();
const emit = defineEmits<{ "update:focal": [Point | null] }>();

const box = ref<HTMLDivElement | null>(null);
const img = ref<HTMLImageElement | null>(null);
const natural = ref({ w: 0, h: 0 });
const boxSize = ref({ w: 0, h: 0 });
let ro: ResizeObserver | undefined;

onMounted(() => {
  ro = new ResizeObserver(() => {
    if (box.value) boxSize.value = { w: box.value.clientWidth, h: box.value.clientHeight };
  });
  if (box.value) ro.observe(box.value);
});
onBeforeUnmount(() => ro?.disconnect());

function onLoad() {
  if (img.value) natural.value = { w: img.value.naturalWidth, h: img.value.naturalHeight };
}

/** Area actually covered by the image inside the box (object-fit: contain). */
const shown = computed(() => {
  const { w, h } = natural.value;
  const B = boxSize.value;
  if (!w || !h || !B.w || !B.h) return null;
  const scale = Math.min(B.w / w, B.h / h);
  const width = w * scale;
  const height = h * scale;
  return { left: (B.w - width) / 2, top: (B.h - height) / 2, width, height };
});

/** Crop frame (target aspect ratio) around the focal point, clamped to the image — same formula as the core. */
const cropRect = computed(() => {
  const s = shown.value;
  const { w, h } = natural.value;
  if (!s || !w) return null;
  const ratio = props.target.width / props.target.height;
  let cw = w;
  let ch = h;
  if (w / h > ratio) cw = h * ratio;
  else ch = w / ratio;
  const f = props.focal ?? { x: 0.5, y: 0.5 };
  const left = Math.min(Math.max(f.x * w - cw / 2, 0), w - cw);
  const top = Math.min(Math.max(f.y * h - ch / 2, 0), h - ch);
  const k = s.width / w;
  return { left: s.left + left * k, top: s.top + top * k, width: cw * k, height: ch * k };
});

function onClick(ev: MouseEvent) {
  const s = shown.value;
  if (!s || !box.value) return;
  const r = box.value.getBoundingClientRect();
  const x = (ev.clientX - r.left - s.left) / s.width;
  const y = (ev.clientY - r.top - s.top) / s.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  emit("update:focal", { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 });
}
</script>

<template>
  <div class="crop-editor">
    <div ref="box" class="crop-box" @click="onClick">
      <img ref="img" :src="src" alt="" draggable="false" @load="onLoad" />
      <div v-if="cropRect" class="crop-rect" :style="{ left: `${cropRect.left}px`, top: `${cropRect.top}px`, width: `${cropRect.width}px`, height: `${cropRect.height}px` }" />
      <div
        v-if="focal && shown"
        class="crop-dot"
        :style="{ left: `${shown.left + focal.x * shown.width}px`, top: `${shown.top + focal.y * shown.height}px` }"
      />
    </div>
    <div class="row">
      <span class="muted">
        Click vào ảnh để đặt focal point. Khung = vùng giữ lại ({{ target.width }}×{{ target.height }}).
        <template v-if="focal">Focal: {{ focal.x.toFixed(3) }}, {{ focal.y.toFixed(3) }}</template>
      </span>
      <button v-if="focal" type="button" @click.stop="emit('update:focal', null)">Bỏ focal</button>
    </div>
  </div>
</template>
