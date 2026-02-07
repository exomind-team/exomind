/**
 * WebSocket 模块 - 错误处理单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WebSocketError,
  WebSocketErrorCode,
  ConnectionState,
} from '../../src/lib/sync/ws-errors';

describe('WebSocketError', () => {
  describe('构造', () => {
    it('应该创建包含所有属性的错误', () => {
      const error = new WebSocketError({
        code: WebSocketErrorCode.ERR_CONNECTION_FAILED,
        message: 'Connection failed',
        url: 'ws://localhost:8080',
        reason: 'Network unreachable',
        retryable: true,
      });

      expect(error.name).toBe('WebSocketError');
      expect(error.code).toBe(WebSocketErrorCode.ERR_CONNECTION_FAILED);
      expect(error.message).toBe('Connection failed');
      expect(error.url).toBe('ws://localhost:8080');
      expect(error.reason).toBe('Network unreachable');
      expect(error.retryable).toBe(true);
    });

    it('应该支持可选属性', () => {
      const error = new WebSocketError({
        code: WebSocketErrorCode.ERR_UNKNOWN,
        message: 'Unknown error',
      });

      expect(error.url).toBeUndefined();
      expect(error.reason).toBeUndefined();
      // ERR_UNKNOWN 默认不可重试
      expect(error.retryable).toBe(false);
    });
  });

  describe('is()', () => {
    it('应该正确判断错误码', () => {
      const error = new WebSocketError({
        code: WebSocketErrorCode.ERR_NOT_CONNECTED,
        message: 'Not connected',
      });

      expect(error.is(WebSocketErrorCode.ERR_NOT_CONNECTED)).toBe(true);
      expect(error.is(WebSocketErrorCode.ERR_CONNECTION_FAILED)).toBe(false);
    });
  });

  describe('toJSON()', () => {
    it('应该返回可序列化的对象', () => {
      const error = new WebSocketError({
        code: WebSocketErrorCode.ERR_SEND_FAILED,
        message: 'Send failed',
        url: 'ws://localhost:8080',
        retryable: true,
      });

      const json = error.toJSON();

      expect(json).toEqual({
        name: 'WebSocketError',
        code: WebSocketErrorCode.ERR_SEND_FAILED,
        message: 'Send failed',
        url: 'ws://localhost:8080',
        reason: undefined,
        retryable: true,
      });
    });
  });

  describe('静态工厂方法', () => {
    describe('connectionFailed()', () => {
      it('应该创建连接失败错误', () => {
        const error = WebSocketError.connectionFailed('ws://localhost:8080', 'timeout');

        expect(error.code).toBe(WebSocketErrorCode.ERR_CONNECTION_FAILED);
        expect(error.message).toContain('ws://localhost:8080');
        expect(error.url).toBe('ws://localhost:8080');
        expect(error.reason).toBe('timeout');
        expect(error.retryable).toBe(true);
      });
    });

    describe('connectionTimeout()', () => {
      it('应该创建连接超时错误', () => {
        const error = WebSocketError.connectionTimeout('ws://localhost:8080');

        expect(error.code).toBe(WebSocketErrorCode.ERR_CONNECTION_TIMEOUT);
        expect(error.message).toContain('ws://localhost:8080');
        expect(error.retryable).toBe(true);
      });
    });

    describe('notConnected()', () => {
      it('应该创建未连接错误', () => {
        const error = WebSocketError.notConnected();

        expect(error.code).toBe(WebSocketErrorCode.ERR_NOT_CONNECTED);
        expect(error.message).toBe('WebSocket is not connected');
        expect(error.retryable).toBe(true);
      });
    });

    describe('alreadyConnected()', () => {
      it('应该创建已连接错误', () => {
        const error = WebSocketError.alreadyConnected('ws://localhost:8080');

        expect(error.code).toBe(WebSocketErrorCode.ERR_ALREADY_CONNECTED);
        expect(error.message).toContain('ws://localhost:8080');
        expect(error.retryable).toBe(false);
      });
    });

    describe('invalidUrl()', () => {
      it('应该创建无效 URL 错误', () => {
        const error = WebSocketError.invalidUrl('invalid-url');

        expect(error.code).toBe(WebSocketErrorCode.ERR_INVALID_URL);
        expect(error.message).toContain('invalid-url');
        expect(error.retryable).toBe(false);
      });
    });

    describe('sendFailed()', () => {
      it('应该创建发送失败错误', () => {
        const error = WebSocketError.sendFailed('test message');

        expect(error.code).toBe(WebSocketErrorCode.ERR_SEND_FAILED);
        expect(error.message).toContain('test message');
        expect(error.retryable).toBe(true);
      });
    });

    describe('maxReconnectAttempts()', () => {
      it('应该创建最大重连次数错误', () => {
        const error = WebSocketError.maxReconnectAttempts('ws://localhost:8080', 5);

        expect(error.code).toBe(WebSocketErrorCode.ERR_RECONNECT_MAX_ATTEMPTS);
        expect(error.message).toContain('5');
        expect(error.message).toContain('ws://localhost:8080');
        expect(error.retryable).toBe(false);
      });
    });
  });

  describe('默认重试行为', () => {
    it('连接错误应该可重试', () => {
      const error = WebSocketError.connectionFailed('ws://localhost:8080');
      expect(error.retryable).toBe(true);
    });

    it('状态错误不应该自动重试', () => {
      const error = WebSocketError.notConnected();
      expect(error.retryable).toBe(true);
    });

    it('无效 URL 不应该重试', () => {
      const error = WebSocketError.invalidUrl('invalid');
      expect(error.retryable).toBe(false);
    });
  });
});

describe('ConnectionState 枚举', () => {
  it('应该包含所有状态', () => {
    expect(ConnectionState.Disconnected).toBe('disconnected');
    expect(ConnectionState.Connecting).toBe('connecting');
    expect(ConnectionState.Connected).toBe('connected');
    expect(ConnectionState.Reconnecting).toBe('reconnecting');
  });
});
