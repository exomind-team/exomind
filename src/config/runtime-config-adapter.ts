import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  persistEmbeddedRuntimeStatus,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';
import type { RuntimeServiceStatus } from '@/lib/types/agent-hub-runtime';
import type {
  RuntimeConfigBootstrapPayload,
  RuntimeConfigEntryRecord,
  RuntimeConfigTransport,
  RuntimeConfigWriteOptions,
} from './runtime-config-types';

const USER_SCOPE = 'user';
const BOOTSTRAP_IMPORT_SOURCE = 'frontend-bootstrap-import';
export const RUNTIME_CONFIG_FRONTEND_IMPORT_KEYS = [
  'exomind:themePreference',
  'exomind:voiceShortcutHotkey',
  'exomind:mainWindowShortcutSelection',
  'exomind:mainWindowShortcutSelectionCustomized',
  'exomind:mainWindowShortcutQuickFocusEnabled',
  'exomind:voiceShortcutAsrProvider',
  'exomind:voiceShortcutSendMode',
  'exomind:voiceShortcutMicPrewarmEnabled',
  'exomind:voiceTranscriptSendMode',
  'exomind:inputSendMode',
  'exomind:voice-auto-record',
  'exomind:taskCreateSuccessAction',
  'exomind:taskPageFuzzySearchEnabled',
  'exomind:feedbackPreferences',
  'exomind:timerPreferences',
  'exomind:agentPageEnabled',
  'exomind:goalsPageEnabled',
  'exomind:mePageEnabled',
  'exomind:commandPaletteEnabled',
  'exomind:developerMode',
  'exomind:desktopAdaptiveEnabled',
  'exomind:desktop-sidebar-collapsed',
  'exomind:devtoolsEnabled',
  'exomind:useMockData',
  'exomind:focusBgmPreferences',
  'exomind:runtimeTargetMode',
  'exomind:embeddedRuntimeNetworkMode',
  'exomind:embeddedRuntimeAllowLanNoAuth',
  'exomind:runtimeExternalAddress',
  'exomind:eventlogBackendMode',
  'exomind:taskBackendMode',
  'exomind:timeblockBackendMode',
  'exomind:dag-pan-speed',
  'exomind:dag-zoom-speed',
  'exomind:tasks-default-tab',
  'exomind:syncServerUrl',
  'exomind:task-timer:auto-fill',
  'exomind:goals-mode',
  'exomind:goals-show-cancelled',
  'exomind:goals-guide-hidden',
  'task-timeline-range',
  'task-timeline-selected-task',
  'task-timeline-show-pending',
  'task-timeline-layout-mode',
  'exomind:dag-mode',
  'exomind:dag-direction',
  'exomind:dag-hide-terminal',
  'exomind:dag-background-mode',
  'exomind:dag-immersive',
  'exomind:dag-viewport',
  'exomind:dag-search-draft',
  'exomind:dag-search-options',
  'exomind:dag-visibility',
  'exomind:agentHubTopologyLayouts',
  'exomind:agentHubRuntimePorts',
  'exomind:voiceOverlayOpacity',
  'exomind:voiceOverlayShowDiagnostics',
  'exomind:voiceOverlayTranscriptLines',
  'exomind:voiceOverlayBottomOffset',
  'exomind:nowWorkbenchOverlayEnabled',
  'exomind:nowWorkbenchOverlayPosition',
  'moss_api_key',
  'volcano_asr_app_key',
  'volcano_asr_access_key',
  'volcano_asr_resource_id',
  'volcano_asr_endpoint',
  'volcano_asr_language',
  'volcano_asr_enable_nonstream',
  'volcano_asr_show_utterances',
  'volcano_asr_end_window_size',
  'volcano_asr_force_to_speech_time',
  'exomind:ai-registry:snapshot',
  'exomind-update-settings',
  'agent_runtime_hosts_v1',
] as const;
export const RUNTIME_CONFIG_FRONTEND_IMPORT_PREFIXES = [
  'exomind:ai-registry:energy-secret:',
] as const;
const SENSITIVE_EXACT_KEYS = new Set<string>([
  'moss_api_key',
  'volcano_asr_app_key',
  'volcano_asr_access_key',
]);
const SENSITIVE_PREFIXES = [
  'exomind:ai-registry:energy-secret:',
] as const;

let activeTransport: RuntimeConfigTransport | null = null;

export class RuntimeConfigTransportDisabledError extends Error {
  readonly code = 'runtime-config-transport-disabled';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConfigTransportDisabledError';
  }
}

export function isRuntimeConfigTransportDisabledError(
  error: unknown,
): error is RuntimeConfigTransportDisabledError {
  return error instanceof RuntimeConfigTransportDisabledError
    || (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error as { code?: unknown }).code === 'runtime-config-transport-disabled'
    );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function buildHeaders(transport: RuntimeConfigTransport, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  const token = transport.authToken?.trim();
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_EXACT_KEYS.has(key)
    || SENSITIVE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function readLocalStorageEntry(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function collectFrontendImportEntries(): RuntimeConfigEntryRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const keys = new Set<string>(RUNTIME_CONFIG_FRONTEND_IMPORT_KEYS);
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) {
        continue;
      }
      if (RUNTIME_CONFIG_FRONTEND_IMPORT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.add(key);
      }
    }
  } catch {
    return [];
  }

  const sourceOrigin = window.location?.origin || undefined;
  const entries: RuntimeConfigEntryRecord[] = [];
  for (const key of keys) {
    const value = readLocalStorageEntry(key);
    if (value == null) {
      continue;
    }
    entries.push({
      key,
      value,
      sensitive: isSensitiveKey(key),
      source: BOOTSTRAP_IMPORT_SOURCE,
      sourceOrigin,
    });
  }

  return entries;
}

async function resolveRuntimeTransport(): Promise<RuntimeConfigTransport | null> {
  if (!await isTauri()) {
    return null;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const status = await invoke<RuntimeServiceStatus>('runtime_service_status');
    if (status.running) {
      if (status.externalRuntime) {
        activeTransport = null;
        throw new RuntimeConfigTransportDisabledError(
          'runtime config transport is disabled for external runtime managers',
        );
      }

      persistEmbeddedRuntimeStatus({
        host: status.host,
        port: status.port,
        hostId: status.hostId,
      });
      return {
        baseUrl: toRuntimeBaseUrl({ host: status.host, port: status.port }),
      };
    }

    await sleep(150);
  }

  return null;
}

async function fetchRuntimeSnapshot(
  transport: RuntimeConfigTransport,
): Promise<RuntimeConfigEntryRecord[]> {
  const response = await fetch(`${transport.baseUrl}/config?scope=${USER_SCOPE}`, {
    headers: buildHeaders(transport),
  });
  if (!response.ok) {
    throw new Error(`runtime config snapshot failed: ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`runtime config snapshot: expected array, got ${typeof data}`);
  }

  return data.filter((entry): entry is RuntimeConfigEntryRecord => {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const record = entry as Record<string, unknown>;
    return typeof record.key === 'string'
      && typeof record.value === 'string'
      && (record.sensitive === undefined || typeof record.sensitive === 'boolean')
      && (record.source === undefined || typeof record.source === 'string')
      && (record.sourceOrigin === undefined || typeof record.sourceOrigin === 'string');
  });
}

async function importFrontendEntriesIfEmpty(
  transport: RuntimeConfigTransport,
): Promise<void> {
  const entries = collectFrontendImportEntries();
  if (entries.length === 0) {
    return;
  }

  const response = await fetch(`${transport.baseUrl}/config/import/frontend`, {
    method: 'POST',
    headers: buildHeaders(transport, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      scope: USER_SCOPE,
      strategy: 'if-empty',
      entries,
    }),
  });

  if (!response.ok) {
    throw new Error(`runtime config import failed: ${response.status}`);
  }
}

export async function bootstrapRuntimeConfigTransport(): Promise<RuntimeConfigBootstrapPayload | null> {
  const transport = await resolveRuntimeTransport();
  activeTransport = transport;
  if (!transport) {
    return null;
  }

  await importFrontendEntriesIfEmpty(transport);
  const entries = await fetchRuntimeSnapshot(transport);
  return { transport, entries };
}

export async function writeRuntimeConfigValue(
  key: string,
  value: string,
  options: RuntimeConfigWriteOptions = {},
): Promise<void> {
  if (!activeTransport) {
    return;
  }

  const response = await fetch(`${activeTransport.baseUrl}/config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: buildHeaders(activeTransport, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      scope: USER_SCOPE,
      value,
      sensitive: options.sensitive ?? false,
      source: options.source,
      sourceOrigin: options.sourceOrigin,
    }),
  });

  if (!response.ok) {
    throw new Error(`runtime config put failed: ${response.status}`);
  }
}

export async function deleteRuntimeConfigValue(key: string): Promise<void> {
  if (!activeTransport) {
    return;
  }

  const response = await fetch(
    `${activeTransport.baseUrl}/config/${encodeURIComponent(key)}?scope=${USER_SCOPE}`,
    {
      method: 'DELETE',
      headers: buildHeaders(activeTransport),
    },
  );

  if (!response.ok) {
    throw new Error(`runtime config delete failed: ${response.status}`);
  }
}

export function clearRuntimeConfigTransport(): void {
  activeTransport = null;
}

export function __resetRuntimeConfigAdapterForTests(): void {
  clearRuntimeConfigTransport();
}
