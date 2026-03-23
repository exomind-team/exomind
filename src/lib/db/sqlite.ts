/**
 * FileStorage 模块 - SQLite 存储适配器
 */

import type { Entity, QueryOptions, QueryResult } from './types';
import type { Storage, StorageConfig } from './storage';
import { StorageError, ok, fail } from './errors';

/**
 * SQLite 存储适配器（预留实现）
 * 遵循 Storage 接口规范
 */
export class SQLiteStorage<T extends Record<string, unknown> = Record<string, unknown>>
  implements Storage<T>
{
  private db: unknown;
  private path: string;
  private tableName: string;
  private tables: Map<string, Record<string, unknown>[]>;

  constructor(config: StorageConfig) {
    this.path = config.path;
    this.tableName = 'entities';
    this.tables = new Map();
    this.db = this.createInMemoryDB();
  }

  /**
   * 创建内存数据库模拟
   */
  private createInMemoryDB(): Record<string, unknown> {
    const self = this;

    return {
      exec: (sql: string) => {
        sql = sql.trim();
        if (sql.startsWith('CREATE TABLE')) {
          const tableName = this.parseTableName(sql);
          if (tableName && !self.tables.has(tableName)) {
            self.tables.set(tableName, []);
          }
        }
        return { changes: 0 };
      },
      prepare: (sql: string) => {
        const trimmedSql = sql.trim();
        const isDDL = this.isDDL(trimmedSql);

        return {
          run: (..._params: unknown[]) => {
            if (isDDL) {
              return self.run(sql);
            }
            const op = trimmedSql.split(' ')[0].toUpperCase();
            if (['INSERT', 'UPDATE', 'DELETE'].includes(op)) {
              return { changes: 1 };
            }
            return { changes: 0 };
          },
          get: (..._params: unknown[]) => {
            if (trimmedSql.includes('COUNT')) {
              const tableName = this.parseTableNameFromSql(trimmedSql);
              if (tableName) {
                const count = self.tables.get(tableName)?.length || 0;
                return { count };
              }
            }
            return null;
          },
          all: (..._params: unknown[]) => {
            return [];
          },
        };
      },
    };
  }

  private parseTableName(sql: string): string | null {
    const afterCreate = sql.substring(13).trim();
    const firstSpace = afterCreate.indexOf(' ');
    const parenIndex = afterCreate.indexOf('(');
    let tableName: string;

    if (firstSpace > 0 && (parenIndex < 0 || firstSpace < parenIndex)) {
      tableName = afterCreate.substring(0, firstSpace);
    } else if (parenIndex > 0) {
      tableName = afterCreate.substring(0, parenIndex);
    } else {
      tableName = afterCreate;
    }

    return tableName.trim() || null;
  }

  private parseTableNameFromSql(sql: string): string | null {
    const parts = sql.split('FROM');
    if (parts[1]) {
      return parts[1].trim().split(' ')[0].trim() || null;
    }
    return null;
  }

  private isDDL(sql: string): boolean {
    const upper = sql.trim().toUpperCase();
    return (
      upper.startsWith('CREATE TABLE') ||
      upper.startsWith('DROP TABLE') ||
      upper.startsWith('ALTER TABLE')
    );
  }

  private run(sql: string): { changes: number } {
    const trimmedSql = sql.trim();
    if (trimmedSql.startsWith('CREATE TABLE')) {
      const tableName = this.parseTableName(trimmedSql);
      if (tableName && !this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
    }
    return { changes: 0 };
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

    const table = this.tables.get(this.tableName) || [];

    if (table.some((e) => e.id === entity.id)) {
      throw new StorageError({
        type: 'DUPLICATE_KEY',
        message: `Entity with id '${entity.id}' already exists`,
        code: 'DUPLICATE_KEY',
      });
    }

    const timestamp = new Date().toISOString();
    const entityWithTimestamp = {
      ...entity,
      createdAt: entity.createdAt ?? timestamp,
      updatedAt: timestamp,
    } as T & { createdAt?: string; updatedAt?: string };

    table.push(entityWithTimestamp);
    this.tables.set(this.tableName, table);

    return entityWithTimestamp;
  }

  /**
   * 根据 ID 查找实体
   */
  find(id: string): T | null {
    const table = this.tables.get(this.tableName) || [];
    const entity = table.find((e) => e.id === id);
    return (entity as T) || null;
  }

  /**
   * 更新实体
   */
  update(id: string, data: Partial<T>): boolean {
    const table = this.tables.get(this.tableName) || [];
    const index = table.findIndex((e) => e.id === id);

    if (index === -1) {
      return false;
    }

    const existing = table[index];
    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    } as T;

    table[index] = updated;
    this.tables.set(this.tableName, table);

    return true;
  }

  /**
   * 删除实体
   */
  delete(id: string): boolean {
    const table = this.tables.get(this.tableName) || [];
    const index = table.findIndex((e) => e.id === id);

    if (index === -1) {
      return false;
    }

    table.splice(index, 1);
    this.tables.set(this.tableName, table);

    return true;
  }

  /**
   * 获取所有实体
   */
  all(): T[] {
    const table = this.tables.get(this.tableName) || [];
    return [...table] as T[];
  }

  /**
   * 条件查询
   */
  where(filter: Partial<T>): T[] {
    const table = this.tables.get(this.tableName) || [];
    return table.filter((entity) => {
      return Object.entries(filter).every(([key, value]) => {
        return entity[key] === value;
      });
    }) as T[];
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

    const total = results.length;

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
    if (this.db && typeof (this.db as Record<string, unknown>).close === 'function') {
      (this.db as Record<string, () => void>).close();
    }
    this.db = null;
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.tables.set(this.tableName, []);
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
    const table = this.tables.get(this.tableName) || [];
    return table.length;
  }

  /**
   * 检查是否存在
   */
  exists(id: string): boolean {
    const table = this.tables.get(this.tableName) || [];
    return table.some((e) => e.id === id);
  }
}

/**
 * 创建 SQLite 存储实例的便捷函数
 */
export function createSQLiteStorage<T extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  options?: Partial<StorageConfig>
): SQLiteStorage<T> {
  return new SQLiteStorage<T>({
    path,
    ...options,
  });
}
