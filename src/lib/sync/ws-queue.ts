/**
 * WebSocket 模块 - 消息队列
 */

/**
 * 队列消息接口
 */
export interface QueueMessage<T = string> {
  /** 消息内容 */
  payload: T;
  /** 优先级（数值越大优先级越高） */
  priority: number;
  /** 创建时间戳 */
  createdAt: number;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 消息 ID */
  id: string;
}

/**
 * 消息队列选项
 */
export interface MessageQueueOptions {
  /** 最大容量（0 表示无限制） */
  maxSize?: number;
  /** 是否启用优先级排序 */
  priorityEnabled?: boolean;
  /** 消息过期时间（毫秒），0 表示永不过期 */
  ttl?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 默认队列选项
 */
export const DEFAULT_QUEUE_OPTIONS: Required<MessageQueueOptions> = {
  maxSize: 1000,
  priorityEnabled: true,
  ttl: 0,
  maxRetries: 3,
};

/**
 * 消息队列类
 */
export class MessageQueue<T = string> {
  private options: Required<MessageQueueOptions>;
  private queue: QueueMessage<T>[];
  private idCounter: number = 0;

  constructor(options?: Partial<MessageQueueOptions>) {
    this.options = { ...DEFAULT_QUEUE_OPTIONS, ...options };
    this.queue = [];
  }

  /**
   * 生成唯一消息 ID
   */
  private generateId(): string {
    this.idCounter++;
    return `msg_${Date.now()}_${this.idCounter}`;
  }

  /**
   * 入队
   */
  enqueue(
    payload: T,
    priority: number = 0,
    maxRetries?: number
  ): boolean {
    // 检查是否已满
    if (this.options.maxSize > 0 && this.queue.length >= this.options.maxSize) {
      return false;
    }

    const message: QueueMessage<T> = {
      payload,
      priority,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: maxRetries ?? this.options.maxRetries,
      id: this.generateId(),
    };

    this.queue.push(message);

    // 如果启用优先级，重新排序
    if (this.options.priorityEnabled) {
      this.queue.sort((a, b) => {
        // 按优先级降序
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        // 按创建时间升序（先入队的优先）
        return a.createdAt - b.createdAt;
      });
    }

    return true;
  }

  /**
   * 出队
   */
  dequeue(): T | null {
    if (this.queue.length === 0) {
      return null;
    }

    const message = this.queue.shift();
    return message?.payload ?? null;
  }

  /**
   * 查看队首消息（不出队）
   */
  peek(): T | null {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue[0].payload;
  }

  /**
   * 批量入队
   */
  enqueueBatch(
    payloads: T[],
    priority?: number,
    maxRetries?: number
  ): number {
    let inserted = 0;
    for (const payload of payloads) {
      if (this.enqueue(payload, priority, maxRetries)) {
        inserted++;
      }
    }
    return inserted;
  }

  /**
   * 批量出队
   */
  dequeueBatch(count: number): T[] {
    const results: T[] = [];
    for (let i = 0; i < count; i++) {
      const payload = this.dequeue();
      if (payload === null) {
        break;
      }
      results.push(payload);
    }
    return results;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 获取队列大小
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 检查是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 检查是否已满
   */
  isFull(): boolean {
    return (
      this.options.maxSize > 0 && this.queue.length >= this.options.maxSize
    );
  }

  /**
   * 获取剩余容量
   */
  remainingCapacity(): number {
    if (this.options.maxSize === 0) {
      return Infinity;
    }
    return Math.max(0, this.options.maxSize - this.queue.length);
  }

  /**
   * 获取所有消息
   */
  getAll(): T[] {
    return this.queue.map((m) => m.payload);
  }

  /**
   * 获取队列快照（包含元数据）
   */
  snapshot(): QueueMessage<T>[] {
    return [...this.queue];
  }

  /**
   * 根据 ID 移除消息
   */
  removeById(id: string): boolean {
    const index = this.queue.findIndex((m) => m.id === id);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    return true;
  }

  /**
   * 过滤并移除过期消息
   */
  removeExpired(): number {
    if (this.options.ttl === 0) {
      return 0;
    }

    const now = Date.now();
    const originalLength = this.queue.length;
    this.queue = this.queue.filter((m) => now - m.createdAt < this.options.ttl);
    return originalLength - this.queue.length;
  }

  /**
   * 增加消息重试次数
   */
  incrementRetry(id: string): boolean {
    const message = this.queue.find((m) => m.id === id);
    if (!message) {
      return false;
    }
    message.retryCount++;
    return true;
  }

  /**
   * 获取消息重试次数
   */
  getRetryCount(id: string): number {
    const message = this.queue.find((m) => m.id === id);
    return message?.retryCount ?? -1;
  }

  /**
   * 刷新消息创建时间（防止过期）
   */
  touch(id: string): boolean {
    const message = this.queue.find((m) => m.id === id);
    if (!message) {
      return false;
    }
    message.createdAt = Date.now();
    return true;
  }
}

/**
 * 优先级常量
 */
export const MessagePriority = {
  /** 最高优先级 - 控制消息 */
  CRITICAL: 100,
  /** 高优先级 - 认证消息 */
  HIGH: 50,
  /** 普通优先级 - 常规消息 */
  NORMAL: 0,
  /** 低优先级 - 同步消息 */
  LOW: -50,
  /** 最低优先级 - 日志消息 */
  LOWEST: -100,
} as const;

export type MessagePriority =
  (typeof MessagePriority)[keyof typeof MessagePriority];
