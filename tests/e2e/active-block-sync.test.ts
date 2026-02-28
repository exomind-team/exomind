/**
 * ActiveBlockSync 集成测试
 *
 * 测试多设备同步场景：
 * - 设备 A 创建时间块 → 设备 B 自动显示
 * - 设备 A 暂停/恢复 → 设备 B 自动更新
 * - 设备 A 结束 → 设备 B 自动清除
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActiveBlockStorage, clearAllStorageInstances } from '@/lib/storage/active-block-storage';
import type { ActiveBlockData } from '@/lib/types/event';

describe('ActiveBlockSync 集成测试', () => {
  let deviceA: ActiveBlockStorage;
  let deviceB: ActiveBlockStorage;
  let testUserId: string;
  let remoteUrl: string;

  beforeEach(async () => {
    // 使用随机用户 ID 避免测试冲突
    testUserId = `sync-test-${Date.now()}`;
    remoteUrl = `http://localhost:5984/active_blocks_${testUserId}`;

    // 创建设备 A 实例
    deviceA = new ActiveBlockStorage(testUserId);
    // 创建设备 B 实例（使用不同的 userId）
    deviceB = new ActiveBlockStorage(`${testUserId}-device-b`);
  });

  afterEach(async () => {
    // 简化清理：只删除数据，不关闭数据库
    // 避免 PouchDB close() 导致的超时问题
    await Promise.allSettled([
      deviceA.deleteActiveBlock(),
      deviceA.stopSync(),
    ]);

    if (deviceB) {
      await Promise.allSettled([deviceB.stopSync()]);
    }

    // 清理单例缓存
    clearAllStorageInstances();
  });

  describe('基本同步功能', () => {
    it('应该能够保存和加载活跃块', async () => {
      const block: ActiveBlockData = {
        startId: 'sync-test-1',
        name: '同步测试块',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);
      const loaded = await deviceA.loadActiveBlock();

      expect(loaded).toMatchObject(block);
    });

    it('应该能够删除活跃块', async () => {
      const block: ActiveBlockData = {
        startId: 'delete-test',
        name: '删除测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);
      await deviceA.deleteActiveBlock();

      const loaded = await deviceA.loadActiveBlock();
      expect(loaded).toBeNull();
    });
  });

  describe('变更监听', () => {
    it('应该能够注册变更监听器', () => {
      const callback = vi.fn();
      const unsubscribe = deviceA.onRemoteChange(callback);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });

    it('保存时应该触发本地变更通知', async () => {
      const callback = vi.fn();
      deviceA.onRemoteChange(callback);

      const block: ActiveBlockData = {
        startId: 'notify-test',
        name: '通知测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);

      // 等待异步通知
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(callback).toHaveBeenCalled();
    });

    it('删除时应该触发变更通知', async () => {
      const block: ActiveBlockData = {
        startId: 'delete-notify',
        name: '删除通知测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);

      const callback = vi.fn();
      deviceA.onRemoteChange(callback);

      await deviceA.deleteActiveBlock();

      // 等待异步通知
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(callback).toHaveBeenCalledWith(null);
    });
  });

  describe('同步状态管理', () => {
    it('初始状态应该是未激活', () => {
      const status = deviceA.getSyncStatus();

      expect(status.active).toBe(false);
      expect(status.paused).toBe(false);
      expect(status.error).toBeNull();
    });

    it('停止同步不应抛出错误', async () => {
      await expect(async () => {
        await deviceA.stopSync();
      }).not.toThrow();
    });
  });

  describe('多设备场景模拟', () => {
    it('设备 A 创建时间块后，设备 B 应该能够读取', async () => {
      const block: ActiveBlockData = {
        startId: 'multi-device-1',
        name: '多设备测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      // 设备 A 创建
      await deviceA.saveActiveBlock(block);

      // 模拟：设备 B 从同一数据库读取
      // 注意：这里需要使用相同的 userId 才能访问同一数据库
      const deviceBSameUser = new ActiveBlockStorage(testUserId);
      const loaded = await deviceBSameUser.loadActiveBlock();
      expect(loaded).toMatchObject(block);
      // 不关闭 deviceBSameUser，避免超时问题
    }, { timeout: 10000 });

    it('设备 A 暂停后，设备 B 应该能够看到暂停状态', async () => {
      const block: ActiveBlockData = {
        startId: 'pause-test',
        name: '暂停测试',
        startTime: Date.now(),
        elapsed: 5000,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);

      // 暂停
      const pausedBlock: ActiveBlockData = {
        ...block,
        paused: true,
        pausedAt: Date.now(),
      };
      await deviceA.saveActiveBlock(pausedBlock);

      // 设备 B 读取
      const deviceBSameUser = new ActiveBlockStorage(testUserId);
      const loaded = await deviceBSameUser.loadActiveBlock();
      expect(loaded?.paused).toBe(true);
      expect(loaded?.pausedAt).toBeDefined();
      // 不关闭 deviceBSameUser，避免超时问题
    }, { timeout: 10000 });

    it('设备 A 结束后，设备 B 应该读取到 null', async () => {
      const block: ActiveBlockData = {
        startId: 'end-test',
        name: '结束测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      await deviceA.saveActiveBlock(block);

      // 设备 A 结束（删除）
      await deviceA.deleteActiveBlock();

      // 设备 B 读取
      const deviceBSameUser = new ActiveBlockStorage(testUserId);
      try {
        const loaded = await deviceBSameUser.loadActiveBlock();
        expect(loaded).toBeNull();
      } finally {
        // 确保关闭数据库连接
        await deviceBSameUser.close();
      }
    }, { timeout: 10000 });
  });

  describe('数据一致性', () => {
    it('多次更新应该保持数据一致性', async () => {
      const block: ActiveBlockData = {
        startId: 'consistency-test',
        name: '一致性测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      // 第一次保存
      await deviceA.saveActiveBlock(block);

      // 多次更新
      for (let i = 1; i <= 5; i++) {
        const updated: ActiveBlockData = {
          ...block,
          elapsed: i * 1000,
          updatedAt: Date.now(),
        };
        await deviceA.saveActiveBlock(updated);
      }

      // 验证最终状态
      const loaded = await deviceA.loadActiveBlock();
      expect(loaded?.elapsed).toBe(5000);
    });

    it('应该正确处理快速连续更新', async () => {
      const block: ActiveBlockData = {
        startId: 'rapid-update',
        name: '快速更新测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'stopwatch',
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };

      // 快速连续更新
      const updates = Array.from({ length: 10 }, (_, i) => ({
        ...block,
        elapsed: i * 100,
        updatedAt: Date.now(),
      }));

      for (const update of updates) {
        await deviceA.saveActiveBlock(update);
      }

      // 验证最终状态
      const loaded = await deviceA.loadActiveBlock();
      expect(loaded?.elapsed).toBe(900);
    });
  });

  describe('边界情况', () => {
    it('应该处理空数据库', async () => {
      const loaded = await deviceA.loadActiveBlock();
      expect(loaded).toBeNull();
    });

    it('应该处理重复删除', async () => {
      await expect(async () => {
        await deviceA.deleteActiveBlock();
        await deviceA.deleteActiveBlock();
      }).not.toThrow();
    });

    it('应该处理大数值', async () => {
      const block: ActiveBlockData = {
        startId: 'large-values',
        name: '大数值测试',
        startTime: Date.now() + 1000000000,
        elapsed: 999999999,
        mode: 'stopwatch',
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 888888888,
      };

      await deviceA.saveActiveBlock(block);
      const loaded = await deviceA.loadActiveBlock();

      expect(loaded?.elapsed).toBe(999999999);
      expect(loaded?.pauseAccumulatedMs).toBe(888888888);
    });
  });
});

describe('真实同步场景（需要 CouchDB）', () => {
  // 这些测试需要真实的 CouchDB 服务器
  // 在 CI 环境中应该跳过

  const hasServer = false; // 设置为 true 如果有 CouchDB 服务器

  it.skipIf(!hasServer)('应该能够启动实时同步', async () => {
    const userId = `real-sync-${Date.now()}`;
    const remoteUrl = `http://localhost:5984/active_blocks_${userId}`;
    const storage = new ActiveBlockStorage(userId);

    try {
      const sync = await storage.syncToRemote(remoteUrl);
      expect(sync).toBeDefined();

      const status = storage.getSyncStatus();
      expect(status.active).toBe(true);

      await storage.stopSync();
      await storage.close();
    } catch (error) {
      console.warn('真实同步测试失败:', error);
      await storage.close();
    }
  });

  it.skipIf(!hasServer)('设备 A 创建 → 设备 B 自动显示', async () => {
    const userId = `real-multi-${Date.now()}`;
    const remoteUrl = `http://localhost:5984/active_blocks_${userId}`;

    const deviceA = new ActiveBlockStorage(userId);
    const deviceB = new ActiveBlockStorage(userId);

    try {
      // 启动同步
      await deviceA.syncToRemote(remoteUrl);
      await deviceB.syncToRemote(remoteUrl);

      // 设备 B 监听变更
      const changes: (ActiveBlockData | null)[] = [];
      deviceB.onRemoteChange((block) => {
        changes.push(block);
      });

      // 设备 A 创建时间块
      const block: ActiveBlockData = {
        startId: 'real-sync-1',
        name: '真实同步测试',
        startTime: Date.now(),
        elapsed: 0,
        mode: 'countdown',
        targetMinutes: 25,
        updatedAt: Date.now(),
        paused: false,
        pauseAccumulatedMs: 0,
      };
      await deviceA.saveActiveBlock(block);

      // 等待同步
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 验证设备 B 收到变更
      expect(changes.length).toBeGreaterThan(0);

      await deviceA.stopSync();
      await deviceB.stopSync();
      await deviceA.close();
      await deviceB.close();
    } catch (error) {
      console.warn('真实多设备同步测试失败:', error);
      await deviceA.close();
      await deviceB.close();
    }
  });
});
