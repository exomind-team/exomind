/**
 * FileStorage 模块 - JSONL 存储单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { JSONLStorage } from '../../src/lib/db/jsonl';
import { StorageError } from '../../src/lib/db/errors';

interface TestEntity {
  id: string;
  name: string;
  value?: number;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

describe('JSONLStorage', () => {
  const testDir = join(__dirname, 'test-data');
  const testFile = join(testDir, 'test-storage.jsonl');

  beforeEach(() => {
    // 确保测试目录存在
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    // 清理测试文件
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  afterEach(() => {
    // 清理测试文件
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('构造', () => {
    it('应该创建存储实例', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      expect(storage).toBeDefined();
      expect(storage.size()).toBe(0);
    });

    it('应该加载已存在的文件', () => {
      // 先创建一些数据
      const storage1 = new JSONLStorage<TestEntity>({ path: testFile });
      storage1.insert({ id: '1', name: 'Test1' });
      storage1.insert({ id: '2', name: 'Test2' });
      storage1.close();

      // 重新加载
      const storage2 = new JSONLStorage<TestEntity>({ path: testFile });

      expect(storage2.size()).toBe(2);
      expect(storage2.find('1')).toMatchObject({ id: '1', name: 'Test1' });
      expect(storage2.find('2')).toMatchObject({ id: '2', name: 'Test2' });
    });
  });

  describe('insert()', () => {
    it('应该插入实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const entity = storage.insert({ id: '1', name: 'Test' });

      expect(entity.id).toBe('1');
      expect(entity.name).toBe('Test');
      expect(storage.size()).toBe(1);
    });

    it('应该自动添加时间戳', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const entity = storage.insert({ id: '1', name: 'Test' });

      expect(entity.createdAt).toBeDefined();
      expect(entity.updatedAt).toBeDefined();
      expect(typeof entity.createdAt).toBe('string');
    });

    it('应该保留已存在的 createdAt', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      const existingCreatedAt = '2024-01-01T00:00:00.000Z';

      const entity = storage.insert({
        id: '1',
        name: 'Test',
        createdAt: existingCreatedAt,
      });

      expect(entity.createdAt).toBe(existingCreatedAt);
    });

    it('应该抛出 VALIDATION_ERROR 当 id 缺失', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      expect(() => storage.insert({ name: 'Test' } as TestEntity)).toThrow(
        StorageError
      );
    });

    it('应该抛出 DUPLICATE_KEY 当 id 已存在', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      storage.insert({ id: '1', name: 'Test1' });

      expect(() => storage.insert({ id: '1', name: 'Test2' })).toThrow(
        StorageError
      );
    });
  });

  describe('find()', () => {
    it('应该返回找到的实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test' });

      const entity = storage.find('1');

      expect(entity).toMatchObject({ id: '1', name: 'Test' });
    });

    it('应该返回 null 当实体不存在', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const entity = storage.find('non-existent');

      expect(entity).toBeNull();
    });
  });

  describe('update()', () => {
    it('应该更新实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Original' });

      const result = storage.update('1', { name: 'Updated' });

      expect(result).toBe(true);
      expect(storage.find('1')).toMatchObject({
        id: '1',
        name: 'Updated',
      });
    });

    it('应该更新 updatedAt 时间戳', async () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test' });

      // 等待一小段时间
      const original = storage.find('1')!;

      // 等待一小段时间
      await new Promise((resolve) => setTimeout(resolve, 10));

      storage.update('1', { name: 'Updated' });
      const updated = storage.find('1')!;

      expect(updated.updatedAt).not.toBe(original.updatedAt);
    });

    it('应该返回 false 当实体不存在', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const result = storage.update('non-existent', { name: 'Updated' });

      expect(result).toBe(false);
    });
  });

  describe('delete()', () => {
    it('应该删除实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test' });

      const result = storage.delete('1');

      expect(result).toBe(true);
      expect(storage.size()).toBe(0);
      expect(storage.find('1')).toBeNull();
    });

    it('应该返回 false 当实体不存在', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const result = storage.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('all()', () => {
    it('应该返回所有实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test1' });
      storage.insert({ id: '2', name: 'Test2' });
      storage.insert({ id: '3', name: 'Test3' });

      const all = storage.all();

      expect(all).toHaveLength(3);
      expect(all.map((e) => e.id).sort()).toEqual(['1', '2', '3']);
    });

    it('应该返回空数组当没有实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      const all = storage.all();

      expect(all).toEqual([]);
    });
  });

  describe('where()', () => {
    it('应该返回匹配的实体', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Apple', value: 1 });
      storage.insert({ id: '2', name: 'Banana', value: 2 });
      storage.insert({ id: '3', name: 'Apple', value: 3 });

      const results = storage.where({ name: 'Apple' });

      expect(results).toHaveLength(2);
      expect(results.every((e) => e.name === 'Apple')).toBe(true);
    });

    it('应该支持多条件查询', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Apple', value: 1 });
      storage.insert({ id: '2', name: 'Banana', value: 2 });
      storage.insert({ id: '3', name: 'Apple', value: 2 });

      const results = storage.where({ name: 'Apple', value: 2 });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('3');
    });
  });

  describe('query()', () => {
    it('应该支持分页查询', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      for (let i = 1; i <= 10; i++) {
        storage.insert({ id: String(i), name: `Item ${i}` });
      }

      const result = storage.query({
        pagination: { limit: 3, offset: 2 },
      });

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(10);
      expect(result.hasMore).toBe(true);
      expect(result.items[0]?.id).toBe('3');
    });

    it('应该支持排序', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', value: 30 });
      storage.insert({ id: '2', value: 10 });
      storage.insert({ id: '3', value: 20 });

      const resultAsc = storage.query({
        sort: { field: 'value', order: 'asc' },
      });

      expect(resultAsc.items[0]?.id).toBe('2');
      expect(resultAsc.items[1]?.id).toBe('3');
      expect(resultAsc.items[2]?.id).toBe('1');

      const resultDesc = storage.query({
        sort: { field: 'value', order: 'desc' },
      });

      expect(resultDesc.items[0]?.id).toBe('1');
    });

    it('应该支持条件过滤 + 分页 + 排序', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Apple', value: 10 });
      storage.insert({ id: '2', name: 'Banana', value: 5 });
      storage.insert({ id: '3', name: 'Apple', value: 20 });
      storage.insert({ id: '4', name: 'Apple', value: 15 });

      const result = storage.query({
        where: { name: 'Apple' },
        sort: { field: 'value', order: 'desc' },
        pagination: { limit: 2, offset: 0 },
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.items[0]?.id).toBe('3');
      expect(result.items[1]?.id).toBe('4');
    });
  });

  describe('clear()', () => {
    it('应该清空所有数据', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test1' });
      storage.insert({ id: '2', name: 'Test2' });

      storage.clear();

      expect(storage.size()).toBe(0);
      expect(storage.all()).toEqual([]);
    });
  });

  describe('close()', () => {
    it('应该关闭存储并保存数据', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test' });
      storage.insert({ id: '2', name: 'Test2' });

      storage.close();

      // 重新加载验证数据已保存
      const storage2 = new JSONLStorage<TestEntity>({ path: testFile });
      expect(storage2.size()).toBe(2);
    });
  });

  describe('exists()', () => {
    it('应该检查实体是否存在', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });
      storage.insert({ id: '1', name: 'Test' });

      expect(storage.exists('1')).toBe(true);
      expect(storage.exists('2')).toBe(false);
    });
  });

  describe('getPath()', () => {
    it('应该返回存储路径', () => {
      const storage = new JSONLStorage<TestEntity>({ path: testFile });

      expect(storage.getPath()).toBe(testFile);
    });
  });
});
