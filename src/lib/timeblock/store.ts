/**
 * TimeBlock Store - 状态管理与业务逻辑
 *
 * @module timeblock/store
 */

import { v4 as uuidv4 } from 'uuid';
import {
  TimeBlock,
  TimeBlockStatus,
  TimeBlockType,
  CreateTimeBlockParams,
  UpdateTimeBlockParams,
  TimeBlockQuery,
  TimeBlockStats,
  DaySummary,
} from './types';
import { TimeBlockStorage } from './persistence';

// ============================================================================
// 事件类型
// ============================================================================

/**
 * TimeBlock 事件类型
 */
export enum TimeBlockEventType {
  BlockCreated = 'blockCreated',
  BlockUpdated = 'blockUpdated',
  BlockDeleted = 'blockDeleted',
  StatusChanged = 'statusChanged',
  Loaded = 'loaded',
  Error = 'error',
}

/**
 * TimeBlock 事件载荷
 */
export interface TimeBlockEventPayload {
  [TimeBlockEventType.BlockCreated]: TimeBlock;
  [TimeBlockEventType.BlockUpdated]: { old: TimeBlock; new: TimeBlock };
  [TimeBlockEventType.BlockDeleted]: { id: string };
  [TimeBlockEventType.StatusChanged]: { id: string; oldStatus: TimeBlockStatus; newStatus: TimeBlockStatus };
  [TimeBlockEventType.Loaded]: TimeBlock[];
  [TimeBlockEventType.Error]: { error: string };
}

/**
 * 事件监听器类型
 */
export type TimeBlockEventListener<K extends TimeBlockEventType = TimeBlockEventType> = (
  payload: TimeBlockEventPayload[K]
) => void;

// ============================================================================
// TimeBlock Store
// ============================================================================

/**
 * TimeBlock Store
 * 封装时间块的 CRUD 操作和业务逻辑
 */
export class TimeBlockStore {
  // 单例实例
  private static instance: TimeBlockStore | null = null;

  // 存储
  private storage: TimeBlockStorage;

  // 内存缓存
  private blocks: Map<string, TimeBlock> = new Map();

  // 事件监听器
  private listeners: Map<TimeBlockEventType, Set<TimeBlockEventListener>> = new Map();

  // 加载状态
  private loaded: boolean = false;
  private loading: boolean = false;

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(config?: ConstructorParameters<typeof TimeBlockStorage>[0]) {
    this.storage = new TimeBlockStorage(config);
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ConstructorParameters<typeof TimeBlockStorage>[0]): TimeBlockStore {
    if (!TimeBlockStore.instance) {
      TimeBlockStore.instance = new TimeBlockStore(config);
    }
    return TimeBlockStore.instance;
  }

  /**
   * 销毁单例实例
   */
  static destroyInstance(): void {
    if (TimeBlockStore.instance) {
      TimeBlockStore.instance.storage.close();
      TimeBlockStore.instance = null;
    }
  }

  // ============================================================================
  // 事件系统
  // ============================================================================

  /**
   * 订阅事件
   */
  on<K extends TimeBlockEventType>(
    eventType: K,
    listener: TimeBlockEventListener<K>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as TimeBlockEventListener);

    return () => this.off(eventType, listener);
  }

  /**
   * 取消订阅
   */
  off<K extends TimeBlockEventType>(
    eventType: K,
    listener: TimeBlockEventListener<K>
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener as TimeBlockEventListener);
    }
  }

  /**
   * 发布事件
   */
  private emit<K extends TimeBlockEventType>(
    eventType: K,
    payload: TimeBlockEventPayload[K]
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`TimeBlock event listener error: ${eventType}`, error);
        }
      });
    }
  }

  // ============================================================================
  // 加载数据
  // ============================================================================

  /**
   * 加载所有时间块
   */
  async load(): Promise<void> {
    if (this.loading || this.loaded) return;

    this.loading = true;

    try {
      await this.storage.init();
      const blocks = await this.storage.getAll();

      // 重建内存索引
      this.blocks.clear();
      blocks.forEach((block) => {
        this.blocks.set(block.id, block);
      });

      this.loaded = true;
      this.loading = false;

      this.emit(TimeBlockEventType.Loaded, blocks);
    } catch (error) {
      this.loading = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit(TimeBlockEventType.Error, { error: errorMessage });
      throw error;
    }
  }

  /**
   * 确保数据已加载
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded && !this.loading) {
      await this.load();
    }
  }

  /**
   * 检查是否已加载
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * 检查是否正在加载
   */
  isLoading(): boolean {
    return this.loading;
  }

  // ============================================================================
  // CRUD 操作
  // ============================================================================

  /**
   * 创建时间块
   */
  async create(params: CreateTimeBlockParams): Promise<TimeBlock> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const block: TimeBlock = {
      id: uuidv4(),
      title: params.title,
      description: params.description,
      startTime: params.startTime,
      endTime: params.endTime,
      status: TimeBlockStatus.Pending,
      type: params.type || TimeBlockType.Work,
      labelIds: params.labelIds,
      notes: params.notes,
      createdAt: now,
      updatedAt: now,
    };

    // 保存到存储
    await this.storage.save(block);

    // 添加到内存缓存
    this.blocks.set(block.id, block);

    // 发送事件
    this.emit(TimeBlockEventType.BlockCreated, block);

    return block;
  }

  /**
   * 获取单个时间块
   */
  async get(id: string): Promise<TimeBlock | null> {
    await this.ensureLoaded();
    return this.blocks.get(id) || null;
  }

  /**
   * 获取所有时间块
   */
  async getAll(): Promise<TimeBlock[]> {
    await this.ensureLoaded();
    return Array.from(this.blocks.values());
  }

  /**
   * 更新时间块
   */
  async update(id: string, params: UpdateTimeBlockParams): Promise<TimeBlock | null> {
    await this.ensureLoaded();

    const existing = this.blocks.get(id);
    if (!existing) {
      return null;
    }

    const oldBlock = { ...existing };
    const updated: TimeBlock = {
      ...existing,
      ...params,
      updatedAt: new Date().toISOString(),
    };

    // 保存到存储
    await this.storage.save(updated);

    // 更新内存缓存
    this.blocks.set(id, updated);

    // 发送事件
    this.emit(TimeBlockEventType.BlockUpdated, { old: oldBlock, new: updated });

    return updated;
  }

  /**
   * 更新状态
   */
  async updateStatus(
    id: string,
    status: TimeBlockStatus
  ): Promise<TimeBlock | null> {
    await this.ensureLoaded();

    const existing = this.blocks.get(id);
    if (!existing) {
      return null;
    }

    const oldStatus = existing.status;
    const updated = await this.update(id, { status });

    if (updated) {
      this.emit(TimeBlockEventType.StatusChanged, {
        id,
        oldStatus,
        newStatus: status,
      });
    }

    return updated;
  }

  /**
   * 删除时间块
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();

    if (!this.blocks.has(id)) {
      return false;
    }

    // 从存储删除
    await this.storage.delete(id);

    // 从内存删除
    this.blocks.delete(id);

    // 发送事件
    this.emit(TimeBlockEventType.BlockDeleted, { id });

    return true;
  }

  // ============================================================================
  // 查询操作
  // ============================================================================

  /**
   * 条件查询
   */
  async where(query: TimeBlockQuery): Promise<TimeBlock[]> {
    await this.ensureLoaded();

    const all = Array.from(this.blocks.values());

    return all.filter((block) => {
      // 按状态筛选
      if (query.status) {
        const statuses = Array.isArray(query.status) ? query.status : [query.status];
        if (!statuses.includes(block.status)) return false;
      }

      // 按类型筛选
      if (query.type) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        if (!types.includes(block.type)) return false;
      }

      // 按标签筛选
      if (query.labelIds && query.labelIds.length > 0) {
        if (!block.labelIds || !query.labelIds.some((id) => block.labelIds!.includes(id))) {
          return false;
        }
      }

      // 开始时间范围
      if (query.startTimeFrom && block.startTime < query.startTimeFrom) return false;
      if (query.startTimeTo && block.startTime > query.startTimeTo) return false;

      // 结束时间范围
      if (query.endTimeFrom && block.endTime < query.endTimeFrom) return false;
      if (query.endTimeTo && block.endTime > query.endTimeTo) return false;

      return true;
    });
  }

  /**
   * 获取某一天的时间块
   */
  async getByDate(date: string): Promise<TimeBlock[]> {
    await this.ensureLoaded();
    return this.storage.getByDate(date);
  }

  /**
   * 获取某一天的时间块摘要
   */
  async getDaySummary(date: string): Promise<DaySummary> {
    await this.ensureLoaded();
    return this.storage.getDaySummary(date);
  }

  /**
   * 获取今天的摘要
   */
  async getTodaySummary(): Promise<DaySummary> {
    const today = new Date().toISOString().split('T')[0];
    return this.getDaySummary(today);
  }

  /**
   * 获取待执行的时间块
   */
  async getPending(): Promise<TimeBlock[]> {
    return this.where({ status: TimeBlockStatus.Pending });
  }

  /**
   * 获取进行中的时间块
   */
  async getInProgress(): Promise<TimeBlock[]> {
    return this.where({ status: TimeBlockStatus.InProgress });
  }

  /**
   * 获取已完成的时间块
   */
  async getCompleted(): Promise<TimeBlock[]> {
    return this.where({ status: TimeBlockStatus.Completed });
  }

  // ============================================================================
  // 统计操作
  // ============================================================================

  /**
   * 获取时间统计
   */
  async getStats(startDate?: string, endDate?: string): Promise<TimeBlockStats> {
    await this.ensureLoaded();
    return this.storage.getStats(startDate, endDate);
  }

  // ============================================================================
  // 清理操作
  // ============================================================================

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    await this.storage.clear();
    this.blocks.clear();
    this.loaded = false;
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<number> {
    return this.storage.cleanup();
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    await this.storage.close();
    this.blocks.clear();
    this.loaded = false;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 获取 TimeBlockStore 单例
 */
export function getTimeBlockStore(
  config?: ConstructorParameters<typeof TimeBlockStorage>[0]
): TimeBlockStore {
  return TimeBlockStore.getInstance(config);
}

/**
 * 销毁 TimeBlockStore
 */
export function destroyTimeBlockStore(): void {
  TimeBlockStore.destroyInstance();
}
