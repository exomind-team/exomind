/**
 * WebSocket 模块 - 事件系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter, WebSocketEvent, NamespacedEventEmitter } from '../../src/lib/sync/ws-events';

describe('EventEmitter', () => {
  let emitter: EventEmitter<{ test: string; number: number }>;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe('on()', () => {
    it('应该添加事件监听器', () => {
      const handler = vi.fn();
      emitter.on('test', handler);

      emitter.emit('test', 'hello');
      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('应该支持多个监听器', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('test', handler1);
      emitter.on('test', handler2);

      emitter.emit('test', 'hello');

      expect(handler1).toHaveBeenCalledWith('hello');
      expect(handler2).toHaveBeenCalledWith('hello');
    });

    it('应该返回订阅对象', () => {
      const handler = vi.fn();
      const subscription = emitter.on('test', handler);

      expect(subscription.unsubscribe).toBeDefined();
      expect(subscription.isUnsubscribed).toBe(false);
    });
  });

  describe('once()', () => {
    it('应该只触发一次', () => {
      const handler = vi.fn();
      emitter.once('test', handler);

      emitter.emit('test', '1');
      emitter.emit('test', '2');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('1');
    });
  });

  describe('off()', () => {
    it('应该移除特定监听器', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('test', handler1);
      emitter.on('test', handler2);

      emitter.off('test', handler1);

      emitter.emit('test', 'hello');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith('hello');
    });

    it('应该移除所有监听器', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      emitter.on('test', handler1);
      emitter.on('test', handler2);

      emitter.off('test');

      emitter.emit('test', 'hello');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('emit()', () => {
    it('应该触发所有监听器', () => {
      const calls: string[] = [];
      emitter.on('test', (v) => calls.push(v + '1'));
      emitter.on('test', (v) => calls.push(v + '2'));

      emitter.emit('test', 'hello');

      expect(calls).toEqual(['hello1', 'hello2']);
    });

    it('应该返回 false 当没有监听器', () => {
      const result = emitter.emit('test', 'hello');

      expect(result).toBe(false);
    });

    it('应该返回 true 当有监听器', () => {
      emitter.on('test', vi.fn());

      const result = emitter.emit('test', 'hello');

      expect(result).toBe(true);
    });

    it('正常处理器应该仍被调用（即使有处理器抛出错误）', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      emitter.on('test', errorHandler);
      emitter.on('test', normalHandler);

      // 正常处理器应该仍被调用
      normalHandler.mockClear();
      emitter.emit('test', 'hello');
      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('Subscription', () => {
    it('unsubscribe 应该移除监听器', () => {
      const handler = vi.fn();
      const subscription = emitter.on('test', handler);

      subscription.unsubscribe();
      expect(subscription.isUnsubscribed).toBe(true);

      emitter.emit('test', 'hello');
      expect(handler).not.toHaveBeenCalled();
    });

    it('多次 unsubscribe 应该安全', () => {
      const handler = vi.fn();
      const subscription = emitter.on('test', handler);

      subscription.unsubscribe();
      subscription.unsubscribe();
      subscription.unsubscribe();

      expect(subscription.isUnsubscribed).toBe(true);
    });
  });

  describe('listenerCount()', () => {
    it('应该返回监听器数量', () => {
      expect(emitter.listenerCount('test')).toBe(0);

      emitter.on('test', vi.fn());
      expect(emitter.listenerCount('test')).toBe(1);

      emitter.on('test', vi.fn());
      expect(emitter.listenerCount('test')).toBe(2);
    });

    it('应该返回 0 当事件不存在', () => {
      expect(emitter.listenerCount('non-existent')).toBe(0);
    });
  });

  describe('eventNames()', () => {
    it('应该返回所有事件名称', () => {
      emitter.on('event1', vi.fn());
      emitter.on('event2', vi.fn());

      const names = emitter.eventNames();

      expect(names).toContain('event1');
      expect(names).toContain('event2');
    });
  });

  describe('removeAllListeners()', () => {
    it('应该移除所有监听器', () => {
      emitter.on('event1', vi.fn());
      emitter.on('event2', vi.fn());

      emitter.removeAllListeners();

      expect(emitter.eventNames()).toEqual([]);
    });
  });

  describe('setMaxListeners()', () => {
    it('应该设置最大监听器数量', () => {
      emitter.setMaxListeners(5);
      expect(emitter.getMaxListeners()).toBe(5);
    });

    it('应该允许 0 个监听器', () => {
      emitter.setMaxListeners(0);
      expect(emitter.getMaxListeners()).toBe(0);
    });
  });
});

describe('NamespacedEventEmitter', () => {
  let nsEmitter: NamespacedEventEmitter<{
    namespace1: { value: string };
    namespace2: { count: number };
  }>;

  beforeEach(() => {
    nsEmitter = new NamespacedEventEmitter();
  });

  describe('emit()', () => {
    it('应该触发全局事件', () => {
      const handler = vi.fn();
      nsEmitter.on('global-event', handler);

      nsEmitter.emit('global-event', 'data' as any);

      expect(handler).toHaveBeenCalledWith('data');
    });
  });
});
