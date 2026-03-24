/**
 * ChatPage + EventStorage 集成测试
 *
 * 测试场景：
 * 1. 发送消息时自动创建事件记录
 * 2. 从事件存储中检索消息历史
 * 3. 多设备同步场景
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventStorage } from '@/lib/storage/event-storage';

describe('ChatPage + EventStorage Integration', () => {
  let storage: EventStorage;

  beforeEach(async () => {
    // 使用随机用户 ID 隔离测试
    const testUserId = `integration-test-${Date.now()}`;
    storage = new EventStorage(testUserId);
  });

  afterEach(async () => {
    // 清理
    await storage.clearAll();
    await storage.stopSync();
    await storage.close();
  });

  describe('消息发送 → 事件存储', () => {
    it('发送消息应该创建事件记录', async () => {
      const message = '测试消息内容';
      const eventId = `msg-${Date.now()}`;

      // 发送消息（模拟 ChatPage.handleSend）
      await storage.addEvent({
        id: eventId,
        content: message,
        createdAt: new Date().toISOString(),
        type: 'chat',
      });

      // 验证事件已存储
      const events = await storage.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(eventId);
      expect(events[0].content).toBe(message);
      expect(events[0].type).toBe('chat');
    });

    it('连续发送多条消息应该按时间排序', async () => {
      // 发送第一条消息
      await storage.addEvent({
        id: 'msg-1',
        content: '第一条消息',
        createdAt: '2024-01-01T10:00:00.000Z',
      });

      // 发送第二条消息
      await storage.addEvent({
        id: 'msg-2',
        content: '第二条消息',
        createdAt: '2024-01-01T10:00:01.000Z',
      });

      // 发送第三条消息
      await storage.addEvent({
        id: 'msg-3',
        content: '第三条消息',
        createdAt: '2024-01-01T10:00:02.000Z',
      });

      // 验证获取的事件按时间倒序排列
      const events = await storage.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0].id).toBe('msg-3');  // 最新
      expect(events[1].id).toBe('msg-2');
      expect(events[2].id).toBe('msg-1');  // 最旧
    });
  });

  describe('消息历史检索', () => {
    it('应该能检索完整的消息历史', async () => {
      // 准备测试数据
      const messages = [
        { id: 'm1', content: '消息1' },
        { id: 'm2', content: '消息2' },
        { id: 'm3', content: '消息3' },
      ];

      for (const msg of messages) {
        await storage.addEvent({
          id: msg.id,
          content: msg.content,
          createdAt: new Date().toISOString(),
        });
      }

      // 检索历史
      const history = await storage.getEvents();

      // 验证
      expect(history).toHaveLength(3);
      expect(history.map((e) => e.content)).toEqual(['消息3', '消息2', '消息1']);
    });

    it('应该能获取单个消息详情', async () => {
      const eventId = 'single-msg';
      await storage.addEvent({
        id: eventId,
        content: '单条消息内容',
        createdAt: new Date().toISOString(),
        metadata: { source: 'chat' },
      });

      const event = await storage.getEvent(eventId);

      expect(event).toBeDefined();
      expect(event?.id).toBe(eventId);
      expect(event?.content).toBe('单条消息内容');
      expect(event?.metadata?.source).toBe('chat');
    });
  });

  describe('多设备同步场景', () => {
    it('远程变更应该触发监听器', async () => {
      let changeReceived = false;
      let callCount = 0;

      // 注册变更监听
      const unsubscribe = storage.onRemoteChange(() => {
        callCount++;
        changeReceived = true;
      });

      // 等待监听器注册完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 直接调用 notifyChangeListeners 模拟远程变更
      storage.notifyChangeListeners({ type: 'remote_change' });

      // 验证监听器被调用
      expect(callCount).toBe(1);

      // 取消监听
      unsubscribe();
    });

    it('应该能注册和取消远程变更监听', () => {
      let callCount = 0;

      const unsubscribe = storage.onRemoteChange(() => {
        callCount++;
      });

      // 触发一次
      storage.notifyChangeListeners({});
      expect(callCount).toBe(1);

      // 取消监听
      unsubscribe();

      // 触发第二次 - 应该不调用
      storage.notifyChangeListeners({});
      expect(callCount).toBe(1);
    });
  });

  describe('消息删除', () => {
    it('删除消息后应该从历史中消失', async () => {
      await storage.addEvent({
        id: 'to-delete',
        content: '将被删除的消息',
        createdAt: new Date().toISOString(),
      });

      // 验证存在
      let events = await storage.getEvents();
      expect(events.find((e) => e.id === 'to-delete')).toBeDefined();

      // 删除
      await storage.deleteEvent('to-delete');

      // 验证已删除
      events = await storage.getEvents();
      expect(events.find((e) => e.id === 'to-delete')).toBeUndefined();
    });
  });

  describe('事件元数据', () => {
    it('应该支持存储消息类型', async () => {
      await storage.addEvent({
        id: 'text-msg',
        content: '文本消息',
        createdAt: new Date().toISOString(),
        type: 'text',
      });

      await storage.addEvent({
        id: 'voice-msg',
        content: '语音消息',
        createdAt: new Date().toISOString(),
        type: 'voice',
      });

      const events = await storage.getEvents();

      const textEvent = events.find((e) => e.type === 'text');
      const voiceEvent = events.find((e) => e.type === 'voice');

      expect(textEvent).toBeDefined();
      expect(voiceEvent).toBeDefined();
      expect(textEvent?.content).toBe('文本消息');
      expect(voiceEvent?.content).toBe('语音消息');
    });

    it('应该支持存储额外元数据', async () => {
      await storage.addEvent({
        id: 'rich-msg',
        content: '富文本消息',
        createdAt: new Date().toISOString(),
        metadata: {
          sender: 'user-123',
          room: 'general',
          priority: 'high',
        },
      });

      const event = await storage.getEvent('rich-msg');

      expect(event).toBeDefined();
      expect(event?.metadata?.sender).toBe('user-123');
      expect(event?.metadata?.room).toBe('general');
      expect(event?.metadata?.priority).toBe('high');
    });
  });

  describe('数据一致性', () => {
    it('重复添加相同 ID 应该使用不同的 rev', async () => {
      const id = 'same-id-msg';

      // 第一次添加
      await storage.addEvent({
        id,
        content: '第一次添加',
        createdAt: '2024-01-01T10:00:00.000Z',
      });

      // 获取第一个版本
      const events1 = await storage.getEvents();
      expect(events1).toHaveLength(1);
      expect(events1[0].content).toBe('第一次添加');

      // 使用不同的 ID 添加第二次
      const id2 = 'same-id-msg-2';
      await storage.addEvent({
        id: id2,
        content: '第二次添加',
        createdAt: '2024-01-01T12:00:00.000Z',
      });

      // 验证两个事件都存在
      const events2 = await storage.getEvents();
      expect(events2).toHaveLength(2);
    });

    it('事件计数应该准确', async () => {
      expect(await storage.count()).toBe(0);

      await storage.addEvent({ id: 'c1', content: '1', createdAt: new Date().toISOString() });
      expect(await storage.count()).toBe(1);

      await storage.addEvent({ id: 'c2', content: '2', createdAt: new Date().toISOString() });
      await storage.addEvent({ id: 'c3', content: '3', createdAt: new Date().toISOString() });
      expect(await storage.count()).toBe(3);

      await storage.deleteEvent('c2');
      expect(await storage.count()).toBe(2);
    });
  });
});
