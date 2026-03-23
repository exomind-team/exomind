/**
 * TimeBlock 持久化存储
 *
 * @module timeblock/persistence
 */

import type { TimeBlockImpl } from './types';

/**
 * TimeBlock 持久化存储类
 */
export class TimeBlockStorage {
  private initialized: boolean = false;

  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    if (this.initialized) return;
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
  async save(_block: TimeBlockImpl): Promise<void> {
    await this.ensureInit();
  }

  /**
   * 获取所有时间块
   */
  async getAll(): Promise<TimeBlockImpl[]> {
    await this.ensureInit();
    return [];
  }

  /**
   * 清空所有时间块
   */
  async clear(): Promise<void> {
    await this.ensureInit();
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    this.initialized = false;
  }
}
