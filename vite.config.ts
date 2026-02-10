import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  envDir: '.',

  // PouchDB 浏览器兼容配置
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // PouchDB 依赖的 polyfill
      "events": "events",
      "buffer": "buffer/",
      "process": "process/",
    },
  },

  // 外部化 PouchDB 依赖的 Node 模块
  optimizeDeps: {
    include: ['spark-md5', 'vuvuzela'],
    exclude: ['pouchdb', 'pouchdb-find', 'pouchdb-browser', 'pouchdb-adapter-idb'],
  },

  // 处理 PouchDB 的 Node.js 依赖
  build: {
    rollupOptions: {
      external: ['fsevents'],
      output: {
        manualChunks: {
          pouchdb: ['pouchdb'],
        },
      },
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
