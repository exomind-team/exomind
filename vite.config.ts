import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import { parsePort, resolveDevPorts } from "./src/config/port-env-node";

function readCurrentBranch(projectRoot: string): string {
  try {
    return execSync('git branch --show-current', {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  return env[key]?.trim() || process.env[key]?.trim();
}

function hasEnvValue(env: Record<string, string | undefined>, key: string): boolean {
  return Boolean(readEnvValue(env, key));
}

function createDevModuleCacheBypassPlugin() {
  return {
    name: "exomind-dev-module-cache-bypass",
    apply: "serve" as const,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if ((req.method !== "GET" && req.method !== "HEAD") || url.startsWith("/api/")) {
          next();
          return;
        }

        // Chromium-based Tauri webviews can occasionally return
        // ERR_CACHE_READ_FAILURE for Vite module reloads after a 304 response.
        // Strip conditional cache validators in dev so the webview always gets
        // a fresh 200 body for HTML/module assets during reloads/deep links.
        req.headers["if-none-match"] = undefined;
        req.headers["if-modified-since"] = undefined;
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPorts = resolveDevPorts(env);
  const tauriDevHost = env.TAURI_DEV_HOST?.trim() || process.env.TAURI_DEV_HOST?.trim();
  const projectRoot = process.cwd();
  const envMap = {
    ...Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value ?? undefined])),
    ...env,
  } as Record<string, string | undefined>;
  const devWatchIgnored = [
    "**/src-tauri/**",
    "**/target/**",
    "**/.tmp/**",
    "**/*.log",
    "**/.worktrees/**",
    "**/temp/worktrees/**",
    "**/node_modules.stale-*/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "**/website/**",
  ];
  const runtimePort = parsePort(readEnvValue(envMap, 'EXOMIND_RT_PORT'), 9124);
  const runtimeProxyTarget = `http://127.0.0.1:${runtimePort}`;
  const devInstanceMeta = {
    branch: readCurrentBranch(projectRoot),
    worktreeName: path.basename(projectRoot),
    webPort: devPorts.web,
    hmrPort: devPorts.hmr,
    rtPort: runtimePort,
    mcpPort: parsePort(
      readEnvValue(envMap, 'EXOMIND_MCP_PORT')
      ?? readEnvValue(envMap, 'EXOMIND_MCP_BRIDGE_PORT')
      ?? readEnvValue(envMap, 'TAURI_MCP_BRIDGE_PORT'),
      9232,
    ),
    pouchdbPort: parsePort(readEnvValue(envMap, 'EXOMIND_POUCHDB_PORT'), 6984),
    asrPort: parsePort(readEnvValue(envMap, 'EXOMIND_ASR_PORT'), 1949),
    syncServerEnvUrl: readEnvValue(envMap, 'VITE_SYNC_SERVER_URL') ?? '',
    asrServerEnvUrl: readEnvValue(envMap, 'VITE_ASR_SERVER_URL') ?? '',
    envStatus: {
      VITE_MOSS_API_KEY: { sensitive: true, configured: hasEnvValue(envMap, 'VITE_MOSS_API_KEY') },
      VITE_VOLCANO_APP_KEY: { sensitive: true, configured: hasEnvValue(envMap, 'VITE_VOLCANO_APP_KEY') },
      VITE_VOLCANO_ACCESS_KEY: { sensitive: true, configured: hasEnvValue(envMap, 'VITE_VOLCANO_ACCESS_KEY') },
      EXOMIND_ASR_AUTH_TOKEN: { sensitive: true, configured: hasEnvValue(envMap, 'EXOMIND_ASR_AUTH_TOKEN') },
      EXOMIND_RT_SECRET: { sensitive: true, configured: hasEnvValue(envMap, 'EXOMIND_RT_SECRET') },
      VITE_SYNC_SERVER_URL: {
        sensitive: false,
        configured: hasEnvValue(envMap, 'VITE_SYNC_SERVER_URL'),
        value: readEnvValue(envMap, 'VITE_SYNC_SERVER_URL'),
      },
      VITE_ASR_SERVER_URL: {
        sensitive: false,
        configured: hasEnvValue(envMap, 'VITE_ASR_SERVER_URL'),
        value: readEnvValue(envMap, 'VITE_ASR_SERVER_URL'),
      },
    },
  };

  return {
    plugins: [
      react(),
      ...(mode === "development" ? [createDevModuleCacheBypassPlugin()] : []),
    ],
    ...(mode === 'development'
      ? {
          define: {
            "globalThis.__EXOMIND_DEV_INSTANCE_META__": JSON.stringify(devInstanceMeta),
          },
        }
      : {}),

    envDir: ".",
    envPrefix: ["VITE_", "EXOMIND_", "TAURI_ENV_"],

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
          "now-workbench-overlay": path.resolve(__dirname, "now-workbench-overlay.html"),
        },
      },
    },

    clearScreen: false,
    server: {
      port: devPorts.web,
      strictPort: Boolean(process.env.EXOMIND_WEB_PORT),
      host: "0.0.0.0",
      proxy: {
        '/api/proposals': {
          target: runtimeProxyTarget,
          changeOrigin: false,
        },
      },
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
