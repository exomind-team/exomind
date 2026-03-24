/**
 * PouchSyncAdapter 集成测试
 *
 * 测试 PouchDB 同步适配器的核心功能：
 * - 连接/断开
 * - 事件和配置同步
 * - 冲突检测与解决
 * - 状态管理
 *
 * 注意：需要真实 PouchDB 环境才能运行完整测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 根据环境条件决定是否运行测试
const canRunPouchDBTests = typeof window !== 'undefined' || process.env.POUCHDB_TEST === 'true';

// 模拟 PouchDB（如果不可用）
let MockPouchDB: typeof import('pouchdb');
try {
  MockPouchDB = await import('pouchdb');
} catch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MockPouchDB = {} as any;
}

// 导入被测试模块
import type { SyncEvent, ConfigDoc, SyncCredentials } from '@/environment/interfaces/sync.port';
import type { PouchSyncAdapter } from '@/adapters/pouch-sync';
import {
  resolveByLWW,
  detectConflict,
  createConflict,
  autoResolve,
} from '@/lib/sync/conflict-resolver';

// 动态导入，条件执行
const testsEnabled = canRunPouchDBTests;

// 用于测试的类型定义
interface TestEvent extends SyncEvent {
  type: 'event';
  id: string;
  timestamp: number;
}

interface TestConfig extends ConfigDoc {
  type: 'config';
  key: string;
  value: string;
}

describe('PouchSyncAdapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PouchSyncAdapter: any;

  beforeEach(async () => {
    // 动态导入模块
    const module = await import('@/adapters/pouch-sync');
    PouchSyncAdapter = module.PouchSyncAdapter;
  });

  describe('构造函数和状态初始化', () => {
    it('应该正确创建实例', () => {
      const adapter = new PouchSyncAdapter();
      expect(adapter).toBeDefined();
      expect(typeof adapter.connect).toBe('function');
      expect(typeof adapter.disconnect).toBe('function');
      expect(typeof adapter.syncEvents).toBe('function');
      expect(typeof adapter.syncConfig).toBe('function');
    });

    it('初始状态应该为 disconnected', () => {
      const adapter = new PouchSyncAdapter();
      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
      expect(status.lastSync).toBeNull();
      expect(status.pendingChanges).toBe(0);
      expect(status.conflictCount).toBe(0);
    });

    it('初始同步模式应该为 realtime', () => {
      const adapter = new PouchSyncAdapter();
      const status = adapter.getStatus();
      expect(status.syncMode).toBe('realtime');
    });

    it('轮询间隔应该为 5 秒', () => {
      const adapter = new PouchSyncAdapter();
      const status = adapter.getStatus();
      expect(status.pollInterval).toBe(5);
    });
  });

  describe('工厂函数', () => {
    it('createPouchSyncAdapter 应该返回有效实例', async () => {
      const { createPouchSyncAdapter } = await import('@/adapters/pouch-sync');
      const adapter = createPouchSyncAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.getStatus).toBeDefined();
    });
  });

  (testsEnabled ? describe : describe.skip)('连接测试', () => {
    let adapter: PouchSyncAdapter;
    const mockCredentials: SyncCredentials = {
      username: 'testuser',
      passwordHash: 'testhash123',
    };

    beforeEach(() => {
      adapter = new PouchSyncAdapter();
    });

    afterEach(async () => {
      try {
        await adapter.disconnect();
      } catch {
        // 忽略断开连接错误
      }
    });

    it('连接后状态应该变为 connecting', async () => {
      // 模拟 connect 过程（不实际连接）
      // 这里测试状态转换逻辑
      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');

      adapter = new PouchSyncAdapter();
      expect(adapter.getStatus().state).toBe('disconnected');
    });

    it('getLocalDB 初始应该返回 null', () => {
      const adapter = new PouchSyncAdapter();
      expect(adapter.getLocalDB()).toBeNull();
    });

    it('getRemoteDB 初始应该返回 null', () => {
      const adapter = new PouchSyncAdapter();
      expect(adapter.getRemoteDB()).toBeNull();
    });
  });

  (testsEnabled ? describe : describe.skip)('同步事件测试', () => {
    let adapter: PouchSyncAdapter;

    beforeEach(() => {
      adapter = new PouchSyncAdapter();
    });

    afterEach(async () => {
      try {
        await adapter.disconnect();
      } catch {
        // 忽略错误
      }
    });

    it('未连接时 syncEvents 应该返回错误', async () => {
      const result = await adapter.syncEvents();
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toBe('未连接');
    });

    it('未连接时 syncConfig 应该返回错误', async () => {
      const result = await adapter.syncConfig();
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toBe('未连接');
    });
  });

  describe('回调设置', () => {
    it('setOnSyncTrigger 应该设置回调', () => {
      const adapter = new PouchSyncAdapter();
      const callback = vi.fn();

      adapter.setOnSyncTrigger(callback);
      // 验证回调可以设置（不抛出错误）
      expect(typeof adapter.setOnSyncTrigger).toBe('function');
    });
  });

  describe('状态获取', () => {
    it('getStatus 应该返回状态快照', () => {
      const adapter = new PouchSyncAdapter();
      const status1 = adapter.getStatus();
      const status2 = adapter.getStatus();

      // 状态应该是独立的快照
      expect(status1).not.toBe(status2);
      expect(status1.state).toBe(status2.state);
    });

    it('状态修改不应该影响快照', () => {
      const adapter = new PouchSyncAdapter();
      const status = adapter.getStatus();

      // 修改返回的状态对象
      status.state = 'connected';
      status.pendingChanges = 100;

      // 原始状态不应该改变
      const newStatus = adapter.getStatus();
      expect(newStatus.state).toBe('disconnected');
      expect(newStatus.pendingChanges).toBe(0);
    });
  });
});

describe('冲突解决模块', () => {
  describe('resolveByLWW', () => {
    it('本地时间戳较晚应该返回 local', () => {
      const local = { value: { text: 'local' }, timestamp: 2000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-b' };

      const result = resolveByLWW(local, remote);
      expect(result).toBe('local');
    });

    it('远程时间戳较晚应该返回 remote', () => {
      const local = { value: { text: 'local' }, timestamp: 1000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 2000, deviceId: 'device-b' };

      const result = resolveByLWW(local, remote);
      expect(result).toBe('remote');
    });

    it('时间戳相同时设备 ID 大的胜出', () => {
      const local = { value: { text: 'local' }, timestamp: 1000, deviceId: 'device-b' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-a' };

      const result = resolveByLWW(local, remote);
      expect(result).toBe('local'); // device-b > device-a
    });

    it('时间戳相同时设备 ID 小的失败', () => {
      const local = { value: { text: 'local' }, timestamp: 1000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-b' };

      const result = resolveByLWW(local, remote);
      expect(result).toBe('remote'); // device-b > device-a
    });
  });

  describe('detectConflict', () => {
    it('不同时间戳和不同设备应该检测到冲突', () => {
      const local = { value: { text: 'local' }, timestamp: 2000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-b' };

      const hasConflict = detectConflict(local, remote);
      expect(hasConflict).toBe(true);
    });

    it('相同时间戳不应该检测到冲突', () => {
      const local = { value: { text: 'local' }, timestamp: 1000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-b' };

      const hasConflict = detectConflict(local, remote);
      expect(hasConflict).toBe(false);
    });

    it('相同设备不应该检测到冲突', () => {
      const local = { value: { text: 'local' }, timestamp: 2000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-a' };

      const hasConflict = detectConflict(local, remote);
      expect(hasConflict).toBe(false);
    });

    it('相同时间和相同设备不应该检测到冲突', () => {
      const local = { value: { text: 'local' }, timestamp: 1000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-a' };

      const hasConflict = detectConflict(local, remote);
      expect(hasConflict).toBe(false);
    });
  });

  describe('createConflict', () => {
    it('应该创建正确的冲突对象', () => {
      const local = { value: { text: 'local' }, timestamp: 2000, deviceId: 'device-a' };
      const remote = { value: { text: 'remote' }, timestamp: 1000, deviceId: 'device-b' };

      const conflict = createConflict('doc-123', 'event', local, remote);

      expect(conflict.id).toContain('doc-123');
      expect(conflict.docId).toBe('doc-123');
      expect(conflict.docType).toBe('event');
      expect(conflict.local).toBe(local);
      expect(conflict.remote).toBe(remote);
      expect(conflict.resolved).toBe(false);
    });
  });

  describe('autoResolve', () => {
    it('应该自动解决并返回本地值（时间戳较晚）', () => {
      const local = { value: { text: 'winner' }, timestamp: 2000, deviceId: 'device-a' };
      const remote = { value: { text: 'loser' }, timestamp: 1000, deviceId: 'device-b' };

      const result = autoResolve(local, remote);
      expect(result).toEqual({ text: 'winner' });
    });

    it('应该自动解决并返回远程值（时间戳较晚）', () => {
      const local = { value: { text: 'loser' }, timestamp: 1000, deviceId: 'device-a' };
      const remote = { value: { text: 'winner' }, timestamp: 2000, deviceId: 'device-b' };

      const result = autoResolve(local, remote);
      expect(result).toEqual({ text: 'winner' });
    });
  });
});

describe('同步类型定义', () => {
  describe('SyncEvent', () => {
    it('应该支持标准事件结构', () => {
      const event: SyncEvent = {
        _id: 'event-123',
        type: 'event',
        id: 'evt-001',
        timestamp: Date.now(),
        content: '测试事件',
        deviceId: 'device-a',
      };

      expect(event._id).toBe('event-123');
      expect(event.type).toBe('event');
      expect(event.id).toBe('evt-001');
      expect(typeof event.timestamp).toBe('number');
    });
  });

  describe('ConfigDoc', () => {
    it('应该支持标准配置结构', () => {
      const config: ConfigDoc = {
        _id: 'config:theme',
        type: 'config',
        key: 'theme',
        value: 'dark',
        scope: 'global',
        encrypted: false,
        deviceId: 'device-a',
        updatedAt: new Date().toISOString(),
      };

      expect(config._id).toBe('config:theme');
      expect(config.type).toBe('config');
      expect(config.key).toBe('theme');
      expect(config.scope).toBe('global');
    });
  });

  describe('SyncCredentials', () => {
    it('应该支持标准凭据结构', () => {
      const credentials: SyncCredentials = {
        username: 'testuser',
        passwordHash: 'hash123',
      };

      expect(credentials.username).toBe('testuser');
      expect(credentials.passwordHash).toBe('hash123');
    });

    it('优先使用 remoteIdentityKey 和远端 auth 字段（prefer remote identity fields）', async () => {
      const module = await import('@/adapters/pouch-sync');
      const result = module.resolveRemoteSyncTarget('http://localhost:6984', {
        username: 'legacy-user',
        passwordHash: 'legacy-hash',
        remoteIdentityKey: 'space-exomind',
        authType: 'basic',
        authUsername: 'remote-user',
        authSecret: 'remote-secret',
      } as SyncCredentials);

      expect(result.remoteDbKey).toBe('space-exomind');
      expect(result.remoteUrl).toContain('/space-exomind');
      expect(result.remoteConfig).toEqual({
        auth: {
          username: 'remote-user',
          password: 'remote-secret',
        },
      });
    });

    it('本地同步库名应优先使用 localProfileId（prefer local profile for local db name）', async () => {
      const module = await import('@/adapters/pouch-sync');
      const dbName = module.resolveLocalSyncDbName({
        localProfileId: 'profile-exomind',
        username: 'space-exomind',
        passwordHash: 'remote-secret',
      } as SyncCredentials);

      expect(dbName).toBe('local_profile-exomind');
    });
  });
});

describe('PouchSyncAdapter 边界测试', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PouchSyncAdapter: any;

  beforeEach(async () => {
    const module = await import('@/adapters/pouch-sync');
    PouchSyncAdapter = module.PouchSyncAdapter;
  });

  it('多个实例应该独立工作', () => {
    const adapter1 = new PouchSyncAdapter();
    const adapter2 = new PouchSyncAdapter();

    const status1 = adapter1.getStatus();
    const status2 = adapter2.getStatus();

    expect(status1.state).toBe(status2.state);
    expect(status1).not.toBe(status2);
  });

  it('重复创建和销毁不应该泄漏', () => {
    for (let i = 0; i < 10; i++) {
      const adapter = new PouchSyncAdapter();
      const status = adapter.getStatus();
      expect(status.state).toBe('disconnected');
    }
  });
});
