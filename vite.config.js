import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  // GitHub Pages: /ember/ — Capacitor WebView: relative ./ (https://localhost/)
  base: mode === "capacitor" ? "./" : "/ember/",
  appType: "spa",
  server: {
    host: "127.0.0.1",
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 43124,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
}));
