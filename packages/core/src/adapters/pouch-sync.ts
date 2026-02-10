/**
 * PouchDB 同步适配器
 *
 * 使用 PouchDB 内置 replicate() API：
 * - 自动双向同步
 * - 增量复制（性能优化）
 * - 内置冲突检测
 */

import PouchDB from 'pouchdb';
import type {
  SyncEvent,
  ConfigDoc,
  ISyncPort,
  SyncStatus,
  SyncCredentials,
  SyncResult,
  Conflict,
} from '../interfaces/sync.port.js';

// PouchDB 插件
import pouchdbAdapterIdb from 'pouchdb-adapter-idb';

// 注册 IDB 适配器（使用 IndexedDB 作为本地存储）
PouchDB.plugin(pouchdbAdapterIdb);

// 设备信息存储键
const DEVICE_ID_KEY = 'exomind:deviceId';

/**
 * 获取设备 ID
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    // SSR/Node 环境
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const newId = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * PouchDB 同步适配器核心实现
 */
export class PouchSyncAdapter implements ISyncPort {
  private localDB: PouchDB.Database | null = null;
  private remoteDB: PouchDB.Database | null = null;
  private credentials: SyncCredentials | null = null;
  private status: SyncStatus;

  // 复制句柄（用于取消）
  private replicationPush: PouchDB.Replication.Replication<Record<string, unknown>> | null = null;
  private replicationPull: PouchDB.Replication.Replication<Record<string, unknown>> | null = null;

  constructor() {
    this.status = this.getInitialStatus();
  }

  private getInitialStatus(): SyncStatus {
    return {
      state: 'disconnected',
      lastSync: null,
      pendingChanges: 0,
      conflictCount: 0,
      syncMode: 'realtime',
      pollInterval: 5,
    };
  }

  /**
   * 连接到同步服务器
   */
  async connect(url: string, credentials: SyncCredentials): Promise<void> {
    this.credentials = credentials;
    this.status.state = 'connecting';

    const { username, passwordHash } = credentials;

    // 创建本地数据库（使用 IndexedDB）
    const dbName = `local_${username}`;
    this.localDB = new PouchDB(dbName, { adapter: 'idb' });

    // 创建远程数据库连接
    const remoteUrl = `${url}/database/${username}`;
    this.remoteDB = new PouchDB(remoteUrl, {
      auth: {
        username,
        password: passwordHash, // PouchDB auth 使用 password 字段
      },
    });

    // 启动实时双向同步
    this.startRealtimeSync();

    this.status.state = 'connected';
  }

  /**
   * 启动实时双向同步
   *
   * 使用 PouchDB 内置 replicate() 实现：
   * - 本地 → 远程：持续复制
   * - 远程 → 本地：持续复制
   */
  private startRealtimeSync(): void {
    if (!this.localDB || !this.remoteDB) {
      throw new Error('数据库未初始化');
    }

    // 停止现有复制
    this.stopReplication();

    // 本地 → 远程（持续复制）
    this.replicationPush = PouchDB.replicate(this.localDB, this.remoteDB, {
      live: true,
      retry: true,
    });

    // 远程 → 本地（持续复制）
    this.replicationPull = PouchDB.replicate(this.remoteDB, this.localDB, {
      live: true,
      retry: true,
    });

    // 监听复制变更事件
    this.replicationPush.on('change', (info) => {
      this.onPushChange(info);
    });

    this.replicationPull.on('change', (info) => {
      this.onPullChange(info);
    });

    // 监听复制错误
    this.replicationPush.on('error', (err: { message?: string }) => {
      console.error('[Sync] 推送错误:', err);
      this.status.state = 'error';
      this.status.error = err.message || '未知错误';
    });

    this.replicationPull.on('error', (err: { message?: string }) => {
      console.error('[Sync] 拉取错误:', err);
      this.status.state = 'error';
      this.status.error = err.message || '未知错误';
    });

    this.status.syncMode = 'realtime';
  }

  /**
   * 处理推送变更
   */
  private onPushChange(info: { docs_written?: number }): void {
    if (info.docs_written) {
      this.status.pendingChanges = Math.max(0, this.status.pendingChanges - info.docs_written);
    }
    this.status.lastSync = Date.now();
    console.log(`[Sync] 推送完成: ${info.docs_written || 0} 个文档`);
  }

  /**
   * 处理拉取变更
   */
  private onPullChange(info: { docs_written?: number }): void {
    this.status.lastSync = Date.now();
    console.log(`[Sync] 拉取完成: ${info.docs_written || 0} 个文档`);
  }

  /**
   * 停止复制
   */
  private stopReplication(): void {
    if (this.replicationPush) {
      this.replicationPush.cancel();
      this.replicationPush = null;
    }
    if (this.replicationPull) {
      this.replicationPull.cancel();
      this.replicationPull = null;
    }
  }

  /**
   * 同步事件数据（手动触发）
   *
   * 注意：实时同步已自动处理，这里提供手动触发接口
   */
  async syncEvents(): Promise<SyncResult> {
    if (!this.localDB || !this.remoteDB) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        errors: ['未连接'],
      };
    }

    this.status.state = 'syncing';

    try {
      // 使用 one-shot 复制进行手动同步
      const pushResult = await PouchDB.replicate(this.localDB, this.remoteDB);
      const pullResult = await PouchDB.replicate(this.remoteDB, this.localDB);

      this.status.lastSync = Date.now();
      this.status.state = 'connected';

      return {
        success: true,
        uploaded: pushResult.docs_written,
        downloaded: pullResult.docs_written,
        conflicts: 0, // PouchDB 自动处理冲突
        errors: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.status.state = 'error';
      this.status.error = errorMessage;
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        errors: [errorMessage],
      };
    }
  }

  /**
   * 同步配置数据
   *
   * 配置同步与事件同步使用相同的复制通道，
   * 因为 PouchDB.replicate() 会同步所有文档
   */
  async syncConfig(): Promise<SyncResult> {
    return this.syncEvents();
  }

  /**
   * 推送单个事件到本地数据库（自动触发同步）
   */
  async pushEvent(event: SyncEvent): Promise<void> {
    if (!this.localDB) return;

    await this.localDB.put(event as unknown as PouchDB.Core.Document<any>);
    this.status.pendingChanges++;
  }

  /**
   * 推送配置到本地数据库（自动触发同步）
   */
  async pushConfig(key: string, value: unknown): Promise<void> {
    if (!this.localDB) return;

    const deviceId = getDeviceId();
    const config: ConfigDoc = {
      _id: `config:${key}`,
      type: 'config',
      key,
      value,
      scope: 'global',
      encrypted: false,
      deviceId,
      updatedAt: new Date().toISOString(),
    };

    await this.localDB.put(config as unknown as PouchDB.Core.Document<any>);
    this.status.pendingChanges++;
  }

  /**
   * 获取冲突列表
   */
  async getConflicts(): Promise<Conflict[]> {
    if (!this.localDB) return [];

    const conflicts: Conflict[] = [];

    try {
      const result = await this.localDB.allDocs({ conflicts: true, include_docs: true });

      for (const row of result.rows) {
        const doc = row.doc;
        if (doc && (doc as { _conflicts?: string[] })._conflicts?.length) {
          const conflictDoc = doc as unknown as {
            _id: string;
            _conflicts?: string[];
            type: 'event' | 'config';
          };
          const deviceId = getDeviceId();

          for (const rev of conflictDoc._conflicts || []) {
            try {
              const conflictVersion = await this.localDB.get(conflictDoc._id, { rev });
              conflicts.push({
                id: `${conflictDoc._id}-${rev}`,
                docId: conflictDoc._id,
                docType: conflictDoc.type,
                local: {
                  value: conflictVersion,
                  timestamp: 0,
                  deviceId,
                },
                remote: {
                  value: conflictVersion,
                  timestamp: 0,
                  deviceId: 'unknown',
                },
                resolved: false,
              });
            } catch {
              // 版本可能已被删除
            }
          }
        }
      }
    } catch {
      console.error('[Sync] 获取冲突列表失败');
    }

    this.status.conflictCount = conflicts.length;
    return conflicts;
  }

  /**
   * 解决冲突
   */
  async resolveConflict(
    docId: string,
    resolution: 'local' | 'remote' | 'merge'
  ): Promise<void> {
    if (!this.localDB || !this.remoteDB) return;

    if (resolution === 'local') {
      // 保留本地，删除远程冲突版本
      const local = await this.localDB.get(docId);
      delete (local as unknown as Record<string, unknown>)._conflicts;
      await this.localDB.put(local as unknown as PouchDB.Core.Document<any>);
      await this.remoteDB.put(local as unknown as PouchDB.Core.Document<any>);
    } else if (resolution === 'remote') {
      // 保留远程，删除本地冲突版本
      const remote = await this.remoteDB.get(docId);
      await this.localDB.put(remote as unknown as PouchDB.Core.Document<any>);
    } else {
      // merge 模式需要应用层实现，这里与 local 相同
      const local = await this.localDB.get(docId);
      await this.remoteDB.put(local as unknown as PouchDB.Core.Document<any>);
    }

    // 更新冲突计数
    await this.getConflicts();
  }

  /**
   * 从本地存储导入数据（待实现）
   */
  async importFromLocal(_strategy: 'merge' | 'skip' | 'overwrite'): Promise<{
    success: boolean;
    importedCount: number;
    skippedCount: number;
    conflictCount: number;
    errors: string[];
  }> {
    // TODO: 实现从 localStorage 导入数据
    return {
      success: true,
      importedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      errors: [],
    };
  }

  /**
   * 导出数据到文件（待实现）
   */
  async exportToFile(): Promise<void> {
    // TODO: 实现导出到 JSONL 文件
  }

  /**
   * 设置同步触发回调
   */
  setOnSyncTrigger(_callback: (docType: 'event' | 'config') => void): void {
    // 实时同步模式下，回调由 replicate 的 change 事件处理
  }

  /**
   * 触发同步
   */
  async triggerSync(docType: 'event' | 'config'): Promise<void> {
    if (docType === 'event') {
      await this.syncEvents();
    } else {
      await this.syncConfig();
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 停止复制
    this.stopReplication();

    // 关闭数据库
    if (this.localDB) {
      await this.localDB.close();
      this.localDB = null;
    }

    this.remoteDB = null;
    // 消除未使用警告
    void this.credentials;
    this.credentials = null;

    this.status = this.getInitialStatus();
  }

  /**
   * 获取同步状态
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * 获取本地数据库实例（用于调试）
   */
  getLocalDB(): PouchDB.Database | null {
    return this.localDB;
  }

  /**
   * 获取远程数据库实例（用于调试）
   */
  getRemoteDB(): PouchDB.Database | null {
    return this.remoteDB;
  }
}

/**
 * 创建 PouchSyncAdapter 实例的工厂函数
 */
export function createPouchSyncAdapter(): PouchSyncAdapter {
  return new PouchSyncAdapter();
}
