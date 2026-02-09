/**
 * FileStorage 模块 - 统一错误处理
 */

/**
 * 存储错误类型
 */
export type StorageErrorType =
  | 'NOT_FOUND'
  | 'DUPLICATE_KEY'
  | 'IO_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';

/**
 * 存储错误详情
 */
export interface StorageErrorDetails {
  type: StorageErrorType;
  message: string;
  path?: string;
  line?: number;
  field?: string;
  code?: string;
  cause?: unknown;
}

/**
 * 存储错误类
 */
export class StorageError extends Error {
  public readonly type: StorageErrorType;
  public readonly path?: string;
  public readonly line?: number;
  public readonly field?: string;
  public readonly code?: string;

  constructor(details: StorageErrorDetails) {
    super(details.message);
    this.name = 'StorageError';
    this.type = details.type;
    this.path = details.path;
    this.line = details.line;
    this.field = details.field;
    this.code = details.code;
    if (details.cause) {
      this.cause = details.cause;
    }
  }

  /**
   * 检查是否为特定类型错误
   */
  is(type: StorageErrorType): boolean {
    return this.type === type;
  }

  /**
   * 转换为可序列化的对象
   */
  toJSON(): object {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      path: this.path,
      line: this.line,
      field: this.field,
      code: this.code,
    };
  }

  /**
   * 从错误对象创建 StorageError
   */
  static from(error: unknown, defaultMessage: string = 'Unknown storage error'): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message || defaultMessage;

      // 根据错误消息推断类型
      if (message.includes('ENOENT') || message.includes('not found')) {
        return new StorageError({
          type: 'NOT_FOUND',
          message,
          cause: error,
        });
      }

      if (message.includes('EACCES') || message.includes('permission')) {
        return new StorageError({
          type: 'PERMISSION_DENIED',
          message,
          cause: error,
        });
      }

      return new StorageError({
        type: 'UNKNOWN',
        message,
        cause: error,
      });
    }

    return new StorageError({
      type: 'UNKNOWN',
      message: String(error) || defaultMessage,
    });
  }
}

/**
 * 存储操作结果
 */
export type StorageResult<T> = T extends void
  ? { success: true } | { success: false; error: StorageError }
  : { success: true; data: T } | { success: false; error: StorageError };

/**
 * 创建成功结果
 */
export function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

/**
 * 创建失败结果
 */
export function fail(error: StorageError): { success: false; error: StorageError } {
  return { success: false, error };
}

/**
 * 检查结果是否成功
 */
export function isSuccess<T>(result: StorageResult<T>): result is { success: true; data: T } {
  return result.success;
}

/**
 * 提取成功数据或抛出错误
 */
export function unwrap<T>(result: StorageResult<T>): T {
  if (result.success) {
    if ('data' in result) {
      return result.data;
    }
    return undefined as T;
  }
  throw result.error;
}

/**
 * 提取成功数据或返回默认值
 */
export function unwrapOr<T>(result: StorageResult<T>, defaultValue: T): T {
  if (result.success && 'data' in result) {
    return result.data;
  }
  return defaultValue;
}

/**
 * 映射成功数据的值
 */
export function map<T, U>(
  result: StorageResult<T>,
  fn: (value: T) => U
): StorageResult<U> {
  if (result.success) {
    if ('data' in result) {
      return { success: true, data: fn(result.data) };
    }
    return { success: true, data: fn(undefined as unknown as T) };
  }
  return result;
}

/**
 * 链式操作
 */
export function andThen<T, U>(
  result: StorageResult<T>,
  fn: (value: T) => StorageResult<U>
): StorageResult<U> {
  if (result.success) {
    if ('data' in result) {
      return fn(result.data);
    }
    return fn(undefined as unknown as T);
  }
  return result;
}
