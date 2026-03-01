import PouchDB from 'pouchdb';
import type { ActiveBlockData } from '../types/event';

const ACTIVE_BLOCK_DOC_ID = 'current';
const ACTIVE_BLOCK_PREFIX_ENV = 'EXOMIND_ACTIVE_BLOCK_STORAGE_PREFIX';
const DEFAULT_TEST_POUCHDB_PREFIX = '.tmp/pouchdb-active-block/';
const MAX_SAVE_RETRY = 3;

interface ActiveBlockDoc extends ActiveBlockData {
  _id: string;
  _rev?: string;
}

interface ActiveBlockStorageOptions {
  pouchDbPrefix?: string;
}

const storageInstances: Map<string, ActiveBlockStorage> = new Map();

function readNodeEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
  return process.env[name];
}

function normalizePouchDbPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return DEFAULT_TEST_POUCHDB_PREFIX;
  }

  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function resolvePouchDbPrefix(explicitPrefix?: string): string | undefined {
  if (typeof explicitPrefix === 'string' && explicitPrefix.trim().length > 0) {
    return normalizePouchDbPrefix(explicitPrefix);
  }

  const envPrefix = readNodeEnv(ACTIVE_BLOCK_PREFIX_ENV);
  if (typeof envPrefix === 'string' && envPrefix.trim().length > 0) {
    return normalizePouchDbPrefix(envPrefix);
  }

  if (readNodeEnv('VITEST') || readNodeEnv('VITEST_WORKER_ID') || readNodeEnv('NODE_ENV') === 'test') {
    return DEFAULT_TEST_POUCHDB_PREFIX;
  }

  return undefined;
}

function toSafeStorageValue(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getCurrentSyncUserId(): string {
  if (typeof localStorage === 'undefined') {
    return 'anonymous';
  }

  try {
    const syncStoreData = localStorage.getItem('exomind:sync-store');
    if (!syncStoreData) {
      return 'anonymous';
    }

    const parsed = JSON.parse(syncStoreData) as {
      state?: { currentUser?: string };
      currentUser?: string;
    };

    const stateUser = toSafeStorageValue(parsed.state?.currentUser);
    if (stateUser) {
      return stateUser;
    }

    const directUser = toSafeStorageValue(parsed.currentUser);
    if (directUser) {
      return directUser;
    }
  } catch {
    // ignore malformed local data
  }

  return 'anonymous';
}

export function normalizeActiveBlockDbName(userId: string): string {
  const normalized = userId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_$()+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const safeUserId = normalized.length > 0 ? normalized : 'anonymous';
  return `active_blocks_${safeUserId}`;
}

function buildStorageCacheKey(userId: string, prefix?: string): string {
  return `${prefix ?? ''}::${normalizeActiveBlockDbName(userId)}`;
}

export function getActiveBlockStorage(userId?: string): ActiveBlockStorage {
  const id = userId || getCurrentSyncUserId();
  const prefix = resolvePouchDbPrefix();
  const cacheKey = buildStorageCacheKey(id, prefix);

  if (!storageInstances.has(cacheKey)) {
    storageInstances.set(cacheKey, new ActiveBlockStorage(id, { pouchDbPrefix: prefix }));
  }

  return storageInstances.get(cacheKey)!;
}

export async function clearAllActiveBlockStorageInstances(): Promise<void> {
  const instances = Array.from(storageInstances.values());
  storageInstances.clear();
  await Promise.allSettled(instances.map((instance) => instance.close()));
}

export class ActiveBlockStorage {
  private readonly db: PouchDB.Database<ActiveBlockDoc>;
  private syncReplication: PouchDB.Replication.Sync<ActiveBlockDoc> | null = null;
  private listeners: Set<(block: ActiveBlockData | null) => void> = new Set();
  private lastSyncError: unknown = null;

  constructor(userId: string, options: ActiveBlockStorageOptions = {}) {
    const dbName = normalizeActiveBlockDbName(userId);
    const prefix = resolvePouchDbPrefix(options.pouchDbPrefix);

    this.db = prefix
      ? new PouchDB<ActiveBlockDoc>(dbName, { prefix })
      : new PouchDB<ActiveBlockDoc>(dbName);
  }

  async saveActiveBlock(block: ActiveBlockData): Promise<void> {
    let attempt = 0;

    while (attempt < MAX_SAVE_RETRY) {
      attempt += 1;
      const doc: ActiveBlockDoc = {
        ...block,
        _id: ACTIVE_BLOCK_DOC_ID,
      };

      try {
        const existing = await this.db.get(ACTIVE_BLOCK_DOC_ID);
        doc._rev = existing._rev;
      } catch (error: unknown) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }

      try {
        await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);
        this.emitChange(block);
        return;
      } catch (error: unknown) {
        if (!this.isConflictError(error) || attempt >= MAX_SAVE_RETRY) {
          throw error;
        }
      }
    }
  }

  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    try {
      const doc = await this.db.get(ACTIVE_BLOCK_DOC_ID);
      const { _id, _rev, ...block } = doc;
      return block as ActiveBlockData;
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async deleteActiveBlock(): Promise<void> {
    try {
      const doc = await this.db.get(ACTIVE_BLOCK_DOC_ID);
      await (this.db as unknown as { remove(doc: unknown): Promise<unknown> }).remove(doc);
      this.emitChange(null);
    } catch (error: unknown) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }
  }

  onBlockChange(callback: (block: ActiveBlockData | null) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async syncToRemote(remoteUrl: string): Promise<PouchDB.Replication.Sync<ActiveBlockDoc>> {
    if (this.syncReplication) {
      this.syncReplication.cancel();
    }

    this.syncReplication = this.db.sync(remoteUrl, {
      live: true,
      retry: true,
    });

    this.syncReplication.on('change', () => {
      void this.publishCurrentBlock();
    });

    this.syncReplication.on('error', (error: unknown) => {
      this.lastSyncError = error;
      console.error('[ActiveBlockStorage] sync error:', error);
    });

    return this.syncReplication;
  }

  async stopSync(): Promise<void> {
    if (!this.syncReplication) {
      return;
    }
    this.syncReplication.cancel();
    this.syncReplication = null;
  }

  getSyncStatus(): { active: boolean; paused: boolean; error: unknown } {
    return {
      active: this.syncReplication !== null,
      paused: false,
      error: this.lastSyncError,
    };
  }

  async close(): Promise<void> {
    await this.stopSync();
    await this.db.close();

    for (const [key, instance] of storageInstances.entries()) {
      if (instance === this) {
        storageInstances.delete(key);
      }
    }
  }

  private async publishCurrentBlock(): Promise<void> {
    try {
      const block = await this.loadActiveBlock();
      this.emitChange(block);
    } catch (error) {
      console.error('[ActiveBlockStorage] publish current block error:', error);
    }
  }

  private emitChange(block: ActiveBlockData | null): void {
    for (const listener of this.listeners) {
      try {
        listener(block);
      } catch (error) {
        console.error('[ActiveBlockStorage] listener error:', error);
      }
    }
  }

  private isNotFoundError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 404
    );
  }

  private isConflictError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 409
    );
  }
}
