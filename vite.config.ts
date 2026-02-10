import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// PouchDB UMD 注入插件
function pouchdbInject(): any {
  return {
    name: 'pouchdb-inject',
    transformIndexHtml(html) {
      // 检查是否已经注入
      if (html.includes('pouchdb.js')) return html;

      // 读取 PouchDB UMD 文件
      const pouchdbPath = path.resolve(__dirname, 'node_modules/pouchdb/dist/pouchdb.js');
      if (fs.existsSync(pouchdbPath)) {
        const pouchdbContent = fs.readFileSync(pouchdbPath, 'utf-8');
        // 注入到 HTML 中
        return html.replace(
          '</head>',
          `<script>${pouchdbContent}</script></head>`
        );
      }
      return html;
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), pouchdbInject()],

  envDir: '.',

  // PouchDB 浏览器兼容配置
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // 优化依赖配置
  optimizeDeps: {
    include: ['spark-md5', 'vuvuzela'],
    exclude: ['pouchdb', 'pouchdb-find', 'pouchdb-browser', 'pouchdb-adapter-idb'],
  },

  // 构建时将 pouchdb 外部化（因为已经在 HTML 中注入了）
  build: {
    rollupOptions: {
      external: ['pouchdb'],
      output: {
        globals: {
          pouchdb: 'PouchDB',
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
