export const DEFAULT_PORTS = {
  web: 1420,
  hmr: 1421,
  pouchdb: 6984,
  asr: 1949,
} as const;

type EnvMap = Record<string, string | undefined>;

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }

  return port;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveDevPorts(env: EnvMap): { web: number; hmr: number } {
  const web = parsePort(env.EXOMIND_WEB_PORT, DEFAULT_PORTS.web);
  const fallbackHmr = web < 65535 ? web + 1 : DEFAULT_PORTS.hmr;
  const hmr = parsePort(env.EXOMIND_HMR_PORT, fallbackHmr);

  return { web, hmr };
}

export function resolveSyncServerUrl(env: EnvMap, runtimeHostname: string = 'localhost'): string {
  if (env.VITE_SYNC_SERVER_URL) {
    return normalizeBaseUrl(env.VITE_SYNC_SERVER_URL);
  }

  const port = parsePort(env.EXOMIND_POUCHDB_PORT, DEFAULT_PORTS.pouchdb);
  const hostname = runtimeHostname.trim() || 'localhost';
  return `http://${hostname}:${port}`;
}

export function resolveAsrServerUrl(env: EnvMap): string {
  if (env.VITE_ASR_SERVER_URL) {
    return normalizeBaseUrl(env.VITE_ASR_SERVER_URL);
  }

  const port = parsePort(env.EXOMIND_ASR_PORT, DEFAULT_PORTS.asr);
  return `http://localhost:${port}`;
}

