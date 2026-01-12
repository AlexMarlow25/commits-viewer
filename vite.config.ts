import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  define: {
    "process.env": {},
  },
  build: {
    outDir: "media",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "webview/main.ts"),
      name: "CommitTimesheetWebview",
      formats: ["iife"],
      fileName: () => "webview.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "webview.css",
      },
    },
  },
});
