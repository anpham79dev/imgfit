<script setup lang="ts">
import { computed } from "vue";
import type { BatchState } from "../composables/useBatch";

const props = defineProps<{ state: BatchState }>();
const emit = defineEmits<{ cancel: []; retry: [] }>();
const pct = computed(() => (props.state.total ? Math.round((props.state.completed / props.state.total) * 100) : 0));
const failed = computed(() => (props.state.report?.summary.failed ?? 0) + (props.state.report?.summary.cancelled ?? 0));
</script>

<template>
  <div v-if="state.status !== 'idle'" class="batch-progress">
    <div class="bar"><div class="fill" :style="{ width: `${pct}%` }" /></div>
    <div class="row">
      <span>
        <template v-if="state.status === 'running'">Đang xử lý {{ state.completed }}/{{ state.total }}…</template>
        <template v-else-if="state.status === 'error'">Lỗi: {{ state.error?.message }}</template>
        <template v-else>
          Xong · {{ state.report?.status }} · {{ state.report?.summary.created ?? 0 }} tạo mới · {{ state.report?.summary.replaced ?? 0 }} thay thế ·
          {{ state.report?.summary.failed ?? 0 }} lỗi
        </template>
      </span>
      <span class="row">
        <button v-if="state.status === 'running'" type="button" @click="emit('cancel')">Hủy</button>
        <button v-if="state.status === 'done' && failed > 0" type="button" @click="emit('retry')">Thử lại {{ failed }} file lỗi</button>
      </span>
    </div>
  </div>
</template>
