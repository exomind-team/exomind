import PouchDB from 'pouchdb';
import { buildSyncErrorLog } from './sync-error';
import type { Reminder, ReminderStatus } from '@/lib/types/reminder';
import { log } from '@/lib/logger';

const POUCHDB_PREFIX_ENV = 'EXOMIND_REMINDER_STORAGE_PREFIX';
const DEFAULT_TEST_POUCHDB_PREFIX = '.tmp/pouchdb-reminder-storage/';

interface ReminderDoc extends Reminder {
  _id: string;
  _rev?: string;
}

const BY_DUE_AT_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('reminder:')) {
    emit(doc.dueAt, null);
  }
}`;

const BY_STATUS_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('reminder:')) {
    emit(doc.status, null);
  }
}`;

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

export interface ReminderStorageOptions {
  pouchDbPrefix?: string;
}

const storageInstances: Map<string, ReminderStorage> = new Map();

function buildCacheKey(userId: string, prefix?: string): string {
  return `${prefix ?? ''}::${userId}`;
}

export function getReminderStorage(userId: string, options?: ReminderStorageOptions): ReminderStorage {
  const prefix = resolvePouchDbPrefix(options?.pouchDbPrefix);
  const cacheKey = buildCacheKey(userId, prefix);
  if (!storageInstances.has(cacheKey)) {
    storageInstances.set(cacheKey, new ReminderStorage(userId, { pouchDbPrefix: prefix }));
  }
  return storageInstances.get(cacheKey)!;
}

export function clearAllReminderStorageInstances(): void {
  storageInstances.clear();
}

export class ReminderStorage {
  private db: PouchDB.Database<Reminder>;
  private initialized = false;
  private syncReplication: PouchDB.Replication.Sync<Reminder> | null = null;
  private changeListeners: Array<(change: unknown) => void> = [];
  private lastSyncErrorSignature: string | null = null;

  constructor(userId: string, options: ReminderStorageOptions = {}) {
    const dbName = `reminders_${userId}`;
    const prefix = resolvePouchDbPrefix(options.pouchDbPrefix);
    this.db = prefix
      ? new PouchDB<Reminder>(dbName, { prefix })
      : new PouchDB<Reminder>(dbName);
    this.initializeDesignDoc();
  }

  private async initializeDesignDoc(): Promise<void> {
    if (this.initialized) return;

    const designDoc = {
      _id: '_design/reminders',
      views: {
        by_due_at: { map: BY_DUE_AT_MAP },
        by_status: { map: BY_STATUS_MAP },
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
              by_due_at?: { map?: string };
              by_status?: { map?: string };
            };
          }>('_design/reminders');

          const hasLatest =
            existing.views?.by_due_at?.map === BY_DUE_AT_MAP &&
            existing.views?.by_status?.map === BY_STATUS_MAP;

          if (!hasLatest) {
            await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put({
              ...designDoc,
              _rev: existing._rev,
            });
          }
          this.initialized = true;
        } catch (updateError) {
          log.warn(`更新 ReminderStorage 设计文档失败: ${updateError instanceof Error ? updateError.message : String(updateError)}`);
        }
      } else {
        log.warn(`创建 ReminderStorage 设计文档失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async addReminder(reminder: Reminder): Promise<void> {
    await this.initializeDesignDoc();
    const doc: ReminderDoc = { ...reminder, _id: `reminder:${reminder.id}` };
    await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);
    this.notifyChangeListeners({ type: 'local', doc });
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    await this.initializeDesignDoc();
    try {
      const doc = await this.db.get<Reminder>(`reminder:${id}`);
      return this.toReminder(doc as unknown as ReminderDoc);
    } catch {
      return undefined;
    }
  }

  async getReminders(): Promise<Reminder[]> {
    await this.initializeDesignDoc();
    const result = await this.db.query<ReminderDoc>('reminders/by_due_at', {
      include_docs: true,
      descending: false,
    });
    return result.rows.filter((row) => row.doc).map((row) => this.toReminder(row.doc!));
  }

  async getRemindersByStatus(status: ReminderStatus): Promise<Reminder[]> {
    await this.initializeDesignDoc();
    const result = await this.db.query<ReminderDoc>('reminders/by_status', {
      include_docs: true,
      key: status,
    });
    return result.rows.filter((row) => row.doc).map((row) => this.toReminder(row.doc!));
  }

  async updateReminder(id: string, updates: Partial<Reminder>): Promise<Reminder | undefined> {
    await this.initializeDesignDoc();
    try {
      const doc = await this.db.get<Reminder>(`reminder:${id}`);
      const updated = { ...doc, ...updates, updatedAt: Date.now() };
      await this.db.put(updated as unknown as Parameters<typeof this.db.put>[0]);
      this.notifyChangeListeners({ type: 'local', doc: updated });
      return this.toReminder(updated as unknown as ReminderDoc);
    } catch {
      return undefined;
    }
  }

  async count(): Promise<number> {
    await this.initializeDesignDoc();
    const result = await this.db.query<Reminder>('reminders/by_due_at');
    return result.rows.length;
  }

  async clearAll(): Promise<void> {
    await this.initializeDesignDoc();
    const result = await this.db.allDocs({ include_docs: true });
    const docsToDelete = result.rows
      .filter((row) => row.id && row.id.startsWith('reminder:'))
      .map((row) => ({ _id: row.id, _rev: row.value?.rev, _deleted: true }));
    if (docsToDelete.length > 0) {
      await this.db.bulkDocs(docsToDelete as unknown as Parameters<typeof this.db.bulkDocs>[0]);
    }
  }

  async syncToRemote(remoteUrl: string): Promise<PouchDB.Replication.Sync<Reminder>> {
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
    return {
      active: this.syncReplication !== null,
      paused: false,
      error: null,
    };
  }

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

  private toReminder(doc: ReminderDoc): Reminder {
    const obj = { ...doc } as Record<string, unknown>;
    delete obj._id;
    delete obj._rev;
    delete obj._conflicts;
    return obj as unknown as Reminder;
  }

  private notifyChangeListeners(change: unknown): void {
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch {
        log.error('ReminderStorage 变更监听器执行错误');
      }
    }
  }

  private extractSyncDirection(change: unknown): string | null {
    if (!change || typeof change !== 'object' || !('direction' in change)) return null;
    const direction = (change as { direction?: unknown }).direction;
    return typeof direction === 'string' && direction.trim().length > 0 ? direction : null;
  }

  private logSyncError(remoteUrl: string, error: unknown): void {
    const [message, payload] = buildSyncErrorLog('ReminderStorage', remoteUrl, error);
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
