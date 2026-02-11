/**
 * EventStorage - 事件本地存储
 *
 * 使用 PouchDB 实现事件数据的本地存储
 * 支持添加、获取、删除事件
 *
 * 注意：PouchDB 通过 vite.config.ts 注入的全局 UMD 构建访问
 */

// PouchDB 全局变量（由 vite.config.ts 中的 pouchdbInject 插件注入）
declare const PouchDB: any;

// 单例实例缓存
let singletonInstance: EventStorage | null = null;

/**
 * 获取 EventStorage 单例实例
 *
 * @param userId - 用户 ID，用于隔离不同用户的数据
 * @returns EventStorage 实例
 */
export async function getEventStorage(userId: string): Promise<EventStorage> {
  if (!singletonInstance || singletonInstance.userId !== userId) {
    singletonInstance = new EventStorage(userId);
  }
  return singletonInstance;
}

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

/**
 * 内部事件文档接口（包含 PouchDB 字段）
 */
interface EventDoc extends Event {
  _id: string;
  _rev?: string;
}

// 单例缓存
const storageInstances: Map<string, EventStorage> = new Map();

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

  if (!storageInstances.has(id)) {
    storageInstances.set(id, new EventStorage(id));
  }

  return storageInstances.get(id)!;
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
 * 使用动态导入 PouchDB UMD 构建以避免浏览器兼容性问题
 */
export class EventStorage {
  private db: any = null;
  private initialized: boolean = false;
  private syncReplication: any = null;
  private changeListeners: Array<(change: unknown) => void> = [];
  private pouchdbConstructor: any = null;

  /**
   * 创建事件存储实例
   *
   * @param userId - 用户 ID，用于隔离不同用户的数据
   */
  constructor(userId: string) {
    // 延迟初始化，不在构造函数中创建数据库
    this.userId = userId;
  }

  /**
   * 用户 ID（公开用于单例比较）
   */
  userId: string = '';

  /**
   * 初始化数据库连接
   */
  private async initDb(): Promise<void> {
    if (this.db) return;

    // 使用全局的 PouchDB（由 vite.config.ts 注入的 UMD 构建）
    this.pouchdbConstructor = PouchDB;

    const dbName = `events_${this.userId}`;
    this.db = new this.pouchdbConstructor(dbName);
    await this.initializeDesignDoc();
  }

  /**
   * 初始化设计文档（视图）
   */
  private async initializeDesignDoc(): Promise<void> {
    if (this.initialized || !this.db) return;

    try {
      await (this.db as unknown as { put(doc: unknown): Promise<unknown> }).put({
        _id: '_design/events',
        views: {
          by_created_at: {
            map: `function(doc) {
              if (doc._id && doc._id.startsWith('event:')) {
                emit(doc.createdAt, doc);
              }
            }`,
          },
          by_id: {
            map: `function(doc) {
              if (doc._id && doc._id.startsWith('event:')) {
                emit(doc._id, doc);
              }
            }`,
          },
        },
      });
      this.initialized = true;
    } catch (error: unknown) {
      // 409 表示文档已存在，这是正常情况
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 409) {
        this.initialized = true;
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
    await this.initDb();
    if (!this.db) return;

    const doc: EventDoc = {
      ...event,
      _id: `event:${event.id}`,
      createdAt: event.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.put(doc);

    // 触发本地变更通知
    this.notifyChangeListeners({ type: 'local', doc });
  }

  /**
   * 获取所有事件
   *
   * @returns 按时间戳降序排列的事件数组
   */
  async getEvents(): Promise<Event[]> {
    await this.initDb();
    if (!this.db) return [];

    const result = await this.db.query<EventDoc>('events/by_created_at', {
      include_docs: true,
      descending: true,
    });

    return result.rows
      .filter((row) => row.doc)
      .map((row) => {
        const doc = row.doc!;
        // 移除内部字段
        const { _id, _rev, _conflicts, ...event } = doc;
        return event as Event;
      });
  }

  /**
   * 获取单个事件
   *
   * @param id - 事件 ID
   * @returns 事件数据，不存在返回 undefined
   */
  async getEvent(id: string): Promise<Event | undefined> {
    await this.initDb();
    if (!this.db) return undefined;

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
    await this.initDb();
    if (!this.db) return;

    try {
      const doc = await this.db.get<Event>(`event:${id}`);
      await this.db.remove(doc);
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
    await this.initDb();
    if (!this.db) return;

    const doc = await this.db.get<Event>(`event:${id}`);
    const updatedDoc: EventDoc = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.db.put(updatedDoc);
  }

  /**
   * 清空所有事件
   */
  async clearAll(): Promise<void> {
    await this.initDb();
    if (!this.db) return;

    // 使用 allDocs 获取所有带 _rev 的文档
    const result = await this.db.allDocs({ include_docs: true });
    const docsToDelete = result.rows
      .filter((row: any) => row.id && row.id.startsWith('event:'))
      .map((row: any) => ({
        _id: row.id,
        _rev: row.value?.rev,
        _deleted: true,
      }));

    if (docsToDelete.length > 0) {
      await this.db.bulkDocs(docsToDelete);
    }
  }

  /**
   * 获取事件数量
   */
  async count(): Promise<number> {
    await this.initDb();
    if (!this.db) return 0;

    const result = await this.db.query<Event>('events/by_created_at');
    return result.rows.length;
  }

  /**
   * 关闭数据库连接
   * 注意：关闭后单例会被移除，下次 getEventStorage() 会创建新实例
   */
  async close(): Promise<void> {
  async close(): Promise<void> {
    if (!this.db) return;

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
   * @param remoteUrl - 远程数据库 URL（格式: http://host:port/database）
   * @returns 复制对象
   */
  async syncToRemote(remoteUrl: string): Promise<unknown> {
    await this.initDb();
    if (!this.db) throw new Error('数据库未初始化');

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
}
