/**
 * FileStorage 模块 - 索引导出测试
 */

import { describe, it, expect } from 'vitest';
import { JSONLStorage, createJSONLStorage, SQLiteStorage, createSQLiteStorage, StorageError, ok, fail, isSuccess, unwrap, unwrapOr } from '../../src/lib/db';

describe('Module exports', () => {
  describe('JSONLStorage', () => {
    it('应该导出 JSONLStorage 类', () => {
      expect(typeof JSONLStorage).toBe('function');
      expect(JSONLStorage).toBeDefined();
    });

    it('应该导出 createJSONLStorage 函数', () => {
      expect(typeof createJSONLStorage).toBe('function');
      expect(createJSONLStorage).toBeDefined();
    });
  });

  describe('SQLiteStorage', () => {
    it('应该导出 SQLiteStorage 类', () => {
      expect(typeof SQLiteStorage).toBe('function');
      expect(SQLiteStorage).toBeDefined();
    });

    it('应该导出 createSQLiteStorage 函数', () => {
      expect(typeof createSQLiteStorage).toBe('function');
      expect(createSQLiteStorage).toBeDefined();
    });
  });

  describe('Error utilities', () => {
    it('应该导出 StorageError 类', () => {
      expect(typeof StorageError).toBe('function');
      expect(StorageError).toBeDefined();
    });

    it('应该导出 Result helpers', () => {
      expect(typeof ok).toBe('function');
      expect(typeof fail).toBe('function');
      expect(typeof isSuccess).toBe('function');
      expect(typeof unwrap).toBe('function');
      expect(typeof unwrapOr).toBe('function');
    });
  });
});
