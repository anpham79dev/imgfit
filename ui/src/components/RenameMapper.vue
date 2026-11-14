<script setup lang="ts">
import { computed, ref, watch } from "vue";

/**
 * Assigns an id to every source of a rule that uses {id}. Paste either:
 *  - one id per line, in (sorted) source order, or
 *  - "file-name<TAB , or ;>id" lines to match by name.
 * No fuzzy matching: lines that do not match a file name exactly are errors and must be fixed before saving.
 */
const props = defineProps<{ rule: string; sources: string[]; current: Record<string, string> }>();
const emit = defineEmits<{ save: [Record<string, string>] }>();

const text = ref("");
watch(
  () => [props.rule, props.current] as const,
  () => {
    text.value = props.sources.map((s) => props.current[s] ?? "").join("\n").replace(/\n+$/, "");
  },
  { immediate: true },
);

const basename = (p: string) => p.split("/").pop() ?? p;
const stem = (p: string) => basename(p).replace(/\.[^.]+$/, "");

const parsed = computed(() => {
  const lines = text.value.split(/\r?\n/).map((l) => l.trim()).filter((l, i, arr) => l !== "" || i < arr.length - 1);
  const paired = lines.some((l) => /[\t,;]/.test(l));
  const mapping: Record<string, string> = {};
  const problems: string[] = [];
  if (paired) {
    const byName = new Map<string, string[]>();
    for (const s of props.sources) for (const k of [s, basename(s), stem(s)]) byName.set(k.toLowerCase(), [...(byName.get(k.toLowerCase()) ?? []), s]);
    for (const l of lines) {
      if (!l) continue;
      const [name = "", id = ""] = l.split(/[\t,;]/).map((x) => x.trim());
      const hits = [...new Set(byName.get(name.toLowerCase()) ?? [])];
      if (hits.length === 0) problems.push(`Không có nguồn tên "${name}"`);
      else if (hits.length > 1) problems.push(`"${name}" khớp nhiều nguồn: ${hits.join(", ")} — dùng đường dẫn đầy đủ`);
      else if (!id) problems.push(`"${name}" chưa có id`);
      else mapping[hits[0] as string] = id;
    }
  } else {
    if (lines.length > props.sources.length) problems.push(`Có ${lines.length} id nhưng chỉ ${props.sources.length} nguồn`);
    props.sources.forEach((s, i) => {
      const id = lines[i];
      if (id) mapping[s] = id;
    });
  }
  const byId = new Map<string, string[]>();
  for (const [s, id] of Object.entries(mapping)) byId.set(id.toLowerCase(), [...(byId.get(id.toLowerCase()) ?? []), s]);
  for (const [id, list] of byId) if (list.length > 1) problems.push(`id "${id}" trùng: ${list.join(", ")}`);
  const missing = props.sources.filter((s) => !mapping[s]);
  return { mapping, problems, missing };
});
</script>

<template>
  <section class="rename-mapper card">
    <h3>Đặt tên theo id — rule <code>{{ rule }}</code></h3>
    <p class="muted">Mỗi dòng một id theo thứ tự nguồn bên dưới, hoặc dạng <code>tên-file,id</code>. Lưu vào file names của rule.</p>
    <div class="mapper-grid">
      <textarea v-model="text" rows="12" spellcheck="false" />
      <table class="results">
        <thead>
          <tr><th>Nguồn</th><th>id</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in sources" :key="s" :class="{ missing: !parsed.mapping[s] }">
            <td class="path">{{ s }}</td>
            <td>{{ parsed.mapping[s] ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul v-if="parsed.problems.length" class="err">
      <li v-for="p in parsed.problems" :key="p">{{ p }}</li>
    </ul>
    <p v-if="parsed.missing.length" class="warn">{{ parsed.missing.length }} nguồn chưa có id (sẽ báo E_NAME_MISSING khi chạy).</p>
    <button type="button" class="primary" :disabled="parsed.problems.length > 0" @click="emit('save', parsed.mapping)">Lưu mapping</button>
  </section>
</template>
