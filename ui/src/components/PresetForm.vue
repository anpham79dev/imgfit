<script setup lang="ts">
import { computed } from "vue";
import type { TransformForm } from "../api";
import type { PresetOption } from "../composables/usePresets";

const props = defineProps<{ presets: PresetOption[] }>();
const model = defineModel<TransformForm>({ required: true });

const quick = computed(() => props.presets.filter((p) => p.group === "quick"));
const project = computed(() => props.presets.filter((p) => p.group === "project"));

function apply(key: string) {
  const p = props.presets.find((x) => x.key === key);
  if (!p) return;
  const v = p.value as Record<string, unknown>;
  model.value = {
    ...model.value,
    width: Number(v.width ?? model.value.width),
    height: Number(v.height ?? model.value.height),
    mode: (v.mode as TransformForm["mode"]) ?? "fit",
    format: (v.format as TransformForm["format"]) ?? "keep",
    quality: (v.quality as number | undefined) ?? null,
    position: (v.position as TransformForm["position"]) ?? "center",
    background: (v.background as string | undefined) ?? "",
    smallInput: (v.smallInput as TransformForm["smallInput"]) ?? "",
    upscale: Boolean(v.upscale),
  };
}
</script>

<template>
  <form class="preset-form" @submit.prevent>
    <label class="span2">
      Preset
      <select @change="apply(($event.target as HTMLSelectElement).value)">
        <option value="">— tùy chỉnh —</option>
        <optgroup v-if="project.length" label="Dự án (imgfit.json)">
          <option v-for="p in project" :key="p.key" :value="p.key">{{ p.label }}</option>
        </optgroup>
        <optgroup label="Dựng sẵn">
          <option v-for="p in quick" :key="p.key" :value="p.key">{{ p.label }}</option>
        </optgroup>
      </select>
    </label>
    <label>Rộng <input v-model.number="model.width" type="number" min="1" max="65535" required /></label>
    <label>Cao <input v-model.number="model.height" type="number" min="1" max="65535" required /></label>
    <label>
      Chế độ
      <select v-model="model.mode">
        <option value="fit">fit — vừa khung, không cắt</option>
        <option value="cover">cover — lấp kín, cắt bớt</option>
        <option value="pad">pad — vừa khung + đệm nền</option>
      </select>
    </label>
    <label>
      Định dạng
      <select v-model="model.format">
        <option value="keep">giữ nguyên</option>
        <option value="jpg">JPG</option>
        <option value="png">PNG</option>
        <option value="webp">WebP</option>
        <option value="avif">AVIF</option>
      </select>
    </label>
    <label>Chất lượng <input v-model.number="model.quality" type="number" min="1" max="100" placeholder="mặc định" /></label>
    <label v-if="model.mode === 'cover'">
      Điểm crop
      <select v-model="model.position">
        <option value="center">giữa</option>
        <option value="top">mép trên</option>
        <option value="attention">vùng nổi bật (heuristic)</option>
      </select>
    </label>
    <label>
      Ảnh nhỏ hơn đích
      <select v-model="model.smallInput">
        <option value="">mặc định ({{ model.mode === "fit" ? "giữ" : "báo lỗi" }})</option>
        <option value="error">báo lỗi</option>
        <option value="keep">giữ kích thước nhỏ</option>
        <option value="pad">đệm nền</option>
        <option value="skip">bỏ qua (không tạo output)</option>
      </select>
    </label>
    <label>Màu nền <input v-model="model.background" type="text" placeholder="#ffffff" pattern="#[0-9a-fA-F]{3,8}" /></label>
    <label class="span2">Tên output <input v-model="model.name" type="text" placeholder="{name}.{ext}" /></label>
    <label class="check"><input v-model="model.upscale" type="checkbox" /> Cho phép phóng to</label>
    <label class="check"><input :checked="model.stripMetadata === false" type="checkbox" @change="model.stripMetadata = !($event.target as HTMLInputElement).checked" /> Giữ metadata (EXIF/GPS)</label>
  </form>
</template>
