import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  envDir: '.',

  optimizeDeps: {
    include: ['spark-md5', 'vuvuzela'],
    exclude: ['pouchdb', 'pouchdb-find', 'pouchdb-browser'],
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Force the npm polyfill package instead of Node builtin externalization.
      "events": "events/",
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
