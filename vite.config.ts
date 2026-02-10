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
    },
  },

  // 定义全局变量供 PouchDB UMD 使用
  define: {
    'process.env': '{}',
  },

  // 优化依赖配置
  optimizeDeps: {
    include: ['spark-md5', 'vuvuzela'],
    exclude: ['pouchdb', 'pouchdb-find', 'pouchdb-browser', 'pouchdb-adapter-idb'],
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
