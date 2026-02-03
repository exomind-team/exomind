# SPEC-007: Actor 架构设计

> 文档版本：v1.0
> 创建时间：2026-01-29
> 关联：Phase 3, MAIL-001, BUF-001, THINK-001, EXEC-001

---

## 1. 概述

### 1.1 目的

定义 Actor 架构的核心组件和交互模式，使自主生命体具备：
- **消息驱动**：通过邮箱接收消息，自主处理
- **状态隔离**：每个 Actor 有独立状态，不共享内存
- **位置透明**：消息发送不关心 Actor 物理位置
- **容错处理**：支持监督和恢复机制

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Actor System                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        LivingActor (自主生命体)                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │   │
│  │  │   Mailbox   │ ──→│    Inbox    │ ──→│ ThinkEngine │              │   │
│  │  │   (邮箱)    │    │  (输入队列) │    │   (思考)    │              │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘              │   │
│  │         ↑                                    │                        │   │
│  │         │                                    ▼                        │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │   │
│  │  │   Sender    │ ←──│   Outbox    │ ←──│  Executor   │              │   │
│  │  │  (发送器)   │    │  (输出队列) │    │   (执行)    │              │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘              │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────┐     │   │
│  │  │                    Actor State (状态)                        │     │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │     │   │
│  │  │  │ Life     │  │ Trust    │  │ Memory   │  │ Energy   │    │     │   │
│  │  │  │ (生命)   │  │ (信任度) │  │ (记忆)   │  │ (能量)   │    │     │   │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │     │   │
│  │  └─────────────────────────────────────────────────────────────┘     │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐       │
│  │ Supervisor  │───→│              Message Router                 │       │
│  │  (监督者)   │    │           (消息路由)                          │       │
│  └─────────────┘    └─────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Actor 接口定义

### 2.1 LivingActor 接口

```typescript
/**
 * 自主生命体 Actor 接口
 */
interface LivingActor {
  /** Actor 唯一标识 */
  readonly id: string;

  /** Actor 名称 */
  readonly name: string;

  /** Actor 状态 */
  readonly state: ActorState;

  /** 邮箱地址 */
  readonly mailbox: Mailbox;

  /** 发送消息到其他 Actor */
  send(targetId: string, message: ActorMessage): Promise<void>;

  /** 广播消息到所有 Actor */
  broadcast(message: ActorMessage): Promise<void>;

  /** 启动 Actor */
  start(): Promise<void>;

  /** 停止 Actor */
  stop(): Promise<void>;

  /** 获取 Actor 统计信息 */
  getStats(): ActorStats;
}
```

### 2.2 ActorState 枚举

```typescript
/**
 * Actor 运行状态
 */
enum ActorState {
  /** 初始状态 */
  CREATED = "CREATED",

  /** 正在启动 */
  STARTING = "STARTING",

  /** 运行中 */
  RUNNING = "RUNNING",

  /** 空闲中 */
  IDLE = "IDLE",

  /** 正在处理消息 */
  PROCESSING = "PROCESSING",

  /** 暂停中 */
  PAUSED = "PAUSED",

  /** 停止中 */
  STOPPING = "STOPPING",

  /** 已停止 */
  STOPPED = "STOPPED",

  /** 错误状态 */
  ERROR = "ERROR",

  /** 休眠状态 */
  SLEEPING = "SLEEPING",
}
```

### 2.3 ActorMessage 结构

```typescript
/**
 * Actor 消息结构
 */
interface ActorMessage {
  /** 消息唯一 ID */
  id: string;

  /** 发送者 ID */
  senderId: string;

  /** 接收者 ID */
  targetId: string;

  /** 消息类型 */
  type: ActorMessageType;

  /** 消息内容（JSON 可序列化） */
  payload: Record<string, unknown>;

  /** 消息优先级 */
  priority: MessagePriority;

  /** 创建时间 */
  createdAt: number;

  /** 过期时间 */
  expiresAt?: number;

  /** 关联的消息 ID（回复） */
  inReplyTo?: string;

  /** 追踪 ID */
  correlationId?: string;
}
```

### 2.4 ActorMessageType 枚举

```typescript
/**
 * Actor 消息类型
 */
enum ActorMessageType {
  /** 用户输入 */
  USER_INPUT = "USER_INPUT",

  /** 系统指令 */
  SYSTEM_COMMAND = "SYSTEM_COMMAND",

  /** 内部信号 */
  INTERNAL_SIGNAL = "INTERNAL_SIGNAL",

  /** 心跳消息 */
  HEARTBEAT = "HEARTBEAT",

  /** 状态同步 */
  STATE_SYNC = "STATE_SYNC",

  /** 错误通知 */
  ERROR_NOTICE = "ERROR_NOTICE",

  /** 关闭消息 */
  SHUTDOWN = "SHUTDOWN",

  /** 暂停消息 */
  PAUSE = "PAUSE",

  /** 恢复消息 */
  RESUME = "RESUME",

  /** Agent 间通讯 */
  AGENT_MESSAGE = "AGENT_MESSAGE",
}
```

---

## 3. 核心组件接口

### 3.1 Mailbox 接口

```typescript
/**
 * 邮箱接口 - Actor 的消息接收端点
 */
interface Mailbox {
  /** 邮箱地址 */
  readonly address: string;

  /** 关联的 Actor ID */
  readonly actorId: string;

  /** 队列中的消息数量 */
  readonly size: number;

  /** 最大队列容量 */
  readonly capacity: number;

  /** 接收消息（阻塞） */
  receive(timeout?: number): Promise<ActorMessage | null>;

  /** 尝试接收消息（非阻塞） */
  tryReceive(): ActorMessage | null;

  /** 发送消息到邮箱 */
  send(message: ActorMessage): Promise<void>;

  /** 广播消息到多个邮箱 */
  broadcast(addresses: string[], message: ActorMessage): Promise<void>;

  /** 清空邮箱 */
  clear(): void;

  /** 关闭邮箱 */
  close(): Promise<void>;
}
```

### 3.2 Inbox 接口

```typescript
/**
 * 输入缓冲区 - 消息处理前的缓冲队列
 */
interface Inbox {
  /** 当前队列大小 */
  readonly size: number;

  /** 正在处理的消息 */
  readonly processing: ActorMessage | null;

  /** 添加消息到队列 */
  enqueue(message: ActorMessage): boolean;

  /** 从队列取出消息（按优先级） */
  dequeue(): ActorMessage | null;

  /** 查看下一个消息（不移除） */
  peek(): ActorMessage | null;

  /** 消息处理完成确认 */
  ack(messageId: string): void;

  /** 消息处理失败，重试或放入死信队列 */
  nack(messageId: string, reason: string): void;

  /** 清空队列 */
  clear(): void;

  /** 获取队列统计 */
  getStats(): InboxStats;
}
```

### 3.3 Outbox 接口

```typescript
/**
 * 输出缓冲区 - 待发送消息的缓冲队列
 */
interface Outbox {
  /** 当前队列大小 */
  readonly size: number;

  /** 添加消息到待发送队列 */
  enqueue(message: ActorMessage): boolean;

  /** 获取待发送消息 */
  dequeue(): ActorMessage | null;

  /** 标记消息已发送 */
  markSent(messageId: string): void;

  /** 标记消息发送失败 */
  markFailed(messageId: string, error: string): void;

  /** 重试发送失败的消息 */
  retry(): Promise<void>;

  /** 清空队列 */
  clear(): void;

  /** 获取队列统计 */
  getStats(): OutboxStats;
}
```

### 3.4 ThinkEngine 接口

```typescript
/**
 * 思考引擎 - Actor 的决策中心
 */
interface ThinkEngine {
  /** 当前处理的消息 */
  readonly currentMessage: ActorMessage | null;

  /** 开始处理消息 */
  process(message: ActorMessage): Promise<ThinkResult>;

  /** 思考状态 */
  readonly thinking: boolean;

  /** 中断当前思考 */
  interrupt(): void;

  /** 清空上下文 */
  clearContext(): void;

  /** 获取决策历史 */
  getDecisionHistory(): DecisionRecord[];
}
```

### 3.5 Executor 接口

```typescript
/**
 * 执行器 - Actor 动作的执行者
 */
interface Executor {
  /** 执行动作 */
  execute(action: Action): Promise<ExecutionResult>;

  /** 获取可用的动作类型 */
  getAvailableActions(): ActionType[];

  /** 检查动作是否可执行 */
  canExecute(action: Action): Promise<boolean>;

  /** 取消正在执行的动作 */
  cancel(actionId: string): Promise<void>;

  /** 获取执行历史 */
  getExecutionHistory(): ExecutionRecord[];
}
```

---

## 4. 消息优先级

### 4.1 MessagePriority 枚举

```typescript
/**
 * 消息优先级（数值越小优先级越高）
 */
enum MessagePriority {
  /** 立即处理 - 最高优先级 */
  CRITICAL = 0,

  /** 高优先级 */
  HIGH = 1,

  /** 正常优先级 */
  NORMAL = 2,

  /** 低优先级 */
  LOW = 3,

  /** 后台处理 - 最低优先级 */
  BACKGROUND = 4,
}
```

### 4.2 优先级处理策略

| 优先级 | 处理策略 | 适用场景 |
|--------|----------|----------|
| CRITICAL | 立即中断当前处理 | 系统关闭、紧急错误 |
| HIGH | 优先于正常消息 | 用户输入、信号 |
| NORMAL | 按顺序处理 | 默认消息 |
| LOW | 资源空闲时处理 | 后台任务 |
| BACKGROUND | 仅在空闲时处理 | 日志同步、统计 |

---

## 5. Actor 生命周期

### 5.1 状态转换图

```
      ┌─────────┐
      │ CREATED │←───────────────────────────────┐
      └────┬────┘                                │
           │ start()                             │
           ▼                                    │
      ┌─────────┐                          stop()│
      │ STARTING│───────────────────────────────→│
      └────┬────┘                                │
           │ 完成初始化                           │
           ▼                                    │
      ┌─────────┐                          ┌────┴────┐
      │ RUNNING │──→ idle timeout ──→      │ STOPPED │
      └────┬────┘                          └─────────┘
           │                                      ▲
           │ 有消息                               │
           ▼                                      │
      ┌─────────┐                          stop()│
      │PROCESSING│─────────────────────────────→│
      └────┬────┘                                │
           │ 处理完成                             │
           ▼                                    │
      ┌─────────┐                                │
      │  IDLE   │                                │
      └────┬────┘                                │
           │ pause()                             │
           ▼                                    │
      ┌─────────┐                                │
      │ PAUSED  │                                │
      └────┬────┘                                │
           │ resume()                            │
           ▼                                    │
      ┌─────────┐                          ┌────┴────┐
      │ ERROR   │──→ stop() ──────────────→│ STOPPED │
      └─────────┘                          └─────────┘
```

### 5.2 生命周期事件

```typescript
/**
 * Actor 生命周期事件
 */
interface ActorLifecycleEvent {
  actorId: string;
  previousState: ActorState;
  currentState: ActorState;
  timestamp: number;
  reason?: string;
}
```

---

## 6. 监督机制

### 6.1 Supervisor 接口

```typescript
/**
 * 监督者 - 监控 Actor 状态，处理错误
 */
interface Supervisor {
  /** 监督的 Actor 列表 */
  readonly supervised: Set<string>;

  /** 注册监督 Actor */
  supervise(actor: LivingActor): void;

  /** 取消监督 */
  unsupervise(actorId: string): void;

  /** 获取 Actor 状态 */
  getActorState(actorId: string): ActorState | null;

  /** 重启 Actor */
  restart(actorId: string): Promise<void>;

  /** 重置 Actor 状态 */
  reset(actorId: string): Promise<void>;

  /** 批量重启所有失败的 Actor */
  restartAll(): Promise<void>;
}
```

### 6.2 错误处理策略

```typescript
/**
 * 错误处理策略
 */
enum ErrorHandlingStrategy {
  /** 重试 */
  RETRY = "RETRY",

  /** 重启 Actor */
  RESTART = "RESTART",

  /** 转发到死信队列 */
  DEAD_LETTER = "DEAD_LETTER",

  /** 忽略 */
  IGNORE = "IGNORE",

  /** 升级到监督者 */
  ESCALATE = "ESCALATE",
}
```

---

## 7. 验收标准

- [ ] Actor 支持创建、启动、停止生命周期管理
- [ ] Mailbox 支持消息发送和接收
- [ ] Inbox 支持优先级队列和消息确认
- [ ] Outbox 支持发送确认和重试
- [ ] ThinkEngine 支持消息处理和决策记录
- [ ] Executor 支持动作执行和历史记录
- [ ] Supervisor 支持 Actor 监督和错误恢复
- [ ] 单元测试覆盖率 > 80%
- [ ] 支持消息序列化用于持久化

---

## 8. 依赖关系

- 依赖 `src/signals/` - 信号池（消息来源）
- 依赖 `src/energy/` - 能量池（消耗统计）
- 被 `src/living-agent.ts` - 主程序使用

---

## 9. 相关文档

| 文档 | 路径 |
|------|------|
| PRD | `pm/PRD.md` |
| 任务计划 | `pm/tasks_plan.md` |
| SPEC-008 | `docs/specs/SPEC-008_MAILBOX.md` |
| SPEC-009 | `docs/specs/SPEC-009_STATE_PERSISTENCE.md` |

---

*文档创建：2026-01-29*
*状态：待实现*
