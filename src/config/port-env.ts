export const DEFAULT_PORTS = {
  web: 1420,
  hmr: 1421,
  pouchdb: 6984,
  asr: 1949,
} as const;

export const SYNC_SERVER_URL_STORAGE_KEY = 'exomind:syncServerUrl';

type EnvMap = Record<string, string | undefined>;
type ResolveSyncServerUrlOptions = {
  hostname?: string;
  syncServerOverride?: string | null;
};
type ResolveAsrServerUrlOptions = {
  hostname?: string;
};

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

function normalizeOptionalBaseUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return normalizeBaseUrl(trimmed);
}

function resolveDefaultHost(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }

  return 'localhost';
}

function resolveRuntimeHostname(hostname?: string): string {
  if (hostname) return hostname;
  return resolveDefaultHost();
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }

  return host;
}

export function getSyncServerUrlOverride(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return normalizeOptionalBaseUrl(
      window.localStorage.getItem(SYNC_SERVER_URL_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function setSyncServerUrlOverride(url: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalized = normalizeOptionalBaseUrl(url);
    if (!normalized) {
      window.localStorage.removeItem(SYNC_SERVER_URL_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SYNC_SERVER_URL_STORAGE_KEY, normalized);
  } catch {
    // ignore localStorage write errors
  }
}

export function resolveDevPorts(env: EnvMap): { web: number; hmr: number } {
  const web = parsePort(env.EXOMIND_WEB_PORT, DEFAULT_PORTS.web);
  const fallbackHmr = web < 65535 ? web + 1 : DEFAULT_PORTS.hmr;
  const hmr = parsePort(env.EXOMIND_HMR_PORT, fallbackHmr);

  return { web, hmr };
}

export function resolveSyncServerUrl(
  env: EnvMap,
  options: ResolveSyncServerUrlOptions = {}
): string {
  if (env.VITE_SYNC_SERVER_URL) {
    return normalizeBaseUrl(env.VITE_SYNC_SERVER_URL);
  }

  const overrideUrl =
    normalizeOptionalBaseUrl(options.syncServerOverride) ??
    getSyncServerUrlOverride();
  if (overrideUrl) {
    return overrideUrl;
  }

  const port = parsePort(env.EXOMIND_POUCHDB_PORT, DEFAULT_PORTS.pouchdb);
  const host = formatHostForUrl(resolveRuntimeHostname(options.hostname));
  return `http://${host}:${port}`;
}

export function resolveAsrServerUrl(
  env: EnvMap,
  options: ResolveAsrServerUrlOptions = {}
): string {
  if (env.VITE_ASR_SERVER_URL) {
    return normalizeBaseUrl(env.VITE_ASR_SERVER_URL);
  }

  const port = parsePort(env.EXOMIND_ASR_PORT, DEFAULT_PORTS.asr);
  const host = formatHostForUrl(resolveRuntimeHostname(options.hostname));
  return `http://${host}:${port}`;
}

