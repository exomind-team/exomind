import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  envDir: '.',

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // 强制使用 pouchdb 浏览器 CJS 构建，避免 ESM 导入 CJS 问题
      "pouchdb": path.resolve(__dirname, './node_modules/pouchdb/lib/index-browser.js'),
      "pouchdb-utils": path.resolve(__dirname, './node_modules/pouchdb-utils/lib/index-browser.js'),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    hmr: {
      protocol: "ws",
      host: "0.0.0.0",
      port: 1421,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
