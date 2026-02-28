/**
 * ActiveBlockStorage - 活跃时间块同步存储
 *
 * 使用 PouchDB 实现活跃时间块的实时同步
 * 支持本地存储、远程同步、变更监听
 */

import PouchDB from 'pouchdb';
import type { ActiveBlockData } from '../types/event';

/**
 * 内部文档接口（包含 PouchDB 字段）
 */
interface ActiveBlockDoc extends ActiveBlockData {
  _id: string;
  _rev?: string;
}

// 固定文档 ID
const ACTIVE_BLOCK_DOC_ID = 'current';

// 单例缓存
const storageInstances: Map<string, ActiveBlockStorage> = new Map();

/**
 * 获取当前用户 ID（与 EventStorage 保持一致）
 */
export function getCurrentUserId(): string {
  try {
    const syncStoreData = localStorage.getItem('exomind:sync-store');
    if (syncStoreData) {
      const parsed = JSON.parse(syncStoreData);
      if (parsed.state && parsed.state.currentUser) {
        return parsed.state.currentUser;
      }
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
 * 获取共享的 ActiveBlockStorage 实例
 *
 * 使用单例模式，确保全局使用同一个实例
 *
 * @param userId - 用户 ID，如果不提供则使用当前用户 ID
 */
export function getActiveBlockStorage(userId?: string): ActiveBlockStorage {
  const id = userId || getCurrentUserId();

  if (!storageInstances.has(id)) {
    storageInstances.set(id, new ActiveBlockStorage(id));
  }

  return storageInstances.get(id)!;
}

/**
 * 清空所有 ActiveBlockStorage 实例
 * 主要用于测试
 */
export function clearAllStorageInstances(): void {
  storageInstances.clear();
}

/**
 * 活跃时间块存储类
 *
 * 使用 PouchDB 实现活跃时间块的本地存储和实时同步
 */
export class ActiveBlockStorage {
  private db: PouchDB.Database<ActiveBlockData>;
  private syncReplication: PouchDB.Replication.Sync<ActiveBlockData> | null = null;
  private changeListeners: Array<(block: ActiveBlockData | null) => void> = [];

  /**
   * 创建活跃时间块存储实例
   *
   * @param userId - 用户 ID，用于隔离不同用户的数据
   */
  constructor(userId: string) {
    const dbName = `active_blocks_${userId}`;
    this.db = new PouchDB<ActiveBlockData>(dbName);
  }

  /**
   * 保存活跃时间块
   *
   * @param block - 活跃时间块数据
   */
  async saveActiveBlock(block: ActiveBlockData): Promise<void> {
    const doc: ActiveBlockDoc = {
      ...block,
      _id: ACTIVE_BLOCK_DOC_ID,
    };

    try {
      // 尝试获取现有文档以获取 _rev
      const existing = await this.db.get<ActiveBlockData>(ACTIVE_BLOCK_DOC_ID);
      doc._rev = existing._rev;
    } catch {
      // 文档不存在，首次创建
    }

    await this.db.put(doc as unknown as Parameters<typeof this.db.put>[0]);

    // 触发本地变更通知
    this.notifyChangeListeners(block);
  }

  /**
   * 加载活跃时间块
   *
   * @returns 活跃时间块数据，不存在返回 null
   */
  async loadActiveBlock(): Promise<ActiveBlockData | null> {
    try {
      const doc = await this.db.get<ActiveBlockData>(ACTIVE_BLOCK_DOC_ID);
      const { _id, _rev, _conflicts, ...block } = doc;
      return block as ActiveBlockData;
    } catch {
      return null;
    }
  }

  /**
   * 删除活跃时间块
   */
  async deleteActiveBlock(): Promise<void> {
    try {
      const doc = await this.db.get<ActiveBlockData>(ACTIVE_BLOCK_DOC_ID);
      await (this.db as unknown as { remove(doc: unknown): Promise<unknown> }).remove(doc);

      // 触发变更通知
      this.notifyChangeListeners(null);
    } catch {
      // 文档不存在，忽略错误
    }
  }

  /**
   * 同步到远程数据库
   *
   * @param remoteUrl - 远程数据库 URL（格式: http://host:port/<db-name>）
   * @returns 复制对象
   */
  async syncToRemote(remoteUrl: string): Promise<PouchDB.Replication.Sync<ActiveBlockData>> {
    // 停止之前的同步
    if (this.syncReplication) {
      this.syncReplication.cancel();
    }

    // 启动新的实时同步
    this.syncReplication = this.db.sync(remoteUrl, {
      live: true,
      retry: true,
    });

    // 监听变更事件
    this.syncReplication.on('change', (change: unknown) => {
      this.handleRemoteChange(change);
    });

    this.syncReplication.on('error', (error: unknown) => {
      console.error('[ActiveBlockStorage] 同步错误:', error);
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
  onRemoteChange(callback: (block: ActiveBlockData | null) => void): () => void {
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
   * 关闭数据库连接
   * 注意：关闭后单例会被移除，下次 getActiveBlockStorage() 会创建新实例
   */
  async close(): Promise<void> {
    // 停止同步
    await this.stopSync();

    // 关闭数据库
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
   * 处理远程变更
   */
  private async handleRemoteChange(change: unknown): Promise<void> {
    // 从远程拉取最新数据
    const block = await this.loadActiveBlock();
    this.notifyChangeListeners(block);
  }

  /**
   * 通知所有变更监听器
   */
  private notifyChangeListeners(block: ActiveBlockData | null): void {
    for (const listener of this.changeListeners) {
      try {
        listener(block);
      } catch (error) {
        console.error('[ActiveBlockStorage] 变更监听器执行错误:', error);
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
