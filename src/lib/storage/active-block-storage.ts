import PouchDB from 'pouchdb';
import type { ActiveBlockData } from '../types/event';

const ACTIVE_BLOCK_DOC_ID = 'current';
const ACTIVE_BLOCK_PREFIX_ENV = 'EXOMIND_ACTIVE_BLOCK_STORAGE_PREFIX';
const DEFAULT_TEST_POUCHDB_PREFIX = '.tmp/pouchdb-active-block/';
const MAX_SAVE_RETRY = 3;

interface ActiveBlockDoc extends ActiveBlockData {
  _id: string;
  _rev?: string;
  _conflicts?: string[];
}

interface ActiveBlockStorageOptions {
  pouchDbPrefix?: string;
}

export type ActiveBlockChangeSource = 'local' | 'sync';
type ActiveBlockChangeListener = (block: ActiveBlockData | null, source: ActiveBlockChangeSource) => void;

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
  private listeners: Set<ActiveBlockChangeListener> = new Set();
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
      let nextBlock = block;
      const doc: ActiveBlockDoc = {
        ...block,
        _id: ACTIVE_BLOCK_DOC_ID,
      };

      try {
        const existing = await this.getResolvedDoc();
        if (existing && existing._rev) {
          doc._rev = existing._rev;
          const existingBlock = this.toActiveBlockData(existing);
          nextBlock = this.pickPreferredBlock(existingBlock, block);
          Object.assign(doc, nextBlock);
        }
      } catch (error: unknown) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }

      try {
        await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);
        this.emitChange(nextBlock, 'local');
        return;
      } catch (error: unknown) {
        if (!this.isConflictError(error) || attempt >= MAX_SAVE_RETRY) {
          throw error;
        }
      }
    }
  }

  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    const doc = await this.getResolvedDoc();
    return doc ? this.toActiveBlockData(doc) : null;
  }

  async deleteActiveBlock(): Promise<void> {
    try {
      const doc = await this.db.get(ACTIVE_BLOCK_DOC_ID);
      await (this.db as unknown as { remove(doc: unknown): Promise<unknown> }).remove(doc);
      this.emitChange(null, 'local');
    } catch (error: unknown) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }
  }

  onBlockChange(callback: ActiveBlockChangeListener): () => void {
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
      doc_ids: [ACTIVE_BLOCK_DOC_ID],
      live: true,
      retry: true,
    });

    this.syncReplication.on('change', (info: unknown) => {
      const direction = this.extractSyncDirection(info);
      // Ignore local push echo; local writes already notify via save/delete paths.
      if (direction && direction !== 'pull') {
        return;
      }
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
      this.emitChange(block, 'sync');
    } catch (error) {
      console.error('[ActiveBlockStorage] publish current block error:', error);
    }
  }

  private emitChange(block: ActiveBlockData | null, source: ActiveBlockChangeSource): void {
    for (const listener of this.listeners) {
      try {
        listener(block, source);
      } catch (error) {
        console.error('[ActiveBlockStorage] listener error:', error);
      }
    }
  }

  private extractSyncDirection(info: unknown): string | null {
    if (!info || typeof info !== 'object' || !('direction' in info)) {
      return null;
    }

    const direction = (info as { direction?: unknown }).direction;
    return typeof direction === 'string' && direction.trim().length > 0 ? direction : null;
  }

  private async getResolvedDoc(): Promise<ActiveBlockDoc | null> {
    let doc: ActiveBlockDoc;
    try {
      doc = await (
        this.db.get(ACTIVE_BLOCK_DOC_ID, { conflicts: true }) as Promise<ActiveBlockDoc>
      );
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }

    const conflicts = Array.isArray(doc._conflicts) ? doc._conflicts : [];
    if (conflicts.length === 0) {
      return doc;
    }

    const candidates: ActiveBlockDoc[] = [doc];
    for (const rev of conflicts) {
      try {
        const conflictDoc = await (
          this.db.get(ACTIVE_BLOCK_DOC_ID, { rev }) as Promise<ActiveBlockDoc>
        );
        candidates.push(conflictDoc);
      } catch (error: unknown) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    let preferred = candidates[0];
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const preferredData = this.toActiveBlockData(preferred);
      const candidateData = this.toActiveBlockData(candidate);
      const picked = this.pickPreferredBlock(preferredData, candidateData);
      if (this.isSameBlockData(picked, candidateData)) {
        preferred = candidate;
      }
    }

    const preferredData = this.toActiveBlockData(preferred);
    const currentData = this.toActiveBlockData(doc);
    if (this.isSameBlockData(preferredData, currentData)) {
      return doc;
    }

    const rewritten: ActiveBlockDoc = {
      ...preferredData,
      _id: ACTIVE_BLOCK_DOC_ID,
      _rev: doc._rev,
    };
    const response = await this.db.put(rewritten as unknown as Parameters<typeof this.db.put>[0]);
    rewritten._rev = response.rev;
    return rewritten;
  }

  private toActiveBlockData(doc: ActiveBlockDoc): ActiveBlockData {
    const { _id, _rev, _conflicts, ...block } = doc;
    return block as ActiveBlockData;
  }

  private getBlockPhase(block: ActiveBlockData): number {
    const phase = block.phase
      ?? (block.feedbackSubmittedAt
        ? 'feedback_submitted'
        : (block.actionEndedAt ? 'action_ended' : (block.paused ? 'paused' : 'running')));
    if (phase === 'feedback_submitted') {
      return 2;
    }
    if (phase === 'action_ended') {
      return 1;
    }
    return 0;
  }

  private getBlockOrderTime(block: ActiveBlockData): number {
    return block.lastTransitionAt
      ?? block.feedbackSubmittedAt
      ?? block.actionEndedAt
      ?? block.pausedAt
      ?? block.lastResumedAt
      ?? block.startTime;
  }

  private pickPreferredBlock(a: ActiveBlockData, b: ActiveBlockData): ActiveBlockData {
    if (a.startId !== b.startId) {
      if (a.startTime !== b.startTime) {
        return b.startTime > a.startTime ? b : a;
      }
      return this.getBlockOrderTime(b) >= this.getBlockOrderTime(a) ? b : a;
    }

    const phaseA = this.getBlockPhase(a);
    const phaseB = this.getBlockPhase(b);
    if (phaseA !== phaseB) {
      return phaseB > phaseA ? b : a;
    }

    const versionA = a.version ?? 0;
    const versionB = b.version ?? 0;
    if (versionA !== versionB) {
      return versionB > versionA ? b : a;
    }

    const actorA = a.actorId ?? '';
    const actorB = b.actorId ?? '';
    if (actorA !== actorB) {
      return actorB > actorA ? b : a;
    }

    return this.getBlockOrderTime(b) >= this.getBlockOrderTime(a) ? b : a;
  }

  private isSameBlockData(a: ActiveBlockData, b: ActiveBlockData): boolean {
    return a.startId === b.startId
      && a.name === b.name
      && a.mode === b.mode
      && a.targetMinutes === b.targetMinutes
      && a.startTime === b.startTime
      && a.phase === b.phase
      && a.version === b.version
      && a.actorId === b.actorId
      && a.lastTransitionAt === b.lastTransitionAt
      && a.lastResumedAt === b.lastResumedAt
      && a.accumulatedRunMs === b.accumulatedRunMs
      && a.actionEndedAt === b.actionEndedAt
      && a.feedbackStartedAt === b.feedbackStartedAt
      && a.feedbackSubmittedAt === b.feedbackSubmittedAt
      && a.pauseAccumulatedMs === b.pauseAccumulatedMs
      && a.paused === b.paused
      && a.pausedAt === b.pausedAt;
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
