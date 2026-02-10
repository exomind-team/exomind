/**
 * EventStorage - 事件本地存储
 *
 * 使用 PouchDB 实现事件数据的本地存储
 * 支持添加、获取、删除事件
 */

import PouchDB from 'pouchdb';

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
 * 事件存储类
 *
 * 使用 PouchDB 实现本地数据库存储
 */
export class EventStorage {
  private db: PouchDB.Database<Event>;
  private initialized: boolean = false;

  /**
   * 创建事件存储实例
   *
   * @param userId - 用户 ID，用于隔离不同用户的数据
   */
  constructor(userId: string) {
    const dbName = `events_${userId}`;
    this.db = new PouchDB<Event>(dbName);
    this.initializeDesignDoc();
  }

  /**
   * 初始化设计文档（视图）
   */
  private async initializeDesignDoc(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.db.put({
        _id: '_design/events',
        views: {
          by_created_at: {
            map: `function(doc) {
              if (doc._id.startsWith('event:')) {
                emit(doc.createdAt, doc);
              }
            }`,
          },
          by_id: {
            map: `function(doc) {
              if (doc._id.startsWith('event:')) {
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
    await this.initializeDesignDoc();

    const doc: Event = {
      ...event,
      _id: `event:${event.id}`,
      createdAt: event.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.put(doc);
  }

  /**
   * 获取所有事件
   *
   * @returns 按时间戳降序排列的事件数组
   */
  async getEvents(): Promise<Event[]> {
    await this.initializeDesignDoc();

    const result = await this.db.query<Event>('events/by_created_at', {
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
    await this.initializeDesignDoc();

    const doc = await this.db.get<Event>(`event:${id}`);
    const updatedDoc: Event = {
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
    await this.initializeDesignDoc();

    const events = await this.getEvents();
    for (const event of events) {
      await this.deleteEvent(event.id);
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
   */
  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * 同步到远程数据库
   *
   * @param remoteUrl - 远程数据库 URL
   */
  async sync(remoteUrl: string): Promise<PouchDB.Replication.Sync<Event>> {
    return this.db.sync(remoteUrl, {
      live: true,
      retry: true,
    });
  }
}
