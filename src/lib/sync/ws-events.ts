/**
 * WebSocket 模块 - 事件系统
 */

/**
 * 事件类型定义
 */
export enum WebSocketEvent {
  /** 连接成功 */
  Connected = 'connected',
  /** 断开连接 */
  Disconnected = 'disconnected',
  /** 连接错误 */
  Error = 'error',
  /** 收到消息 */
  Message = 'message',
  /** 消息发送成功 */
  MessageSent = 'message:sent',
  /** 消息发送失败 */
  MessageFailed = 'message:failed',
  /** 开始重连 */
  Reconnecting = 'reconnecting',
  /** 重连成功 */
  Reconnected = 'reconnected',
  /** 重连失败 */
  ReconnectFailed = 'reconnect:failed',
  /** 状态变更 */
  StateChange = 'state:change',
  /** 队列状态变更 */
  QueueStateChange = 'queue:state:change',
}

/**
 * 事件监听器类型
 */
export type EventListener<T = unknown> = (data: T) => void;

/**
 * 订阅对象
 */
export interface Subscription {
  /** 取消订阅 */
  unsubscribe(): void;
  /** 检查是否已取消 */
  readonly isUnsubscribed: boolean;
}

/**
 * 事件监听器包装
 */
interface ListenerWrapper<T> {
  listener: EventListener<T>;
  once: boolean;
  unsubscribed: boolean;
}

/**
 * 事件发射器类
 */
export class EventEmitter<EventMap extends Record<string, unknown> = never> {
  private listeners: Map<string, ListenerWrapper<unknown>[]> = new Map();
  private maxListeners: number;
  private defaultMaxListeners: number = 10;

  constructor(maxListeners?: number) {
    this.maxListeners = maxListeners ?? this.defaultMaxListeners;
  }

  /**
   * 添加事件监听器
   */
  on<K extends keyof EventMap>(
    event: K,
    listener: EventListener<EventMap[K]>
  ): Subscription;
  on(event: string, listener: EventListener<unknown>): Subscription {
    return this.addListener(event, listener, false);
  }

  /**
   * 添加一次性事件监听器
   */
  once<K extends keyof EventMap>(
    event: K,
    listener: EventListener<EventMap[K]>
  ): Subscription;
  once(event: string, listener: EventListener<unknown>): Subscription {
    return this.addListener(event, listener, true);
  }

  /**
   * 内部添加监听器方法
   */
  private addListener(
    event: string,
    listener: EventListener<unknown>,
    once: boolean
  ): Subscription {
    const listeners = this.listeners.get(event) ?? [];

    // 检查是否超过最大监听器数量
    if (listeners.length >= this.maxListeners) {
      console.warn(
        `Max listeners (${this.maxListeners}) exceeded for event "${event}"`
      );
    }

    const wrapper: ListenerWrapper<unknown> = {
      listener,
      once,
      unsubscribed: false,
    };

    listeners.push(wrapper);
    this.listeners.set(event, listeners);

    // 返回订阅对象
    return {
      unsubscribe: () => {
        wrapper.unsubscribed = true;
        this.removeUnsubscribed(event);
      },
      get isUnsubscribed() {
        return wrapper.unsubscribed;
      },
    };
  }

  /**
   * 移除事件监听器
   */
  off<K extends keyof EventMap>(
    event: K,
    listener?: EventListener<EventMap[K]>
  ): void;
  off(event: string, listener?: EventListener<unknown>): void {
    if (listener === undefined) {
      // 移除该事件的所有监听器
      this.listeners.delete(event);
      return;
    }

    const listeners = this.listeners.get(event);
    if (!listeners) {
      return;
    }

    // 标记为取消订阅，稍后清理
    for (const wrapper of listeners) {
      if (wrapper.listener === listener) {
        wrapper.unsubscribed = true;
      }
    }
    this.removeUnsubscribed(event);
  }

  /**
   * 移除已取消订阅的监听器
   */
  private removeUnsubscribed(event: string): void {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      return;
    }

    const activeListeners = listeners.filter((w) => !w.unsubscribed);
    if (activeListeners.length === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, activeListeners);
    }
  }

  /**
   * 触发事件
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): boolean;
  emit(event: string, data: unknown): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.length === 0) {
      return false;
    }

    // 复制数组，避免在迭代中修改
    const toCall = [...listeners];

    for (const wrapper of toCall) {
      if (wrapper.unsubscribed) {
        continue;
      }

      try {
        wrapper.listener(data);
      } catch (error) {
        console.error(`Error in event listener for "${event}":`, error);
      }

      // 如果是一次性监听器，标记为取消
      if (wrapper.once) {
        wrapper.unsubscribed = true;
      }
    }

    // 清理已取消的一次性监听器
    this.removeUnsubscribed(event);
    return true;
  }

  /**
   * 获取事件监听器数量
   */
  listenerCount(event: string): number {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      return 0;
    }
    return listeners.filter((w) => !w.unsubscribed).length;
  }

  /**
   * 获取所有事件名称
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * 设置最大监听器数量
   */
  setMaxListeners(n: number): void {
    this.maxListeners = Math.max(0, n);
  }

  /**
   * 获取最大监听器数量
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }
}

/**
 * 带命名空间的事件发射器
 */
export class NamespacedEventEmitter<
  NamespaceMap extends Record<string, Record<string, unknown>> = never
> {
  private emitter: EventEmitter;
  private namespaceSeparator: string;

  constructor(namespaceSeparator: string = ':') {
    this.emitter = new EventEmitter();
    this.namespaceSeparator = namespaceSeparator;
  }

  /**
   * 构建完整事件名
   */
  private buildEventName(namespace: string, event: string): string {
    return `${namespace}${this.namespaceSeparator}${event}`;
  }

  /**
   * 获取命名空间的事件发射器
   */
  namespace<K extends keyof NamespaceMap>(
    ns: K
  ): EventEmitter<NamespaceMap[K]> {
    const eventPrefix = `${ns}${this.namespaceSeparator}`;

    // 创建代理对象
    const proxy = new EventEmitter<NamespaceMap[K]>();

    // 覆盖方法，添加命名空间前缀
    const originalOn = proxy.on.bind(proxy);
    const originalOnce = proxy.once.bind(proxy);
    const originalOff = proxy.off.bind(proxy);
    const originalEmit = proxy.emit.bind(proxy);

    proxy.on = ((event: string, listener: EventListener<unknown>) => {
      return this.emitter.on(this.buildEventName(ns as string, event), listener);
    }) as typeof proxy.on;

    proxy.once = ((event: string, listener: EventListener<unknown>) => {
      return this.emitter.once(this.buildEventName(ns as string, event), listener);
    }) as typeof proxy.once;

    proxy.off = ((event: string, listener?: EventListener<unknown>) => {
      return this.emitter.off(this.buildEventName(ns as string, event), listener);
    }) as typeof proxy.off;

    return proxy;
  }

  /**
   * 全局监听
   */
  on(event: string, listener: EventListener<unknown>): Subscription {
    return this.emitter.on(event, listener);
  }

  /**
   * 全局一次性监听
   */
  once(event: string, listener: EventListener<unknown>): Subscription {
    return this.emitter.once(event, listener);
  }

  /**
   * 触发事件
   */
  emit(event: string, data: unknown): boolean {
    return this.emitter.emit(event, data);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
