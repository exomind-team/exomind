import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { bytesToBase64 } from '@/lib/asr/volcano-config';
import type { RuntimeTaskPayload } from '@/lib/adapters/task-rt-adapter';
import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';
import {
  ensureRuntimeResponseOk,
  fetchRuntimeResponseOrThrow,
} from '@/lib/utils/runtime-request-error';

type RuntimeFetch = typeof fetch;
export type TaskImportStrategy = 'merge' | 'overwrite';

export interface TaskBackendStatus {
  backend: string;
  supportsJsonBackup: boolean;
  supportsSqliteSnapshot: boolean;
}

export interface TaskExportJsonResult {
  fileName: string;
  content: string;
  taskCount: number;
}

export interface TaskExportSqliteResult {
  fileName: string;
  bytes: Uint8Array;
  taskCount: number;
}

export interface TaskImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export interface TaskReplicationSummary {
  schemaVersion: 1;
  scopeKey: string;
  taskCount: number;
  maxUpdatedAt: number;
  revisionHash: string;
  generatedAt: number;
}

export interface TaskReplicationPullCursor {
  kind: 'task_watermark';
  updatedAt: number;
  taskId: string;
}

export interface TaskReplicationPullResult {
  schemaVersion: 1;
  scopeKey: string;
  items: RuntimeTaskPayload[];
  nextCursor?: TaskReplicationPullCursor;
  hasMore: boolean;
  summary: TaskReplicationSummary;
}

export interface TaskScopeGrantReconcileResult {
  scopeKey: string;
  grantedPeers: number;
}

interface TaskBackupJsonPayload {
  version: number;
  tasks: unknown[];
}

interface TaskBackupSqlitePayload {
  version: number;
  file_name: string;
  content_base64: string;
  task_count: number;
}

interface RuntimeTaskReplicationSummaryPayload {
  schema_version: 1;
  scope_key: string;
  task_count: number;
  max_updated_at: number;
  revision_hash: string;
  generated_at: number;
}

interface RuntimeTaskReplicationPullCursorPayload {
  kind: 'task_watermark';
  updated_at: number;
  task_id: string;
}

interface RuntimeTaskReplicationPullPayload {
  schema_version: 1;
  scope_key: string;
  items: RuntimeTaskPayload[];
  next_cursor?: RuntimeTaskReplicationPullCursorPayload | null;
  has_more: boolean;
  summary: RuntimeTaskReplicationSummaryPayload;
}

interface RuntimeTaskScopeGrantReconcilePayload {
  scope_key: string;
  granted_peers: number;
}

export interface TaskBackupServiceOptions {
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

function buildTaskJsonFileName(): string {
  const day = new Date().toISOString().slice(0, 10);
  return `exomind-tasks-${day}.json`;
}

function mapTaskReplicationSummary(
  payload: RuntimeTaskReplicationSummaryPayload,
): TaskReplicationSummary {
  return {
    schemaVersion: payload.schema_version,
    scopeKey: payload.scope_key,
    taskCount: payload.task_count,
    maxUpdatedAt: payload.max_updated_at,
    revisionHash: payload.revision_hash,
    generatedAt: payload.generated_at,
  };
}

function mapTaskReplicationPullCursor(
  payload: RuntimeTaskReplicationPullCursorPayload,
): TaskReplicationPullCursor {
  return {
    kind: payload.kind,
    updatedAt: payload.updated_at,
    taskId: payload.task_id,
  };
}

export class TaskBackupServiceImpl {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: TaskBackupServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async getBackendStatus(): Promise<TaskBackendStatus> {
    const payload = await this.requestJson<{
      backend: string;
      supports_json_backup: boolean;
      supports_sqlite_snapshot: boolean;
    }>('/tasks/backend/status');

    return {
      backend: payload.backend,
      supportsJsonBackup: payload.supports_json_backup,
      supportsSqliteSnapshot: payload.supports_sqlite_snapshot,
    };
  }

  async exportTasksAsJson(): Promise<TaskExportJsonResult> {
    const payload = await this.requestJson<TaskBackupJsonPayload>('/tasks/backup/json');
    return {
      fileName: buildTaskJsonFileName(),
      content: JSON.stringify(payload, null, 2),
      taskCount: Array.isArray(payload.tasks) ? payload.tasks.length : 0,
    };
  }

  async exportTasksAsSqliteSnapshot(): Promise<TaskExportSqliteResult> {
    const payload = await this.requestJson<TaskBackupSqlitePayload>('/tasks/backup/sqlite');
    return {
      fileName: payload.file_name,
      bytes: base64ToBytes(payload.content_base64),
      taskCount: payload.task_count,
    };
  }

  async getTaskReplicationSummary(): Promise<TaskReplicationSummary> {
    const payload = await this.requestJson<RuntimeTaskReplicationSummaryPayload>(
      '/tasks/replication/summary',
    );
    return mapTaskReplicationSummary(payload);
  }

  async reconcileTaskScopeGrants(): Promise<TaskScopeGrantReconcileResult> {
    const payload = await this.requestJson<RuntimeTaskScopeGrantReconcilePayload>(
      '/mesh/tasks/grants/reconcile',
      { method: 'POST' },
    );
    return {
      scopeKey: payload.scope_key,
      grantedPeers: payload.granted_peers,
    };
  }

  async getPeerTaskReplicationSummary(peerId: string): Promise<TaskReplicationSummary> {
    const payload = await this.requestJson<RuntimeTaskReplicationSummaryPayload>(
      `/mesh/peers/${encodeURIComponent(peerId)}/tasks/summary`,
    );
    return mapTaskReplicationSummary(payload);
  }

  async pullPeerTaskReplicationBatch(
    peerId: string,
    cursor?: TaskReplicationPullCursor,
    limit = 200,
  ): Promise<TaskReplicationPullResult> {
    const path = new URL(
      `/mesh/peers/${encodeURIComponent(peerId)}/tasks/pull`,
      'http://runtime.local',
    );
    path.searchParams.set('limit', String(limit));
    if (cursor) {
      path.searchParams.set('after_updated_at', String(cursor.updatedAt));
      path.searchParams.set('after_task_id', cursor.taskId);
    }

    const payload = await this.requestJson<RuntimeTaskReplicationPullPayload>(
      `${path.pathname}${path.search}`,
    );
    return {
      schemaVersion: payload.schema_version,
      scopeKey: payload.scope_key,
      items: payload.items,
      nextCursor: payload.next_cursor ? mapTaskReplicationPullCursor(payload.next_cursor) : undefined,
      hasMore: payload.has_more,
      summary: mapTaskReplicationSummary(payload.summary),
    };
  }

  async exportPeerTasksAsSqliteSnapshot(peerId: string): Promise<TaskExportSqliteResult> {
    const payload = await this.requestJson<TaskBackupSqlitePayload>(
      `/mesh/peers/${encodeURIComponent(peerId)}/tasks/snapshot/sqlite`,
    );
    return {
      fileName: payload.file_name,
      bytes: base64ToBytes(payload.content_base64),
      taskCount: payload.task_count,
    };
  }

  async importTasksFromJson(content: string, strategy: TaskImportStrategy): Promise<TaskImportResult> {
    return this.requestJson<TaskImportResult>(`/tasks/import/json?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: content,
    });
  }

  async importTasksFromSqliteSnapshot(
    bytes: Uint8Array,
    strategy: TaskImportStrategy,
  ): Promise<TaskImportResult> {
    return this.requestJson<TaskImportResult>(`/tasks/import/sqlite?strategy=${strategy}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        content_base64: bytesToBase64(bytes),
      }),
    });
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const target = this.resolveTarget();
    const url = this.url(path, target);
    const response = await fetchRuntimeResponseOrThrow(this.fetchImpl, url, {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    }, 'Task backup request');
    await ensureRuntimeResponseOk(response, url, 'Task backup request');

    return response.json() as Promise<T>;
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}

let taskBackupServiceInstance: TaskBackupServiceImpl | null = null;

export function getTaskBackupService(): TaskBackupServiceImpl {
  if (!taskBackupServiceInstance) {
    taskBackupServiceInstance = new TaskBackupServiceImpl();
  }
  return taskBackupServiceInstance;
}

export function resetTaskBackupServiceForTests(): void {
  taskBackupServiceInstance = null;
}
