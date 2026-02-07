/**
 * TimeBlock 持久化存储
 *
 * @module timeblock/persistence
 */

import { invoke } from '@tauri-apps/api/core';
import {
  TimeBlock,
  TimeBlockQuery,
  TimeBlockStats,
  TimeBlockStorageConfig,
  DEFAULT_TIMEBLOCK_STORAGE_CONFIG,
} from './types';
import type { DaySummary } from './types';

/**
 * TimeBlock 持久化存储类
 */
export class TimeBlockStorage {
  private config: TimeBlockStorageConfig;
  private initialized: boolean = false;

  /**
   * 创建存储实例
   */
  constructor(config?: Partial<TimeBlockStorageConfig>) {
    this.config = { ...DEFAULT_TIMEBLOCK_STORAGE_CONFIG, ...config };
  }

  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await invoke('init_timeblock_storage', {
      dataPath: this.config.dataPath,
      filename: this.config.filename,
      compress: this.config.compress,
      maxRetentionDays: this.config.maxRetentionDays,
    });

    this.initialized = true;
  }

  /**
   * 确保存储已初始化
   */
  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * 保存时间块
   */
  async save(block: TimeBlock): Promise<void> {
    await this.ensureInit();
    await invoke('save_timeblock', { block });
  }

  /**
   * 批量保存时间块
   */
  async saveMany(blocks: TimeBlock[]): Promise<void> {
    await this.ensureInit();
    await invoke('save_timeblocks', { blocks });
  }

  /**
   * 获取单个时间块
   */
  async get(id: string): Promise<TimeBlock | null> {
    await this.ensureInit();
    return invoke<TimeBlock | null>('get_timeblock', { id });
  }

  /**
   * 获取所有时间块
   */
  async getAll(): Promise<TimeBlock[]> {
    await this.ensureInit();
    return invoke<TimeBlock[]>('get_all_timeblocks');
  }

  /**
   * 查询时间块
   */
  async query(query: TimeBlockQuery): Promise<TimeBlock[]> {
    await this.ensureInit();
    return invoke<TimeBlock[]>('query_timeblocks', { query });
  }

  /**
   * 获取某一天的时间块
   */
  async getByDate(date: string): Promise<TimeBlock[]> {
    await this.ensureInit();
    return invoke<TimeBlock[]>('get_timeblocks_by_date', { date });
  }

  /**
   * 获取某一天的时间块摘要
   */
  async getDaySummary(date: string): Promise<DaySummary> {
    await this.ensureInit();
    return invoke<DaySummary>('get_day_summary', { date });
  }

  /**
   * 获取时间统计
   */
  async getStats(startDate?: string, endDate?: string): Promise<TimeBlockStats> {
    await this.ensureInit();
    return invoke<TimeBlockStats>('get_timeblock_stats', { startDate, endDate });
  }

  /**
   * 删除时间块
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    return invoke<boolean>('delete_timeblock', { id });
  }

  /**
   * 清空所有时间块
   */
  async clear(): Promise<void> {
    await this.ensureInit();
    await invoke('clear_all_timeblocks');
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<number> {
    await this.ensureInit();
    return invoke<number>('cleanup_expired_timeblocks');
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    await invoke('close_timeblock_storage');
    this.initialized = false;
  }
}
