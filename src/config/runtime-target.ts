import { createConfigModule } from './config-factory';
import { resolveLocalServiceHost } from '@/config/local-service-host';

export const RUNTIME_TARGET_MODE_STORAGE_KEY = 'exomind:runtimeTargetMode';
export const RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY = 'exomind:runtimeExternalAddress';
export const RUNTIME_EXTERNAL_AUTH_TOKEN_STORAGE_KEY = 'exomind:runtimeExternalAuthToken';
export const EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY = 'exomind:embeddedRuntimeNetworkMode';
export const EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH_STORAGE_KEY = 'exomind:embeddedRuntimeAllowLanNoAuth';
export const EMBEDDED_RUNTIME_STATUS_STORAGE_KEY = 'exomind:embeddedRuntimeStatus';
export const RUNTIME_TARGET_CHANGED_EVENT = 'exomind:runtime-target-changed';
export const EMBEDDED_RUNTIME_NETWORK_MODE_CHANGED_EVENT = 'exomind:embedded-runtime-network-mode-changed';
export const EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH_CHANGED_EVENT = 'exomind:embedded-runtime-allow-lan-no-auth-changed';
const RUNTIME_TARGET_MODE_VALUE_CHANGED_EVENT = 'exomind:runtime-target-mode-value-changed';
const RUNTIME_EXTERNAL_ADDRESS_CHANGED_EVENT = 'exomind:runtime-external-address-changed';
const RUNTIME_EXTERNAL_AUTH_TOKEN_CHANGED_EVENT = 'exomind:runtime-external-auth-token-changed';

export type RuntimeTargetMode = 'embedded' | 'external';
export type EmbeddedRuntimeNetworkMode = 'local' | 'lan';

export interface RuntimeTarget {
  mode: RuntimeTargetMode;
  host: string;
  port: number;
  authToken?: string;
}

export interface EmbeddedRuntimeStatusSnapshot {
  host: string;
  port: number;
  hostId?: string;
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
export const DEFAULT_EXTERNAL_RUNTIME_PORT = DEFAULT_EMBEDDED_RUNTIME_PORT;
const DEFAULT_RUNTIME_TARGET_MODE: RuntimeTargetMode = 'embedded';
const DEFAULT_EMBEDDED_RUNTIME_NETWORK_MODE: EmbeddedRuntimeNetworkMode = 'local';
const DEFAULT_EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH = false;
const DEFAULT_RUNTIME_EXTERNAL_ADDRESS = `${DEFAULT_EXTERNAL_RUNTIME_HOST}:${DEFAULT_EXTERNAL_RUNTIME_PORT}`;

function normalizeRuntimeMode(rawValue: string | null | undefined): RuntimeTargetMode {
  return rawValue === 'external' ? 'external' : 'embedded';
}

function normalizeEmbeddedRuntimeNetworkMode(
  rawValue: string | null | undefined,
): EmbeddedRuntimeNetworkMode {
  return rawValue === 'lan' ? 'lan' : 'local';
}

function normalizeEmbeddedRuntimeAllowLanWithoutAuth(
  rawValue: string | null | undefined,
): boolean {
  return rawValue === 'true';
}

function formatHostForAddress(host: string): string {
  if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
    return `[${host}]`;
  }
  return host;
}

export function formatHostForUrl(host: string): string {
  const normalizedHost = resolveLocalServiceHost(host);
  if (normalizedHost.includes(':') && !normalizedHost.startsWith('[')) {
    return `[${normalizedHost}]`;
  }
  return normalizedHost;
}

export function readEmbeddedRuntimeStatus(): EmbeddedRuntimeStatusSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // 非 Tauri 环境不存在内嵌 RT，跳过 localStorage 缓存（#775）
  if (!isTauriWindow()) {
    return null;
  }

  const raw = window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EmbeddedRuntimeStatusSnapshot> & {
      authSecret?: unknown;
    };
    if (typeof parsed.host !== 'string' || typeof parsed.port !== 'number') {
      return null;
    }
    const snapshot = {
      host: resolveLocalServiceHost(parsed.host),
      port: parsed.port,
      hostId: typeof parsed.hostId === 'string' ? parsed.hostId : undefined,
    };
    if (Object.prototype.hasOwnProperty.call(parsed, 'authSecret')) {
      window.localStorage.setItem(
        EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
        JSON.stringify(snapshot),
      );
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function isTauriWindow(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function isDesktopOperatingSystem(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent?.toLowerCase() ?? '';
  // 先排除移动端 UA——Android Tauri 的 WebView UA 包含 "android"
  if (/(android|iphone|ipad|ipod|mobile|phone)/i.test(userAgent)) {
    return false;
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = (
    navigatorWithUserAgentData.userAgentData?.platform
    || navigator.platform
    || userAgent
  ).toLowerCase();

  return /(win|mac|linux|x11)/i.test(platform);
}

function resolveEmbeddedHost(): string {
  const cachedStatus = readEmbeddedRuntimeStatus();
  if (cachedStatus) {
    return cachedStatus.host;
  }

  if (isTauriWindow()) {
    return resolveLocalServiceHost('127.0.0.1');
  }

  if (typeof window !== 'undefined' && window.location?.hostname) {
    return resolveLocalServiceHost(window.location.hostname);
  }
  return 'localhost';
}

function resolveEmbeddedPort(): number {
  const cachedStatus = readEmbeddedRuntimeStatus();
  if (cachedStatus?.port) return cachedStatus.port;

  return DEFAULT_EMBEDDED_RUNTIME_PORT;
}

export function getPreferredEmbeddedRuntimePort(): number {
  return resolveEmbeddedPort();
}

export function resolveEmbeddedRuntimeBindHost(
  mode: EmbeddedRuntimeNetworkMode = getEmbeddedRuntimeNetworkMode(),
): '127.0.0.1' | '0.0.0.0' {
  return mode === 'lan' ? '0.0.0.0' : '127.0.0.1';
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

function normalizeRuntimeExternalAddress(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return DEFAULT_RUNTIME_EXTERNAL_ADDRESS;
  }

  try {
    const parsed = parseRuntimeAddress(rawValue);
    return toAddress(parsed.host, parsed.port);
  } catch {
    return DEFAULT_RUNTIME_EXTERNAL_ADDRESS;
  }
}

function normalizeRuntimeExternalAuthToken(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return '';
  }

  let normalized = rawValue.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

const runtimeTargetModeModule = createConfigModule<RuntimeTargetMode>({
  storageKey: RUNTIME_TARGET_MODE_STORAGE_KEY,
  eventName: RUNTIME_TARGET_MODE_VALUE_CHANGED_EVENT,
  defaultValue: DEFAULT_RUNTIME_TARGET_MODE,
  normalize: normalizeRuntimeMode,
  serialize: (value) => normalizeRuntimeMode(value),
  persistMode: 'runtime-preferred',
});

const embeddedRuntimeNetworkModeModule = createConfigModule<EmbeddedRuntimeNetworkMode>({
  storageKey: EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY,
  eventName: EMBEDDED_RUNTIME_NETWORK_MODE_CHANGED_EVENT,
  defaultValue: DEFAULT_EMBEDDED_RUNTIME_NETWORK_MODE,
  normalize: normalizeEmbeddedRuntimeNetworkMode,
  serialize: (value) => normalizeEmbeddedRuntimeNetworkMode(value),
  persistMode: 'runtime-preferred',
});

const embeddedRuntimeAllowLanWithoutAuthModule = createConfigModule<boolean>({
  storageKey: EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH_STORAGE_KEY,
  eventName: EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH_CHANGED_EVENT,
  defaultValue: DEFAULT_EMBEDDED_RUNTIME_ALLOW_LAN_NO_AUTH,
  normalize: normalizeEmbeddedRuntimeAllowLanWithoutAuth,
  serialize: (value) => String(value === true),
  persistMode: 'runtime-preferred',
});

const runtimeExternalAddressModule = createConfigModule<string>({
  storageKey: RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY,
  eventName: RUNTIME_EXTERNAL_ADDRESS_CHANGED_EVENT,
  defaultValue: DEFAULT_RUNTIME_EXTERNAL_ADDRESS,
  normalize: normalizeRuntimeExternalAddress,
  serialize: (value) => {
    const parsed = parseRuntimeAddress(value);
    return toAddress(parsed.host, parsed.port);
  },
  persistMode: 'runtime-preferred',
});

const runtimeExternalAuthTokenModule = createConfigModule<string>({
  storageKey: RUNTIME_EXTERNAL_AUTH_TOKEN_STORAGE_KEY,
  eventName: RUNTIME_EXTERNAL_AUTH_TOKEN_CHANGED_EVENT,
  defaultValue: '',
  normalize: normalizeRuntimeExternalAuthToken,
  serialize: (value) => normalizeRuntimeExternalAuthToken(value),
  persistMode: 'runtime-preferred',
});

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
  return runtimeTargetModeModule.get();
}

export function getEmbeddedRuntimeNetworkMode(): EmbeddedRuntimeNetworkMode {
  return embeddedRuntimeNetworkModeModule.get();
}

export function getEmbeddedRuntimeAllowLanWithoutAuth(): boolean {
  return embeddedRuntimeAllowLanWithoutAuthModule.get();
}

export function setRuntimeTargetMode(mode: RuntimeTargetMode): void {
  runtimeTargetModeModule.set(mode);
  emitRuntimeTargetChanged();
}

export function setEmbeddedRuntimeNetworkMode(mode: EmbeddedRuntimeNetworkMode): void {
  embeddedRuntimeNetworkModeModule.set(mode);
}

export function setEmbeddedRuntimeAllowLanWithoutAuth(enabled: boolean): void {
  embeddedRuntimeAllowLanWithoutAuthModule.set(enabled);
}

export function subscribeEmbeddedRuntimeNetworkModeChanges(
  listener: (mode: EmbeddedRuntimeNetworkMode) => void,
): () => void {
  return embeddedRuntimeNetworkModeModule.subscribe(listener);
}

export function subscribeEmbeddedRuntimeAllowLanWithoutAuthChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return embeddedRuntimeAllowLanWithoutAuthModule.subscribe(listener);
}

export function getRuntimeExternalAddress(): string {
  return runtimeExternalAddressModule.get();
}

export function setRuntimeExternalAddress(address: string): void {
  runtimeExternalAddressModule.set(address);
  emitRuntimeTargetChanged();
}

export function getRuntimeExternalAuthToken(): string {
  return runtimeExternalAuthTokenModule.get();
}

export function setRuntimeExternalAuthToken(token: string): void {
  runtimeExternalAuthTokenModule.set(token);
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
    const authToken = getRuntimeExternalAuthToken();
    return {
      mode,
      host: external.host,
      port: external.port,
      authToken: authToken || undefined,
    };
  }

  return {
    mode,
    host: resolveEmbeddedHost(),
    port: resolveEmbeddedPort(),
  };
}

export function buildRuntimeAuthHeaders(
  target: Pick<RuntimeTarget, 'authToken'>,
  headers?: HeadersInit,
): Headers {
  const nextHeaders = new Headers(headers);
  const token = target.authToken?.trim();
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
}

export function persistEmbeddedRuntimeStatus(status: EmbeddedRuntimeStatusSnapshot | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!status) {
    window.localStorage.removeItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY);
    emitRuntimeTargetChanged();
    return;
  }

  window.localStorage.setItem(
    EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
    JSON.stringify({
      host: resolveLocalServiceHost(status.host),
      port: status.port,
      hostId: status.hostId,
    }),
  );
  emitRuntimeTargetChanged();
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
    if (
      event.key !== RUNTIME_TARGET_MODE_STORAGE_KEY
      && event.key !== RUNTIME_EXTERNAL_ADDRESS_STORAGE_KEY
      && event.key !== RUNTIME_EXTERNAL_AUTH_TOKEN_STORAGE_KEY
    ) {
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
