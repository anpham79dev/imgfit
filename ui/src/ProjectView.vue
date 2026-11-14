<script setup lang="ts">
import { onMounted, ref, toRef } from "vue";
import BatchProgress from "./components/BatchProgress.vue";
import ConflictReview from "./components/ConflictReview.vue";
import ErrorSummary from "./components/ErrorSummary.vue";
import OutputDetail from "./components/OutputDetail.vue";
import RenameMapper from "./components/RenameMapper.vue";
import ResultTable from "./components/ResultTable.vue";
import { useNameMapping } from "./composables/useNameMapping";
import { useProjectManifest } from "./composables/useProjectManifest";
import { useProjectWrite } from "./composables/useProjectWrite";
import type { ManifestItem, ProjectInfo } from "./types";

const props = defineProps<{ info: ProjectInfo }>();
const emit = defineEmits<{ reload: [] }>();
const info = toRef(props, "info");

const error = ref<string | null>(null);
const showError = (message: string) => (error.value = message);
const tab = ref<"files" | "names">("files");

const manifest = useProjectManifest(info, showError);
const { report, selected } = manifest;
const names = useNameMapping(info, report, manifest.load, showError);
const write = useProjectWrite(() => report.value?.files.length ?? 0, manifest.load, showError);

function reload() {
  error.value = null;
  void manifest.load();
  emit("reload");
}
onMounted(manifest.load);
</script>

<template>
  <div class="project">
    <section class="card">
      <div class="row">
        <div>
          <strong>{{ info.root }}</strong>
          <span class="muted"> · profile {{ info.profile }} · nguồn {{ info.inputRoot }} → output {{ info.outputRoot }}</span>
        </div>
        <button type="button" :disabled="manifest.loading.value" @click="reload">Tải lại</button>
      </div>
      <ErrorSummary :warnings="[...(info.warnings ?? []), ...(report?.warnings ?? [])]" :errors="report?.errors" />
      <pre v-if="error" class="err">{{ error }}</pre>
      <p v-if="report" class="muted">
        {{ report.summary.total }} output · {{ report.summary.planned }} cần xử lý · {{ report.summary.unchanged }} không đổi · {{ report.summary.failed }} lỗi
      </p>
      <div class="tabs small">
        <button type="button" :class="{ active: tab === 'files' }" @click="tab = 'files'">Output</button>
        <button v-if="names.rules.value.length" type="button" :class="{ active: tab === 'names' }" @click="tab = 'names'">Đặt tên theo id</button>
      </div>
    </section>

    <template v-if="tab === 'files' && report">
      <div class="layout two">
        <section class="card">
          <ErrorSummary :files="report.files" />
          <ResultTable :files="report.files" selectable :selected="selected?.destination ?? null" @select="selected = $event as ManifestItem" />
        </section>
        <OutputDetail
          v-if="selected"
          :item="selected"
          :target="manifest.target.value"
          :preview="manifest.preview.value"
          :preview-error="manifest.previewError.value"
          :has-current="manifest.hasCurrentOutput.value"
          :source-url="manifest.imageUrl(selected.sourceRel, 1024)"
          :current-url="selected.destination ? manifest.outputUrl(selected.destination, 1024) : null"
          @update:focal="manifest.setFocal"
        />
      </div>
      <ConflictReview
        v-model:overwrite="write.overwrite.value"
        :plan="write.plan.value"
        :busy="write.busy.value || write.batch.state.status === 'running'"
        :expires-at="write.expiresAt.value"
        @preview="write.preview"
        @commit="write.commit"
      />
      <section v-if="write.batch.state.status !== 'idle'" class="card">
        <BatchProgress :state="write.batch.state" @cancel="write.batch.cancel" />
        <template v-if="write.batch.state.report">
          <ErrorSummary :files="write.batch.state.report.files" :warnings="write.batch.state.report.warnings" />
          <ResultTable :files="write.batch.state.report.files.filter((f) => f.status !== 'unchanged')" />
        </template>
      </section>
    </template>

    <template v-if="tab === 'names'">
      <section class="card">
        <label>
          Rule
          <select v-model="names.rule.value">
            <option v-for="r in names.rules.value" :key="r.id" :value="r.id">{{ r.id }} ({{ r.names }})</option>
          </select>
        </label>
      </section>
      <RenameMapper v-if="names.rule.value" :rule="names.rule.value" :sources="names.sources.value" :current="names.names.value" @save="names.save" />
    </template>
  </div>
</template>
