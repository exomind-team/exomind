import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { resolveDevPorts } from "./src/config/port-env";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPorts = resolveDevPorts(env);

  return {
    plugins: [react()],

    envDir: ".",
    envPrefix: ["VITE_", "EXOMIND_"],

    optimizeDeps: {
      include: ["spark-md5", "vuvuzela"],
      exclude: ["pouchdb", "pouchdb-find", "pouchdb-browser"],
    },

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Force the npm polyfill package instead of Node builtin externalization.
        events: "events/",
      },
    },

    clearScreen: false,
    server: {
      port: devPorts.web,
      strictPort: Boolean(process.env.EXOMIND_WEB_PORT),
      host: "0.0.0.0",
      hmr: {
        protocol: "ws",
        host: "0.0.0.0",
        port: devPorts.hmr,
      },
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
