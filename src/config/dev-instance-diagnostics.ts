import { resolveAsrServerUrl, resolveSyncServerUrl } from '@/config/port-env';
import { getHardwareKeyboardState } from '@/config/hardware-keyboard';
import { isDesktopOperatingSystem, isTauriWindow } from '@/config/runtime-target';

export type DevInstanceEnvStatus = {
  sensitive: boolean;
  configured: boolean;
  value?: string;
};

export type DevInstanceMeta = {
  branch: string;
  worktreeName: string;
  webPort: number;
  hmrPort: number;
  rtPort: number;
  mcpPort: number;
  pouchdbPort: number;
  asrPort: number;
  syncServerEnvUrl?: string;
  asrServerEnvUrl?: string;
  envStatus: Record<string, DevInstanceEnvStatus>;
};

export type DevInstanceDiagnosticsSnapshot = DevInstanceMeta & {
  syncServerUrl: string;
  asrServerUrl: string;
  pid: number | null;
  isDesktopOS: boolean;
  isTauri: boolean;
  hasHardwareKeyboard: boolean;
  keyboardType: string;
};

const DEFAULT_DEV_INSTANCE_META: DevInstanceMeta = {
  branch: 'dev',
  worktreeName: 'default',
  webPort: 1420,
  hmrPort: 1421,
  rtPort: 9124,
  mcpPort: 9232,
  pouchdbPort: 6984,
  asrPort: 1949,
  syncServerEnvUrl: undefined,
  asrServerEnvUrl: undefined,
  envStatus: {},
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function normalizeEnvStatus(value: unknown): Record<string, DevInstanceEnvStatus> {
  const record = toRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, raw]) => {
      const item = toRecord(raw);
      return [key, {
        sensitive: Boolean(item?.sensitive),
        configured: Boolean(item?.configured),
        ...(typeof item?.value === 'string' && item.value.trim().length > 0
          ? { value: item.value.trim() }
          : {}),
      } satisfies DevInstanceEnvStatus];
    }),
  );
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readInjectedMeta(): DevInstanceMeta {
  const raw = (globalThis as typeof globalThis & {
    __EXOMIND_DEV_INSTANCE_META__?: unknown;
  }).__EXOMIND_DEV_INSTANCE_META__;
  const record = toRecord(raw);
  if (!record) {
    return DEFAULT_DEV_INSTANCE_META;
  }

  return {
    branch: normalizeString(record.branch, DEFAULT_DEV_INSTANCE_META.branch),
    worktreeName: normalizeString(record.worktreeName, DEFAULT_DEV_INSTANCE_META.worktreeName),
    webPort: normalizeNumber(record.webPort, DEFAULT_DEV_INSTANCE_META.webPort),
    hmrPort: normalizeNumber(record.hmrPort, DEFAULT_DEV_INSTANCE_META.hmrPort),
    rtPort: normalizeNumber(record.rtPort, DEFAULT_DEV_INSTANCE_META.rtPort),
    mcpPort: normalizeNumber(record.mcpPort, DEFAULT_DEV_INSTANCE_META.mcpPort),
    pouchdbPort: normalizeNumber(record.pouchdbPort, DEFAULT_DEV_INSTANCE_META.pouchdbPort),
    asrPort: normalizeNumber(record.asrPort, DEFAULT_DEV_INSTANCE_META.asrPort),
    syncServerEnvUrl: normalizeString(record.syncServerEnvUrl, ''),
    asrServerEnvUrl: normalizeString(record.asrServerEnvUrl, ''),
    envStatus: normalizeEnvStatus(record.envStatus),
  };
}

function resolveRuntimeHostname(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.location?.hostname;
}

export function isDevInstanceDiagnosticsEnabled(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function getDevInstanceDiagnosticsSnapshot(
  runtime: { pid?: number | null } = {},
): DevInstanceDiagnosticsSnapshot {
  const meta = readInjectedMeta();
  const hostname = resolveRuntimeHostname();
  const syncServerUrl = resolveSyncServerUrl(
    {
      VITE_SYNC_SERVER_URL: meta.syncServerEnvUrl,
      EXOMIND_POUCHDB_PORT: String(meta.pouchdbPort),
    },
    { hostname },
  );
  const asrServerUrl = resolveAsrServerUrl(
    {
      VITE_ASR_SERVER_URL: meta.asrServerEnvUrl,
      EXOMIND_ASR_PORT: String(meta.asrPort),
    },
    { hostname },
  );

  const keyboardState = getHardwareKeyboardState();

  return {
    ...meta,
    syncServerUrl,
    asrServerUrl,
    pid: typeof runtime.pid === 'number' ? runtime.pid : null,
    isDesktopOS: isDesktopOperatingSystem(),
    isTauri: isTauriWindow(),
    hasHardwareKeyboard: keyboardState.hasHardwareKeyboard,
    keyboardType: keyboardState.keyboardType,
  };
}

export function formatDevInstanceWindowTitle(): string {
  const snapshot = getDevInstanceDiagnosticsSnapshot();
  return `ExoMind [${snapshot.branch}] [Web:${snapshot.webPort} RT:${snapshot.rtPort}]`;
}
