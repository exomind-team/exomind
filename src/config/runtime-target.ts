export const RUNTIME_TARGET_MODE_STORAGE_KEY = 'exomind:runtimeTargetMode';
export const RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY = 'exomind:runtimeExternalAddress';
export const RUNTIME_TARGET_CHANGED_EVENT = 'exomind:runtime-target-changed';

export type RuntimeTargetMode = 'embedded' | 'external';

export interface RuntimeTarget {
  mode: RuntimeTargetMode;
  host: string;
  port: number;
}

function resolveEmbeddedRuntimePort(rawValue: string | undefined): number {
  if (!rawValue) return 9124;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return 9124;
  }
  return parsed;
}

// Keep frontend/runtime port in sync via EXOMIND_RT_PORT (保持前后端 runtime 端口一致).
export const DEFAULT_EMBEDDED_RUNTIME_PORT = resolveEmbeddedRuntimePort(
  import.meta.env.EXOMIND_RT_PORT,
);
const DEFAULT_EXTERNAL_RUNTIME_HOST = '127.0.0.1';
export const DEFAULT_EXTERNAL_RUNTIME_PORT = 1949;
const DEFAULT_RUNTIME_TARGET_MODE: RuntimeTargetMode = 'embedded';

function normalizeRuntimeMode(rawValue: string | null | undefined): RuntimeTargetMode {
  return rawValue === 'external' ? 'external' : 'embedded';
}

function formatHostForAddress(host: string): string {
  if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
    return `[${host}]`;
  }
  return host;
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function resolveEmbeddedHost(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

function parseRuntimePort(rawPort: string): number {
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('port must be 1-65535（端口需在 1-65535）');
  }
  return port;
}

export function parseRuntimeAddress(address: string): { host: string; port: number } {
  const raw = address.trim();
  if (!raw) {
    throw new Error('host:port is required（必须输入 host:port）');
  }
  if (raw.includes('://') || raw.includes('/') || raw.includes('?') || raw.includes('#')) {
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const splitIndex = raw.lastIndexOf(':');
  if (splitIndex <= 0 || splitIndex >= raw.length - 1) {
    throw new Error('invalid host:port format（host:port 格式错误）');
  }

  const hostRaw = raw.slice(0, splitIndex).trim();
  const portRaw = raw.slice(splitIndex + 1).trim();
  const host = hostRaw.startsWith('[') && hostRaw.endsWith(']')
    ? hostRaw.slice(1, -1).trim()
    : hostRaw;

  if (!host) {
    throw new Error('host is required（host 不能为空）');
  }

  return {
    host,
    port: parseRuntimePort(portRaw),
  };
}

function toAddress(host: string, port: number): string {
  return `${formatHostForAddress(host)}:${port}`;
}

function emitRuntimeTargetChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<RuntimeTarget>(RUNTIME_TARGET_CHANGED_EVENT, {
      detail: getSelectedRuntimeTarget(),
    }),
  );
}

export function getRuntimeTargetMode(): RuntimeTargetMode {
  if (typeof window === 'undefined') {
    return DEFAULT_RUNTIME_TARGET_MODE;
  }

  return normalizeRuntimeMode(window.localStorage.getItem(RUNTIME_TARGET_MODE_STORAGE_KEY));
}

export function setRuntimeTargetMode(mode: RuntimeTargetMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeRuntimeMode(mode);
  window.localStorage.setItem(RUNTIME_TARGET_MODE_STORAGE_KEY, normalized);
  emitRuntimeTargetChanged();
}

export function getRuntimeExternalAddress(): string {
  if (typeof window === 'undefined') {
    return `${DEFAULT_EXTERNAL_RUNTIME_HOST}:${DEFAULT_EXTERNAL_RUNTIME_PORT}`;
  }

  const raw = window.localStorage.getItem(RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY);
  if (!raw) {
    return `${DEFAULT_EXTERNAL_RUNTIME_HOST}:${DEFAULT_EXTERNAL_RUNTIME_PORT}`;
  }

  try {
    const parsed = parseRuntimeAddress(raw);
    return toAddress(parsed.host, parsed.port);
  } catch {
    return `${DEFAULT_EXTERNAL_RUNTIME_HOST}:${DEFAULT_EXTERNAL_RUNTIME_PORT}`;
  }
}

export function setRuntimeExternalAddress(address: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const parsed = parseRuntimeAddress(address);
  window.localStorage.setItem(
    RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY,
    toAddress(parsed.host, parsed.port),
  );
  emitRuntimeTargetChanged();
}

function getExternalRuntimeTarget(): { host: string; port: number } {
  try {
    return parseRuntimeAddress(getRuntimeExternalAddress());
  } catch {
    return {
      host: DEFAULT_EXTERNAL_RUNTIME_HOST,
      port: DEFAULT_EXTERNAL_RUNTIME_PORT,
    };
  }
}

export function getSelectedRuntimeTarget(): RuntimeTarget {
  const mode = getRuntimeTargetMode();
  if (mode === 'external') {
    const external = getExternalRuntimeTarget();
    return { mode, host: external.host, port: external.port };
  }

  return {
    mode,
    host: resolveEmbeddedHost(),
    port: DEFAULT_EMBEDDED_RUNTIME_PORT,
  };
}

export function formatRuntimeTargetAddress(target: Pick<RuntimeTarget, 'host' | 'port'>): string {
  return toAddress(target.host, target.port);
}

export function toRuntimeBaseUrl(target: Pick<RuntimeTarget, 'host' | 'port'>): string {
  return `http://${formatHostForUrl(target.host)}:${target.port}`;
}

export function subscribeRuntimeTargetChanges(listener: (target: RuntimeTarget) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== RUNTIME_TARGET_MODE_STORAGE_KEY && event.key !== RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY) {
      return;
    }
    listener(getSelectedRuntimeTarget());
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<RuntimeTarget>;
    if (customEvent.detail) {
      listener(customEvent.detail);
      return;
    }
    listener(getSelectedRuntimeTarget());
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(RUNTIME_TARGET_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(RUNTIME_TARGET_CHANGED_EVENT, handleCustomEvent);
  };
}

