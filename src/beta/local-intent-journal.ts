import { BetaApiError } from './api-error';

export interface LocalIntentJournal {
  read(key: string): Promise<string | null>;
  write(key: string, raw: string): Promise<void>;
  close?(): void;
}
export interface IntentPersistenceState { state: 'idle' | 'pending' | 'failed'; error: string | null }
export interface DurableIntentStorage extends Pick<Storage, 'getItem' | 'setItem'> {
  readonly durable: true;
  commit(): Promise<void>;
  snapshot(): IntentPersistenceState;
  subscribe(listener: () => void): () => void;
  close(): void;
}
const DATABASE = 'exomind-beta-local-intents';
const STORE = 'intents';
const OPERATION_TIMEOUT_MS = 10_000;
const inactive = () => new BetaApiError('inactive_session', '本机草稿窗口已关闭');
const failed = () => new BetaApiError('intent_commit_failed', '本机草稿暂存未确认，尚未发送；请保留窗口并重试');

/** A private, origin-local JSON journal. Success means strict transaction
 * complete, not request success or an in-memory getter. It never calls RT. */
export class IndexedDbLocalIntentJournal implements LocalIntentJournal {
  private database: Promise<IDBDatabase> | undefined;
  private closed = false;
  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(inactive());
    if (this.database) return this.database;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        const factory = globalThis.indexedDB;
        if (!factory) { reject(new BetaApiError('intent_store_unavailable', '当前环境不支持持久草稿，尚未启用发送')); return; }
        request = factory.open(DATABASE, 1);
      } catch { reject(new BetaApiError('intent_store_unavailable', '无法打开本机草稿库，请保留窗口后重试')); return; }
      let settled = false;
      const finishError = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        reject(new BetaApiError('intent_store_unavailable', '无法打开本机草稿库，请保留窗口后重试'));
      };
      const timer = setTimeout(finishError, OPERATION_TIMEOUT_MS);
      request.onupgradeneeded = () => {
        if (settled || this.closed) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = finishError; request.onblocked = finishError;
      request.onsuccess = () => {
        const database = request.result;
        if (settled || this.closed) { database.close(); if (!settled) { settled = true; clearTimeout(timer); reject(inactive()); } return; }
        settled = true; clearTimeout(timer);
        if (!database.objectStoreNames.contains(STORE)) { database.close(); reject(new BetaApiError('intent_cache_corrupt', '本机草稿库结构不匹配，已停止写入')); return; }
        database.onversionchange = () => { database.close(); if (this.database === opening) this.database = undefined; };
        database.onclose = () => { if (this.database === opening) this.database = undefined; };
        resolve(database);
      };
    });
    this.database = opening;
    void opening.catch(() => { if (this.database === opening) this.database = undefined; });
    return opening;
  }
  private async transaction(key: string, raw?: string): Promise<string | null | void> {
    const database = await this.open(); if (this.closed) throw inactive();
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction | undefined; let value: string | null | void = undefined; let requestSucceeded = false; let settled = false;
      const rejectOnce = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => {
        rejectOnce(new BetaApiError('intent_commit_unknown', '本机草稿事务未及时确认，尚未发送；请重试或重新打开查证'));
        try { transaction?.abort(); } catch { /* Committing may no longer be abortable; no acknowledgement is invented. */ }
      }, OPERATION_TIMEOUT_MS);
      try {
        transaction = raw === undefined ? database.transaction(STORE, 'readonly') : database.transaction(STORE, 'readwrite', { durability: 'strict' });
        if (raw !== undefined && transaction.durability !== 'strict') {
          transaction.abort(); rejectOnce(new BetaApiError('intent_durability_unavailable', '当前环境不能确认 strict 草稿事务，尚未启用发送')); return;
        }
        transaction.oncomplete = () => {
          if (settled) return;
          if (!requestSucceeded) { rejectOnce(failed()); return; }
          settled = true; clearTimeout(timer); resolve(value);
        };
        transaction.onerror = () => rejectOnce(failed()); transaction.onabort = () => rejectOnce(failed());
        const store = transaction.objectStore(STORE);
        const request = raw === undefined ? store.get(key) : store.put(raw, key);
        request.onsuccess = () => {
          if (raw === undefined) {
            if (request.result !== undefined && typeof request.result !== 'string') {
              rejectOnce(new BetaApiError('intent_cache_corrupt', '本机草稿内容无法识别，已保留原值')); try { transaction?.abort(); } catch {} return;
            }
            value = request.result ?? null;
          }
          requestSucceeded = true;
        };
      } catch (error) { rejectOnce(error instanceof BetaApiError ? error : failed()); try { transaction?.abort(); } catch {} }
    });
  }
  async read(key: string): Promise<string | null> { return await this.transaction(key) as string | null; }
  async write(key: string, raw: string): Promise<void> { await this.transaction(key, raw); }
  close(): void { this.closed = true; void this.database?.then(database => database.close()).catch(() => {}); }
}

interface CommitWaiter { target: number; resolve(): void; reject(error: unknown): void }
/** One bound key, one in-flight transaction and one latest snapshot. Never
 * replay a stale whole-state snapshot after a newer setItem was accepted. */
class JournalStorage implements DurableIntentStorage {
  readonly durable = true as const;
  private raw: string | null;
  private sequence = 0;
  private committed = 0;
  private status: IntentPersistenceState = { state: 'idle', error: null };
  private readonly listeners = new Set<() => void>();
  private waiters: CommitWaiter[] = [];
  private operation: Promise<void> | undefined;
  private closed = false;
  private journalClosed = false;
  constructor(private readonly key: string, private readonly journal: LocalIntentJournal, private readonly ownsJournal: boolean,
    private readonly validate: (raw: string) => void, raw: string | null) { this.raw = raw; }
  snapshot = (): IntentPersistenceState => this.status;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(state: IntentPersistenceState['state'], error: string | null = null): void {
    this.status = { state, error };
    for (const listener of this.listeners) { try { listener(); } catch { console.error('Local intent persistence subscriber failed'); } }
  }
  private scope(key: string): void { if (key !== this.key) throw new BetaApiError('intent_scope_mismatch', '草稿存储作用域不匹配'); }
  getItem(key: string): string | null { this.scope(key); return this.raw; }
  setItem(key: string, raw: string): void {
    this.scope(key); if (this.closed) throw inactive(); this.validate(raw);
    this.raw = raw; ++this.sequence;
    if (this.status.state !== 'failed') { this.emit('pending'); this.start(); }
  }
  private start(): void {
    if (this.operation || this.status.state === 'failed' || this.committed >= this.sequence) return;
    const operation = this.pump(); this.operation = operation;
    void operation.finally(() => {
      if (this.operation === operation) this.operation = undefined;
      if (this.status.state !== 'failed' && this.committed < this.sequence) this.start();
      this.closeJournalIfIdle();
    }).catch(() => {});
  }
  private async pump(): Promise<void> {
    while (this.committed < this.sequence && this.status.state !== 'failed') {
      const target = this.sequence; const raw = this.raw!;
      try { await this.journal.write(this.key, raw); }
      catch {
        const waiters = this.waiters.splice(0);
        this.emit('failed', '本机草稿暂存未确认，请保留窗口并重试；尚未确认的提交不会发送');
        waiters.forEach(waiter => waiter.reject(failed())); return;
      }
      this.committed = target;
      const completed = this.waiters.filter(waiter => waiter.target <= target); this.waiters = this.waiters.filter(waiter => waiter.target > target);
      completed.forEach(waiter => waiter.resolve());
      this.emit(this.committed === this.sequence ? 'idle' : 'pending');
    }
  }
  commit(): Promise<void> {
    if (this.closed) return Promise.reject(inactive());
    if (this.committed >= this.sequence) return Promise.resolve();
    const target = this.sequence;
    if (this.status.state === 'failed') this.emit('pending');
    const waiting = new Promise<void>((resolve, reject) => { this.waiters.push({ target, resolve, reject }); });
    this.start(); return waiting;
  }
  private closeJournalIfIdle(): void {
    if (this.closed && !this.operation && !this.journalClosed) { this.journalClosed = true; if (this.ownsJournal) this.journal.close?.(); }
  }
  close(): void { this.closed = true; this.listeners.clear(); this.closeJournalIfIdle(); }
}

export async function openDurableIntentStorage(options: {
  key: string; journal?: LocalIntentJournal; legacy?: Pick<Storage, 'getItem'>; validate(raw: string): void;
}): Promise<DurableIntentStorage> {
  const journal = options.journal ?? new IndexedDbLocalIntentJournal(); const ownsJournal = !options.journal;
  try {
    // A read error/corrupt value is not absence and never authorizes an empty
    // fallback or reimport of an older localStorage snapshot.
    let raw: string | null;
    try { raw = await journal.read(options.key); }
    catch (error) { if (error instanceof BetaApiError) throw error; throw new BetaApiError('intent_store_unavailable', '无法读取本机草稿库，已停止恢复和发送'); }
    const validate = (value: string) => {
      try { options.validate(value); }
      catch { throw new BetaApiError('intent_cache_corrupt', '本机草稿内容无法识别，已保留原缓存并停止写入'); }
    };
    if (raw !== null) validate(raw);
    else {
      let legacy: string | null;
      try { legacy = options.legacy?.getItem(options.key) ?? null; }
      catch { throw new BetaApiError('intent_legacy_unavailable', '旧草稿缓存无法读取，尚未建立新缓存或启用发送'); }
      if (legacy !== null) {
        validate(legacy);
        try { await journal.write(options.key, legacy); }
        catch { throw new BetaApiError('intent_migration_failed', '旧草稿迁移尚未确认，已保留原缓存并停止发送'); }
        raw = legacy;
      }
    }
    return new JournalStorage(options.key, journal, ownsJournal, validate, raw);
  } catch (error) { if (ownsJournal) journal.close?.(); throw error; }
}
