/**
 * EventStorage 单元测试
 *
 * 测试事件本地存储功能：
 * - 添加事件
 * - 获取事件列表
 * - 删除事件
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventStorage } from '../../src/lib/storage/event-storage';

describe('EventStorage', () => {
  let storage: EventStorage;

  beforeEach(async () => {
    // 使用随机用户 ID 避免测试冲突
    const testUserId = `test-user-${Date.now()}`;
    storage = new EventStorage(testUserId);
  });

  afterEach(async () => {
    // 清理存储
    if (storage) {
      const events = await storage.getEvents();
      for (const event of events) {
        await storage.deleteEvent(event.id);
      }
    }
  });

  describe('addEvent', () => {
    it('应该正确添加事件', async () => {
      const event = {
        id: 'event-1',
        content: '测试事件内容',
        createdAt: new Date().toISOString(),
      };

      await storage.addEvent(event);

      const events = await storage.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(event);
    });

    it('应该正确添加多个事件', async () => {
      const events = [
        { id: 'event-1', content: '事件1', createdAt: new Date().toISOString() },
        { id: 'event-2', content: '事件2', createdAt: new Date().toISOString() },
        { id: 'event-3', content: '事件3', createdAt: new Date().toISOString() },
      ];

      for (const event of events) {
        await storage.addEvent(event);
      }

      const storedEvents = await storage.getEvents();
      expect(storedEvents).toHaveLength(3);
    });

    it('应该保留事件时间戳', async () => {
      const timestamp = new Date().toISOString();
      const event = {
        id: 'event-ts',
        content: '带时间戳的事件',
        createdAt: timestamp,
      };

      await storage.addEvent(event);

      const events = await storage.getEvents();
      expect(events[0].createdAt).toBe(timestamp);
    });
  });

  describe('getEvents', () => {
    it('应该返回空数组当没有事件', async () => {
      const events = await storage.getEvents();
      expect(events).toEqual([]);
    });

    it('应该按创建时间排序返回事件', async () => {
      const event1 = { id: 'event-1', content: '第一个事件', createdAt: '2024-01-01T10:00:00.000Z' };
      await storage.addEvent(event1);

      const event2 = { id: 'event-2', content: '第二个事件', createdAt: '2024-01-01T11:00:00.000Z' };
      await storage.addEvent(event2);

      const event3 = { id: 'event-3', content: '第三个事件', createdAt: '2024-01-01T09:00:00.000Z' };
      await storage.addEvent(event3);

      const events = await storage.getEvents();

      // 按时间戳降序排列
      expect(events[0].id).toBe('event-2');
      expect(events[1].id).toBe('event-1');
      expect(events[2].id).toBe('event-3');
    });
  });

  describe('deleteEvent', () => {
    it('应该正确删除事件', async () => {
      const event = { id: 'delete-me', content: '将被删除', createdAt: new Date().toISOString() };
      await storage.addEvent(event);

      await storage.deleteEvent('delete-me');

      const events = await storage.getEvents();
      expect(events).toHaveLength(0);
    });

    it('删除不存在的事件不应抛出错误', async () => {
      // 不应抛出错误
      await expect(async () => {
        await storage.deleteEvent('non-existent');
      }).not.toThrow();
    });

    it('删除后无法再获取到该事件', async () => {
      const event = { id: 'to-delete', content: '测试删除', createdAt: new Date().toISOString() };
      await storage.addEvent(event);

      // 确认存在
      let events = await storage.getEvents();
      expect(events.find((e) => e.id === 'to-delete')).toBeDefined();

      // 删除
      await storage.deleteEvent('to-delete');

      // 确认不存在
      events = await storage.getEvents();
      expect(events.find((e) => e.id === 'to-delete')).toBeUndefined();
    });
  });

  describe('事件数据完整性', () => {
    it('应该正确存储包含特殊字符的内容', async () => {
      const specialContent = '事件内容: Hello World! @#$%^&*()';
      const event = {
        id: 'special-chars',
        content: specialContent,
        createdAt: new Date().toISOString(),
      };

      await storage.addEvent(event);

      const events = await storage.getEvents();
      expect(events[0].content).toBe(specialContent);
    });

    it('应该正确存储 JSON 对象', async () => {
      const eventData = {
        id: 'json-event',
        content: JSON.stringify({ action: 'click', target: 'button' }),
        createdAt: new Date().toISOString(),
      };

      await storage.addEvent(eventData);

      const events = await storage.getEvents();
      const parsed = JSON.parse(events[0].content);
      expect(parsed.action).toBe('click');
      expect(parsed.target).toBe('button');
    });
  });
});
