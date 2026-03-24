/**
 * IStoragePort - 存储能力接口
 *
 * ┌─────────────────────────────────────────┐
 * │  L2 Environment                         │
 * │  ─────────────────────────────────     │
 * │  - 持有 IStoragePort 实例               │
 * │  - 提供给 Service 使用                   │
 * └─────────────────────────────────────────┘
 */

/**
 * 查询条件
 */
export interface QueryOptions<T = Record<string, unknown>> {
  where?: Partial<T>;
  limit?: number;
  offset?: number;
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

/**
 * 存储查询结果
 */
export interface QueryResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/**
 * 存储 Port 接口
 *
 * 特点：
 * - 跨平台兼容：Web (localStorage) / Tauri (SQLite)
 * - 简单键值存储 + 可选查询能力
 */
export interface IStoragePort {
  /**
   * 写入数据
   */
  write<T>(key: string, data: T): Promise<void>;

  /**
   * 读取数据
   */
  read<T>(key: string): Promise<T | null>;

  /**
   * 删除数据
   */
  delete(key: string): Promise<void>;

  /**
   * 批量读取所有数据
   */
  readAll<T>(): Promise<Map<string, T>>;

  /**
   * 清空所有数据
   */
  clear(): Promise<void>;

  /**
   * 查询数据（可选能力）
   */
  query<T>(options: QueryOptions<T>): Promise<QueryResult<T>>;
}
