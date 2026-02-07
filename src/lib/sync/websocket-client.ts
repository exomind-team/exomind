/**
 * WebSocket 模块 - 重构后的 WebSocket 客户端
 */

import { invoke } from '@tauri-apps/api/core';
import { EventEmitter, WebSocketEvent } from './ws-events';
import {
  WebSocketError,
  WebSocketErrorCode,
  ConnectionState,
  ConnectionResult,
  ConnectOptions,
  WebSocketResult,
} from './ws-errors';
import { MessageQueue, MessagePriority } from './ws-queue';

/**
 * WebSocket 消息类型
 */
export interface SyncMessage {
  type: 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';
  payload: unknown;
  timestamp: number;
  deviceId: string;
  id?: string;
}

/**
 * WebSocket 客户端配置
 */
export interface WebSocketClientConfig {
  /** 连接超时（毫秒） */
  connectTimeout: number;
  /** 启用自动重连 */
  autoReconnect: boolean;
  /** 重连最大次数 */
  maxReconnectAttempts: number;
  /** 重连初始延迟（毫秒） */
  reconnectInitialDelay: number;
  /** 重连最大延迟（毫秒） */
  reconnectMaxDelay: number;
  /** 重连退避乘数 */
  reconnectBackoffMultiplier: number;
  /** 启用消息队列 */
  enableMessageQueue: boolean;
  /** 消息队列最大容量 */
  messageQueueMaxSize: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: WebSocketClientConfig = {
  connectTimeout: 10000,
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectInitialDelay: 1000,
  reconnectMaxDelay: 30000,
  reconnectBackoffMultiplier: 2,
  enableMessageQueue: true,
  messageQueueMaxSize: 1000,
};

/**
 * 重构后的 WebSocket 客户端类
 */
export class WebSocketClient extends EventEmitter<{
  [WebSocketEvent.Connected]: { url: string; latency?: number };
  [WebSocketEvent.Disconnected]: { reason?: string };
  [WebSocketEvent.Error]: WebSocketError;
  [WebSocketEvent.Message]: SyncMessage;
  [WebSocketEvent.MessageSent]: { id: string };
  [WebSocketEvent.MessageFailed]: { id: string; error: WebSocketError };
  [WebSocketEvent.Reconnecting]: { attempt: number; maxAttempts: number };
  [WebSocketEvent.Reconnected]: { url: string; attempt: number };
  [WebSocketEvent.ReconnectFailed]: { attempt: number; maxAttempts: number };
}> {
  private config: WebSocketClientConfig;
  private state: ConnectionState;
  private currentUrl: string | null;
  private messageQueue: MessageQueue<SyncMessage>;
  private reconnectAttempts: number;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null;

  constructor(config?: Partial<WebSocketClientConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = ConnectionState.Disconnected;
    this.currentUrl = null;
    this.messageQueue = new MessageQueue<SyncMessage>({
      maxSize: this.config.messageQueueMaxSize,
    });
    this.reconnectAttempts = 0;
    this.reconnectTimeoutId = null;
    this.connectTimeoutId = null;
  }

  /**
   * 获取当前连接状态
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.state === ConnectionState.Connected;
  }

  /**
   * 检查是否正在连接
   */
  isConnecting(): boolean {
    return this.state === ConnectionState.Connecting;
  }

  /**
   * 获取消息队列大小
   */
  getQueueSize(): number {
    return this.messageQueue.size();
  }

  /**
   * 连接到 WebSocket 服务器
   */
  async connect(url: string, options?: ConnectOptions): Promise<ConnectionResult> {
    // 检查是否已连接
    if (this.state === ConnectionState.Connected) {
      if (this.currentUrl === url) {
        throw WebSocketError.alreadyConnected(url);
      }
      await this.disconnect('Reconnecting to new URL');
    }

    // 设置状态为连接中
    this.setState(ConnectionState.Connecting);

    // 设置连接超时
    const timeout = options?.timeout ?? this.config.connectTimeout;
    this.connectTimeoutId = setTimeout(() => {
      if (this.state === ConnectionState.Connecting) {
        this.handleConnectionError(WebSocketError.connectionTimeout(url));
      }
    }, timeout);

    try {
      // 调用后端连接
      const result = await invoke<string>('ws_connect', { url });

      if (result === 'connected' || result.includes('Connected')) {
        // 计算延迟（粗略估算）
        const latency = options?.timeout ? undefined : undefined;

        this.clearConnectTimeout();
        this.currentUrl = url;
        this.reconnectAttempts = 0;
        this.setState(ConnectionState.Connected);

        // 发送队列中的消息
        await this.flushQueue();

        // 触发连接成功事件
        this.emit(WebSocketEvent.Connected, { url, latency });

        return { connected: true, url, attempt: 1, latency };
      }

      throw WebSocketError.connectionFailed(url, result);
    } catch (error) {
      this.clearConnectTimeout();

      if (error instanceof WebSocketError) {
        this.handleConnectionError(error);
        throw error;
      }

      const wsError = WebSocketError.connectionFailed(
        url,
        error instanceof Error ? error.message : String(error)
      );
      this.handleConnectionError(wsError);
      throw wsError;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(reason?: string): Promise<void> {
    this.clearReconnectTimeout();
    this.clearConnectTimeout();

    if (this.state === ConnectionState.Disconnected) {
      return;
    }

    const previousUrl = this.currentUrl ?? undefined;

    try {
      await invoke('ws_disconnect');
    } catch (error) {
      console.warn('Disconnect error:', error);
    }

    this.setState(ConnectionState.Disconnected);
    this.currentUrl = null;

    // 触发断开连接事件
    this.emit(WebSocketEvent.Disconnected, { reason });

    // 如果配置了自动重连，尝试重连
    if (this.config.autoReconnect && previousUrl) {
      await this.scheduleReconnect(previousUrl);
    }
  }

  /**
   * 发送消息
   */
  async send(message: SyncMessage): Promise<void> {
    // 如果启用了队列且未连接，添加到队列
    if (
      this.config.enableMessageQueue &&
      this.state !== ConnectionState.Connected
    ) {
      const enqueued = this.messageQueue.enqueue(
        message,
        this.getMessagePriority(message.type)
      );

      if (!enqueued) {
        throw new WebSocketError({
          code: WebSocketErrorCode.ERR_MESSAGE_QUEUE_FULL,
          message: 'Message queue is full',
        });
      }

      this.emit(WebSocketEvent.QueueStateChange, {
        action: 'enqueue',
        size: this.messageQueue.size(),
      } as any);

      return;
    }

    // 检查连接状态
    if (this.state !== ConnectionState.Connected) {
      throw WebSocketError.notConnected();
    }

    // 添加消息 ID
    const messageWithId = {
      ...message,
      id: message.id ?? this.generateMessageId(),
    };

    try {
      await invoke('ws_send', {
        message: JSON.stringify(messageWithId),
      });

      this.emit(WebSocketEvent.MessageSent, { id: messageWithId.id! });
    } catch (error) {
      const wsError =
        error instanceof WebSocketError
          ? error
          : WebSocketError.sendFailed(String(error));

      // 如果启用了队列，添加到队列
      if (this.config.enableMessageQueue) {
        this.messageQueue.enqueue(messageWithId, this.getMessagePriority(message.type));
      }

      this.emit(WebSocketEvent.MessageFailed, {
        id: messageWithId.id!,
        error: wsError,
      });

      throw wsError;
    }
  }

  /**
   * 注册消息处理器
   */
  onMessage(handler: (message: SyncMessage) => void): () => void {
    return this.on(WebSocketEvent.Message, handler);
  }

  /**
   * 注册连接处理器
   */
  onConnected(handler: (data: { url: string; latency?: number }) => void): () => void {
    return this.on(WebSocketEvent.Connected, handler);
  }

  /**
   * 注册断开连接处理器
   */
  onDisconnected(handler: (data: { reason?: string }) => void): () => void {
    return this.on(WebSocketEvent.Disconnected, handler);
  }

  /**
   * 注册错误处理器
   */
  onError(handler: (error: WebSocketError) => void): () => void {
    return this.on(WebSocketEvent.Error, handler);
  }

  /**
   * 批量发送队列中的消息
   */
  private async flushQueue(): Promise<void> {
    if (this.messageQueue.isEmpty()) {
      return;
    }

    const messages = this.messageQueue.dequeueBatch(100);

    for (const message of messages) {
      try {
        await this.send(message);
      } catch (error) {
        console.warn('Failed to flush queued message:', error);
      }
    }
  }

  /**
   * 安排重连
   */
  private async scheduleReconnect(url: string): Promise<void> {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      const error = WebSocketError.maxReconnectAttempts(url, this.config.maxReconnectAttempts);
      this.emit(WebSocketEvent.ReconnectFailed, {
        attempt: this.reconnectAttempts,
        maxAttempts: this.config.maxReconnectAttempts,
      });
      this.emit(WebSocketEvent.Error, error);
      return;
    }

    this.reconnectAttempts++;
    this.setState(ConnectionState.Reconnecting);

    // 计算重连延迟（指数退避）
    const delay = Math.min(
      this.config.reconnectInitialDelay *
        Math.pow(this.config.reconnectBackoffMultiplier, this.reconnectAttempts - 1),
      this.config.reconnectMaxDelay
    );

    this.emit(WebSocketEvent.Reconnecting, {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
    });

    this.reconnectTimeoutId = setTimeout(async () => {
      try {
        await this.connect(url);
        this.emit(WebSocketEvent.Reconnected, {
          url,
          attempt: this.reconnectAttempts,
        });
      } catch (error) {
        // 重连失败，继续尝试
        await this.scheduleReconnect(url);
      }
    }, delay);
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(error: WebSocketError): void {
    this.setState(ConnectionState.Disconnected);
    this.emit(WebSocketEvent.Error, error);

    // 如果配置了自动重连，尝试重连
    if (this.config.autoReconnect && this.currentUrl) {
      this.scheduleReconnect(this.currentUrl);
    }
  }

  /**
   * 设置连接状态
   */
  private setState(newState: ConnectionState): void {
    const previousState = this.state;
    this.state = newState;

    if (previousState !== newState) {
      this.emit(WebSocketEvent.StateChange, {
        previousState,
        currentState: newState,
      } as any);
    }
  }

  /**
   * 清除连接超时
   */
  private clearConnectTimeout(): void {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
  }

  /**
   * 清除重连超时
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  /**
   * 根据消息类型获取优先级
   */
  private getMessagePriority(type: SyncMessage['type']): number {
    switch (type) {
      case 'AUTH':
        return MessagePriority.HIGH;
      case 'SYNC_REQUEST':
      case 'SYNC_RESPONSE':
        return MessagePriority.NORMAL;
      case 'CHANGE':
        return MessagePriority.HIGH;
      case 'ACK':
        return MessagePriority.CRITICAL;
      default:
        return MessagePriority.NORMAL;
    }
  }

  /**
   * 生成消息 ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 清空消息队列
   */
  clearQueue(): void {
    this.messageQueue.clear();
  }

  /**
   * 销毁客户端
   */
  destroy(): void {
    this.clearConnectTimeout();
    this.clearReconnectTimeout();
    this.messageQueue.clear();
    this.removeAllListeners();
    this.state = ConnectionState.Disconnected;
  }
}

/**
 * 默认 WebSocket 客户端实例
 */
export const wsClient = new WebSocketClient();
