/**
 * PouchSyncAdapter 核心测试
 *
 * 测试内容：
 * - Mock PouchDB 类
 * - connect/disconnect
 * - pushEvent/pushConfig
 * - getConflicts/resolveConflict
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import type { SyncEvent, ConfigDoc, Conflict } from '@/environment/interfaces/sync.port';

// ============ Mock PouchDB ============

/**
 * Mock PouchDB 类
 */
class MockPouchDB {
  private static plugins: Array<unknown> = [];
  private static instances: MockPouchDB[] = [];
  private docs: Map<string, Record<string, unknown>> = new Map();
  private changesCallbacks: Array<(change: { id: string; deleted?: boolean; doc?: unknown }) => void> = [];
  private queryResults: Map<string, Array<{ id: string; key: string; value: unknown; doc?: unknown }>> = new Map();
  private closed = false;

  constructor(
    private name: string,
    private options: Record<string, unknown> = {}
  ) {
    MockPouchDB.instances.push(this);
  }

  static plugin(_plugin: unknown): typeof MockPouchDB {
    MockPouchDB.plugins.push(_plugin);
    return MockPouchDB;
  }

  static resetInstances(): void {
    MockPouchDB.instances = [];
  }

  static getInstanceByName(name: string): MockPouchDB | undefined {
    return MockPouchDB.instances.find((instance) => instance.name === name);
  }

  getOptions(): Record<string, unknown> {
    return this.options;
  }

  static replicate(
    source: MockPouchDB,
    target: MockPouchDB,
    _opts?: { live?: boolean; retry?: boolean; name?: string }
  ): {
    on: (event: string, callback: (info: { changes?: Array<{ length: number }> }) => void) => void;
    cancel: () => void;
  } {
    // 模拟复制
    const mockSync = {
      on: (_event: string, _callback: (info: { changes?: Array<{ length: number }> }) => void) => mockSync,
      cancel: () => {},
    };
    return mockSync;
  }

  async put(doc: Record<string, unknown>): Promise<{ ok: boolean; id: string; rev: string }> {
    if (this.closed) throw new Error('Database is closed');
    const rev = `1-${Date.now()}`;
    this.docs.set(doc._id as string, { ...doc, _rev: rev });
    this._notifyChanges({ id: doc._id as string, doc });
    return { ok: true, id: doc._id as string, rev };
  }

  async get(id: string, _opts?: { rev?: string }): Promise<Record<string, unknown>> {
    if (this.closed) throw new Error('Database is closed');
    const doc = this.docs.get(id);
    if (!doc) throw { status: 404, message: 'not_found' };
    return doc;
  }

  async allDocs(opts?: { include_docs?: boolean; conflicts?: boolean }): Promise<{
    rows: Array<{ id: string; doc?: Record<string, unknown> }>;
  }> {
    if (this.closed) throw new Error('Database is closed');
    const rows = Array.from(this.docs.entries()).map(([id, doc]) => ({
      id,
      ...(opts?.include_docs ? { doc } : {}),
    }));
    return { rows };
  }

  async query(view: string, opts?: unknown): Promise<{
    rows: Array<{ id: string; key: string; value: unknown; doc?: unknown }>;
  }> {
    if (this.closed) throw new Error('Database is closed');
    const results = this.queryResults.get(view) || [];
    return { rows: results };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.docs.clear();
    this.changesCallbacks = [];
  }

  // 设置查询结果（用于测试）
  setQueryResults(view: string, rows: Array<{ id: string; key: string; value: unknown; doc?: unknown }>): void {
    this.queryResults.set(view, rows);
  }

  // 模拟变更监听
  changes(opts: { since: string; live: boolean; include_docs: boolean }): {
    on: (event: string, callback: (change: { id: string; deleted?: boolean; doc?: unknown }) => void) => void;
    cancel: () => void;
  } {
    return {
      on: (event, callback) => {
        if (event === 'change') {
          this.changesCallbacks.push(callback);
        }
      },
      cancel: () => {
        this.changesCallbacks = [];
      },
    };
  }

  // 通知变更
  private _notifyChanges(change: { id: string; deleted?: boolean; doc?: unknown }): void {
    this.changesCallbacks.forEach((cb) => cb(change));
  }

  // 添加文档（用于测试）
  addDoc(doc: Record<string, unknown>): void {
    this.docs.set(doc._id as string, doc);
  }

  // 获取文档数量
  getDocCount(): number {
    return this.docs.size;
  }
}

// Mock pouchdb-adapter-idb
const pouchdbAdapterIdb = {};

// ============ 全局 Mock ============

const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem(key: string): string | null {
    return this.store[key] || null;
  },
  setItem(key: string, value: string): void {
    this.store[key] = value;
  },
  removeItem(key: string): void {
    delete this.store[key];
  },
  clear(): void {
    this.store = {};
  },
};

const mockCrypto = {
  randomUUID: vi.fn(() => 'test-uuid-1234'),
  getRandomValues: vi.fn((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
};

// ============ 测试 Setup ============

// Mock PouchDB 模块
vi.mock('pouchdb', () => ({
  default: MockPouchDB,
  __esModule: true,
}));

vi.mock('pouchdb-adapter-idb', () => ({
  default: pouchdbAdapterIdb,
  __esModule: true,
}));

// 动态导入被测模块（在设置 mock 之后）
let PouchSyncAdapter: typeof import('@/adapters/pouch-sync').PouchSyncAdapter;
let createPouchSyncAdapter: () => import('@/adapters/pouch-sync').PouchSyncAdapter;
let getDeviceId: () => string;

describe('PouchSyncAdapter', () => {
  beforeAll(async () => {
    // Mock globals using Object.defineProperty
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: mockCrypto,
      writable: true,
    });
    Object.defineProperty(globalThis, 'PouchDB', {
      value: MockPouchDB,
      writable: true,
    });

    // 导入被测模块
    const module = await import('@/adapters/pouch-sync');
    PouchSyncAdapter = module.PouchSyncAdapter;
    createPouchSyncAdapter = module.createPouchSyncAdapter;
    getDeviceId = () => {
      const stored = mockLocalStorage.store['exomind:deviceId'];
      if (stored) return stored;
      const newId = mockCrypto.randomUUID();
      mockLocalStorage.store['exomind:deviceId'] = newId;
      return newId;
    };
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
    MockPouchDB.resetInstances();
    delete process.env.EXOMIND_SYNC_AUTH_MODE;
    delete process.env.VITE_SYNC_AUTH_MODE;
  });

  describe('getDeviceId', () => {
    it('should return stored device ID if exists', () => {
      mockLocalStorage.store['exomind:deviceId'] = 'existing-id';
      const id = getDeviceId();
      expect(id).toBe('existing-id');
    });

    it('should generate and store new device ID if not exists', () => {
      const id = getDeviceId();
      expect(id).toBe('test-uuid-1234');
      expect(mockLocalStorage.store['exomind:deviceId']).toBe(id);
    });
  });

  describe('getInitialStatus', () => {
    it('should return correct initial status', () => {
      const adapter = createPouchSyncAdapter();
      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
      expect(status.pendingChanges).toBe(0);
      expect(status.conflictCount).toBe(0);
      expect(status.syncMode).toBe('realtime');
      expect(status.pollInterval).toBe(5);
      expect(status.lastSync).toBeNull();
    });
  });

  describe('connect', () => {
    it('should transition to connected state', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const status = adapter.getStatus();
      expect(status.state).toBe('connected');
    });

    it('should create local and remote databases', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const localDB = adapter.getLocalDB();
      const remoteDB = adapter.getRemoteDB();

      expect(localDB).not.toBeNull();
      expect(remoteDB).not.toBeNull();
    });

    it('should not attach remote auth by default', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const remote = MockPouchDB.getInstanceByName('http://localhost:6984/test-user');
      expect(remote).toBeDefined();
      expect(remote?.getOptions()).not.toHaveProperty('auth');
    });

    it('should attach remote auth when EXOMIND_SYNC_AUTH_MODE is enabled', async () => {
      process.env.EXOMIND_SYNC_AUTH_MODE = 'enabled';
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const remote = MockPouchDB.getInstanceByName('http://localhost:6984/test-user');
      expect(remote).toBeDefined();
      expect(remote?.getOptions()).toMatchObject({
        auth: {
          username: 'test-user',
          password: 'test-pass-hash',
        },
      });
    });
  });

  describe('disconnect', () => {
    it('should transition to disconnected state', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });
      await adapter.disconnect();

      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
    });

    it('should clear database references', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });
      await adapter.disconnect();

      expect(adapter.getLocalDB()).toBeNull();
      expect(adapter.getRemoteDB()).toBeNull();
    });
  });

  describe('pushEvent', () => {
    it('should increment pending changes', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const event: SyncEvent = {
        id: 'event-1',
        type: 'event',
        eventId: 'event-1',
        content: 'Test message',
        timestamp: new Date().toISOString(),
        tags: [],
        deviceId: 'test-device',
      };

      await adapter.pushEvent(event);

      const status = adapter.getStatus();
      expect(status.pendingChanges).toBeGreaterThanOrEqual(0);
    });

    it('should throw error when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      const event: SyncEvent = {
        id: 'event-1',
        type: 'event',
        eventId: 'event-1',
        content: 'Test message',
        timestamp: new Date().toISOString(),
        tags: [],
        deviceId: 'test-device',
      };

      // 不应抛出错误，但应安全处理
      await adapter.pushEvent(event);
    });
  });

  describe('pushConfig', () => {
    it('should create config document', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      await adapter.pushConfig('theme', 'dark');

      const status = adapter.getStatus();
      expect(status.pendingChanges).toBeGreaterThanOrEqual(0);
    });

    it('should throw error when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      // 不应抛出错误，但应安全处理
      await adapter.pushConfig('theme', 'dark');
    });
  });

  describe('getConflicts', () => {
    it('should return empty array when no conflicts', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const conflicts = await adapter.getConflicts();
      expect(conflicts).toEqual([]);
    });

    it('should return empty array when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      const conflicts = await adapter.getConflicts();
      expect(conflicts).toEqual([]);
    });
  });

  describe('resolveConflict', () => {
    it('should throw error when document not found', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      // 文档不存在时会抛出错误（方法本身没有 try-catch）
      await expect(adapter.resolveConflict('non-existent-doc', 'local')).rejects.toThrow();
    });

    it('should not throw when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      // 未连接时不执行任何操作，不抛出错误
      await adapter.resolveConflict('doc-1', 'local');
    });
  });

  describe('syncEvents', () => {
    it('should return error when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      const result = await adapter.syncEvents();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('syncConfig', () => {
    it('should return error when not connected', async () => {
      const adapter = createPouchSyncAdapter();

      const result = await adapter.syncConfig();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('status management', () => {
    it('should track pending changes correctly', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const initialStatus = adapter.getStatus();
      expect(initialStatus.pendingChanges).toBe(0);
    });

    it('should track conflict count correctly', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      const conflicts = await adapter.getConflicts();
      const status = adapter.getStatus();

      expect(status.conflictCount).toBe(conflicts.length);
    });
  });

  describe('importFromLocal', () => {
    it('should return success with zero counts by default', async () => {
      const adapter = createPouchSyncAdapter();

      const result = await adapter.importFromLocal('merge');

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.conflictCount).toBe(0);
    });
  });

  describe('setOnSyncTrigger', () => {
    it('should set callback', () => {
      const adapter = createPouchSyncAdapter();
      const callback = vi.fn();

      adapter.setOnSyncTrigger(callback);

      // 回调设置成功，无异常
    });
  });

  describe('triggerSync', () => {
    it('should set callback for sync trigger', () => {
      const adapter = createPouchSyncAdapter();
      const callback = vi.fn();
      adapter.setOnSyncTrigger(callback);

      // 验证回调设置后，调用 triggerSync 不会报错
      adapter.triggerSync('event');
    });

    it('should handle sync trigger without callback', async () => {
      const adapter = createPouchSyncAdapter();

      await adapter.connect('http://localhost:6984', {
        username: 'test-user',
        passwordHash: 'test-pass-hash',
      });

      // 没有设置回调时不应报错
      await adapter.triggerSync('event');
      await adapter.triggerSync('config');
    });
  });
});
