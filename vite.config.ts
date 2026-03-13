import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { resolveDevPorts } from "./src/config/port-env";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPorts = resolveDevPorts(env);
  const tauriDevHost = env.TAURI_DEV_HOST?.trim() || process.env.TAURI_DEV_HOST?.trim();
  const devWatchIgnored = [
    "**/src-tauri/**",
    "**/target/**",
    "**/.tmp/**",
    "**/*.log",
    "**/.worktrees/**",
    "**/website/**",
    "**/packages/ts-agent-cli/**",
  ];

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

    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          "voice-overlay": path.resolve(__dirname, "voice-overlay.html"),
        },
      },
    },

    clearScreen: false,
    server: {
      port: devPorts.web,
      strictPort: Boolean(process.env.EXOMIND_WEB_PORT),
      host: "0.0.0.0",
      hmr: {
        protocol: "ws",
        ...(tauriDevHost ? { host: tauriDevHost } : {}),
        port: devPorts.hmr,
      },
      watch: {
        // Ignore Rust/Cargo outputs to avoid FS event storms during `tauri dev`.
        //（忽略 Rust/Cargo 产物与无关子项目，避免 tauri dev 时误触发整页重载）
        ignored: devWatchIgnored,
      },
    },
  };
});
