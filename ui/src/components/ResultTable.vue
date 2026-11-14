<script setup lang="ts">
import { type FileResult, formatBytes, px, saved } from "../api";

defineProps<{ files: FileResult[]; downloadBase?: string; outputs?: Array<{ index: number; name: string }>; selectable?: boolean; selected?: string | null }>();
const emit = defineEmits<{ select: [FileResult] }>();
const hasOutput = (outputs: Array<{ index: number }> | undefined, i: number) => outputs?.some((o) => o.index === i);
</script>

<template>
  <div class="table-wrap">
    <table class="results">
      <thead>
        <tr>
          <th>Trạng thái</th>
          <th>Nguồn</th>
          <th>Output</th>
          <th>Kích thước</th>
          <th>Dung lượng</th>
          <th>Ghi chú</th>
          <th v-if="downloadBase" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(f, i) in files"
          :key="`${f.file}→${f.destination}`"
          :class="[`st-${f.status}`, { clickable: selectable, selected: selected === f.destination }]"
          @click="selectable && emit('select', f)"
        >
          <td><span class="pill" :class="`st-${f.status}`">{{ f.status }}{{ f.action && f.status === "planned" ? ` · ${f.action}` : "" }}</span></td>
          <td class="path">{{ f.file }}</td>
          <td class="path">{{ f.destination ?? "—" }}</td>
          <td>{{ px(f.inputPx) }} → {{ px(f.outputPx) }}</td>
          <td>
            {{ formatBytes(f.inputBytes) }} → {{ formatBytes(f.outputBytes) }}
            <span class="muted">{{ saved(f.inputBytes, f.outputBytes) }}</span>
          </td>
          <td class="notes">
            <div v-for="e in f.errors" :key="e.code + e.message" class="err">{{ e.code }}: {{ e.message }}</div>
            <div v-for="w in f.warnings" :key="w.code + w.message" class="warn">{{ w.code }}</div>
          </td>
          <td v-if="downloadBase">
            <a v-if="hasOutput(outputs, i)" :href="`${downloadBase}/files/${i}?download=1`">Tải</a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
