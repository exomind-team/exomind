/**
 * FileStorage 模块 - 单元测试
 */

import { describe, it, expect, beforeEach, vi, SpyInstance } from 'vitest';
import { JSONLStorage, createJSONLStorage } from './jsonl';
import { StorageError, ok, fail, isSuccess, unwrap, unwrapOr, map, andThen } from './errors';
import type { Entity, QueryOptions } from './types';

// Mock fs module
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => {
  const api = {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
  return {
    ...api,
    default: api,
  };
});

describe('JSONLStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');
    mockWriteFileSync.mockReturnValue(undefined);
    mockMkdirSync.mockReturnValue(undefined);
  });

  describe('constructor', () => {
    it('should load existing data on initialization', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"1","name":"Test","createdAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z"}\n'
      );

      const storage = createJSONLStorage<Entity>('/test/data.jsonl');
      const result = storage.find('1');

      expect(result?.id).toBe('1');
      expect(result?.name).toBe('Test');
    });
  });

  describe('insert', () => {
    it('should insert entity and generate timestamps', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');
      const entity = { id: 'test-id', name: 'Test Name' };

      const result = storage.insert(entity);

      expect(result.id).toBe('test-id');
      expect(result.name).toBe('Test Name');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should throw error for entity without id', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      expect(() => storage.insert({ name: 'Test' } as unknown as Entity)).toThrow(StorageError);
    });

    it('should throw error for duplicate id', () => {
      mockReadFileSync.mockReturnValue('{"id":"existing","name":"First"}\n');
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      expect(() => storage.insert({ id: 'existing', name: 'Second' })).toThrow(StorageError);
    });
  });

  describe('find', () => {
    it('should return null for non-existent id', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.find('non-existent');

      expect(result).toBeNull();
    });

    it('should return entity when found', () => {
      mockReadFileSync.mockReturnValue('{"id":"test-id","name":"Test"}\n');
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.find('test-id');

      expect(result?.id).toBe('test-id');
      expect(result?.name).toBe('Test');
    });
  });

  describe('update', () => {
    it('should update existing entity', () => {
      mockReadFileSync.mockReturnValue('{"id":"test-id","name":"OldName"}\n');
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.update('test-id', { name: 'NewName' });

      expect(result).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should return false for non-existent id', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.update('non-existent', { name: 'New' });

      expect(result).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing entity', () => {
      mockReadFileSync.mockReturnValue('{"id":"test-id","name":"Test"}\n');
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.delete('test-id');

      expect(result).toBe(true);
    });

    it('should return false for non-existent id', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('all', () => {
    it('should return all entities', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"1","name":"A"}\n{"id":"2","name":"B"}\n{"id":"3","name":"C"}\n'
      );
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.all();

      expect(result).toHaveLength(3);
    });
  });

  describe('where', () => {
    it('should filter entities by condition', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"1","name":"A","type":"foo"}\n{"id":"2","name":"B","type":"bar"}\n{"id":"3","name":"C","type":"foo"}\n'
      );
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.where({ type: 'foo' });

      expect(result).toHaveLength(2);
    });
  });

  describe('query', () => {
    it('should support pagination', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"1","name":"A"}\n{"id":"2","name":"B"}\n{"id":"3","name":"C"}\n'
      );
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.query<Entity>({
        pagination: { limit: 2, offset: 0 },
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(true);
    });

    it('should support sorting', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"3","name":"C","order":3}\n{"id":"1","name":"A","order":1}\n{"id":"2","name":"B","order":2}\n'
      );
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      const result = storage.query<Entity>({
        sort: { field: 'order', order: 'asc' },
      });

      expect(result.items[0].id).toBe('1');
      expect(result.items[1].id).toBe('2');
      expect(result.items[2].id).toBe('3');
    });
  });

  describe('exists', () => {
    it('should return true for existing entity', () => {
      mockReadFileSync.mockReturnValue('{"id":"test-id","name":"Test"}\n');
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      expect(storage.exists('test-id')).toBe(true);
    });

    it('should return false for non-existing entity', () => {
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      expect(storage.exists('non-existent')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return correct count', () => {
      mockReadFileSync.mockReturnValue(
        '{"id":"1"}\n{"id":"2"}\n{"id":"3"}\n'
      );
      const storage = createJSONLStorage<Entity>('/test/data.jsonl');

      expect(storage.size()).toBe(3);
    });
  });
});

describe('StorageError', () => {
  it('should create error with all properties', () => {
    const error = new StorageError({
      type: 'IO_ERROR',
      message: 'Test error',
      path: '/test/path',
      line: 10,
      field: 'data',
      code: 'EIO',
    });

    expect(error.type).toBe('IO_ERROR');
    expect(error.message).toBe('Test error');
    expect(error.path).toBe('/test/path');
    expect(error.line).toBe(10);
    expect(error.field).toBe('data');
    expect(error.code).toBe('EIO');
  });

  it('should check error type correctly', () => {
    const error = new StorageError({
      type: 'NOT_FOUND',
      message: 'Not found',
    });

    expect(error.is('NOT_FOUND')).toBe(true);
    expect(error.is('IO_ERROR')).toBe(false);
  });

  it('should convert to JSON', () => {
    const error = new StorageError({
      type: 'VALIDATION_ERROR',
      message: 'Invalid data',
      field: 'id',
    });

    const json = error.toJSON();

    expect(json.type).toBe('VALIDATION_ERROR');
    expect((json as any).field).toBe('id');
  });

  it('should create error from unknown type', () => {
    const error = StorageError.from('some error string');

    expect(error.type).toBe('UNKNOWN');
  });

  it('should preserve StorageError from error object', () => {
    const original = new StorageError({
      type: 'NOT_FOUND',
      message: 'Original error',
    });

    const wrapped = StorageError.from(original);

    expect(wrapped.type).toBe('NOT_FOUND');
    expect(wrapped.message).toBe('Original error');
  });

  it('should infer type from error message', () => {
    const error = StorageError.from(new Error('ENOENT: file not found'));

    expect(error.type).toBe('NOT_FOUND');
  });
});

describe('StorageResult helpers', () => {
  describe('ok/fail', () => {
    it('should create success result', () => {
      const result = ok('data');

      expect(result.success).toBe(true);
      expect(result.data).toBe('data');
    });

    it('should create failure result', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      const result = fail(error);

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('isSuccess', () => {
    it('should return true for success result', () => {
      expect(isSuccess(ok('data'))).toBe(true);
    });

    it('should return false for failure result', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: '' });
      expect(isSuccess(fail(error))).toBe(false);
    });
  });

  describe('unwrap', () => {
    it('should return data from success result', () => {
      expect(unwrap(ok('data'))).toBe('data');
    });

    it('should throw error from failure result', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: 'Not found' });
      expect(() => unwrap(fail(error))).toThrow(StorageError);
    });
  });

  describe('unwrapOr', () => {
    it('should return data from success result', () => {
      expect(unwrapOr(ok('data'), 'default')).toBe('data');
    });

    it('should return default from failure result', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: '' });
      expect(unwrapOr(fail(error), 'default')).toBe('default');
    });
  });

  describe('map', () => {
    it('should transform success result', () => {
      const result = map(ok(5), (n) => n * 2);

      expect(result.success).toBe(true);
      expect((result as any).data).toBe(10);
    });

    it('should pass through failure result', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: '' });
      const result = map(fail(error), (n: number) => n * 2);

      expect(result.success).toBe(false);
    });
  });

  describe('andThen', () => {
    it('should chain success results', () => {
      const result = andThen(ok(5), (n) => ok(n * 2));

      expect(result.success).toBe(true);
      expect((result as any).data).toBe(10);
    });

    it('should short-circuit on failure', () => {
      const error = new StorageError({ type: 'NOT_FOUND', message: '' });
      const result = andThen(fail(error), (n: number) => ok(n * 2));

      expect(result.success).toBe(false);
    });
  });
});
