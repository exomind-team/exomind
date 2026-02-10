import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  envDir: '.',

  // PouchDB 浏览器兼容配置（使用 UMD 构建，无需 polyfill）
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // pouchdb/dist/pouchdb.js UMD 构建已内置所有必需模块（EventEmitter, IDB 适配器等）
      // 无需配置 pouchdb 或 events alias
    },
  },

  // 优化依赖配置
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
