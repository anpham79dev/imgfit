<script setup lang="ts">
import { computed } from "vue";
import type { Report } from "../api";

/**
 * Review of what will be written before committing. The commit sends a nonce bound to the hash of this exact plan;
 * if the project changes between review and confirmation the server refuses (E_STALE_CONFIRMATION).
 */
const props = defineProps<{ plan: Report | null; busy: boolean; expiresAt: string | null }>();
const overwrite = defineModel<boolean>("overwrite", { default: false });
const emit = defineEmits<{ preview: []; commit: [] }>();

const creates = computed(() => props.plan?.files.filter((f) => f.status === "planned" && f.action === "create") ?? []);
const replaces = computed(() => props.plan?.files.filter((f) => f.status === "planned" && f.action === "replace") ?? []);
const blocked = computed(() => props.plan?.files.filter((f) => f.status === "failed") ?? []);
const unchanged = computed(() => props.plan?.files.filter((f) => f.status === "unchanged").length ?? 0);
const canCommit = computed(() => !!props.plan && props.plan.status !== "aborted" && creates.value.length + replaces.value.length > 0);
</script>

<template>
  <section class="conflict-review card">
    <h3>Ghi vào dự án</h3>
    <label class="check">
      <input v-model="overwrite" type="checkbox" @change="emit('preview')" />
      Cho phép thay file chưa do imgfit quản lý / đã bị sửa tay (có backup trong .imgfit/backups)
    </label>
    <div class="row">
      <button type="button" :disabled="busy" @click="emit('preview')">Xem trước thay đổi</button>
      <button type="button" class="primary" :disabled="busy || !canCommit" @click="emit('commit')">
        Xác nhận ghi {{ creates.length + replaces.length }} file
      </button>
    </div>
    <template v-if="plan">
      <p>
        <strong>{{ creates.length }}</strong> tạo mới · <strong>{{ replaces.length }}</strong> thay thế · {{ unchanged }} không đổi ·
        <strong :class="{ err: blocked.length }">{{ blocked.length }}</strong> bị chặn
        <span v-if="expiresAt" class="muted">(xác nhận hết hạn lúc {{ new Date(expiresAt).toLocaleTimeString() }})</span>
      </p>
      <p v-if="plan.status === 'aborted'" class="err">Có output trùng đích — không thể ghi. Sửa rule/tên rồi xem trước lại.</p>
      <details v-if="replaces.length" open>
        <summary>Sẽ thay thế ({{ replaces.length }})</summary>
        <ul class="paths">
          <li v-for="f in replaces" :key="f.destination ?? f.file">
            {{ f.destination }}
            <span v-for="w in f.warnings.filter((x) => x.code === 'W_OUTPUT_MODIFIED')" :key="w.code" class="warn">(đã bị sửa tay)</span>
          </li>
        </ul>
      </details>
      <details v-if="creates.length">
        <summary>Sẽ tạo mới ({{ creates.length }})</summary>
        <ul class="paths">
          <li v-for="f in creates" :key="f.destination ?? f.file">{{ f.destination }}</li>
        </ul>
      </details>
      <details v-if="blocked.length" open>
        <summary class="err">Bị chặn ({{ blocked.length }})</summary>
        <ul class="paths">
          <li v-for="f in blocked" :key="f.file + f.destination">
            {{ f.destination ?? f.file }} — <span class="err">{{ f.errors[0]?.code }}</span> {{ f.errors[0]?.message }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
