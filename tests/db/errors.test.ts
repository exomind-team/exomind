/**
 * FileStorage 模块 - 错误处理单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StorageError,
  ok,
  fail,
  isSuccess,
  unwrap,
  unwrapOr,
  map,
  andThen,
} from '../../src/lib/db/errors';

describe('StorageError', () => {
  describe('构造', () => {
    it('应该创建包含所有属性的错误', () => {
      const error = new StorageError({
        type: 'NOT_FOUND',
        message: 'Entity not found',
        path: '/test/path',
        line: 10,
        field: 'id',
        code: 'NOT_FOUND',
      });

      expect(error.name).toBe('StorageError');
      expect(error.type).toBe('NOT_FOUND');
      expect(error.message).toBe('Entity not found');
      expect(error.path).toBe('/test/path');
      expect(error.line).toBe(10);
      expect(error.field).toBe('id');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('应该支持可选属性', () => {
      const error = new StorageError({
        type: 'UNKNOWN',
        message: 'Unknown error',
      });

      expect(error.path).toBeUndefined();
      expect(error.line).toBeUndefined();
      expect(error.field).toBeUndefined();
    });
  });

  describe('is()', () => {
    it('应该正确判断错误类型', () => {
      const notFoundError = new StorageError({
        type: 'NOT_FOUND',
        message: 'Not found',
      });

      const ioError = new StorageError({
        type: 'IO_ERROR',
        message: 'IO error',
      });

      expect(notFoundError.is('NOT_FOUND')).toBe(true);
      expect(notFoundError.is('IO_ERROR')).toBe(false);
      expect(ioError.is('IO_ERROR')).toBe(true);
    });
  });

  describe('toJSON()', () => {
    it('应该返回可序列化的对象', () => {
      const error = new StorageError({
        type: 'VALIDATION_ERROR',
        message: 'Validation failed',
        field: 'name',
      });

      const json = error.toJSON();

      expect(json).toEqual({
        name: 'StorageError',
        type: 'VALIDATION_ERROR',
        message: 'Validation failed',
        path: undefined,
        line: undefined,
        field: 'name',
        code: undefined,
      });
    });
  });

  describe('from()', () => {
    it('应该从 Error 对象创建 StorageError', () => {
      const originalError = new Error('File not found');
      const storageError = StorageError.from(originalError, 'Custom message');

      expect(storageError.message).toBe('File not found');
    });

    it('应该从字符串创建 StorageError', () => {
      const storageError = StorageError.from('Some error', 'Custom message');

      expect(storageError.message).toBe('Some error');
    });

    it('应该保留已有的 StorageError', () => {
      const originalError = new StorageError({
        type: 'NOT_FOUND',
        message: 'Original error',
      });

      const storageError = StorageError.from(originalError);

      expect(storageError.type).toBe('NOT_FOUND');
      expect(storageError.message).toBe('Original error');
    });
  });
});

describe('Result helpers', () => {
  describe('ok()', () => {
    it('应该创建成功结果', () => {
      const result = ok(42);

      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });
  });

  describe('fail()', () => {
    it('应该创建失败结果', () => {
      const error = new StorageError({
        type: 'NOT_FOUND',
        message: 'Not found',
      });
      const result = fail(error);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('isSuccess()', () => {
    it('应该正确判断成功结果', () => {
      const successResult = ok(42);
      const error = new StorageError({ type: 'UNKNOWN', message: 'Error' });
      const failResult = fail(error);

      expect(isSuccess(successResult)).toBe(true);
      expect(isSuccess(failResult)).toBe(false);
    });
  });

  describe('unwrap()', () => {
    it('应该从成功结果提取数据', () => {
      const result = ok(42);

      expect(unwrap(result)).toBe(42);
    });

    it('应该从失败结果抛出错误', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      const result = fail(error);

      expect(() => unwrap(result)).toThrow(StorageError);
    });
  });

  describe('unwrapOr()', () => {
    it('应该从成功结果提取数据', () => {
      const result = ok(42);

      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('应该从失败结果返回默认值', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      const result = fail(error);

      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('map()', () => {
    it('应该映射成功结果的值', () => {
      const result = ok(5);
      const mapped = map(result, (x) => x * 2);

      expect(mapped.success).toBe(true);
      expect((mapped as { success: true; data: number }).data).toBe(10);
    });

    it('应该透传失败结果', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      const result = fail(error);
      const mapped = map(result, (x) => x * 2);

      expect(mapped.success).toBe(false);
      expect((mapped as { success: false; error: StorageError }).error).toBe(error);
    });
  });

  describe('andThen()', () => {
    it('应该链式操作成功结果', () => {
      const result = ok(5);
      const chained = andThen(result, (x) => ok(x * 2));

      expect(chained.success).toBe(true);
      expect((chained as { success: true; data: number }).data).toBe(10);
    });

    it('应该透传失败结果', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      const result = fail(error);
      const chained = andThen(result, (x) => ok(x * 2));

      expect(chained.success).toBe(false);
    });
  });
});
