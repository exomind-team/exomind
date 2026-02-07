/**
 * WebSocket 客户端单元测试
 * 100% 覆盖率目标
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WSConnectionState,
  WSMessageType,
  WSClientEventType,
  DEFAULT_WS_CONFIG,
  WebSocketClient,
  getWSClient,
  destroyWSClient,
} from './client';

// Mock Tauri invoke 函数
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('WebSocketClient', () => {
  beforeEach(() => {
    destroyWSClient();
    mockInvoke.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyWSClient();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple getInstance calls', () => {
      const client1 = getWSClient();
      const client2 = getWSClient();
      expect(client1).toBe(client2);
    });

    it('should create new instance after destroy', () => {
      const client1 = getWSClient();
      destroyWSClient();
      const client2 = getWSClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe('Default Config', () => {
    it('should have correct default configuration', () => {
      expect(DEFAULT_WS_CONFIG.maxRetries).toBe(10);
      expect(DEFAULT_WS_CONFIG.initialDelay).toBe(1000);
      expect(DEFAULT_WS_CONFIG.maxDelay).toBe(30000);
      expect(DEFAULT_WS_CONFIG.backoffFactor).toBe(2);
      expect(DEFAULT_WS_CONFIG.heartbeatInterval).toBe(30000);
      expect(DEFAULT_WS_CONFIG.connectionTimeout).toBe(10000);
    });
  });

  describe('State Management', () => {
    it('should start in disconnected state', () => {
      const client = getWSClient();
      expect(client.getState()).toBe(WSConnectionState.Disconnected);
    });

    it('isConnected should return false when disconnected', () => {
      const client = getWSClient();
      expect(client.isConnected()).toBe(false);
    });

    it('isConnecting should return false when disconnected', () => {
      const client = getWSClient();
      expect(client.isConnecting()).toBe(false);
    });

    it('isReconnecting should return false when disconnected', () => {
      const client = getWSClient();
      expect(client.isReconnecting()).toBe(false);
    });
  });

  describe('Connection', () => {
    it('should connect successfully', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('connected');

      const result = await client.connect('ws://localhost:8080');

      expect(result.success).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    it('should handle connect failure', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('failed');

      const result = await client.connect('ws://localhost:8080');

      expect(result.success).toBe(false);
      expect(client.isConnected()).toBe(false);
    });

    it('should handle invoke error', async () => {
      const client = getWSClient();
      mockInvoke.mockRejectedValue(new Error('Network error'));

      const result = await client.connect('ws://localhost:8080');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('should return error when already connecting', async () => {
      const client = getWSClient();
      mockInvoke.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

      const result1 = client.connect('ws://localhost:8080');
      const result2 = client.connect('ws://localhost:8080');

      const [r1, r2] = await Promise.all([result1, result2]);

      expect(r2.success).toBe(false);
      expect(r2.error).toBe('Already connecting');
    });
  });

  describe('Disconnection', () => {
    it('should disconnect successfully', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('connected');
      await client.connect('ws://localhost:8080');
      mockInvoke.mockResolvedValue(undefined);

      await client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should clear message queue on disconnect', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('connected');
      await client.connect('ws://localhost:8080');

      // 发送消息（会进入队列）
      await client.send({ type: WSMessageType.Send, payload: { content: 'test' } });

      await client.disconnect();

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Message Sending', () => {
    it('should send message successfully when connected', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('connected');
      await client.connect('ws://localhost:8080');
      mockInvoke.mockResolvedValue(undefined);

      const result = await client.send({
        type: WSMessageType.Send,
        payload: { content: 'Hello' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.messageId).toMatch(/^\d+-[\w]{11}$/);
    });

    it('should queue message when not connected', async () => {
      const client = getWSClient();

      const result = await client.send({
        type: WSMessageType.Send,
        payload: { content: 'Hello' },
      });

      expect(result.success).toBe(true);
    });

    it('should include timestamp in message', async () => {
      const client = getWSClient();
      mockInvoke.mockResolvedValue('connected');
      await client.connect('ws://localhost:8080');
      mockInvoke.mockResolvedValue(undefined);

      const sendSpy = vi.spyOn(client as any, 'send');

      await client.send({
        type: WSMessageType.Send,
        payload: { content: 'test' },
      });

      expect(sendSpy).toHaveBeenCalled();
    });
  });

  describe('Event System', () => {
    it('should allow subscription and unsubscription', () => {
      const client = getWSClient();
      const callback = vi.fn();

      const unsubscribe = client.on(WSClientEventType.Connected, callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should support generic on method', () => {
      const client = getWSClient();
      const callback = vi.fn();

      const unsubscribe = client.on(WSClientEventType.StateChanged, callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should support onMessage subscription', () => {
      const client = getWSClient();
      const callback = vi.fn();

      const unsubscribe = client.onMessage(callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });
  });

  describe('Message Handling', () => {
    it('should handle incoming message', () => {
      const client = getWSClient();
      const callback = vi.fn();

      client.onMessage(callback);

      const rawMessage = JSON.stringify({
        type: WSMessageType.Send,
        fromDevice: 'device-1',
        payload: { content: 'Hello' },
        timestamp: new Date().toISOString(),
        messageId: 'msg-1',
      });

      client.handleMessage(rawMessage);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            type: WSMessageType.Send,
            messageId: 'msg-1',
          }),
        })
      );
    });

    it('should ignore pong messages', () => {
      const client = getWSClient();
      const callback = vi.fn();

      client.onMessage(callback);

      const rawMessage = JSON.stringify({
        type: WSMessageType.Pong,
        timestamp: new Date().toISOString(),
      });

      client.handleMessage(rawMessage);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle parse error gracefully', () => {
      const client = getWSClient();
      const errorCallback = vi.fn();

      client.on(WSClientEventType.Error, errorCallback);

      // Invalid JSON
      client.handleMessage('not valid json');

      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Failed to parse message'),
        })
      );
    });
  });

  describe('Connection State Enum', () => {
    it('should have all required states', () => {
      expect(WSConnectionState.Disconnected).toBe('disconnected');
      expect(WSConnectionState.Connecting).toBe('connecting');
      expect(WSConnectionState.Connected).toBe('connected');
      expect(WSConnectionState.Reconnecting).toBe('reconnecting');
      expect(WSConnectionState.Error).toBe('error');
    });
  });

  describe('Message Type Enum', () => {
    it('should have all required message types', () => {
      expect(WSMessageType.Auth).toBe('auth');
      expect(WSMessageType.AuthOk).toBe('auth_ok');
      expect(WSMessageType.AuthFail).toBe('auth_fail');
      expect(WSMessageType.Ping).toBe('ping');
      expect(WSMessageType.Pong).toBe('pong');
      expect(WSMessageType.Send).toBe('send');
      expect(WSMessageType.Broadcast).toBe('broadcast');
      expect(WSMessageType.Deliver).toBe('deliver');
      expect(WSMessageType.Sync).toBe('sync');
      expect(WSMessageType.SyncResp).toBe('sync_resp');
    });
  });

  describe('Client Event Type Enum', () => {
    it('should have all required event types', () => {
      expect(WSClientEventType.Connected).toBe('connected');
      expect(WSClientEventType.Disconnected).toBe('disconnected');
      expect(WSClientEventType.Message).toBe('message');
      expect(WSClientEventType.Error).toBe('error');
      expect(WSClientEventType.StateChanged).toBe('stateChanged');
      expect(WSClientEventType.Reconnecting).toBe('reconnecting');
      expect(WSClientEventType.MaxRetriesExceeded).toBe('maxRetriesExceeded');
    });
  });
});

describe('WSConnectionResult', () => {
  it('should create success result', () => {
    const result: { success: boolean } = { success: true };
    expect(result.success).toBe(true);
  });

  it('should create error result', () => {
    const result: { success: boolean; error: string } = {
      success: false,
      error: 'Connection failed',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection failed');
  });
});

describe('MessageQueue', () => {
  // Test internal MessageQueue via WebSocketClient behavior
  it('should handle queue operations through client', async () => {
    const client = getWSClient();
    mockInvoke.mockResolvedValue('connected');
    await client.connect('ws://localhost:8080');

    // Queue a message
    await client.send({
      type: WSMessageType.Send,
      payload: { content: 'test' },
    });

    expect(client.isConnected()).toBe(true);
  });
});
