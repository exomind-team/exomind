/**
 * WebSocket 模块 - 统一错误码定义
 */

/**
 * WebSocket 错误码枚举
 */
export enum WebSocketErrorCode {
  // ============ 连接错误 ============
  /** 连接失败 */
  ERR_CONNECTION_FAILED = 'WS_001',
  /** 连接超时 */
  ERR_CONNECTION_TIMEOUT = 'WS_002',
  /** 连接被拒绝 */
  ERR_CONNECTION_REFUSED = 'WS_003',
  /** 无效的 URL */
  ERR_INVALID_URL = 'WS_004',

  // ============ 状态错误 ============
  /** 未连接 */
  ERR_NOT_CONNECTED = 'WS_010',
  /** 已连接 */
  ERR_ALREADY_CONNECTED = 'WS_011',
  /** 正在连接中 */
  ERR_STILL_CONNECTING = 'WS_012',

  // ============ 发送错误 ============
  /** 发送失败 */
  ERR_SEND_FAILED = 'WS_020',
  /** 消息队列已满 */
  ERR_MESSAGE_QUEUE_FULL = 'WS_021',

  // ============ 接收错误 ============
  /** 消息解析失败 */
  ERR_MESSAGE_PARSE_FAILED = 'WS_030',
  /** 消息处理器错误 */
  ERR_MESSAGE_HANDLER_ERROR = 'WS_031',

  // ============ 重连错误 ============
  /** 重连失败 */
  ERR_RECONNECT_FAILED = 'WS_040',
  /** 超过最大重连次数 */
  ERR_RECONNECT_MAX_ATTEMPTS = 'WS_041',

  // ============ 通用错误 ============
  /** 未知错误 */
  ERR_UNKNOWN = 'WS_999',
}

/**
 * WebSocket 错误详情
 */
export interface WebSocketErrorDetails {
  code: WebSocketErrorCode;
  message: string;
  url?: string;
  reason?: string;
  retryable?: boolean;
  cause?: unknown;
}

/**
 * WebSocket 错误类
 */
export class WebSocketError extends Error {
  public readonly code: WebSocketErrorCode;
  public readonly url?: string;
  public readonly reason?: string;
  public readonly retryable: boolean;
  public readonly cause?: unknown;

  constructor(details: WebSocketErrorDetails) {
    super(details.message);
    this.name = 'WebSocketError';
    this.code = details.code;
    this.url = details.url;
    this.reason = details.reason;
    this.retryable = details.retryable ?? this.isRetryableByDefault(details.code);
    this.cause = details.cause;
  }

  /**
   * 根据错误码判断是否可重试
   */
  private isRetryableByDefault(code: WebSocketErrorCode): boolean {
    const retryableCodes = [
      WebSocketErrorCode.ERR_CONNECTION_FAILED,
      WebSocketErrorCode.ERR_CONNECTION_TIMEOUT,
      WebSocketErrorCode.ERR_CONNECTION_REFUSED,
      WebSocketErrorCode.ERR_SEND_FAILED,
      WebSocketErrorCode.ERR_RECONNECT_FAILED,
    ];
    return retryableCodes.includes(code);
  }

  /**
   * 检查是否为特定错误码
   */
  is(code: WebSocketErrorCode): boolean {
    return this.code === code;
  }

  /**
   * 转换为可序列化的对象
   */
  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      url: this.url,
      reason: this.reason,
      retryable: this.retryable,
    };
  }

  /**
   * 创建连接失败错误
   */
  static connectionFailed(url: string, reason?: string): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_CONNECTION_FAILED,
      message: `Failed to connect to ${url}`,
      url,
      reason,
      retryable: true,
    });
  }

  /**
   * 创建连接超时错误
   */
  static connectionTimeout(url: string): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_CONNECTION_TIMEOUT,
      message: `Connection to ${url} timed out`,
      url,
      retryable: true,
    });
  }

  /**
   * 创建未连接错误
   */
  static notConnected(): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_NOT_CONNECTED,
      message: 'WebSocket is not connected',
      retryable: true,
    });
  }

  /**
   * 创建已连接错误
   */
  static alreadyConnected(url: string): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_ALREADY_CONNECTED,
      message: `Already connected to ${url}`,
      url,
      retryable: false,
    });
  }

  /**
   * 创建无效 URL 错误
   */
  static invalidUrl(url: string): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_INVALID_URL,
      message: `Invalid WebSocket URL: ${url}`,
      url,
      retryable: false,
    });
  }

  /**
   * 创建发送失败错误
   */
  static sendFailed(message: string): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_SEND_FAILED,
      message: `Failed to send message: ${message}`,
      retryable: true,
    });
  }

  /**
   * 创建超过最大重连次数错误
   */
  static maxReconnectAttempts(url: string, attempts: number): WebSocketError {
    return new WebSocketError({
      code: WebSocketErrorCode.ERR_RECONNECT_MAX_ATTEMPTS,
      message: `Max reconnect attempts (${attempts}) exceeded for ${url}`,
      url,
      retryable: false,
    });
  }
}

/**
 * WebSocket 结果类型
 */
export type WebSocketResult<T> =
  | { success: true; data: T }
  | { success: false; error: WebSocketError };

/**
 * 连接选项
 */
export interface ConnectOptions {
  /** 连接超时时间（毫秒） */
  timeout?: number;
  /** 自动重连策略 */
  reconnectPolicy?: ReconnectPolicy;
  /** 是否启用消息队列 */
  enableQueue?: boolean;
  /** 队列最大容量 */
  maxQueueSize?: number;
}

/**
 * 重连策略接口
 */
export interface ReconnectPolicy {
  /** 最大重试次数 */
  maxAttempts: number;
  /** 初始延迟（毫秒） */
  initialDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 退避乘数 */
  backoffMultiplier: number;
  /** 是否应该重连 */
  shouldReconnect(error: WebSocketError): boolean;
}

/**
 * 默认重连策略
 */
export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  shouldReconnect: (error) => error.retryable,
};

/**
 * 连接结果
 */
export interface ConnectionResult {
  connected: boolean;
  url: string;
  attempt: number;
  latency?: number;
}

/**
 * 连接状态
 */
export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
}

/**
 * 连接状态变更事件
 */
export interface ConnectionStateChangeEvent {
  previousState: ConnectionState;
  currentState: ConnectionState;
  reason?: string;
}
