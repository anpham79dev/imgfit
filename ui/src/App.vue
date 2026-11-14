<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "./api";
import ProjectView from "./ProjectView.vue";
import QuickView from "./QuickView.vue";
import type { ProjectInfo } from "./types";

type Info = ProjectInfo;
const tab = ref<"quick" | "project">("quick");
const project = ref<Info | null>(null);
const version = ref("");
const fatal = ref<string | null>(null);

async function loadProject() {
  project.value = await api.get<Info>("/api/v1/project");
}

onMounted(async () => {
  try {
    const h = await api.get<{ versions: { imgfit: string; sharp: string; libvips: string } }>("/api/v1/health");
    version.value = `imgfit ${h.versions.imgfit} · sharp ${h.versions.sharp} · libvips ${h.versions.libvips}`;
    await loadProject();
    if (project.value?.configured) tab.value = "project";
  } catch (e) {
    fatal.value = (e as Error).message;
  }
});
</script>

<template>
  <header>
    <h1>imgfit</h1>
    <nav class="tabs">
      <button type="button" :class="{ active: tab === 'quick' }" @click="tab = 'quick'">Resize nhanh</button>
      <button type="button" :class="{ active: tab === 'project' }" :disabled="!project" @click="tab = 'project'">Dự án</button>
    </nav>
    <span class="muted small">{{ version }}</span>
  </header>
  <main>
    <p v-if="fatal" class="err card">{{ fatal }} — mở lại URL có token in trong terminal.</p>
    <QuickView v-show="tab === 'quick'" />
    <template v-if="tab === 'project' && project">
      <ProjectView v-if="project.configured" :info="project" @reload="loadProject" />
      <section v-else class="card">
        <h3>Chưa có cấu hình dự án</h3>
        <p>Không đọc được <code>imgfit.json</code> trong <code>{{ project.root }}</code>.</p>
        <p v-if="project.error" class="err">{{ project.error.code }}: {{ project.error.message }}</p>
        <p class="muted">Tạo bằng <code>imgfit init</code> rồi chạy lại <code>imgfit ui --root &lt;thư mục dự án&gt;</code>.</p>
      </section>
    </template>
  </main>
</template>
