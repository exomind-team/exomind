/**
 * 同步 Port 接口和类型定义
 *
 * 基于 SPEC-301 多设备数据同步规格
 * @see docs/specs/SPEC-301-多设备数据同步.md
 */

import { DeviceType } from '@exomind/shared';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 同步状态枚举
 */
export type SyncState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';

/**
 * 同步模式
 */
export type SyncMode = 'realtime' | 'polling';

/**
 * 冲突解决策略
 */
export type ConflictResolution = 'local' | 'remote' | 'merge';

/**
 * 导入策略
 */
export type ImportStrategy = 'merge' | 'skip' | 'overwrite';

/**
 * 文档类型
 */
export type DocType = 'event' | 'config';

/**
 * 配置作用域
 */
export type ConfigScope = 'global' | 'local';

/**
 * UUID 类型
 */
export type UUID = string;

/**
 * 时间戳类型
 */
export type Timestamp = number;

/**
 * 同步用事件类型（适合存储和序列化）
 *
 * 注意：与 UI 层的 Event 类型不同，使用数组而非 Set
 */
export interface SyncEvent {
  id: UUID;
  type: 'event';
  eventId: UUID;           // 原始事件 ID
  content: string;
  timestamp: Timestamp;
  tags: string[];          // 数组而非 Set，方便序列化
  deviceId: UUID;          // 记录来源设备
  _rev?: string;           // CouchDB 版本控制
  _deleted?: boolean;       // 软删除标记
}

/**
 * 同步用配置类型
 */
export interface SyncConfig {
  _id: string;
  type: 'config';
  key: string;
  value: unknown;
  scope: ConfigScope;
  encrypted: boolean;
  deviceId: UUID;
  updatedAt: string;
  _rev?: string;
}

// ============================================================================
// 接口定义
// ============================================================================

/**
 * 同步凭据
 */
export interface SyncCredentials {
  username: string;
  passwordHash: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
}

/**
 * 同步状态
 */
export interface SyncStatus {
  state: SyncState;
  lastSync: number | null;
  pendingChanges: number;
  conflictCount: number;
  syncMode: SyncMode;
  pollInterval: number;
  error?: string;
}

/**
 * 同步结果
 */
export interface SyncResult {
  success: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  errors: string[];
}

/**
 * 冲突信息
 */
export interface Conflict {
  id: string;
  docId: string;
  docType: DocType;
  local: {
    value: unknown;
    timestamp: number;
    deviceId: string;
  };
  remote: {
    value: unknown;
    timestamp: number;
    deviceId: string;
  };
  resolved: boolean;
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  errors: string[];
}

/**
 * 设备信息（仅本地存储）
 */
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  createdAt: number;
  lastSync?: number;
}

/**
 * 配置文档
 */
export interface ConfigDoc {
  _id: string;
  type: 'config';
  key: string;
  value: unknown;
  scope: ConfigScope;
  encrypted: boolean;
  deviceId: string;
  updatedAt: string;
  _rev?: string;
}

/**
 * 同步触发回调
 */
export type SyncTriggerCallback = (docType: DocType) => void;

// ============================================================================
// Port 接口
// ============================================================================

/**
 * 同步 Port 接口
 *
 * 渐进式扩展：保留 IStoragePort，新增同步相关方法
 */
export interface ISyncPort {
  // === 连接管理 ===
  /**
   * 连接到同步服务器
   */
  connect(url: string, credentials: SyncCredentials): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(): Promise<void>;

  /**
   * 获取当前同步状态
   */
  getStatus(): SyncStatus;

  // === 事件同步 ===
  /**
   * 同步事件数据（双向）
   */
  syncEvents(): Promise<SyncResult>;

  /**
   * 推送单个事件到服务器
   */
  pushEvent(event: SyncEvent): Promise<void>;

  // === 配置同步 ===
  /**
   * 同步配置数据（双向）
   */
  syncConfig(): Promise<SyncResult>;

  /**
   * 推送配置到服务器
   */
  pushConfig(key: string, value: unknown): Promise<void>;

  // === 冲突处理 ===
  /**
   * 获取冲突列表
   */
  getConflicts(): Promise<Conflict[]>;

  /**
   * 解决冲突
   */
  resolveConflict(docId: string, resolution: ConflictResolution): Promise<void>;

  // === 导入导出 ===
  /**
   * 从本地存储导入
   */
  importFromLocal(strategy: ImportStrategy): Promise<ImportResult>;

  /**
   * 导出到文件
   */
  exportToFile(): Promise<void>;

  // === 同步触发机制 ===
  /**
   * 设置同步触发回调（当本地数据变更时自动触发同步）
   */
  setOnSyncTrigger(callback: SyncTriggerCallback): void;

  /**
   * 触发同步（供内部调用）
   */
  triggerSync(docType: DocType): Promise<void>;
}
