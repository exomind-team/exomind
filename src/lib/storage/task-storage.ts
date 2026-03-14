/**
 * TaskStorage - 任务本地存储
 *
 * 使用 PouchDB 实现任务数据的本地存储，支持同步。
 * 仿照 EventStorage 模式构建。
 */

import PouchDB from 'pouchdb';
import { buildSyncErrorLog } from './sync-error';
import type { TaskNode } from '@/lib/types/task';
import { log } from '@/lib/logger';

const POUCHDB_PREFIX_ENV = 'EXOMIND_TASK_STORAGE_PREFIX';
const DEFAULT_TEST_POUCHDB_PREFIX = '.tmp/pouchdb-task-storage/';
const OLD_STORAGE_KEY = 'task_nodes_v2';

/** Internal PouchDB document type */
interface TaskDoc extends TaskNode {
  _id: string;
  _rev?: string;
}

/* ── Design-doc map functions ── */

const BY_CREATED_AT_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('task:')) {
    emit(doc.createdAt, null);
  }
}`;

const BY_STATUS_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('task:')) {
    emit(doc.status, null);
  }
}`;

const BY_PARENT_ID_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('task:')) {
    emit(doc.parentId || null, null);
  }
}`;

/* ── Prefix resolution (shared pattern with EventStorage) ── */

function normalizePouchDbPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return DEFAULT_TEST_POUCHDB_PREFIX;
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function readNodeEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return process.env[name];
}

function resolvePouchDbPrefix(explicitPrefix?: string): string | undefined {
  if (typeof explicitPrefix === 'string' && explicitPrefix.trim().length > 0) {
    return normalizePouchDbPrefix(explicitPrefix);
  }
  const envPrefix = readNodeEnv(POUCHDB_PREFIX_ENV);
  if (typeof envPrefix === 'string' && envPrefix.trim().length > 0) {
    return normalizePouchDbPrefix(envPrefix);
  }
  if (readNodeEnv('VITEST') || readNodeEnv('VITEST_WORKER_ID') || readNodeEnv('NODE_ENV') === 'test') {
    return DEFAULT_TEST_POUCHDB_PREFIX;
  }
  return undefined;
}

/* ── Singleton cache ── */

const storageInstances: Map<string, TaskStorage> = new Map();

function buildCacheKey(userId: string, prefix?: string): string {
  return `${prefix ?? ''}::${userId}`;
}

export interface TaskStorageOptions {
  pouchDbPrefix?: string;
}

/**
 * 获取共享的 TaskStorage 实例（单例）
 */
export function getTaskStorage(userId: string, options?: TaskStorageOptions): TaskStorage {
  const prefix = resolvePouchDbPrefix(options?.pouchDbPrefix);
  const cacheKey = buildCacheKey(userId, prefix);
  if (!storageInstances.has(cacheKey)) {
    storageInstances.set(cacheKey, new TaskStorage(userId, { pouchDbPrefix: prefix }));
  }
  return storageInstances.get(cacheKey)!;
}

/** 清空所有实例（测试用） */
export function clearAllTaskStorageInstances(): void {
  storageInstances.clear();
}

/* ── TaskStorage class ── */

export class TaskStorage {
  private db: PouchDB.Database<TaskNode>;
  private initialized = false;
  private syncReplication: PouchDB.Replication.Sync<TaskNode> | null = null;
  private changeListeners: Array<(change: unknown) => void> = [];
  private lastSyncErrorSignature: string | null = null;

  constructor(userId: string, options: TaskStorageOptions = {}) {
    const dbName = `tasks_${userId}`;
    const prefix = resolvePouchDbPrefix(options.pouchDbPrefix);
    this.db = prefix
      ? new PouchDB<TaskNode>(dbName, { prefix })
      : new PouchDB<TaskNode>(dbName);
    this.initializeDesignDoc();
  }

  /* ── Design doc ── */

  private async initializeDesignDoc(): Promise<void> {
    if (this.initialized) return;

    const designDoc = {
      _id: '_design/tasks',
      views: {
        by_created_at: { map: BY_CREATED_AT_MAP },
        by_status: { map: BY_STATUS_MAP },
        by_parent_id: { map: BY_PARENT_ID_MAP },
      },
    };

    try {
      await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put(designDoc);
      this.initialized = true;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 409) {
        try {
          const existing = await this.db.get<{
            _rev: string;
            views?: {
              by_created_at?: { map?: string };
              by_status?: { map?: string };
              by_parent_id?: { map?: string };
            };
          }>('_design/tasks');

          const hasLatest =
            existing.views?.by_created_at?.map === BY_CREATED_AT_MAP &&
            existing.views?.by_status?.map === BY_STATUS_MAP &&
            existing.views?.by_parent_id?.map === BY_PARENT_ID_MAP;

          if (!hasLatest) {
            await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put({
              ...designDoc,
              _rev: existing._rev,
            });
          }
          this.initialized = true;
        } catch (updateError) {
          log.warn(`更新 TaskStorage 设计文档失败: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
        }
      } else {
        log.warn(`创建 TaskStorage 设计文档失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /* ── CRUD ── */

  async addTask(task: TaskNode): Promise<void> {
    await this.initializeDesignDoc();
    const doc: TaskDoc = { ...task, _id: `task:${task.id}` };
    await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);
    this.notifyChangeListeners({ type: 'local', doc });
  }

  async getTask(id: string): Promise<TaskNode | undefined> {
    await this.initializeDesignDoc();
    try {
      const doc = await this.db.get<TaskNode>(`task:${id}`);
      return this.toTaskNode(doc as unknown as TaskDoc);
    } catch {
      return undefined;
    }
  }

  async getTasks(): Promise<TaskNode[]> {
    await this.initializeDesignDoc();
    const result = await this.db.query<TaskDoc>('tasks/by_created_at', {
      include_docs: true,
      descending: true,
    });
    return result.rows.filter((row) => row.doc).map((row) => this.toTaskNode(row.doc!));
  }

  async getTasksByStatus(status: string): Promise<TaskNode[]> {
    await this.initializeDesignDoc();
    const result = await this.db.query<TaskDoc>('tasks/by_status', {
      include_docs: true,
      key: status,
    });
    return result.rows.filter((row) => row.doc).map((row) => this.toTaskNode(row.doc!));
  }

  async getTasksByParent(parentId: string | null): Promise<TaskNode[]> {
    await this.initializeDesignDoc();
    const result = await this.db.query<TaskDoc>('tasks/by_parent_id', {
      include_docs: true,
      key: parentId,
    });
    return result.rows.filter((row) => row.doc).map((row) => this.toTaskNode(row.doc!));
  }

  async updateTask(id: string, updates: Partial<TaskNode>): Promise<TaskNode | undefined> {
    await this.initializeDesignDoc();
    try {
      const doc = await this.db.get<TaskNode>(`task:${id}`);
      const updated = { ...doc, ...updates, updatedAt: Date.now() };
      await this.db.put(updated as unknown as Parameters<typeof this.db.put>[0]);
      this.notifyChangeListeners({ type: 'local', doc: updated });
      return this.toTaskNode(updated as unknown as TaskDoc);
    } catch {
      return undefined;
    }
  }

  async deleteDoc(id: string): Promise<void> {
    await this.initializeDesignDoc();
    try {
      const doc = await this.db.get<TaskNode>(`task:${id}`);
      await (this.db as unknown as { remove(doc: unknown): Promise<unknown> }).remove(doc);
    } catch {
      // not found, ignore
    }
  }

  async clearAll(): Promise<void> {
    await this.initializeDesignDoc();
    const result = await this.db.allDocs({ include_docs: true });
    const docsToDelete = result.rows
      .filter((row) => row.id && row.id.startsWith('task:'))
      .map((row) => ({ _id: row.id, _rev: row.value?.rev, _deleted: true }));
    if (docsToDelete.length > 0) {
      await this.db.bulkDocs(docsToDelete as unknown as Parameters<typeof this.db.bulkDocs>[0]);
    }
  }

  async count(): Promise<number> {
    await this.initializeDesignDoc();
    const result = await this.db.query<TaskNode>('tasks/by_created_at');
    return result.rows.length;
  }

  /* ── Sync ── */

  async syncToRemote(remoteUrl: string): Promise<PouchDB.Replication.Sync<TaskNode>> {
    if (this.syncReplication) {
      this.syncReplication.cancel();
    }
    this.syncReplication = this.db.sync(remoteUrl, { live: true, retry: true });
    this.syncReplication.on('active', () => {
      this.lastSyncErrorSignature = null;
    });
    this.syncReplication.on('change', (change: unknown) => {
      const direction = this.extractSyncDirection(change);
      if (direction && direction !== 'pull') return;
      this.notifyChangeListeners(change);
    });
    this.syncReplication.on('error', (error: unknown) => {
      this.logSyncError(remoteUrl, error);
    });
    return this.syncReplication;
  }

  async stopSync(): Promise<void> {
    if (this.syncReplication) {
      this.syncReplication.cancel();
      this.syncReplication = null;
    }
  }

  onRemoteChange(callback: (change: unknown) => void): () => void {
    this.changeListeners.push(callback);
    return () => {
      const idx = this.changeListeners.indexOf(callback);
      if (idx > -1) this.changeListeners.splice(idx, 1);
    };
  }

  getSyncStatus(): { active: boolean; paused: boolean; error: unknown } {
    return { active: this.syncReplication !== null, paused: false, error: null };
  }

  /* ── Data migration ── */

  /**
   * Migrate tasks from legacy localStorage key (task_nodes_v2) into PouchDB.
   * Safe to call multiple times; skips if old key is absent.
   */
  async migrateFromLocalStorage(): Promise<number> {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return 0;

    let tasks: TaskNode[];
    try {
      tasks = JSON.parse(raw);
      if (!Array.isArray(tasks)) return 0;
    } catch {
      return 0;
    }

    await this.initializeDesignDoc();
    let migrated = 0;
    for (const task of tasks) {
      if (!task.id) continue;
      try {
        await this.db.get(`task:${task.id}`);
        // already exists, skip
      } catch {
        await this.addTask(task);
        migrated++;
      }
    }

    localStorage.removeItem(OLD_STORAGE_KEY);
    return migrated;
  }

  /* ── Lifecycle ── */

  async close(): Promise<void> {
    await this.stopSync();
    await this.db.close();
    for (const [key, instance] of storageInstances.entries()) {
      if (instance === this) {
        storageInstances.delete(key);
        break;
      }
    }
  }

  /* ── Internal helpers ── */

  private toTaskNode(doc: TaskDoc): TaskNode {
    const obj = { ...doc } as Record<string, unknown>;
    delete obj._id;
    delete obj._rev;
    delete obj._conflicts;
    return obj as unknown as TaskNode;
  }

  private notifyChangeListeners(change: unknown): void {
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch {
        log.error('TaskStorage 变更监听器执行错误');
      }
    }
  }

  private extractSyncDirection(change: unknown): string | null {
    if (!change || typeof change !== 'object' || !('direction' in change)) return null;
    const direction = (change as { direction?: unknown }).direction;
    return typeof direction === 'string' && direction.trim().length > 0 ? direction : null;
  }

  private logSyncError(remoteUrl: string, error: unknown): void {
    const [message, payload] = buildSyncErrorLog('TaskStorage', remoteUrl, error);
    const signature = JSON.stringify({
      message,
      remoteUrl,
      code: payload.code,
      status: payload.status,
      errorMessage: payload.message,
    });
    if (signature === this.lastSyncErrorSignature) return;
    this.lastSyncErrorSignature = signature;
    log.error(`${message} ${JSON.stringify(payload)}`);
  }
}
