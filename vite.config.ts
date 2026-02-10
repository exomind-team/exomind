import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // 读取 .env 文件
  envDir: '.',

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // 解决 spark-md5 没有 default 导出的问题
      "spark-md5": path.resolve(__dirname, "./node_modules/spark-md5/spark-md5.js"),
    },
  },

  // 排除 PouchDB 和 spark-md5 的依赖优化，避免浏览器兼容性问题
  optimizeDeps: {
    exclude: ['pouchdb', 'spark-md5'],
  },

  // SSR 配置
  ssr: {
    noExternal: ['pouchdb', 'spark-md5'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',  // 监听所有网络接口
    hmr: {
      protocol: "ws",
      host: "0.0.0.0",
      port: 1421,
    },
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
