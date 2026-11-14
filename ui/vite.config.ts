import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL("../dist/ui", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  server: {
    // Dev: chạy `imgfit ui --port 8765` song song rồi `npm run dev:ui`; mở URL token của 8765 một lần để có cookie.
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
});
