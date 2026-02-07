/**
 * WebSocket 模块 - 消息队列单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MessageQueue,
  MessagePriority,
  QueueMessage,
} from '../../src/lib/sync/ws-queue';

describe('MessageQueue', () => {
  let queue: MessageQueue<string>;

  beforeEach(() => {
    queue = new MessageQueue<string>({
      maxSize: 10,
      priorityEnabled: true,
      ttl: 0,
      maxRetries: 3,
    });
  });

  describe('构造', () => {
    it('应该创建队列实例', () => {
      expect(queue).toBeDefined();
      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('应该应用自定义选项', () => {
      const customQueue = new MessageQueue<string>({
        maxSize: 5,
        priorityEnabled: false,
      });

      expect(customQueue.isEmpty()).toBe(true);
    });
  });

  describe('enqueue()', () => {
    it('应该入队消息', () => {
      const result = queue.enqueue('message1');

      expect(result).toBe(true);
      expect(queue.size()).toBe(1);
    });

    it('应该返回 false 当队列已满', () => {
      // 填满队列
      for (let i = 0; i < 10; i++) {
        queue.enqueue(`message${i}`);
      }

      const result = queue.enqueue('overflow');

      expect(result).toBe(false);
      expect(queue.size()).toBe(10);
    });

    it('应该支持优先级排序', () => {
      queue.enqueue('low', MessagePriority.LOW);
      queue.enqueue('high', MessagePriority.HIGH);
      queue.enqueue('normal', MessagePriority.NORMAL);
      queue.enqueue('critical', MessagePriority.CRITICAL);
      queue.enqueue('lowest', MessagePriority.LOWEST);

      const first = queue.dequeue();
      expect(first).toBe('critical');
    });

    it('相同优先级应该按入队顺序', () => {
      queue.enqueue('first');
      queue.enqueue('second');
      queue.enqueue('third');

      expect(queue.dequeue()).toBe('first');
      expect(queue.dequeue()).toBe('second');
      expect(queue.dequeue()).toBe('third');
    });
  });

  describe('dequeue()', () => {
    it('应该出队消息', () => {
      queue.enqueue('message1');
      queue.enqueue('message2');

      const first = queue.dequeue();
      const second = queue.dequeue();

      expect(first).toBe('message1');
      expect(second).toBe('message2');
      expect(queue.isEmpty()).toBe(true);
    });

    it('应该返回 null 当队列为空', () => {
      const result = queue.dequeue();

      expect(result).toBeNull();
    });
  });

  describe('peek()', () => {
    it('应该查看队首消息', () => {
      queue.enqueue('message1');
      queue.enqueue('message2');

      const peeked = queue.peek();

      expect(peeked).toBe('message1');
      expect(queue.size()).toBe(2);
    });

    it('应该返回 null 当队列为空', () => {
      const peeked = queue.peek();

      expect(peeked).toBeNull();
    });
  });

  describe('enqueueBatch()', () => {
    it('应该批量入队', () => {
      const result = queue.enqueueBatch(['a', 'b', 'c']);

      expect(result).toBe(3);
      expect(queue.size()).toBe(3);
    });

    it('应该返回实际入队数量', () => {
      // 填满部分队列
      for (let i = 0; i < 8; i++) {
        queue.enqueue(`existing${i}`);
      }

      const result = queue.enqueueBatch(['a', 'b', 'c']);

      expect(result).toBe(2);
      expect(queue.size()).toBe(10);
    });
  });

  describe('dequeueBatch()', () => {
    it('应该批量出队', () => {
      queue.enqueueBatch(['a', 'b', 'c', 'd', 'e']);

      const batch = queue.dequeueBatch(3);

      expect(batch).toEqual(['a', 'b', 'c']);
      expect(queue.size()).toBe(2);
    });

    it('不应该超过队列大小', () => {
      queue.enqueueBatch(['a', 'b']);

      const batch = queue.dequeueBatch(10);

      expect(batch).toEqual(['a', 'b']);
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('clear()', () => {
    it('应该清空队列', () => {
      queue.enqueueBatch(['a', 'b', 'c']);

      queue.clear();

      expect(queue.isEmpty()).toBe(true);
      expect(queue.size()).toBe(0);
    });
  });

  describe('isFull()', () => {
    it('应该正确判断队列是否已满', () => {
      expect(queue.isFull()).toBe(false);

      for (let i = 0; i < 10; i++) {
        queue.enqueue(`message${i}`);
      }

      expect(queue.isFull()).toBe(true);
    });
  });

  describe('remainingCapacity()', () => {
    it('应该返回剩余容量', () => {
      expect(queue.remainingCapacity()).toBe(10);

      queue.enqueue('a');
      expect(queue.remainingCapacity()).toBe(9);

      queue.enqueueBatch(['b', 'c']);
      expect(queue.remainingCapacity()).toBe(7);
    });

    it('无限制容量返回 Infinity', () => {
      const unlimitedQueue = new MessageQueue<string>({
        maxSize: 0,
      });

      expect(unlimitedQueue.remainingCapacity()).toBe(Infinity);
    });
  });

  describe('removeById()', () => {
    it('应该根据 ID 移除消息', () => {
      const msg1 = 'message1';
      const msg2 = 'message2';
      const msg3 = 'message3';

      queue.enqueue(msg1);
      queue.enqueue(msg2);
      queue.enqueue(msg3);

      // 获取消息的 ID（通过快照）
      const snapshot = queue.snapshot();
      const idToRemove = snapshot[1].id;

      const result = queue.removeById(idToRemove);

      expect(result).toBe(true);
      expect(queue.size()).toBe(2);
    });

    it('应该返回 false 当消息不存在', () => {
      queue.enqueue('message');

      const result = queue.removeById('non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('应该返回所有消息', () => {
      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      const all = queue.getAll();

      expect(all).toEqual(['a', 'b', 'c']);
    });
  });

  describe('snapshot()', () => {
    it('应该返回包含元数据的快照', () => {
      queue.enqueue('test', 5);
      const snapshot = queue.snapshot();

      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].payload).toBe('test');
      expect(snapshot[0].priority).toBe(5);
      expect(snapshot[0].retryCount).toBe(0);
      expect(snapshot[0].maxRetries).toBe(3);
      expect(snapshot[0].id).toBeDefined();
    });
  });
});

describe('MessagePriority 常量', () => {
  it('应该包含所有优先级级别', () => {
    expect(MessagePriority.CRITICAL).toBe(100);
    expect(MessagePriority.HIGH).toBe(50);
    expect(MessagePriority.NORMAL).toBe(0);
    expect(MessagePriority.LOW).toBe(-50);
    expect(MessagePriority.LOWEST).toBe(-100);
  });

  it('优先级应该有序', () => {
    expect(MessagePriority.CRITICAL).toBeGreaterThan(MessagePriority.HIGH);
    expect(MessagePriority.HIGH).toBeGreaterThan(MessagePriority.NORMAL);
    expect(MessagePriority.NORMAL).toBeGreaterThan(MessagePriority.LOW);
    expect(MessagePriority.LOW).toBeGreaterThan(MessagePriority.LOWEST);
  });
});
