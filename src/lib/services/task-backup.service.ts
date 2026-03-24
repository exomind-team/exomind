import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { bytesToBase64 } from '@/lib/asr/volcano-config';
import { appendRuntimeProfileScope } from '@/lib/adapters/runtime-profile-scope';

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
    const response = await this.fetchImpl(this.url(path, target), {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Task backup request failed: ${response.status}`);
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
