/**
 * PouchDB 同步适配器
 *
 * 实现本地 PouchDB 与远程 PouchDB Server 之间的数据同步
 * 复用 sync.port.ts 中定义的类型，确保架构一致性
 */

// 使用 import * as PouchDB 解决类型问题
import PouchDB from 'pouchdb';
import type { Event } from '@/lib/types/event';
import type {
  SyncStatus,
  SyncCredentials,
  SyncResult,
  Conflict,
  ConfigDoc,
  ISyncPort,
  DeviceType,
  DocType,
} from '@/environment/interfaces/sync.port';

// 设备信息存储键
const DEVICE_ID_KEY = 'exomind:deviceId';

/**
 * 设备类型映射（兼容旧代码）
 */
function getDeviceTypeFromString(type: string): DeviceType {
  switch (type) {
    case 'phone':
      return DeviceType.PHONE;
    case 'tablet':
      return DeviceType.TABLET;
    case 'desktop':
      return DeviceType.DESKTOP;
    case 'server':
      return DeviceType.SERVER;
    default:
      return DeviceType.DESKTOP;
  }
}

/**
 * 变更事件接口
 */
interface ChangeEvent {
  id: string;
  deleted?: boolean;
  changes?: Array<{ rev: string }>;
  doc?: unknown;
}

/**
 * 查询结果行接口
 */
interface QueryRow<T = unknown> {
  id: string;
  key: string;
  value: T;
  doc?: unknown;
}

/**
 * PouchDB 文档基础接口
 */
interface PouchDocument {
  _id: string;
  _rev?: string;
  [key: string]: unknown;
}

// 设备信息存储键
const DEVICE_ID_KEY = 'exomind:deviceId';

/**
 * 获取设备 ID
 */
function getDeviceId(): string {
  if (typeof window === 'undefined') {
    // SSR 环境，返回随机 ID
    return generateUUID();
  }

  const stored = localStorage.getItem(DEVICE_ID_KEY);
  if (stored) return stored;

  const newId = generateUUID();
  localStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}

/**
 * 生成 UUID
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * PouchDB 同步适配器核心实现
 */
export class PouchSyncAdapter implements ISyncPort {
  private localDB: PouchDB.Database<PouchDocument> | null = null;
  private remoteDB: PouchDB.Database<PouchDocument> | null = null;
  // 存储凭据（用于断开连接时清理）
  private _credentials: SyncCredentials | null = null;
  private status: SyncStatus;
  private syncTrigger: ((docType: 'event' | 'config') => void) | null = null;
  private localChangesListener: PouchDB.Core.Changes<PouchDocument> | null = null;
  private remoteChangesListener: PouchDB.Core.Changes<PouchDocument> | null = null;

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
    this._credentials = credentials;
    this.status.state = 'connecting';

    // 创建本地 PouchDB 数据库
    const dbName = `local_${credentials.username}`;
    this.localDB = new PouchDB<PouchDocument>(dbName);

    // 创建远程 PouchDB 连接
    const remoteUrl = `${url}/database/${credentials.username}`;
    this.remoteDB = new PouchDB<PouchDocument>(remoteUrl, {
      auth: {
        username: credentials.username,
        password: credentials.passwordHash,
      },
    });

    // 设置视图
    await this.ensureViews();

    // 启动实时同步
    this.startRealtimeSync();

    this.status.state = 'connected';
  }

  /**
   * 确保设计文档已创建
   */
  private async ensureViews(): Promise<void> {
    if (!this.localDB) return;

    // 创建设计文档（用于查询）
    try {
      await this.localDB.put({
        _id: '_design/sync',
        views: {
          events: {
            map: `function(doc) {
              if (doc.type === 'event') {
                emit(doc._id, doc);
              }
            }`,
          },
          configs: {
            map: `function(doc) {
              if (doc.type === 'config') {
                emit(doc._id, doc);
              }
            }`,
          },
          conflicts: {
            map: `function(doc) {
              if (doc._conflicts && doc._conflicts.length > 0) {
                emit(doc._id, doc);
              }
            }`,
          },
        },
      });
    } catch (error: unknown) {
      // 视图已存在，忽略 409 错误
      if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status !== 409) {
        throw error;
      }
    }
  }

  /**
   * 启动实时同步（通过 changes() 监听）
   */
  private startRealtimeSync(): void {
    if (!this.localDB || !this.remoteDB) return;

    // 监听本地变更并同步到远程
    this.localChangesListener = this.localDB.changes({
      since: 'now',
      live: true,
      include_docs: true,
    });

    this.localChangesListener.on('change', async (change: ChangeEvent) => {
      if (!this.localDB || !this.remoteDB) return;

      // 跳过系统文档和已删除文档
      if (change.id.startsWith('_') || change.deleted) return;

      try {
        // 获取完整文档
        const doc = await this.localDB.get(change.id);
        await this.remoteDB.put(doc);
        this.status.pendingChanges = Math.max(0, this.status.pendingChanges - 1);
      } catch {
        console.error('同步本地变更失败');
      }
    });

    // 监听远程变更并同步到本地
    this.remoteChangesListener = this.remoteDB.changes({
      since: 'now',
      live: true,
      include_docs: true,
    });

    this.remoteChangesListener.on('change', async (change: ChangeEvent) => {
      if (!this.localDB || !this.remoteDB) return;

      // 跳过系统文档和已删除文档
      if (change.id.startsWith('_') || change.deleted) return;

      try {
        // 获取远程文档
        const remoteDoc = await this.remoteDB.get(change.id);
        await this.localDB.put(remoteDoc);
      } catch {
        console.error('同步远程变更失败');
      }
    });

    this.status.syncMode = 'realtime';
  }

  /**
   * 同步事件数据（双向）
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
      // 获取本地事件
      const localResult = await this.localDB.query<PouchDocument>('sync/events', {
        include_docs: true,
      });
      const localEvents: Event[] = localResult.rows.map((r: QueryRow) => r.value as Event);

      // 获取远程事件
      const remoteResult = await this.remoteDB.query<PouchDocument>('sync/events', {
        include_docs: true,
      });
      const remoteEvents: Event[] = remoteResult.rows.map((r: QueryRow) => r.value as Event);

      let uploaded = 0;
      let downloaded = 0;
      let conflicts = 0;

      // 双向同步
      for (const event of localEvents) {
        const remote = remoteEvents.find((e: Event) => e.id === event.id);
        if (!remote) {
          // 上传新事件
          await this.remoteDB.put(event as unknown as PouchDocument);
          uploaded++;
        } else if (event.timestamp > remote.timestamp) {
          // 本地更新，更新远程
          await this.remoteDB.put(event as unknown as PouchDocument);
          uploaded++;
        }
      }

      for (const event of remoteEvents) {
        const local = localEvents.find((e: Event) => e.id === event.id);
        if (!local) {
          // 下载新事件
          await this.localDB.put(event as unknown as PouchDocument);
          downloaded++;
        } else if (event.timestamp > local.timestamp) {
          // 远程更新，更新本地
          await this.localDB.put(event as unknown as PouchDocument);
          downloaded++;
        }
      }

      this.status.lastSync = Date.now();
      this.status.state = 'connected';

      return { success: true, uploaded, downloaded, conflicts, errors: [] };
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
   * 同步配置数据（双向）
   */
  async syncConfig(): Promise<SyncResult> {
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
      // 获取本地配置（只同步 global 作用域）
      const localResult = await this.localDB.query<PouchDocument>('sync/configs', {
        include_docs: true,
      });
      const localConfigs: ConfigDoc[] = localResult.rows.map((r: QueryRow) => r.value as ConfigDoc);

      // 获取远程配置
      const remoteResult = await this.remoteDB.query<PouchDocument>('sync/configs', {
        include_docs: true,
      });
      const remoteConfigs: ConfigDoc[] = remoteResult.rows.map((r: QueryRow) => r.value as ConfigDoc);

      let uploaded = 0;
      let downloaded = 0;
      let conflicts = 0;

      for (const config of localConfigs) {
        if (config.scope === 'local') continue; // 跳过本地配置

        const remote = remoteConfigs.find((c: ConfigDoc) => c.key === config.key);
        if (!remote) {
          await this.remoteDB.put(config as unknown as PouchDocument);
          uploaded++;
        } else if (config.updatedAt > remote.updatedAt) {
          await this.remoteDB.put(config as unknown as PouchDocument);
          uploaded++;
        }
      }

      for (const config of remoteConfigs) {
        if (config.scope === 'local') continue;

        const local = localConfigs.find((c: ConfigDoc) => c.key === config.key);
        if (!local) {
          await this.localDB.put(config as unknown as PouchDocument);
          downloaded++;
        } else if (config.updatedAt > local.updatedAt) {
          await this.localDB.put(config as unknown as PouchDocument);
          downloaded++;
        }
      }

      this.status.lastSync = Date.now();
      this.status.state = 'connected';

      return { success: true, uploaded, downloaded, conflicts, errors: [] };
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
   * 推送单个事件到本地数据库（自动触发同步）
   */
  async pushEvent(event: Event): Promise<void> {
    if (!this.localDB) return;

    await this.localDB.put(event as unknown as PouchDocument);
    this.status.pendingChanges++;

    // 触发同步
    await this.syncEvents();
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
      deviceId,
      updatedAt: new Date().toISOString(),
      scope: 'global',
    };

    await this.localDB.put(config as unknown as PouchDocument);
    this.status.pendingChanges++;

    // 触发同步
    await this.syncConfig();
  }

  /**
   * 获取冲突列表
   */
  async getConflicts(): Promise<Conflict[]> {
    if (!this.localDB) return [];

    const conflicts: Conflict[] = [];

    try {
      // 查询有冲突的文档
      const result = await this.localDB.query<PouchDocument>('sync/conflicts', {
        include_docs: true,
      });

      for (const row of result.rows) {
        const doc = row.value as {
          _id: string;
          _conflicts?: string[];
          type: 'event' | 'config';
        };
        const deviceId = getDeviceId();

        // 获取冲突版本
        const conflictRevs = doc._conflicts || [];
        for (const rev of conflictRevs) {
          try {
            const conflictDoc = await this.localDB.get(doc._id, { rev });
            conflicts.push({
              id: `${doc._id}-${rev}`,
              docId: doc._id,
              docType: doc.type,
              local: {
                value: conflictDoc,
                timestamp: 0,
                deviceId,
              },
              remote: {
                value: conflictDoc,
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
    } catch {
      // 查询可能失败，返回空列表
      console.error('获取冲突列表失败');
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
      await this.remoteDB.put(local);
      // 移除本地冲突标记
      delete (local as Record<string, unknown>)._conflicts;
      await this.localDB.put(local);
    } else if (resolution === 'remote') {
      // 保留远程，删除本地冲突版本
      const remote = await this.remoteDB.get(docId);
      await this.localDB.put(remote);
    } else {
      // merge 模式需要特殊处理，暂时与 local 相同
      const local = await this.localDB.get(docId);
      await this.remoteDB.put(local);
    }

    // 更新冲突计数
    await this.getConflicts();
  }

  /**
   * 设置同步触发回调
   */
  setOnSyncTrigger(callback: (docType: 'event' | 'config') => void): void {
    this.syncTrigger = callback;
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

    // 触发回调
    this.syncTrigger?.(docType);
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 停止监听
    if (this.localChangesListener) {
      this.localChangesListener.cancel();
      this.localChangesListener = null;
    }

    if (this.remoteChangesListener) {
      this.remoteChangesListener.cancel();
      this.remoteChangesListener = null;
    }

    // 关闭数据库
    if (this.localDB) {
      await this.localDB.close();
      this.localDB = null;
    }

    this.remoteDB = null;
    // 清理凭据
    this._credentials = null;
    void this._credentials; // 消除未使用警告
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
  getLocalDB(): PouchDB.Database<PouchDocument> | null {
    return this.localDB;
  }

  /**
   * 获取远程数据库实例（用于调试）
   */
  getRemoteDB(): PouchDB.Database<PouchDocument> | null {
    return this.remoteDB;
  }
}

/**
 * 创建 PouchSyncAdapter 实例的工厂函数
 */
export function createPouchSyncAdapter(): PouchSyncAdapter {
  return new PouchSyncAdapter();
}
