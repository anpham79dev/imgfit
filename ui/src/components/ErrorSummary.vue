<script setup lang="ts">
import { computed } from "vue";
import type { FileResult, Issue } from "../api";

const props = defineProps<{ files?: FileResult[]; errors?: Issue[]; warnings?: Issue[]; rejected?: Array<{ name: string; error: Issue }> }>();

/** Groups errors by code so the main problem is obvious (e.g. 12 × E_SMALL_INPUT). */
const groups = computed(() => {
  const m = new Map<string, { code: string; message: string; files: string[] }>();
  const add = (i: Issue, file: string) => {
    const g = m.get(i.code) ?? { code: i.code, message: i.message, files: [] };
    g.files.push(file);
    m.set(i.code, g);
  };
  for (const f of props.files ?? []) for (const e of f.errors) add(e, f.file);
  for (const e of props.errors ?? []) add(e, "(batch)");
  for (const r of props.rejected ?? []) add(r.error, r.name);
  return [...m.values()].sort((a, b) => b.files.length - a.files.length);
});
</script>

<template>
  <div v-if="groups.length || warnings?.length" class="error-summary">
    <details v-for="g in groups" :key="g.code" open>
      <summary>
        <strong class="err">{{ g.code }}</strong> × {{ g.files.length }} — {{ g.message }}
      </summary>
      <ul>
        <li v-for="f in g.files.slice(0, 50)" :key="f">{{ f }}</li>
        <li v-if="g.files.length > 50" class="muted">… và {{ g.files.length - 50 }} file khác</li>
      </ul>
    </details>
    <div v-for="w in warnings ?? []" :key="w.code + w.message" class="warn">! {{ w.code }}: {{ w.message }}</div>
  </div>
</template>
