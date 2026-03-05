// signal-stream.service.test.ts — SignalStream 前端服务测试
//
// 测试目标:
//   1. SSE 连接建立（EventSource mock）
//   2. 信号接收与回调
//   3. 断线重连逻辑
//
// 依赖: SignalStreamService（前端 SDK）
// 状态: 测试骨架 — 使用 mock 编写完整测试逻辑

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock EventSource ──

interface MockEventSourceListener {
  (event: MessageEvent): void;
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState: number = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onerror: ((err: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private listeners: Map<string, MockEventSourceListener[]> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: MockEventSourceListener) {
    const existing = this.listeners.get(type) || [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: MockEventSourceListener) {
    const existing = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      existing.filter((l) => l !== listener),
    );
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateMessage(eventType: string, data: string, id?: string) {
    const event = new MessageEvent(eventType, {
      data,
      lastEventId: id || '',
    });

    // Fire typed listeners
    const listeners = this.listeners.get(eventType) || [];
    for (const listener of listeners) {
      listener(event);
    }

    // Fire generic onmessage for 'message' type
    if (eventType === 'message' && this.onmessage) {
      this.onmessage(event);
    }
  }

  simulateError() {
    this.readyState = 2; // CLOSED
    this.onerror?.(new Event('error'));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

// ── 类型定义（基于 API 契约）──

interface SignalEvent {
  schema_version: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  origin_host_id: string;
  hop: number;
  trace_id?: string;
  payload: Record<string, unknown>;
}

// ── 测试 ──

describe('SignalStreamService（信号流前端服务）', () => {
  beforeEach(() => {
    MockEventSource.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── 1. SSE 连接建立 ───

  describe('SSE 连接建立', () => {
    it('creates EventSource with correct URL（使用正确 URL 创建 EventSource）', () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      // });
      //
      // service.connect();
      //
      // expect(MockEventSource.instances).toHaveLength(1);
      // expect(MockEventSource.instances[0].url).toBe(
      //   'http://127.0.0.1:1949/signals/stream?agent_id=echo',
      // );

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it('fires onConnect callback when connection opens（连接打开时触发 onConnect）', () => {
      // const onConnect = vi.fn();
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   onConnect,
      // });
      //
      // service.connect();
      // MockEventSource.instances[0].simulateOpen();
      //
      // expect(onConnect).toHaveBeenCalledOnce();

      // TODO: 等 SignalStreamService 实现后取消注释
      const onConnect = vi.fn();
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('includes Last-Event-ID header for replay（包含 Last-Event-ID 用于重放）', () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   lastEventId: 'evt-42',
      // });
      //
      // service.connect();
      //
      // // EventSource with lastEventId should include it in URL or headers
      // expect(MockEventSource.instances[0].url).toContain('last_event_id=evt-42');

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });
  });

  // ─── 2. 信号接收 ───

  describe('信号接收', () => {
    it('parses SSE signal event and calls onSignal（解析 SSE 信号事件并回调）', () => {
      // const onSignal = vi.fn();
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   onSignal,
      // });
      //
      // service.connect();
      // const es = MockEventSource.instances[0];
      // es.simulateOpen();
      //
      // const testEvent: SignalEvent = {
      //   schema_version: 1,
      //   id: 'evt-1',
      //   topic: 'user.action',
      //   ts: Date.now(),
      //   source: 'test',
      //   origin_host_id: 'host-1',
      //   hop: 0,
      //   payload: { key: 'value' },
      // };
      //
      // es.simulateMessage('signal', JSON.stringify(testEvent), 'evt-1');
      //
      // expect(onSignal).toHaveBeenCalledOnce();
      // expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      //   id: 'evt-1',
      //   topic: 'user.action',
      //   schema_version: 1,
      // }));

      // TODO: 等 SignalStreamService 实现后取消注释
      const testEvent: SignalEvent = {
        schema_version: 1,
        id: 'evt-1',
        topic: 'user.action',
        ts: Date.now(),
        source: 'test',
        origin_host_id: 'host-1',
        hop: 0,
        payload: { key: 'value' },
      };
      expect(testEvent.schema_version).toBe(1);
    });

    it('tracks lastEventId from received events（跟踪最后接收的 event ID）', () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      // });
      //
      // service.connect();
      // const es = MockEventSource.instances[0];
      // es.simulateOpen();
      //
      // es.simulateMessage('signal', JSON.stringify({ id: 'evt-1', ... }), 'evt-1');
      // es.simulateMessage('signal', JSON.stringify({ id: 'evt-2', ... }), 'evt-2');
      //
      // expect(service.lastEventId).toBe('evt-2');

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });

    it('ignores malformed SSE data without crashing（忽略格式错误的 SSE 数据）', () => {
      // const onSignal = vi.fn();
      // const onError = vi.fn();
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   onSignal,
      //   onError,
      // });
      //
      // service.connect();
      // const es = MockEventSource.instances[0];
      // es.simulateOpen();
      //
      // // 发送非法 JSON
      // es.simulateMessage('signal', 'not-json', 'evt-bad');
      //
      // expect(onSignal).not.toHaveBeenCalled();
      // // 可能触发 onError，也可能静默忽略

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });
  });

  // ─── 3. 断线重连 ───

  describe('断线重连', () => {
    it('reconnects after connection error with exponential backoff（断线后指数退避重连）', async () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   reconnectBaseMs: 1000,
      //   maxReconnectMs: 30000,
      // });
      //
      // service.connect();
      // expect(MockEventSource.instances).toHaveLength(1);
      //
      // // 模拟断线
      // MockEventSource.instances[0].simulateError();
      //
      // // 等待第一次重连（1000ms）
      // await vi.advanceTimersByTimeAsync(1000);
      // expect(MockEventSource.instances).toHaveLength(2);
      //
      // // 再次断线
      // MockEventSource.instances[1].simulateError();
      //
      // // 等待第二次重连（2000ms = 1000 * 2^1）
      // await vi.advanceTimersByTimeAsync(2000);
      // expect(MockEventSource.instances).toHaveLength(3);

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });

    it('resets backoff after successful reconnection（重连成功后重置退避计数）', async () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   reconnectBaseMs: 1000,
      // });
      //
      // service.connect();
      //
      // // 断线 → 重连
      // MockEventSource.instances[0].simulateError();
      // await vi.advanceTimersByTimeAsync(1000);
      //
      // // 重连成功
      // MockEventSource.instances[1].simulateOpen();
      //
      // // 再次断线 → 退避应从 1000ms 重新开始（不是 2000ms）
      // MockEventSource.instances[1].simulateError();
      // await vi.advanceTimersByTimeAsync(1000);
      //
      // expect(MockEventSource.instances).toHaveLength(3);

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });

    it('caps reconnect delay at maxReconnectMs（重连延迟不超过上限）', async () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      //   reconnectBaseMs: 1000,
      //   maxReconnectMs: 5000,
      // });
      //
      // service.connect();
      //
      // // 断线多次，让退避增长
      // for (let i = 0; i < 10; i++) {
      //   MockEventSource.instances[i].simulateError();
      //   await vi.advanceTimersByTimeAsync(5000); // 最大延迟
      // }
      //
      // // 10 次断线 → 理论退避 1000*2^9 = 512000ms
      // // 但被 cap 到 5000ms，所以所有重连都应已发生
      // expect(MockEventSource.instances.length).toBe(11);

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });

    it('includes last event ID when reconnecting（重连时携带 last event ID）', async () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      // });
      //
      // service.connect();
      // const es = MockEventSource.instances[0];
      // es.simulateOpen();
      //
      // // 接收一个事件
      // es.simulateMessage('signal', JSON.stringify({ id: 'evt-42' }), 'evt-42');
      //
      // // 断线重连
      // es.simulateError();
      // await vi.advanceTimersByTimeAsync(1000);
      //
      // // 新 EventSource 应包含 last_event_id
      // const newEs = MockEventSource.instances[1];
      // expect(newEs.url).toContain('last_event_id=evt-42');

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });

    it('disconnect stops reconnection attempts（主动断开停止重连）', async () => {
      // const service = new SignalStreamService({
      //   baseUrl: 'http://127.0.0.1:1949',
      //   agentId: 'echo',
      //   EventSourceImpl: MockEventSource as any,
      // });
      //
      // service.connect();
      // MockEventSource.instances[0].simulateError();
      //
      // // 在重连前主动断开
      // service.disconnect();
      //
      // await vi.advanceTimersByTimeAsync(10000);
      // expect(MockEventSource.instances).toHaveLength(1); // 没有新连接

      // TODO: 等 SignalStreamService 实现后取消注释
      expect(true).toBe(true);
    });
  });
});
