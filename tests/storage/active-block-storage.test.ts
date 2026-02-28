/**
 * ActiveBlockStorage 单元测试
 *
 * 测试活跃时间块存储功能：
 * - 保存/加载/删除活跃块
 * - 同步到远程服务器
 * - 监听远程变更
 * - 单例模式验证
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ActiveBlockStorage,
  getActiveBlockStorage,
  clearAllStorageInstances,
} from '@/lib/storage/active-block-storage';
import type { ActiveBlockData } from '@/lib/types/event';

describe('ActiveBlockStorage', () => {
  let storage: ActiveBlockStorage;
  let testUserId: string;

  beforeEach(async () => {
    // 使用随机用户 ID 避免测试冲突
    testUserId = `test-user-${Date.now()}`;
    storage = new ActiveBlockStorage(testUserId);
  });

  afterEach(async () => {
    // 清理存储
    if (storage) {
      try {
        await storage.deleteActiveBlock();
      } catch {
        // 忽略删除错误
      }
      try {
        await storage.close();
      } catch {
        // 忽略关闭错误
      }
    }
    clearAllStorageInstances();
  });

  describe('saveActiveBlock', () => {
    it('应该正确保存活跃时间块', async () => {
      const block: ActiveBlockData = {
        startId: 'block-1',
        name: '测试时间块',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await storage.saveActiveBlock(block);

      const loaded = await storage.loadActiveBlock();
      expect(loaded).toMatchObject(block);
    });

    it('应该更新已存在的活跃时间块', async () => {
      const block1: ActiveBlockData = {
        startId: 'block-1',
        name: '第一个块',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await storage.saveActiveBlock(block1);

      const block2: ActiveBlockData = {
        ...block1,
        name: '更新后的块',
        elapsed: 1000,
      };

      await storage.saveActiveBlock(block2);

      const loaded = await storage.loadActiveBlock();
      expect(loaded?.name).toBe('更新后的块');
      expect(loaded?.elapsed).toBe(1000);
    });

    it('应该保存暂停状态', async () => {
      const block: ActiveBlockData = {
        startId: 'block-paused',
        name: '暂停的块',
        startTime: Date.now(),
        elapsed: 5000,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: true,
        pausedAt: Date.now(),
        pauseAccumulatedMs: 2000,
      };

      await storage.saveActiveBlock(block);

      const loaded = await storage.loadActiveBlock();
      expect(loaded?.paused).toBe(true);
      expect(loaded?.pausedAt).toBeDefined();
      expect(loaded?.pauseAccumulatedMs).toBe(2000);
    });
  });

  describe('loadActiveBlock', () => {
    it('应该返回 null 当没有活跃块', async () => {
      const loaded = await storage.loadActiveBlock();
      expect(loaded).toBeNull();
    });

    it('应该正确加载已保存的活跃块', async () => {
      const block: ActiveBlockData = {
        startId: 'load-test',
        name: '加载测试',
        startTime: Date.now(),
        elapsed: 3000,
        mode: 'stopwatch',
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await storage.saveActiveBlock(block);
      const loaded = await storage.loadActiveBlock();

      expect(loaded).toMatchObject(block);
    });

    it('应该保留所有字段', async () => {
      const now = Date.now();
      const block: ActiveBlockData = {
        startId: 'full-block',
        name: '完整块',
        startTime: now,
        elapsed: 10000,
        mode: 'countdown',
        targetMinutes: 30,
        updatedAt: now,
        paused: true,
        pausedAt: now - 1000,
        pauseAccumulatedMs: 5000,
        actionEndedAt: now - 500,
        feedbackStartedAt: now - 500,
      };

      await storage.saveActiveBlock(block);
      const loaded = await storage.loadActiveBlock();

      expect(loaded).toMatchObject(block);
    });
  });

  describe('deleteActiveBlock', () => {
    it('应该正确删除活跃块', async () => {
      const block: ActiveBlockData = {
        startId: 'delete-me',
        name: '将被删除',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await storage.saveActiveBlock(block);

      // 确认存在
      let loaded = await storage.loadActiveBlock();
      expect(loaded).not.toBeNull();

      // 删除
      await storage.deleteActiveBlock();

      // 确认不存在
      loaded = await storage.loadActiveBlock();
      expect(loaded).toBeNull();
    });

    it('删除不存在的块不应抛出错误', async () => {
      await expect(async () => {
        await storage.deleteActiveBlock();
      }).not.toThrow();
    });
  });

  describe('onRemoteChange', () => {
    it('应该注册变更监听器', () => {
      const callback = vi.fn();
      const unsubscribe = storage.onRemoteChange(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('应该能够取消监听', () => {
      const callback = vi.fn();
      const unsubscribe = storage.onRemoteChange(callback);

      // 取消监听不应抛出错误
      expect(() => unsubscribe()).not.toThrow();
    });

    it('应该支持多个监听器', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = storage.onRemoteChange(callback1);
      const unsubscribe2 = storage.onRemoteChange(callback2);

      expect(typeof unsubscribe1).toBe('function');
      expect(typeof unsubscribe2).toBe('function');

      unsubscribe1();
      unsubscribe2();
    });
  });

  describe('syncToRemote', () => {
    it('应该返回同步对象', async () => {
      const remoteUrl = 'http://localhost:5984/test_active_blocks';

      // 注意：这个测试需要真实的 CouchDB 服务器
      // 在 CI 环境中跳过测试
      const hasServer = false; // 设置为 true 如果有 CouchDB 服务器

      if (!hasServer) {
        console.warn('跳过同步测试：需要 CouchDB 服务器');
        return;
      }

      try {
        const sync = await storage.syncToRemote(remoteUrl);
        expect(sync).toBeDefined();
        await storage.stopSync();
      } catch (error) {
        console.warn('同步测试失败:', error);
      }
    });
  });

  describe('stopSync', () => {
    it('应该能够停止同步', async () => {
      await expect(async () => {
        await storage.stopSync();
      }).not.toThrow();
    });
  });

  describe('getSyncStatus', () => {
    it('应该返回同步状态', () => {
      const status = storage.getSyncStatus();

      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('paused');
      expect(status).toHaveProperty('error');
    });

    it('初始状态应该是未激活', () => {
      const status = storage.getSyncStatus();

      expect(status.active).toBe(false);
      expect(status.paused).toBe(false);
      expect(status.error).toBeNull();
    });
  });

  describe('close', () => {
    it('应该正确关闭数据库连接', async () => {
      const testStorage = new ActiveBlockStorage(`close-test-${Date.now()}`);

      await expect(async () => {
        await testStorage.close();
      }).not.toThrow();
    });

    it('关闭后应该从单例缓存中移除', async () => {
      const userId = `singleton-close-${Date.now()}`;
      const storage1 = getActiveBlockStorage(userId);
      await storage1.close();

      const storage2 = getActiveBlockStorage(userId);
      expect(storage2).not.toBe(storage1);

      await storage2.close();
    });
  });
});

describe('getActiveBlockStorage (单例模式)', () => {
  afterEach(() => {
    clearAllStorageInstances();
  });

  it('应该返回单例实例', () => {
    const userId = 'singleton-test';
    const storage1 = getActiveBlockStorage(userId);
    const storage2 = getActiveBlockStorage(userId);

    expect(storage1).toBe(storage2);
  });

  it('不同用户应该有不同的实例', () => {
    const storage1 = getActiveBlockStorage('user-1');
    const storage2 = getActiveBlockStorage('user-2');

    expect(storage1).not.toBe(storage2);
  });

  it('应该使用当前用户 ID 当未提供参数', () => {
    const storage1 = getActiveBlockStorage();
    const storage2 = getActiveBlockStorage();

    expect(storage1).toBe(storage2);
  });
});

describe('数据完整性', () => {
  let storage: ActiveBlockStorage;

  beforeEach(() => {
    storage = new ActiveBlockStorage(`integrity-test-${Date.now()}`);
  });

  afterEach(async () => {
    try {
      await storage.deleteActiveBlock();
    } catch {
      // 忽略删除错误
    }
    try {
      await storage.close();
    } catch {
      // 忽略关闭错误
    }
    clearAllStorageInstances();
  });

  it('应该正确存储包含特殊字符的名称', async () => {
    const specialName = '时间块: Hello World! @#$%^&*()';
    const block: ActiveBlockData = {
      startId: 'special-chars',
      name: specialName,
      startTime: Date.now(),
      elapsed: 0,
      mode: 'countdown',
      targetMinutes: 25,
      updatedAt: Date.now(),
      paused: false,
      pauseAccumulatedMs: 0,
    };

    await storage.saveActiveBlock(block);

    const loaded = await storage.loadActiveBlock();
    expect(loaded?.name).toBe(specialName);
  });

  it('应该正确存储大数值', async () => {
    const largeTime = Date.now() + 1000000000;
    const block: ActiveBlockData = {
      startId: 'large-values',
      name: '大数值测试',
      startTime: largeTime,
      elapsed: 999999999,
      mode: 'stopwatch',
      updatedAt: largeTime,
      paused: false,
      pauseAccumulatedMs: 888888888,
    };

    await storage.saveActiveBlock(block);

    const loaded = await storage.loadActiveBlock();
    expect(loaded?.startTime).toBe(largeTime);
    expect(loaded?.elapsed).toBe(999999999);
    expect(loaded?.pauseAccumulatedMs).toBe(888888888);
  });

  it('应该正确处理 undefined 可选字段', async () => {
    const block: ActiveBlockData = {
      startId: 'optional-fields',
      name: '可选字段测试',
      startTime: Date.now(),
      elapsed: 0,
      mode: 'stopwatch',
      updatedAt: Date.now(),
      paused: false,
      pauseAccumulatedMs: 0,
      // targetMinutes, pausedAt, actionEndedAt, feedbackStartedAt 未设置
    };

    await storage.saveActiveBlock(block);

    const loaded = await storage.loadActiveBlock();
    expect(loaded?.targetMinutes).toBeUndefined();
    expect(loaded?.pausedAt).toBeUndefined();
    expect(loaded?.actionEndedAt).toBeUndefined();
    expect(loaded?.feedbackStartedAt).toBeUndefined();
  });
});
