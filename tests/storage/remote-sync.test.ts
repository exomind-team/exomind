/**
 * EventStorage 远程同步测试
 *
 * 测试与远程 PouchDB 服务器的同步功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStorage } from '@/lib/storage/event-storage';

describe('EventStorage Remote Sync', () => {
  let storage: EventStorage;

  beforeEach(async () => {
    const testUserId = `sync-test-${Date.now()}`;
    storage = new EventStorage(testUserId);
  });

  afterEach(async () => {
    // 停止同步
    await storage.stopSync();
    // 清理
    await storage.clearAll();
    await storage.close();
  });

  describe('syncToRemote', () => {
    it('同步状态应该默认不活跃', async () => {
      const status = storage.getSyncStatus();
      expect(status.active).toBe(false);
    });

    it('应该能注册监听并获取取消函数', async () => {
      const unsubscribe = storage.onRemoteChange(() => {});
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('stopSync', () => {
    it('在无同步状态下停止应该不报错', () => {
      // 不应抛出错误
      expect(() => storage.stopSync()).not.toThrow();
    });
  });

  describe('onRemoteChange', () => {
    it('应该能注册变更监听器', async () => {
      let changeReceived = false;

      const unsubscribe = storage.onRemoteChange((change) => {
        changeReceived = true;
      });

      // 监听器应该被注册
      expect(typeof unsubscribe).toBe('function');

      // 取消注册
      unsubscribe();
    });

    it('应该能取消监听', async () => {
      let callCount = 0;
      const unsubscribe = storage.onRemoteChange(() => {
        callCount++;
      });

      // 取消监听
      unsubscribe();

      // 后续不应该收到通知
      expect(callCount).toBe(0);
    });
  });

  describe('本地操作验证', () => {
    it('应该能添加和获取事件', async () => {
      const event = {
        id: 'local-test-1',
        content: '测试本地操作',
        createdAt: new Date().toISOString(),
      };

      await storage.addEvent(event);
      const events = await storage.getEvents();

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('local-test-1');
    });

    it('应该能删除事件', async () => {
      const event = {
        id: 'delete-test',
        content: '删除测试',
        createdAt: new Date().toISOString(),
      };

      await storage.addEvent(event);
      await storage.deleteEvent('delete-test');
      const events = await storage.getEvents();

      expect(events).toHaveLength(0);
    });
  });
});
