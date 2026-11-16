<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "./api";
import QuickView from "./QuickView.vue";

const version = ref("");
const fatal = ref<string | null>(null);

onMounted(async () => {
  try {
    const h = await api.get<{ versions: { imgfit: string; sharp: string; libvips: string } }>("/api/v1/health");
    version.value = `imgfit ${h.versions.imgfit} · sharp ${h.versions.sharp} · libvips ${h.versions.libvips}`;
  } catch (e) {
    fatal.value = (e as Error).message;
  }
});
</script>

<template>
  <header>
    <h1>imgfit</h1>
    <span class="muted small">{{ version }}</span>
  </header>
  <main>
    <p v-if="fatal" class="err card">{{ fatal }} — mở lại URL có token in trong terminal.</p>
    <QuickView />
  </main>
</template>
