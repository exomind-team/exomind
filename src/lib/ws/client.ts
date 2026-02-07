/**
 * WebSocket 客户端模块
 * 现代化 WebSocket 连接管理，支持自动重连、消息队列、心跳检测
 *
 * @module ws/client
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * 生成唯一消息 ID
 */
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * WebSocket 连接状态
 */
export enum WSConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Error = 'error',
}

/**
 * WebSocket 消息类型
 */
export enum WSMessageType {
  Auth = 'auth',
  AuthOk = 'auth_ok',
  AuthFail = 'auth_fail',
  Ping = 'ping',
  Pong = 'pong',
  Send = 'send',
  Broadcast = 'broadcast',
  Deliver = 'deliver',
  Sync = 'sync',
  SyncResp = 'sync_resp',
}

/**
 * WebSocket 消息结构
 */
export interface WSMessage {
  type: WSMessageType;
  fromDevice?: string;
  toDevice?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  messageId?: string;
}

/**
 * 连接配置
 */
export interface WSConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始重连延迟（毫秒） */
  initialDelay: number;
  /** 最大重连延迟（毫秒） */
  maxDelay: number;
  /** 重连退避因子 */
  backoffFactor: number;
  /** 心跳间隔（毫秒） */
  heartbeatInterval: number;
  /** 连接超时（毫秒） */
  connectionTimeout: number;
}

/**
 * 默认配置
 */
export const DEFAULT_WS_CONFIG: WSConfig = {
  maxRetries: 10,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  heartbeatInterval: 30000,
  connectionTimeout: 10000,
};

/**
 * 连接结果
 */
export interface WSConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * 发送结果
 */
export interface WSSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * 消息载荷
 */
export interface WSMessagePayload {
  message: WSMessage;
  raw?: string;
}

// ============================================================================
// 消息队列
// ============================================================================

/**
 * 消息队列项
 */
interface QueuedMessage {
  message: WSMessage;
  retries: number;
  maxRetries: number;
  createdAt: number;
}

/**
 * 消息队列
 */
class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly maxSize: number = 1000;

  /**
   * 添加消息到队列
   */
  enqueue(message: WSMessage, maxRetries: number = 3): void {
    if (this.queue.length >= this.maxSize) {
      console.warn('Message queue is full, dropping oldest message');
      this.queue.shift();
    }
    this.queue.push({
      message,
      retries: 0,
      maxRetries,
      createdAt: Date.now(),
    });
  }

  /**
   * 从队列获取消息
   */
  dequeue(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 获取队列大小
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 增加重试计数
   */
  incrementRetries(): number {
    if (this.queue.length > 0) {
      this.queue[0].retries++;
      return this.queue[0].retries;
    }
    return 0;
  }

  /**
   * 获取最早消息的重试次数
   */
  getRetryCount(): number {
    return this.queue.length > 0 ? this.queue[0].retries : 0;
  }

  /**
   * 移除超时的消息
   */
  removeExpired(maxAge: number): void {
    const now = Date.now();
    this.queue = this.queue.filter(item => now - item.createdAt < maxAge);
  }
}

// ============================================================================
// WebSocket 客户端
// ============================================================================

/**
 * WebSocket 客户端事件类型
 */
export enum WSClientEventType {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Message = 'message',
  Error = 'error',
  StateChanged = 'stateChanged',
  Reconnecting = 'reconnecting',
  MaxRetriesExceeded = 'maxRetriesExceeded',
}

/**
 * WebSocket 客户端事件载荷
 */
export interface WSClientEventPayload {
  [WSClientEventType.Connected]: { url: string };
  [WSClientEventType.Disconnected]: { url: string; reason?: string };
  [WSClientEventType.Message]: WSMessagePayload;
  [WSClientEventType.Error]: { error: string };
  [WSClientEventType.StateChanged]: {
    previousState: WSConnectionState;
    currentState: WSConnectionState;
  };
  [WSClientEventType.Reconnecting]: { attempt: number; maxRetries: number };
  [WSClientEventType.MaxRetriesExceeded]: { url: string };
}

/**
 * WebSocket 客户端事件监听器类型
 */
export type WSClientEventListener<K extends WSClientEventType = WSClientEventType> = (
  payload: WSClientEventPayload[K]
) => void;

/**
 * WebSocket 客户端
 * 现代化 WebSocket 连接管理
 */
export class WebSocketClient {
  // 单例实例
  private static instance: WebSocketClient | null = null;

  // 状态管理
  private state: WSConnectionState = WSConnectionState.Disconnected;
  private url: string = '';
  private config: WSConfig;

  // 重连状态
  private retryCount: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // 心跳状态
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // 消息队列
  private messageQueue: MessageQueue = new MessageQueue();

  // 事件总线
  private eventListeners: Map<WSClientEventType, Set<WSClientEventListener>> = new Map();

  // 消息处理器
  private messageHandlers: Set<(payload: WSMessagePayload) => void> = new Set();

  // 私有构造函数（单例模式）
  private constructor(config: Partial<WSConfig> = {}) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
  }

  // ============================================================================
  // 单例模式
  // ============================================================================

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<WSConfig>): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient(config);
    }
    return WebSocketClient.instance;
  }

  /**
   * 销毁单例实例
   */
  static destroyInstance(): void {
    if (WebSocketClient.instance) {
      WebSocketClient.instance.disconnect();
      WebSocketClient.instance.eventListeners.clear();
      WebSocketClient.instance.messageQueue.clear();
      WebSocketClient.instance = null;
    }
  }

  // ============================================================================
  // 状态管理
  // ============================================================================

  /**
   * 获取当前状态
   */
  getState(): WSConnectionState {
    return this.state;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.state === WSConnectionState.Connected;
  }

  /**
   * 检查是否正在连接
   */
  isConnecting(): boolean {
    return this.state === WSConnectionState.Connecting;
  }

  /**
   * 检查是否正在重连
   */
  isReconnecting(): boolean {
    return this.state === WSConnectionState.Reconnecting;
  }

  // ============================================================================
  // 连接管理
  // ============================================================================

  /**
   * 连接到 WebSocket 服务器
   */
  async connect(url: string): Promise<WSConnectionResult> {
    // 如果已经在连接中，返回错误
    if (this.state === WSConnectionState.Connecting) {
      return { success: false, error: 'Already connecting' };
    }

    // 如果已连接，先断开
    if (this.state === WSConnectionState.Connected) {
      await this.disconnect();
    }

    this.url = url;
    this.setState(WSConnectionState.Connecting);

    try {
      const result = await invoke<string>('ws_connect', { url });

      if (result === 'connected') {
        this.setState(WSConnectionState.Connected);
        this.retryCount = 0;

        // 启动心跳检测
        this.startHeartbeat();

        // 发送队列中的消息
        await this.flushMessageQueue();

        // 发送连接成功事件
        this.emit(WSClientEventType.Connected, { url });

        return { success: true };
      } else {
        this.handleConnectionError('Connection failed');
        return { success: false, error: 'Connection failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.handleConnectionError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 断开连接
   */
  async disconnect(reason?: string): Promise<void> {
    // 清除定时器
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();

    try {
      await invoke('ws_disconnect');
    } catch (error) {
      console.error('Disconnect error:', error);
    }

    this.setState(WSConnectionState.Disconnected);
    this.messageQueue.clear();

    this.emit(WSClientEventType.Disconnected, { url: this.url, reason });
  }

  // ============================================================================
  // 消息发送
  // ============================================================================

  /**
   * 发送消息
   */
  async send(message: Omit<WSMessage, 'messageId' | 'timestamp'>): Promise<WSSendResult> {
    const fullMessage: WSMessage = {
      ...message,
      messageId: generateMessageId(),
      timestamp: new Date().toISOString(),
    };

    // 如果未连接，加入队列
    if (!this.isConnected()) {
      this.messageQueue.enqueue(fullMessage);
      return { success: true, messageId: fullMessage.messageId };
    }

    try {
      await invoke('ws_send', { message: JSON.stringify(fullMessage) });
      return { success: true, messageId: fullMessage.messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 发送失败，加入队列重试
      this.messageQueue.enqueue(fullMessage);

      return { success: false, messageId: fullMessage.messageId, error: errorMessage };
    }
  }

  /**
   * 发送消息（带确认）
   */
  async sendWithAck(
    message: Omit<WSMessage, 'messageId' | 'timestamp'>,
    ackTimeout: number = 5000
  ): Promise<WSSendResult> {
    const result = await this.send(message);

    if (!result.success) {
      return result;
    }

    // 等待确认
    return new Promise((resolve) => {
      const messageId = result.messageId!;
      const startTime = Date.now();

      const checkAck = (): void => {
        // 检查是否收到确认
        const acked = this.messageQueue.isEmpty() ||
          this.messageQueue.getRetryCount() > 3;

        if (acked) {
          resolve({ success: true, messageId });
          return;
        }

        if (Date.now() - startTime > ackTimeout) {
          resolve({ success: false, messageId, error: 'Ack timeout' });
          return;
        }

        setTimeout(checkAck, 100);
      };

      checkAck();
    });
  }

  /**
   * 发送心跳
   */
  private async sendPing(): Promise<void> {
    if (!this.isConnected()) {
      return;
    }

    try {
      await this.send({
        type: WSMessageType.Ping,
        payload: {},
      });
    } catch (error) {
      console.error('Ping failed:', error);
    }
  }

  // ============================================================================
  // 事件系统
  // ============================================================================

  /**
   * 订阅事件
   */
  on<K extends WSClientEventType>(
    eventType: K,
    listener: WSClientEventListener<K>
  ): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener as WSClientEventListener);

    // 返回取消订阅函数
    return () => this.off(eventType, listener);
  }

  /**
   * 取消订阅
   */
  off<K extends WSClientEventType>(
    eventType: K,
    listener: WSClientEventListener<K>
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener as WSClientEventListener);
    }
  }

  /**
   * 订阅消息事件
   */
  onMessage(listener: (payload: WSMessagePayload) => void): () => void {
    this.messageHandlers.add(listener);
    return () => this.messageHandlers.delete(listener);
  }

  /**
   * 发布事件
   */
  private emit<K extends WSClientEventType>(
    eventType: K,
    payload: WSClientEventPayload[K]
  ): void {
    // 发布到事件监听器
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`WS client event listener error: ${eventType}`, error);
        }
      });
    }
  }

  /**
   * 处理收到的消息
   */
  handleMessage(rawMessage: string): void {
    try {
      const message = JSON.parse(rawMessage) as WSMessage;

      // 如果是心跳响应，不处理
      if (message.type === WSMessageType.Pong) {
        return;
      }

      const payload: WSMessagePayload = { message, raw: rawMessage };

      // 发送到消息处理器
      this.messageHandlers.forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error('Message handler error:', error);
        }
      });

      // 发送消息事件
      this.emit(WSClientEventType.Message, payload);
    } catch (error) {
      console.error('Failed to parse message:', error);
      this.emit(WSClientEventType.Error, {
        error: `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  /**
   * 设置连接状态
   */
  private setState(newState: WSConnectionState): void {
    if (this.state === newState) {
      return;
    }

    const previousState = this.state;
    this.state = newState;

    this.emit(WSClientEventType.StateChanged, {
      previousState,
      currentState: newState,
    });
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(error: string): void {
    this.setState(WSConnectionState.Error);
    this.emit(WSClientEventType.Error, { error });

    // 尝试重连
    if (this.retryCount < this.config.maxRetries) {
      this.scheduleReconnect();
    } else {
      this.emit(WSClientEventType.MaxRetriesExceeded, { url: this.url });
      this.disconnect('Max retries exceeded');
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    // 计算延迟（指数退避）
    const delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffFactor, this.retryCount),
      this.config.maxDelay
    );

    this.retryCount++;
    this.setState(WSConnectionState.Reconnecting);

    console.log(`Scheduling reconnect in ${delay}ms (attempt ${this.retryCount}/${this.config.maxRetries})`);

    this.emit(WSClientEventType.Reconnecting, {
      attempt: this.retryCount,
      maxRetries: this.config.maxRetries,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect(this.url);
    }, delay);
  }

  /**
   * 清除重连定时器
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendPing();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * 清除心跳定时器
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 发送队列中的消息
   */
  private async flushMessageQueue(): Promise<void> {
    while (!this.messageQueue.isEmpty() && this.isConnected()) {
      const item = this.messageQueue.dequeue();
      if (!item) break;

      try {
        await invoke('ws_send', { message: JSON.stringify(item.message) });
      } catch (error) {
        // 发送失败，增加重试计数
        const retries = this.messageQueue.incrementRetries();
        if (retries >= item.maxRetries) {
          // 超过最大重试次数，丢弃消息
          console.warn('Message exceeded max retries, dropping:', item.message.messageId);
          continue;
        }
        // 重新加入队列
        this.messageQueue.enqueue(item.message, item.maxRetries);
      }
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

/**
 * 获取 WebSocket 客户端默认实例
 */
export function getWSClient(config?: Partial<WSConfig>): WebSocketClient {
  return WebSocketClient.getInstance(config);
}

/**
 * 销毁 WebSocket 客户端实例
 */
export function destroyWSClient(): void {
  WebSocketClient.destroyInstance();
}

// 导出类型供外部使用
export type {
  WSConfig,
  WSMessage,
  WSConnectionResult,
  WSSendResult,
  WSMessagePayload,
};
