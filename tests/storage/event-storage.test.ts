/**
 * EventStorage 单元测试
 *
 * 测试事件本地存储功能：
 * - 添加事件
 * - 获取事件列表
 * - 删除事件
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  EventStorage,
  clearAllStorageInstances,
  getCurrentUserId,
  getEventStorage,
} from '@/lib/storage/event-storage';
import { createLocalProfile, setProfileSession } from '@/lib/profile/profile-storage';

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

    clearAllStorageInstances();
    localStorage.clear();
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

    it('应该为本地事件分配单调 replicationSeq（复制序号）', async () => {
      await storage.addEvent({
        id: 'rep-seq-1',
        content: 'first',
        createdAt: '2026-03-07T00:00:00.000Z',
      });

      await storage.addEvent({
        id: 'rep-seq-2',
        content: 'second',
        createdAt: '2026-03-07T00:00:01.000Z',
      });

      const events = await storage.getEvents();
      const first = events.find((event) => event.id === 'rep-seq-1');
      const second = events.find((event) => event.id === 'rep-seq-2');

      expect(first?.replicationSeq).toBe(1);
      expect(second?.replicationSeq).toBe(2);
    });

    it('应该忽略相同 event.id 且 payload 完全一致的复制事件', async () => {
      const event = {
        id: 'dup-same',
        content: '同一条复制事件',
        createdAt: '2026-03-07T10:00:00.000Z',
        type: 'note',
        metadata: {
          source: 'peer-a',
        },
        replicationSeq: 101,
      };

      await storage.addEvent(event);
      await expect(
        storage.addEvent(
          {
            ...event,
          },
          { origin: 'replicated' }
        )
      ).resolves.toBeUndefined();

      const events = await storage.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject(event);
    });

    it('应该拒绝相同 event.id 但 payload 不同的复制事件', async () => {
      await storage.addEvent({
        id: 'dup-conflict',
        content: '原始内容',
        createdAt: '2026-03-07T10:00:00.000Z',
        type: 'note',
        metadata: {
          source: 'peer-a',
        },
        replicationSeq: 102,
      });

      await expect(
        storage.addEvent(
          {
            id: 'dup-conflict',
            content: '冲突内容',
            createdAt: '2026-03-07T10:00:00.000Z',
            type: 'note',
            metadata: {
              source: 'peer-b',
            },
            replicationSeq: 102,
          },
          { origin: 'replicated' }
        )
      ).rejects.toThrow(/protocol/i);
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

  describe('clearAll', () => {
    it('应该清空所有事件', async () => {
      // 添加多个事件
      const events = [
        { id: 'clear-1', content: '事件1', createdAt: new Date().toISOString() },
        { id: 'clear-2', content: '事件2', createdAt: new Date().toISOString() },
        { id: 'clear-3', content: '事件3', createdAt: new Date().toISOString() },
      ];
      for (const event of events) {
        await storage.addEvent(event);
      }

      // 确认有事件
      expect(await storage.getEvents()).toHaveLength(3);

      // 清空
      await storage.clearAll();

      // 确认清空
      expect(await storage.getEvents()).toHaveLength(0);
    });

    it('在空存储上调用不应抛出错误', async () => {
      // 不应抛出错误
      await expect(async () => {
        await storage.clearAll();
      }).not.toThrow();
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

  describe('projectReplicatedEvent', () => {
    it('应该对完全相同的远端事件幂等去重', async () => {
      await expect(
        storage.projectReplicatedEvent({
          id: 'rep-dup-1',
          content: 'same payload',
          createdAt: '2026-03-07T00:00:00.000Z',
          type: 'note',
          replicationSeq: 10,
        })
      ).resolves.toBe('inserted');

      await expect(
        storage.projectReplicatedEvent({
          id: 'rep-dup-1',
          content: 'same payload',
          createdAt: '2026-03-07T00:00:00.000Z',
          type: 'note',
          replicationSeq: 10,
        })
      ).resolves.toBe('duplicate');

      const events = await storage.getEvents();
      expect(events.filter((event) => event.id === 'rep-dup-1')).toHaveLength(1);
    });

    it('应该拒绝相同 event.id 但不同 payload 的协议冲突', async () => {
      await storage.projectReplicatedEvent({
        id: 'rep-conflict-1',
        content: 'original payload',
        createdAt: '2026-03-07T00:00:00.000Z',
        type: 'note',
        replicationSeq: 12,
      });

      await expect(
        storage.projectReplicatedEvent({
          id: 'rep-conflict-1',
          content: 'mutated payload',
          createdAt: '2026-03-07T00:00:00.000Z',
          type: 'note',
          replicationSeq: 12,
        })
      ).rejects.toThrow(/protocol conflict/i);
    });
  });

  describe('getEventsPage', () => {
    it('应该按分页返回最近事件并提供下一页游标', async () => {
      const base = new Date('2024-01-01T10:00:00.000Z').getTime();

      for (let i = 0; i < 5; i++) {
        await storage.addEvent({
          id: `page-${i + 1}`,
          content: `事件 ${i + 1}`,
          createdAt: new Date(base + i * 1000).toISOString(),
        });
      }

      const firstPage = await storage.getEventsPage({ limit: 2 });

      expect(firstPage.events.map((event) => event.id)).toEqual(['page-5', 'page-4']);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toEqual({
        createdAt: new Date(base + 3 * 1000).toISOString(),
        id: 'page-4',
      });
    });

    it('应该根据游标继续加载更早事件且不重复', async () => {
      const base = new Date('2024-01-01T10:00:00.000Z').getTime();

      for (let i = 0; i < 5; i++) {
        await storage.addEvent({
          id: `cursor-${i + 1}`,
          content: `事件 ${i + 1}`,
          createdAt: new Date(base + i * 1000).toISOString(),
        });
      }

      const firstPage = await storage.getEventsPage({ limit: 2 });
      const secondPage = await storage.getEventsPage({
        limit: 2,
        cursor: firstPage.nextCursor!,
      });
      const thirdPage = await storage.getEventsPage({
        limit: 2,
        cursor: secondPage.nextCursor!,
      });

      expect(secondPage.events.map((event) => event.id)).toEqual(['cursor-3', 'cursor-2']);
      expect(thirdPage.events.map((event) => event.id)).toEqual(['cursor-1']);
      expect(thirdPage.hasMore).toBe(false);
      expect(thirdPage.nextCursor).toBeNull();
    });
  });

  describe('storage partition key（存储分区键）', () => {
    it('应该优先使用 active profileId 作为默认存储键', () => {
      const profile = createLocalProfile({
        slug: 'exomind',
        displayName: 'Hailay',
      });
      setProfileSession({
        version: 1,
        activeProfileId: profile.profileId,
        unlockedProfileIds: [profile.profileId],
      });
      localStorage.setItem('exomind:sync-store', JSON.stringify({
        state: { currentUser: 'legacy-user' },
      }));

      expect(getCurrentUserId()).toBe(profile.profileId);
      expect(getEventStorage()).toBe(getEventStorage(profile.profileId));
    });

    it('没有 active profile 时应该回退 legacy currentUser', () => {
      localStorage.setItem('exomind:sync-store', JSON.stringify({
        state: { currentUser: 'legacy-user' },
      }));

      expect(getCurrentUserId()).toBe('legacy-user');
      expect(getEventStorage()).toBe(getEventStorage('legacy-user'));
    });

    it('显式传入 userId 时应该优先于默认 profile key', () => {
      const profile = createLocalProfile({
        slug: 'exomind',
        displayName: 'Hailay',
      });
      setProfileSession({
        version: 1,
        activeProfileId: profile.profileId,
        unlockedProfileIds: [profile.profileId],
      });
      localStorage.setItem('exomind:sync-store', JSON.stringify({
        state: { currentUser: 'legacy-user' },
      }));

      expect(getEventStorage('override-user')).toBe(getEventStorage('override-user'));
      expect(getEventStorage('override-user')).not.toBe(getEventStorage());
    });
  });
});
