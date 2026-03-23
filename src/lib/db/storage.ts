/**
 * FileStorage 模块 - 统一存储接口
 */

import type { Entity, QueryOptions, QueryResult } from './types';
import type { StorageError } from './errors';

/**
 * 存储接口 - 定义所有存储操作
 */
export interface Storage<T extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * 插入实体
   */
  insert(entity: T): T;

  /**
   * 根据 ID 查找实体
   */
  find(id: string): T | null;

  /**
   * 更新实体
   */
  update(id: string, data: Partial<T>): boolean;

  /**
   * 删除实体
   */
  delete(id: string): boolean;

  /**
   * 获取所有实体
   */
  all(): T[];

  /**
   * 条件查询
   */
  where(filter: Partial<T>): T[];

  /**
   * 带分页和排序的查询
   */
  query(options: QueryOptions<T>): QueryResult<T>;

  /**
   * 关闭存储
   */
  close(): void;

  /**
   * 清空所有数据
   */
  clear(): void;
}

/**
 * 存储工厂接口 - 用于创建存储实例
 */
export interface StorageFactory {
  createStorage<T extends Record<string, unknown>>(name: string): Storage<T>;
}

/**
 * 存储事件监听器
 */
export interface StorageEventMap {
  insert: { id: string; entity: Record<string, unknown> };
  update: { id: string; changes: Partial<Record<string, unknown>> };
  delete: { id: string };
  clear: void;
}

/**
 * 存储可观察接口 - 支持事件监听
 */
export interface ObservableStorage<T extends Record<string, unknown>> extends Storage<T> {
  on<K extends keyof StorageEventMap>(
    event: K,
    listener: (data: StorageEventMap[K]) => void
  ): () => void;

  off<K extends keyof StorageEventMap>(
    event: K,
    listener: (data: StorageEventMap[K]) => void
  ): void;

  emit<K extends keyof StorageEventMap>(event: K, data: StorageEventMap[K]): void;
}

/**
 * 存储配置
 */
export interface StorageConfig {
  path: string;
  prettyPrint?: boolean;
  syncOnWrite?: boolean;
}

/**
 * 默认存储配置
 */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  path: './data',
  prettyPrint: false,
  syncOnWrite: true,
};
