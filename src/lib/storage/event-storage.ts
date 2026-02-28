/**
 * EventStorage - 事件本地存储
 *
 * 使用 PouchDB 实现事件数据的本地存储
 * 支持添加、获取、删除事件
 */

// 使用默认导入
import PouchDB from 'pouchdb';

const POUCHDB_PREFIX_ENV = 'EXOMIND_EVENT_STORAGE_PREFIX';
const DEFAULT_TEST_POUCHDB_PREFIX = '.tmp/pouchdb-event-storage/';

/**
 * 事件接口
 */
export interface Event {
  id: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface EventPageCursor {
  createdAt: string;
  id: string;
}

export interface EventPageOptions {
  limit?: number;
  cursor?: EventPageCursor | null;
}

export interface EventPageResult {
  events: Event[];
  nextCursor: EventPageCursor | null;
  hasMore: boolean;
}

/**
 * 内部事件文档接口（包含 PouchDB 字段）
 */
interface EventDoc extends Event {
  _id: string;
  _rev?: string;
}

const BY_CREATED_AT_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('event:')) {
    emit([doc.createdAt, doc._id], null);
  }
}`;

const BY_ID_MAP = `function(doc) {
  if (doc._id && doc._id.startsWith('event:')) {
    emit(doc._id, doc);
  }
}`;

interface EventStorageOptions {
  /**
   * Optional PouchDB prefix override（可选：覆盖 PouchDB 落盘前缀）
   */
  pouchDbPrefix?: string;
}

function normalizePouchDbPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return DEFAULT_TEST_POUCHDB_PREFIX;
  }
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function readNodeEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
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

  // Vitest in Node runtime writes LevelDB files; isolate under .tmp to avoid root pollution.
  if (readNodeEnv('VITEST') || readNodeEnv('VITEST_WORKER_ID') || readNodeEnv('NODE_ENV') === 'test') {
    return DEFAULT_TEST_POUCHDB_PREFIX;
  }

  return undefined;
}

// 单例缓存
const storageInstances: Map<string, EventStorage> = new Map();

function buildStorageCacheKey(userId: string, prefix?: string): string {
  return `${prefix ?? ''}::${userId}`;
}

/**
 * 获取当前用户 ID（与 ChatPage 保持一致）
 */
export function getCurrentUserId(): string {
  // 尝试从 localStorage 读取 sync-store 中的 currentUser
  try {
    const syncStoreData = localStorage.getItem('exomind:sync-store');
    if (syncStoreData) {
      const parsed = JSON.parse(syncStoreData);
      // Zustand persist 会将状态包装在 state 对象中
      if (parsed.state && parsed.state.currentUser) {
        return parsed.state.currentUser;
      }
      // 直接存储的情况
      if (parsed.currentUser) {
        return parsed.currentUser;
      }
    }
  } catch {
    // 忽略解析错误
  }
  return 'anonymous';
}

/**
 * 获取共享的 EventStorage 实例
 *
 * 使用单例模式，确保 ChatPage 和 TimeBlockService 使用同一个实例
 * 避免数据库连接关闭导致的问题
 *
 * @param userId - 用户 ID，如果不提供则使用当前用户 ID
 */
export function getEventStorage(userId?: string): EventStorage {
  const id = userId || getCurrentUserId();
  const prefix = resolvePouchDbPrefix();
  const cacheKey = buildStorageCacheKey(id, prefix);

  if (!storageInstances.has(cacheKey)) {
    storageInstances.set(cacheKey, new EventStorage(id, { pouchDbPrefix: prefix }));
  }

  return storageInstances.get(cacheKey)!;
}

/**
 * 清空所有 EventStorage 实例
 * 主要用于测试
 */
export function clearAllStorageInstances(): void {
  storageInstances.clear();
}

/**
 * 事件存储类
 *
 * 使用 PouchDB 实现事件数据的本地存储
 */
export class EventStorage {
  private db: PouchDB.Database<Event>;
  private initialized: boolean = false;
  private syncReplication: PouchDB.Replication.Sync<Event> | null = null;
  private changeListeners: Array<(change: unknown) => void> = [];

  /**
   * 创建事件存储实例
   *
   * @param userId - 用户 ID，用于隔离不同用户的数据
   */
  constructor(userId: string, options: EventStorageOptions = {}) {
    const dbName = `events_${userId}`;
    const prefix = resolvePouchDbPrefix(options.pouchDbPrefix);
    this.db = prefix
      ? new PouchDB<Event>(dbName, { prefix })
      : new PouchDB<Event>(dbName);
    this.initializeDesignDoc();
  }

  /**
   * 初始化设计文档（视图）
   */
  private async initializeDesignDoc(): Promise<void> {
    if (this.initialized) return;

    const designDoc = {
      _id: '_design/events',
      views: {
        by_created_at: {
          map: BY_CREATED_AT_MAP,
        },
        by_id: {
          map: BY_ID_MAP,
        },
      },
    };

    try {
      await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put(designDoc);
      this.initialized = true;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 409) {
        try {
          const existingDoc = await this.db.get<{
            _rev: string;
            views?: {
              by_created_at?: { map?: string };
              by_id?: { map?: string };
            };
          }>('_design/events');

          const hasLatestMap =
            existingDoc.views?.by_created_at?.map === BY_CREATED_AT_MAP &&
            existingDoc.views?.by_id?.map === BY_ID_MAP;

          if (!hasLatestMap) {
            await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put({
              ...designDoc,
              _rev: existingDoc._rev,
            });
          }

          this.initialized = true;
        } catch (updateError) {
          console.warn('更新设计文档失败:', updateError);
        }
      } else {
        console.warn('创建设计文档失败:', error);
      }
    }
  }

  /**
   * 添加事件
   *
   * @param event - 事件数据
   */
  async addEvent(event: Event): Promise<void> {
    await this.initializeDesignDoc();

    const doc: EventDoc = {
      ...event,
      _id: `event:${event.id}`,
      createdAt: event.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);

    // 触发本地变更通知
    this.notifyChangeListeners({ type: 'local', doc });
  }

  /**
   * 获取所有事件
   *
   * @returns 按时间戳降序排列的事件数组
   */
  async getEvents(): Promise<Event[]> {
    await this.initializeDesignDoc();

    const result = await this.db.query<EventDoc>('events/by_created_at', {
      include_docs: true,
      descending: true,
    });

    return result.rows.filter((row) => row.doc).map((row) => this.toEvent(row.doc!));
  }

  /**
   * 分页获取事件（按时间倒序，最新在前）
   */
  async getEventsPage(options: EventPageOptions = {}): Promise<EventPageResult> {
    await this.initializeDesignDoc();

    const limit = Math.max(1, options.limit ?? 50);
    const queryOptions: Record<string, unknown> = {
      include_docs: true,
      descending: true,
      limit: limit + 1,
    };

    if (options.cursor) {
      queryOptions.startkey = [options.cursor.createdAt, `event:${options.cursor.id}`];
      queryOptions.skip = 1;
    }

    const result = await this.db.query<EventDoc>(
      'events/by_created_at',
      queryOptions as Parameters<typeof this.db.query<EventDoc>>[1]
    );

    const docs = result.rows.filter((row) => row.doc).map((row) => row.doc!);
    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    const events = pageDocs.map((doc) => this.toEvent(doc));

    const lastEvent = events[events.length - 1];
    const nextCursor = hasMore && lastEvent
      ? {
          createdAt: lastEvent.createdAt,
          id: lastEvent.id,
        }
      : null;

    return {
      events,
      nextCursor,
      hasMore,
    };
  }

  /**
   * 获取单个事件
   *
   * @param id - 事件 ID
   * @returns 事件数据，不存在返回 undefined
   */
  async getEvent(id: string): Promise<Event | undefined> {
    await this.initializeDesignDoc();

    try {
      const doc = await this.db.get<Event>(`event:${id}`);
      const { _id, _rev, _conflicts, ...event } = doc;
      return event as Event;
    } catch {
      return undefined;
    }
  }

  /**
   * 删除事件
   *
   * @param id - 事件 ID
   */
  async deleteEvent(id: string): Promise<void> {
    await this.initializeDesignDoc();

    try {
      const doc = await this.db.get<Event>(`event:${id}`);
      // 使用 any 绕过 PouchDB 类型限制
      await (this.db as unknown as { remove(doc: unknown): Promise<unknown> }).remove(doc);
    } catch {
      // 事件不存在，忽略错误
    }
  }

  /**
   * 更新事件
   *
   * @param id - 事件 ID
   * @param updates - 要更新的字段
   */
  async updateEvent(id: string, updates: Partial<Event>): Promise<void> {
    await this.initializeDesignDoc();

    const doc = await this.db.get<Event>(`event:${id}`);
    const updatedDoc: EventDoc = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.db.put(updatedDoc as unknown as Parameters<typeof this.db.put>[0]);
  }

  /**
   * 清空所有事件
   */
  async clearAll(): Promise<void> {
    await this.initializeDesignDoc();

    // 使用 allDocs 获取所有带 _rev 的文档
    const result = await this.db.allDocs({ include_docs: true });
    const docsToDelete = result.rows
      .filter((row) => row.id && row.id.startsWith('event:'))
      .map((row) => ({
        _id: row.id,
        _rev: row.value?.rev,
        _deleted: true,
      }));

    if (docsToDelete.length > 0) {
      await this.db.bulkDocs(docsToDelete as unknown as Parameters<typeof this.db.bulkDocs>[0]);
    }
  }

  /**
   * 获取事件数量
   */
  async count(): Promise<number> {
    await this.initializeDesignDoc();

    const result = await this.db.query<Event>('events/by_created_at');
    return result.rows.length;
  }

  /**
   * 关闭数据库连接
   * 注意：关闭后单例会被移除，下次 getEventStorage() 会创建新实例
   */
  async close(): Promise<void> {
    await this.db.close();
    // 从单例缓存中移除
    for (const [key, instance] of storageInstances.entries()) {
      if (instance === this) {
        storageInstances.delete(key);
        break;
      }
    }
  }

  /**
   * 同步到远程数据库
   *
   * @param remoteUrl - 远程数据库 URL（格式: http://host:port/<db-name>）
   * @returns 复制对象
   */
  async syncToRemote(remoteUrl: string): Promise<PouchDB.Replication.Sync<Event>> {
    // 停止之前的同步
    if (this.syncReplication) {
      this.syncReplication.cancel();
    }

    // 启动新的同步
    this.syncReplication = this.db.sync(remoteUrl, {
      live: true,
      retry: true,
    });

    // 监听变更事件
    this.syncReplication.on('change', (change: unknown) => {
      this.notifyChangeListeners(change);
    });

    this.syncReplication.on('error', (error: unknown) => {
      console.error('同步错误:', error);
    });

    return this.syncReplication;
  }

  /**
   * 停止同步
   */
  async stopSync(): Promise<void> {
    if (this.syncReplication) {
      this.syncReplication.cancel();
      this.syncReplication = null;
    }
  }

  /**
   * 监听远程变更
   *
   * @param callback - 回调函数
   * @returns 取消监听函数
   */
  onRemoteChange(callback: (change: unknown) => void): () => void {
    this.changeListeners.push(callback);

    // 返回取消监听函数
    return () => {
      const index = this.changeListeners.indexOf(callback);
      if (index > -1) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知所有变更监听器
   */
  private notifyChangeListeners(change: unknown): void {
    for (const listener of this.changeListeners) {
      try {
        listener(change);
      } catch {
        console.error('变更监听器执行错误');
      }
    }
  }

  /**
   * 获取当前同步状态
   */
  getSyncStatus(): { active: boolean; paused: boolean; error: unknown } {
    return {
      active: this.syncReplication !== null,
      paused: false,
      error: null,
    };
  }

  private toEvent(doc: EventDoc): Event {
    const event = { ...doc } as Record<string, unknown>;
    delete event._id;
    delete event._rev;
    delete event._conflicts;
    return event as unknown as Event;
  }
}
