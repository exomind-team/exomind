# SPEC-008: 邮箱与消息处理

> 文档版本：v1.0
> 创建时间：2026-01-29
> 关联：Phase 3, MAIL-001, MAIL-002, MAIL-003, BUF-001, BUF-002

---

## 1. 概述

### 1.1 目的

定义 Actor 系统的邮箱（Mailbox）和消息处理机制，包括：
- 消息的发送、接收、确认
- 消息序列化与反序列化
- 消息过期处理
- 输入/输出缓冲区管理

### 1.2 消息流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              消息流转流程                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   发送方 Actor          Message Router              接收方 Actor            │
│                                                                             │
│       │                     │                          │                     │
│       │  1. send()         │                          │                     │
│       │───────────────────→│                          │                     │
│       │                     │  2. 路由查找             │                     │
│       │                     │─────────────────────────→│                     │
│       │                     │                          │                     │
│       │                     │                          │  3. 放入 Inbox      │
│       │                     │                          │───────────────────→│
│       │                     │                          │                     │
│       │                     │                          │  4. dequeue()      │
│       │                     │                          │───────────────────→│
│       │                     │                          │                     │
│       │                     │                          │  5. 处理完成        │
│       │                     │                          │───────────────────→│
│       │                     │                          │                     │
│       │                     │  6. 放入 Outbox          │                     │
│       │                     │←─────────────────────────│                     │
│       │                     │                          │                     │
│       │  7. send()          │                          │                     │
│       │←───────────────────│                          │                     │
│       │                     │                          │                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 邮箱实现

### 2.1 MailboxImpl 类

```typescript
/**
 * 邮箱实现
 */
export class MailboxImpl implements Mailbox {
  readonly address: string;
  readonly actorId: string;
  private inbox: InboxImpl;
  private outbox: OutboxImpl;
  private router: MessageRouter;
  private closed: boolean = false;

  constructor(config: MailboxConfig) {
    this.address = config.address;
    this.actorId = config.actorId;
    this.inbox = new InboxImpl({ capacity: config.inboxCapacity || 100 });
    this.outbox = new OutboxImpl({ capacity: config.outboxCapacity || 100 });
    this.router = config.router;
  }

  get size(): number {
    return this.inbox.size;
  }

  get capacity(): number {
    return this.inbox.capacity;
  }

  async receive(timeout?: number): Promise<ActorMessage | null> {
    if (this.closed) {
      throw new Error("Mailbox is closed");
    }

    const startTime = Date.now();
    const deadline = timeout ? startTime + timeout : Infinity;

    while (Date.now() < deadline) {
      const message = this.inbox.tryReceive();
      if (message) {
        return message;
      }

      // 短暂休眠后重试
      await this.sleep(10);
    }

    return null;
  }

  tryReceive(): ActorMessage | null {
    return this.inbox.tryReceive();
  }

  async send(message: ActorMessage): Promise<void> {
    if (this.closed) {
      throw new Error("Mailbox is closed");
    }

    // 验证消息
    this.validateMessage(message);

    // 设置接收者
    if (!message.targetId) {
      message.targetId = this.actorId;
    }

    // 路由到目标邮箱
    const targetMailbox = this.router.getMailbox(message.targetId);
    if (!targetMailbox) {
      throw new Error(`Mailbox not found: ${message.targetId}`);
    }

    await targetMailbox.enqueue(message);
  }

  async enqueue(message: ActorMessage): Promise<boolean> {
    if (this.closed) {
      throw new Error("Mailbox is closed");
    }

    return this.inbox.enqueue(message);
  }

  async broadcast(addresses: string[], message: ActorMessage): Promise<void> {
    const results = await Promise.allSettled(
      addresses.map(addr => this.router.getMailbox(addr))
    );

    const validMailboxes = results
      .filter((r): r is PromiseFulfilledResult<Mailbox> =>
        r.status === "fulfilled" && r.value !== null
      )
      .map(r => r.value);

    await Promise.all(
      validMailboxes.map(mb => mb.enqueue(message))
    );
  }

  clear(): void {
    this.inbox.clear();
    this.outbox.clear();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clear();
  }

  private validateMessage(message: ActorMessage): void {
    if (!message.id) {
      message.id = generateMessageId();
    }
    if (!message.createdAt) {
      message.createdAt = Date.now();
    }
    if (!message.senderId) {
      throw new Error("Message senderId is required");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 2.2 MailboxConfig 接口

```typescript
/**
 * 邮箱配置
 */
interface MailboxConfig {
  /** 邮箱地址（格式：actor://{actorId}） */
  address: string;

  /** 关联的 Actor ID */
  actorId: string;

  /** 输入队列容量 */
  inboxCapacity?: number;

  /** 输出队列容量 */
  outboxCapacity?: number;

  /** 消息路由器 */
  router: MessageRouter;

  /** 序列化器 */
  serializer?: MessageSerializer;

  /** 消息过期时间（毫秒） */
  messageTimeout?: number;
}
```

---

## 3. 输入缓冲区（Inbox）

### 3.1 InboxImpl 类

```typescript
/**
 * 输入缓冲区实现
 */
export class InboxImpl implements Inbox {
  private queue: PriorityQueue<QueuedMessage>;
  private processing: Map<string, ActorMessage> = new Map();
  private deadLetter: DeadLetterQueue;
  private config: InboxConfig;

  constructor(config: InboxConfig) {
    this.config = config;
    this.deadLetter = new DeadLetterQueue();
    // 使用最小堆实现优先级队列
    this.queue = new PriorityQueue<QueuedMessage>(
      (a, b) => a.priority - b.priority || a.createdAt - b.createdAt
    );
  }

  get size(): number {
    return this.queue.size + this.processing.size;
  }

  get processingMessage(): ActorMessage | null {
    return this.processing.values().next().value || null;
  }

  enqueue(message: ActorMessage): boolean {
    // 检查是否过期
    if (message.expiresAt && Date.now() > message.expiresAt) {
      this.deadLetter.add(message, "Message expired");
      return false;
    }

    // 检查容量
    if (this.queue.size >= this.config.capacity) {
      if (this.config.onOverflow) {
        this.config.onOverflow(message);
      }
      return false;
    }

    const queuedMessage: QueuedMessage = {
      message,
      priority: message.priority,
      createdAt: Date.now(),
      retryCount: 0,
    };

    this.queue.push(queuedMessage);
    return true;
  }

  dequeue(): ActorMessage | null {
    const queued = this.queue.pop();
    if (!queued) return null;

    // 标记为处理中
    this.processing.set(queued.message.id, queued.message);
    return queued.message;
  }

  peek(): ActorMessage | null {
    const queued = this.queue.peek();
    return queued?.message || null;
  }

  ack(messageId: string): void {
    this.processing.delete(messageId);
  }

  nack(messageId: string, reason: string): void {
    const message = this.processing.get(messageId);
    if (!message) return;

    this.processing.delete(messageId);

    // 检查是否可重试
    const queued = this.queue.items.find(q => q.message.id === messageId);
    if (queued && queued.retryCount < (this.config.maxRetries || 3)) {
      queued.retryCount++;
      queued.message = { ...message, createdAt: Date.now() };
      this.queue.push(queued);
    } else {
      // 放入死信队列
      this.deadLetter.add(message, reason);
    }
  }

  clear(): void {
    this.queue.clear();
    this.processing.clear();
  }

  getStats(): InboxStats {
    return {
      queued: this.queue.size,
      processing: this.processing.size,
      deadLetter: this.deadLetter: this.config.capacity,
      utilization:.size,
      capacity this.queue.size / this.config.capacity,
    };
  }
}
```

### 3.2 InboxConfig 接口

```typescript
/**
 * 输入缓冲区配置
 */
interface InboxConfig {
  /** 最大容量 */
  capacity: number;

  /** 最大重试次数 */
  maxRetries?: number;

  /** 队列溢出处理 */
  onOverflow?: (message: ActorMessage) => void;

  /** 死信队列处理器 */
  deadLetterHandler?: (message: ActorMessage, reason: string) => void;
}
```

---

## 4. 输出缓冲区（Outbox）

### 4.1 OutboxImpl 类

```typescript
/**
 * 输出缓冲区实现
 */
export class OutboxImpl implements Outbox {
  private queue: Queue<OutboxedMessage>;
  private sent: Map<string, OutboxedMessage> = new Map();
  private failed: Map<string, OutboxedMessage> = new Map();
  private config: OutboxConfig;

  constructor(config: OutboxConfig) {
    this.config = config;
    this.queue = new Queue<OutboxedMessage>();
  }

  get size(): number {
    return this.queue.size;
  }

  enqueue(message: ActorMessage): boolean {
    if (this.queue.size >= this.config.capacity) {
      return false;
    }

    const outboxed: OutboxedMessage = {
      message,
      status: "pending",
      createdAt: Date.now(),
      attempts: 0,
    };

    this.queue.push(outboxed);
    return true;
  }

  dequeue(): ActorMessage | null {
    const outboxed = this.queue.peek();
    if (!outboxed) return null;

    // 更新状态
    outboxed.status = "sending";
    outboxed.attempts++;

    return outboxed.message;
  }

  markSent(messageId: string): void {
    const outboxed = this.queue.items.find(o => o.message.id === messageId);
    if (outboxed) {
      this.sent.set(messageId, outboxed);
      this.queue.remove(o => o.message.id === messageId);
    }
  }

  markFailed(messageId: string, error: string): void {
    const outboxed = this.queue.items.find(o => o.message.id === messageId);
    if (outboxed) {
      outboxed.error = error;
      outboxed.lastAttempt = Date.now();

      if (outboxed.attempts >= (this.config.maxRetries || 3)) {
        // 超过重试次数，移到失败队列
        this.failed.set(messageId, outboxed);
        this.queue.remove(o => o.message.id === messageId);
      }
    }
  }

  async retry(): Promise<void> {
    const failedMessages = Array.from(this.failed.values());

    for (const outboxed of failedMessages) {
      if (outboxed.attempts < (this.config.maxRetries || 3)) {
        outboxed.status = "pending";
        outboxed.error = undefined;
        this.queue.push(outboxed);
        this.failed.delete(outboxed.message.id);
      }
    }
  }

  clear(): void {
    this.queue.clear();
    this.sent.clear();
    this.failed.clear();
  }

  getStats(): OutboxStats {
    return {
      queued: this.queue.size,
      sent: this.sent.size,
      failed: this.failed.size,
      capacity: this.config.capacity,
    };
  }
}
```

### 4.2 OutboxConfig 接口

```typescript
/**
 * 输出缓冲区配置
 */
interface OutboxConfig {
  /** 最大容量 */
  capacity: number;

  /** 最大重试次数 */
  maxRetries?: number;

  /** 重试间隔（毫秒） */
  retryInterval?: number;

  /** 发送超时（毫秒） */
  sendTimeout?: number;
}
```

---

## 5. 消息序列化

### 5.1 MessageSerializer 接口

```typescript
/**
 * 消息序列化器
 */
interface MessageSerializer {
  /** 序列化消息 */
  serialize(message: ActorMessage): string;

  /** 反序列化消息 */
  deserialize(data: string): ActorMessage;

  /** 序列化类型名称 */
  contentType: string;
}
```

### 5.2 JSONMessageSerializer 实现

```typescript
/**
 * JSON 消息序列化器
 */
export class JSONMessageSerializer implements MessageSerializer {
  contentType = "application/json";

  serialize(message: ActorMessage): string {
    return JSON.stringify({
      id: message.id,
      senderId: message.senderId,
      targetId: message.targetId,
      type: message.type,
      payload: message.payload,
      priority: message.priority,
      createdAt: message.createdAt,
      expiresAt: message.expiresAt,
      inReplyTo: message.inReplyTo,
      correlationId: message.correlationId,
    });
  }

  deserialize(data: string): ActorMessage {
    const parsed = JSON.parse(data);

    // 验证必需字段
    if (!parsed.id || !parsed.senderId || !parsed.type) {
      throw new Error("Invalid message format");
    }

    return {
      id: parsed.id,
      senderId: parsed.senderId,
      targetId: parsed.targetId,
      type: parsed.type,
      payload: parsed.payload,
      priority: parsed.priority ?? MessagePriority.NORMAL,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      inReplyTo: parsed.inReplyTo,
      correlationId: parsed.correlationId,
    };
  }
}
```

---

## 6. 消息路由器

### 6.1 MessageRouter 接口

```typescript
/**
 * 消息路由器
 */
interface MessageRouter {
  /** 注册邮箱 */
  register(mailbox: Mailbox): void;

  /** 注销邮箱 */
  unregister(actorId: string): void;

  /** 获取邮箱 */
  getMailbox(actorId: string): Mailbox | null;

  /** 获取所有注册的 Actor */
  getRegisteredActors(): string[];

  /** 路由消息 */
  route(message: ActorMessage): Promise<void>;

  /** 关闭路由器 */
  close(): Promise<void>;
}
```

### 6.2 LocalMessageRouter 实现

```typescript
/**
 * 本地消息路由器
 */
export class LocalMessageRouter implements MessageRouter {
  private mailboxes: Map<string, Mailbox> = new Map();
  private deadLetter: DeadLetterQueue;

  constructor(config?: RouterConfig) {
    this.deadLetter = config?.deadLetterQueue || new DeadLetterQueue();
  }

  register(mailbox: Mailbox): void {
    const actorId = mailbox.actorId;
    if (this.mailboxes.has(actorId)) {
      console.warn(`Mailbox already registered for actor: ${actorId}`);
      this.mailboxes.get(actorId)?.close();
    }
    this.mailboxes.set(actorId, mailbox);
    console.log(`📬 Actor ${actorId} 邮箱已注册`);
  }

  unregister(actorId: string): void {
    const mailbox = this.mailboxes.get(actorId);
    if (mailbox) {
      mailbox.close();
      this.mailboxes.delete(actorId);
      console.log(`📬 Actor ${actorId} 邮箱已注销`);
    }
  }

  getMailbox(actorId: string): Mailbox | null {
    return this.mailboxes.get(actorId) || null;
  }

  getRegisteredActors(): string[] {
    return Array.from(this.mailboxes.keys());
  }

  async route(message: ActorMessage): Promise<void> {
    const targetId = message.targetId;
    if (!targetId) {
      throw new Error("Message targetId is required");
    }

    const mailbox = this.mailboxes.get(targetId);
    if (!mailbox) {
      // 尝试死信处理
      const handled = await this.deadLetter.handle(message, "Target mailbox not found");
      if (!handled) {
        throw new Error(`Mailbox not found: ${targetId}`);
      }
      return;
    }

    await mailbox.enqueue(message);
  }

  async close(): Promise<void> {
    for (const mailbox of this.mailboxes.values()) {
      await mailbox.close();
    }
    this.mailboxes.clear();
  }
}
```

---

## 7. 死信队列

### 7.1 DeadLetterQueue 类

```typescript
/**
 * 死信队列 - 无法路由的消息存储
 */
export class DeadLetterQueue {
  private messages: Map<string, DeadLetter> = new Map();
  private handler: ((message: ActorMessage, reason: string) => Promise<boolean>) | null = null;

  get size(): number {
    return this.messages.size;
  }

  add(message: ActorMessage, reason: string): void {
    const deadLetter: DeadLetter = {
      message,
      reason,
      receivedAt: Date.now(),
    };
    this.messages.set(message.id, deadLetter);

    console.warn(`💀 消息 ${message.id} 进入死信队列: ${reason}`);

    // 尝试处理
    if (this.handler) {
      this.handler(message, reason).catch(err => {
        console.error("Dead letter handler error:", err);
      });
    }
  }

  get(messageId: string): DeadLetter | null {
    return this.messages.get(messageId) || null;
  }

  getAll(): DeadLetter[] {
    return Array.from(this.messages.values());
  }

  remove(messageId: string): void {
    this.messages.delete(messageId);
  }

  clear(): void {
    this.messages.clear();
  }

  setHandler(handler: (message: ActorMessage, reason: string) => Promise<boolean>): void {
    this.handler = handler;
  }
}
```

---

## 8. 验收标准

- [ ] Mailbox 支持消息的发送和接收
- [ ] Inbox 支持优先级队列和消息确认
- [ ] Outbox 支持发送确认和自动重试
- [ ] 消息序列化支持 JSON 格式
- [ ] MessageRouter 正确路由消息
- [ ] 死信队列正确处理无法路由的消息
- [ ] 消息过期机制正常工作
- [ ] 单元测试覆盖率 > 80%

---

## 9. 依赖关系

- 依赖 `src/signals/` - 信号池（消息来源）
- 被 `src/actor/` - Actor 模块使用

---

## 10. 相关文档

| 文档 | 路径 |
|------|------|
| SPEC-007 | `docs/specs/SPEC-007_ACTOR_ARCHITECTURE.md` |
| SPEC-009 | `docs/specs/SPEC-009_STATE_PERSISTENCE.md` |

---

*文档创建：2026-01-29*
*状态：待实现*
