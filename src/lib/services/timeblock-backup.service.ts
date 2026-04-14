import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { bytesToBase64 } from '@/lib/asr/volcano-config';
import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';
import type { TimeBlockData } from '@/lib/types/event';

type RuntimeFetch = typeof fetch;
export type TimeBlockImportStrategy = 'merge' | 'overwrite';

export interface TimeBlockBackendStatus {
  backend: string;
  supportsJsonBackup: boolean;
  supportsSqliteSnapshot: boolean;
}

export interface TimeBlockExportJsonResult {
  fileName: string;
  content: string;
  timeBlockCount: number;
  activeBlock: TimeBlockData | null;
}

export interface TimeBlockExportSqliteResult {
  fileName: string;
  bytes: Uint8Array;
  timeBlockCount: number;
  activeBlockPresent: boolean;
}

export interface TimeBlockImportResult {
  imported: number;
  skipped: number;
  total: number;
  activeBlockUpdated: boolean;
}

export interface TimeBlockScopeGrantReconcileResult {
  scopeKey: string;
  grantedPeers: number;
}

interface TimeBlockBackupJsonPayload {
  version: number;
  time_blocks: TimeBlockData[];
  active_block: TimeBlockData | null;
}

interface TimeBlockBackupSqlitePayload {
  version: number;
  file_name: string;
  content_base64: string;
  timeblock_count: number;
  active_block_present: boolean;
}

interface RuntimeTimeBlockScopeGrantReconcilePayload {
  scope_key: string;
  granted_peers: number;
}

export interface TimeBlockBackupServiceOptions {
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

function buildTimeBlockJsonFileName(): string {
  const day = new Date().toISOString().slice(0, 10);
  return `exomind-timeblocks-${day}.json`;
}

export class TimeBlockBackupServiceImpl {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: TimeBlockBackupServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async getBackendStatus(): Promise<TimeBlockBackendStatus> {
    const payload = await this.requestJson<{
      backend: string;
      supports_json_backup: boolean;
      supports_sqlite_snapshot: boolean;
    }>('/timeblocks/backend/status');

    return {
      backend: payload.backend,
      supportsJsonBackup: payload.supports_json_backup,
      supportsSqliteSnapshot: payload.supports_sqlite_snapshot,
    };
  }

  async exportTimeBlocksAsJson(): Promise<TimeBlockExportJsonResult> {
    const payload = await this.requestJson<TimeBlockBackupJsonPayload>('/timeblocks/backup/json');
    return {
      fileName: buildTimeBlockJsonFileName(),
      content: JSON.stringify(payload, null, 2),
      timeBlockCount: Array.isArray(payload.time_blocks) ? payload.time_blocks.length : 0,
      activeBlock: payload.active_block,
    };
  }

  async exportTimeBlocksAsSqliteSnapshot(): Promise<TimeBlockExportSqliteResult> {
    const payload = await this.requestJson<TimeBlockBackupSqlitePayload>('/timeblocks/backup/sqlite');
    return {
      fileName: payload.file_name,
      bytes: base64ToBytes(payload.content_base64),
      timeBlockCount: payload.timeblock_count,
      activeBlockPresent: payload.active_block_present,
    };
  }

  async reconcileTimeBlockScopeGrants(): Promise<TimeBlockScopeGrantReconcileResult> {
    const payload = await this.requestJson<RuntimeTimeBlockScopeGrantReconcilePayload>(
      '/mesh/timeblocks/grants/reconcile',
      { method: 'POST' },
    );
    return {
      scopeKey: payload.scope_key,
      grantedPeers: payload.granted_peers,
    };
  }

  async exportPeerTimeBlocksAsSqliteSnapshot(peerId: string): Promise<TimeBlockExportSqliteResult> {
    const payload = await this.requestJson<TimeBlockBackupSqlitePayload>(
      `/mesh/peers/${encodeURIComponent(peerId)}/timeblocks/snapshot/sqlite`,
    );
    return {
      fileName: payload.file_name,
      bytes: base64ToBytes(payload.content_base64),
      timeBlockCount: payload.timeblock_count,
      activeBlockPresent: payload.active_block_present,
    };
  }

  async importTimeBlocksFromJson(
    content: string,
    strategy: TimeBlockImportStrategy,
  ): Promise<TimeBlockImportResult> {
    const payload = await this.requestJson<{
      imported: number;
      skipped: number;
      total: number;
      active_block_updated: boolean;
    }>(`/timeblocks/import/json?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: content,
    });
    return {
      imported: payload.imported,
      skipped: payload.skipped,
      total: payload.total,
      activeBlockUpdated: payload.active_block_updated,
    };
  }

  async importTimeBlocksFromSqliteSnapshot(
    bytes: Uint8Array,
    strategy: TimeBlockImportStrategy,
  ): Promise<TimeBlockImportResult> {
    const payload = await this.requestJson<{
      imported: number;
      skipped: number;
      total: number;
      active_block_updated: boolean;
    }>(`/timeblocks/import/sqlite?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        content_base64: bytesToBase64(bytes),
      }),
    });
    return {
      imported: payload.imported,
      skipped: payload.skipped,
      total: payload.total,
      activeBlockUpdated: payload.active_block_updated,
    };
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
      throw new Error(`TimeBlock backup request failed: ${response.status}`);
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

let timeBlockBackupServiceInstance: TimeBlockBackupServiceImpl | null = null;

export function getTimeBlockBackupService(): TimeBlockBackupServiceImpl {
  if (!timeBlockBackupServiceInstance) {
    timeBlockBackupServiceInstance = new TimeBlockBackupServiceImpl();
  }
  return timeBlockBackupServiceInstance;
}

export function resetTimeBlockBackupServiceForTests(): void {
  timeBlockBackupServiceInstance = null;
}
