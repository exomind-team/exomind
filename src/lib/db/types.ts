/**
 * FileStorage 模块 - 类型定义
 */

/**
 * 存储实体基础接口
 */
export interface Entity {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 分页查询参数
 */
export interface Pagination {
  limit?: number;
  offset?: number;
}

/**
 * 排序参数
 */
export interface Sort {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * 查询条件
 */
export interface QueryOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  where?: Partial<T>;
  pagination?: Pagination;
  sort?: Sort;
}

/**
 * 存储查询结果
 */
export interface QueryResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}
