import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { bytesToBase64 } from '@/lib/asr/volcano-config';
import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';

type RuntimeFetch = typeof fetch;
export type EventLogImportStrategy = 'merge' | 'overwrite';

export interface EventLogBackendStatus {
  backend: string;
  supportsJsonBackup: boolean;
  supportsSqliteSnapshot: boolean;
}

export interface EventLogExportJsonResult {
  fileName: string;
  content: string;
  eventCount: number;
}

export interface EventLogExportSqliteResult {
  fileName: string;
  bytes: Uint8Array;
  eventCount: number;
}

export interface EventLogImportResult {
  imported: number;
  skipped: number;
  total: number;
}

interface EventLogBackupJsonPayload {
  version: number;
  exportedAt: string;
  events: unknown[];
}

interface EventLogBackupSqlitePayload {
  version: number;
  file_name: string;
  content_base64: string;
  event_count: number;
}

export interface EventLogBackupServiceOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function buildBaseUrl(target: RuntimeTarget): string {
  return `http://${formatHostForUrl(target.host)}:${target.port}`;
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildEventLogJsonFileName(): string {
  const day = new Date().toISOString().slice(0, 10);
  return `exomind-eventlog-${day}.json`;
}

export class EventLogBackupServiceImpl {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: EventLogBackupServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async getBackendStatus(): Promise<EventLogBackendStatus> {
    const payload = await this.requestJson<{
      backend: string;
      supports_json_backup: boolean;
      supports_sqlite_snapshot: boolean;
    }>('/eventlog/backend/status');

    return {
      backend: payload.backend,
      supportsJsonBackup: payload.supports_json_backup,
      supportsSqliteSnapshot: payload.supports_sqlite_snapshot,
    };
  }

  async exportEventsAsJson(): Promise<EventLogExportJsonResult> {
    const payload = await this.requestJson<EventLogBackupJsonPayload>('/eventlog/backup/json');
    return {
      fileName: buildEventLogJsonFileName(),
      content: JSON.stringify(payload, null, 2),
      eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
    };
  }

  async exportEventsAsSqliteSnapshot(): Promise<EventLogExportSqliteResult> {
    const payload = await this.requestJson<EventLogBackupSqlitePayload>('/eventlog/backup/sqlite');
    return {
      fileName: payload.file_name,
      bytes: base64ToBytes(payload.content_base64),
      eventCount: payload.event_count,
    };
  }

  async importEventsFromJson(content: string, strategy: EventLogImportStrategy): Promise<EventLogImportResult> {
    return this.requestJson<EventLogImportResult>(`/eventlog/import/json?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: content,
    });
  }

  async importEventsFromSqliteSnapshot(
    bytes: Uint8Array,
    strategy: EventLogImportStrategy,
  ): Promise<EventLogImportResult> {
    return this.requestJson<EventLogImportResult>(`/eventlog/import/sqlite?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        content_base64: bytesToBase64(bytes),
      }),
    });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`EventLog backup request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}

let eventLogBackupServiceInstance: EventLogBackupServiceImpl | null = null;

export function getEventLogBackupService(): EventLogBackupServiceImpl {
  if (!eventLogBackupServiceInstance) {
    eventLogBackupServiceInstance = new EventLogBackupServiceImpl();
  }
  return eventLogBackupServiceInstance;
}

export function resetEventLogBackupServiceForTests(): void {
  eventLogBackupServiceInstance = null;
}
