/**
 * WebStorageAdapter - Web 环境存储适配器
 *
 * 使用 localStorage 实现 IStoragePort
 * 适合浏览器环境
 */

import type { IStoragePort } from '../environment/interfaces/storage.port';
import type { QueryOptions, QueryResult } from '../environment/interfaces/storage.port';

/**
 * Web Storage 适配器
 *
 * 特点：
 * - 使用浏览器原生 localStorage
 * - 数据自动 JSON 序列化/反序列化
 * - 同步操作（localStorage 是同步的）
 */
export class WebStorageAdapter implements IStoragePort {
  private static STORAGE_KEY_PREFIX = 'exomind_';

  /**
   * 获取带前缀的键名
   */
  private getKey(key: string): string {
    return `${WebStorageAdapter.STORAGE_KEY_PREFIX}${key}`;
  }

  /**
   * 检查是否在浏览器环境
   */
  private isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
  }

  /**
   * 写入数据
   */
  async write<T>(key: string, data: T): Promise<void> {
    if (!this.isBrowser()) {
      console.warn('[WebStorage] 非浏览器环境，跳过写入');
      return;
    }

    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(this.getKey(key), serialized);
      console.log(`[WebStorage] 写入成功: ${key}`);
    } catch (error) {
      console.error(`[WebStorage] 写入失败: ${key}`, error);
      throw error;
    }
  }

  /**
   * 读取数据
   */
  async read<T>(key: string): Promise<T | null> {
    if (!this.isBrowser()) {
      console.warn('[WebStorage] 非浏览器环境，返回 null');
      return null;
    }

    try {
      const raw = localStorage.getItem(this.getKey(key));
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error(`[WebStorage] 读取失败: ${key}`, error);
      return null;
    }
  }

  /**
   * 删除数据
   */
  async delete(key: string): Promise<void> {
    if (!this.isBrowser()) {
      return;
    }

    try {
      localStorage.removeItem(this.getKey(key));
      console.log(`[WebStorage] 删除成功: ${key}`);
    } catch (error) {
      console.error(`[WebStorage] 删除失败: ${key}`, error);
      throw error;
    }
  }

  /**
   * 批量读取所有数据
   */
  async readAll<T>(): Promise<Map<string, T>> {
    if (!this.isBrowser()) {
      return new Map();
    }

    const result = new Map<string, T>();
    const prefix = WebStorageAdapter.STORAGE_KEY_PREFIX;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const rawKey = localStorage.key(i);
        if (rawKey && rawKey.startsWith(prefix)) {
          const key = rawKey.slice(prefix.length);
          try {
            const raw = localStorage.getItem(rawKey);
            if (raw !== null) {
              result.set(key, JSON.parse(raw) as T);
            }
          } catch {
            console.warn(`[WebStorage] 解析失败: ${key}`);
          }
        }
      }
    } catch (error) {
      console.error('[WebStorage] readAll 失败', error);
    }

    return result;
  }

  /**
   * 清空所有数据
   */
  async clear(): Promise<void> {
    if (!this.isBrowser()) {
      return;
    }

    try {
      // 只清除我们写入的数据
      const keysToDelete: string[] = [];
      const prefix = WebStorageAdapter.STORAGE_KEY_PREFIX;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach(key => localStorage.removeItem(key));
      console.log(`[WebStorage] 清空完成，删除了 ${keysToDelete.length} 条数据`);
    } catch (error) {
      console.error('[WebStorage] 清空失败', error);
      throw error;
    }
  }

  /**
   * 查询数据（Web 环境暂未实现）
   */
  async query<T>(_options: QueryOptions<T>): Promise<QueryResult<T>> {
    console.warn('[WebStorage] query 方法暂未实现');
    return {
      items: [],
      total: 0,
      hasMore: false,
    };
  }
}
