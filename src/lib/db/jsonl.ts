/**
 * FileStorage 模块 - JSONL 存储适配器
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { Entity, QueryOptions, QueryResult } from './types';
import type { Storage, StorageConfig } from './storage';
import { StorageError } from './errors';

/**
 * JSONL 存储适配器
 * 将实体以 JSON Lines 格式存储在文件中
 */
export class JSONLStorage<T extends Record<string, unknown> = Record<string, unknown>>
  implements Storage<T>
{
  private path: string;
  private prettyPrint: boolean;
  private syncOnWrite: boolean;
  private data: Map<string, T> = new Map();

  constructor(config: StorageConfig) {
    this.path = config.path;
    this.prettyPrint = config.prettyPrint ?? false;
    this.syncOnWrite = config.syncOnWrite ?? true;
    this.ensureDirectory();
    this.load();
  }

  /**
   * 确保目录存在
   */
  private ensureDirectory(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 从文件加载数据
   */
  private load(): void {
    if (!existsSync(this.path)) {
      this.data.clear();
      return;
    }

    try {
      const content = readFileSync(this.path, 'utf-8');
      if (!content.trim()) {
        this.data.clear();
        return;
      }

      const lines = content.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const entity = JSON.parse(line) as T;
            if (entity.id && typeof entity.id === 'string') {
              this.data.set(entity.id, entity);
            }
          } catch {
            // 忽略解析错误的行
          }
        }
      }
    } catch (error) {
      throw new StorageError({
        type: 'IO_ERROR',
        message: `Failed to load storage file: ${error instanceof Error ? error.message : String(error)}`,
        path: this.path,
        cause: error,
      });
    }
  }

  /**
   * 保存数据到文件
   */
  private save(): void {
    try {
      const lines: string[] = [];
      for (const entity of this.data.values()) {
        const line = this.prettyPrint
          ? JSON.stringify(entity, null, 2)
          : JSON.stringify(entity);
        lines.push(line);
      }
      const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
      writeFileSync(this.path, content, 'utf-8');
    } catch (error) {
      throw new StorageError({
        type: 'IO_ERROR',
        message: `Failed to save storage file: ${error instanceof Error ? error.message : String(error)}`,
        path: this.path,
        cause: error,
      });
    }
  }

  /**
   * 同步数据到磁盘
   */
  private sync(): void {
    if (this.syncOnWrite) {
      this.save();
    }
  }

  /**
   * 插入实体
   */
  insert(entity: T): T {
    if (!entity.id) {
      throw new StorageError({
        type: 'VALIDATION_ERROR',
        message: 'Entity must have an id field',
        field: 'id',
      });
    }

    if (this.data.has(entity.id)) {
      throw new StorageError({
        type: 'DUPLICATE_KEY',
        message: `Entity with id '${entity.id}' already exists`,
        code: 'DUPLICATE_KEY',
        path: this.path,
      });
    }

    const timestamp = new Date().toISOString();
    const entityWithTimestamp = {
      ...entity,
      createdAt: entity.createdAt ?? timestamp,
      updatedAt: timestamp,
    } as T & { createdAt?: string; updatedAt?: string };

    this.data.set(entity.id, entityWithTimestamp);
    this.sync();

    return entityWithTimestamp;
  }

  /**
   * 根据 ID 查找实体
   */
  find(id: string): T | null {
    return this.data.get(id) ?? null;
  }

  /**
   * 更新实体
   */
  update(id: string, data: Partial<T>): boolean {
    const existing = this.data.get(id);
    if (!existing) {
      return false;
    }

    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    } as T;

    this.data.set(id, updated);
    this.sync();

    return true;
  }

  /**
   * 删除实体
   */
  delete(id: string): boolean {
    const deleted = this.data.delete(id);
    if (deleted) {
      this.sync();
    }
    return deleted;
  }

  /**
   * 获取所有实体
   */
  all(): T[] {
    return Array.from(this.data.values());
  }

  /**
   * 条件查询
   */
  where(filter: Partial<T>): T[] {
    return Array.from(this.data.values()).filter((entity) => {
      return Object.entries(filter).every(([key, value]) => {
        const entityValue = entity[key];
        if (entityValue === undefined && value !== undefined) {
          return false;
        }
        return entityValue === value;
      });
    });
  }

  /**
   * 带分页和排序的查询
   */
  query(options: QueryOptions<T>): QueryResult<T> {
    let results = this.all();

    // 应用条件过滤
    if (options.where) {
      results = results.filter((entity) => {
        return Object.entries(options.where!).every(([key, value]) => {
          return entity[key] === value;
        });
      });
    }

    // 应用排序
    if (options.sort) {
      const { field, order } = options.sort;
      results.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (aVal === bVal) return 0;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;
        const comparison = aVal < bVal ? -1 : 1;
        return order === 'asc' ? comparison : -comparison;
      });
    }

    // 计算总数
    const total = results.length;

    // 应用分页
    const limit = options.pagination?.limit ?? results.length;
    const offset = options.pagination?.offset ?? 0;
    const items = results.slice(offset, offset + limit);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * 关闭存储
   */
  close(): void {
    this.save();
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.data.clear();
    this.save();
  }

  /**
   * 获取存储路径
   */
  getPath(): string {
    return this.path;
  }

  /**
   * 获取实体数量
   */
  size(): number {
    return this.data.size;
  }

  /**
   * 检查是否存在
   */
  exists(id: string): boolean {
    return this.data.has(id);
  }
}

/**
 * 创建 JSONL 存储实例的便捷函数
 */
export function createJSONLStorage<T extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  options?: Partial<StorageConfig>
): JSONLStorage<T> {
  return new JSONLStorage<T>({
    path,
    ...options,
  });
}
