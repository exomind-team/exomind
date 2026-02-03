# SPEC-022: exomind 项目重构 - 7层架构设计

> 版本：v1.0
> 创建时间：2026-01-29
> 状态：进行中

---

## 1. 概述

### 1.1 背景

当前 `living-agent.ts` 是一个 65KB/1998 行的单文件，包含了所有功能：
- Telegram Bot 适配器
- 资源监控（MiniMax/VPS）
- 对话视图
- 状态管理
- 信号池系统

这种 monolithic 结构导致：
- 代码难以维护
- 难以单独测试
- 难以扩展新功能
- 新开发者难以理解

### 1.2 目标

将 monolithic 架构拆分为清晰的 7 层架构，每层职责单一，便于：
- 独立开发和测试
- 功能复用
- 故障定位
- 团队协作

### 1.3 重构策略

**绿色方案**：
- 从头实现新架构
- `living-agent.ts` 仅作为参考，不直接运行
- 保持 API 端点兼容，用户无感知
- 逐层迁移，逐步上线

---

## 2. 架构设计

### 2.1 7层架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          exomind 7层架构                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        用户请求                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L7 │ UI 层          │ React + Vite                              │   │
│  │    │ 职责：        │ 视图渲染、用户交互                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L6 │ Agent 层       │ 自研 Agent (业务逻辑)                      │   │
│  │    │ 职责：        │ 消息处理、决策引擎、工具调用                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L5 │ Signals 层     │ EventEmitter (事件总线)                    │   │
│  │    │ 职责：        │ 事件驱动、解耦通信、信号路由                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L4 │ Actor 层       │ Actor 模型 (消息处理)                      │   │
│  │    │ 职责：        │ 邮箱接口、消息队列、优先级处理               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L3 │ Sync 层        │ 同步引擎 (状态同步)                        │   │
│  │    │ 职责：        │ 消息同步、冲突解决、状态合并                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L2 │ Storage 层     │ JSON 文件存储                              │   │
│  │    │ 职责：        │ 数据持久化、缓存管理、迁移                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ L1 │ Network 层     │ Bun HTTP Server                           │   │
│  │    │ 职责：        │ 请求接收、路由分发、响应返回                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        外部服务                                   │   │
│  │  Telegram API / MiniMax API / Voice-ime API                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 层间依赖关系

```
L1-Network (底层依赖)
    │
    ├──► L2-Storage (数据持久化)
    │         │
    │         └──► L3-Sync (状态同步)
    │                   │
    │                   └──► L4-Actor (消息处理)
    │                             │
    │                             └──► L5-Signals (事件驱动)
    │                                       │
    │                                       └──► L6-Agent (业务逻辑)
    │                                                 │
    │                                                 └──► L7-UI (界面展示)
```

**依赖原则**：
- 只能上层依赖下层
- 同层之间不能直接依赖
- 通过接口/事件进行通信

---

## 3. 各层详细设计

### 3.1 L1-Network 层（HTTP API）

**职责**：接收 HTTP 请求，分发到对应处理器，返回响应

**目录**：`src/core/l1-network/`

**接口定义**：
```typescript
// 请求接口
interface Request {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query: Record<string, string>;
}

// 响应接口
interface Response {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

// Handler 类型
type Handler = (req: Request) => Promise<Response> | Response;

// 路由配置
interface Route {
  method: string;
  path: string;
  handler: Handler;
  middleware?: Middleware[];
}

// 中间件类型
type Middleware = (req: Request, next: () => Promise<Response>) => Promise<Response>;
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `server.ts` | HTTP 服务器 |
| `router.ts` | 路由系统 |
| `middleware.ts` | 中间件实现 |
| `response.ts` | 响应格式化 |

**API 端点**（保持兼容）：
| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/resource/minimax` | GET | MiniMax 额度 |
| `/api/resource/vps` | GET | VPS 状态 |
| `/api/chat/send` | POST | 发送消息 |
| `/api/chat/history` | GET | 对话历史 |

### 3.2 L2-Storage 层（数据持久化）

**职责**：数据读写、缓存管理、文件存储

**目录**：`src/core/l2-storage/`

**接口定义**：
```typescript
// 存储接口
interface Storage {
  // 读取
  get<T>(key: string): Promise<T | null>;
  getAll<T>(prefix: string): Promise<Map<string, T>>;

  // 写入
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;

  // 批量操作
  setMany(entries: Record<string, unknown>): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;

  // 缓存
  getCache<T>(key: string): Promise<T | null>;
  setCache<T>(key: string, value: T, ttl: number): Promise<void>;
  clearCache(): Promise<void>;
}

// 数据实体
interface Entity {
  id: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `file-storage.ts` | JSON 文件存储 |
| `cache.ts` | 缓存管理 |
| `migrator.ts` | 数据迁移 |

### 3.3 L3-Sync 层（同步引擎）

**职责**：状态同步、冲突解决、数据一致性

**目录**：`src/core/l3-sync/`

**接口定义**：
```typescript
// 同步状态
interface SyncState {
  version: number;
  timestamp: number;
  checksum: string;
  data: unknown;
}

// 冲突解决策略
type ConflictResolution = 'last-write-wins' | 'first-write-wins' | 'merge';

// 同步配置
interface SyncConfig {
  strategy: ConflictResolution;
  maxRetries: number;
  retryDelay: number;
}

// 同步引擎接口
interface SyncEngine {
  // 同步操作
  sync(key: string, newState: SyncState): Promise<SyncState>;
  syncMany(entries: Record<string, SyncState>): Promise<Map<string, SyncState>>;

  // 冲突检测
  detectConflict(local: SyncState, remote: SyncState): boolean;

  // 冲突解决
  resolveConflict(local: SyncState, remote: SyncState): SyncState;
}
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `engine.ts` | 同步引擎 |
| `conflict.ts` | 冲突解决 |
| `merger.ts` | 数据合并 |

### 3.4 L4-Actor 层（消息处理）

**职责**：邮箱接口、消息队列、优先级处理

**目录**：`src/core/l4-actor/`

**接口定义**：
```typescript
// 消息接口
interface Message {
  id: string;
  type: string;
  payload: unknown;
  priority: number;  // 0-9，数字越大优先级越高
  timestamp: number;
  sender: string;
  receiver: string;
  replyTo?: string;
}

// Actor 接口
interface Actor {
  id: string;
  mailbox: Mailbox;
  state: ActorState;

  // 消息处理
  receive(message: Message): Promise<void>;

  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;

  // 状态管理
  getState(): ActorState;
  setState(state: ActorState): void;
}

// 邮箱接口
interface Mailbox {
  // 发送消息
  send(message: Message): Promise<void>;
  sendTo(actorId: string, message: Message): Promise<void>;

  // 接收消息
  receive(): Promise<Message>;
  peek(): Promise<Message | null>;

  // 队列管理
  size(): number;
  clear(): void;
}
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `actor.ts` | Actor 基类 |
| `mailbox.ts` | 邮箱实现 |
| `queue.ts` | 消息队列 |
| `priority-queue.ts` | 优先级队列 |

### 3.5 L5-Signals 层（事件驱动）

**职责**：事件总线、信号路由、解耦通信

**目录**：`src/core/l5-signals/`

**接口定义**：
```typescript
// 信号/事件
interface Signal {
  id: string;
  type: string;
  payload: unknown;
  source: string;
  target?: string;
  timestamp: number;
  ttl?: number;  // 生存时间
}

// 订阅器
interface Subscriber {
  id: string;
  signalTypes: string[];
  handler: (signal: Signal) => Promise<void>;
  priority: number;
}

// 事件总线接口
interface EventBus {
  // 订阅
  subscribe(subscriber: Subscriber): void;
  unsubscribe(subscriberId: string): void;

  // 发布
  publish(signal: Signal): void;
  publishTo(target: string, signal: Signal): void;

  // 路由
  route(signal: Signal): void;

  // 管理
  getSubscribers(signalType: string): Subscriber[];
  getStats(): EventBusStats;
}

// 信号池
interface SignalPool {
  // 池操作
  add(signal: Signal): void;
  remove(signalId: string): void;
  clear(): void;

  // 查询
  get(id: string): Signal | null;
  getByType(type: string): Signal[];
  getRecent(limit: number): Signal[];

  // 过滤
  filter(predicate: (signal: Signal) => boolean): Signal[];
}
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `event-bus.ts` | 事件总线 |
| `signal-pool.ts` | 信号池 |
| `router.ts` | 信号路由 |
| `filter.ts` | 信号过滤 |

### 3.6 L6-Agent 层（业务逻辑）

**职责**：消息处理、决策引擎、工具调用

**目录**：`src/core/l6-agent/`

**子目录结构**：
```
l6-agent/
├── core/              # 通用业务逻辑
│   ├── message.ts     # 消息处理
│   ├── task.ts        # 任务调度
│   ├── decision.ts    # 决策引擎
│   └── memory.ts      # 长期记忆
├── llm/               # LLM 集成
│   ├── minimax.ts     # MiniMax 客户端
│   └── client.ts      # 统一接口
├── platform/          # 平台适配
│   ├── web.ts         # Web 适配
│   └── telegram.ts    # Telegram 适配
└── soul/              # 身份系统
    ├── loader.ts      # SOUL.md 加载
    └── types.ts       # 类型定义
```

**核心文件**：
| 文件 | 描述 |
|------|------|
| `mod.ts` | 模块导出 |
| `types.ts` | 类型定义 |
| `agent.ts` | Agent 基类 |
| `processor.ts` | 消息处理器 |
| `decision-engine.ts` | 决策引擎 |
| `tool-caller.ts` | 工具调用 |

### 3.7 L7-UI 层（界面展示）

**职责**：视图渲染、用户交互

**目录**：`src/ui/`

**子目录结构**：
```
ui/
├── src/
│   ├── components/     # 组件库
│   │   ├── Button/
│   │   ├── Card/
│   │   ├── Modal/
│   │   ├── ResourceCard/
│   │   └── ChatMessage/
│   ├── views/          # 视图
│   │   ├── Dashboard/  # 资源监控面板
│   │   ├── Chat/       # 对话视图
│   │   ├── Task/       # 任务视图
│   │   └── Finance/    # 财务视图
│   ├── hooks/          # React Hooks
│   ├── services/       # API 服务
│   ├── styles/         # 样式
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

---

## 4. 目录结构

```
exomind-web/
├── src/
│   ├── core/                  # 核心模块
│   │   ├── l1-network/        # L1: HTTP API
│   │   │   ├── mod.ts
│   │   │   ├── types.ts
│   │   │   ├── server.ts
│   │   │   ├── router.ts
│   │   │   ├── middleware.ts
│   │   │   └── response.ts
│   │   ├── l2-storage/        # L2: 数据存储
│   │   │   ├── mod.ts
│   │   │   ├── types.ts
│   │   │   ├── file-storage.ts
│   │   │   ├── cache.ts
│   │   │   └── migrator.ts
│   │   ├── l3-sync/           # L3: 同步引擎
│   │   │   ├── mod.ts
│   │   │   ├── types.ts
│   │   │   ├── engine.ts
│   │   │   ├── conflict.ts
│   │   │   └── merger.ts
│   │   ├── l4-actor/          # L4: Actor 模型
│   │   │   ├── mod.ts
│   │   │   ├── types.ts
│   │   │   ├── actor.ts
│   │   │   ├── mailbox.ts
│   │   │   ├── queue.ts
│   │   │   └── priority-queue.ts
│   │   ├── l5-signals/        # L5: 信号池
│   │   │   ├── mod.ts
│   │   │   ├── types.ts
│   │   │   ├── event-bus.ts
│   │   │   ├── signal-pool.ts
│   │   │   ├── router.ts
│   │   │   └── filter.ts
│   │   └── l6-agent/          # L6: 业务逻辑
│   │       ├── mod.ts
│   │       ├── types.ts
│   │       ├── agent.ts
│   │       ├── processor.ts
│   │       ├── decision-engine.ts
│   │       ├── tool-caller.ts
│   │       ├── core/          # 通用业务
│   │       ├── llm/           # LLM 集成
│   │       ├── platform/      # 平台适配
│   │       └── soul/          # 身份系统
│   │
│   ├── ui/                    # UI 层
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── views/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── styles/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tailwind.config.js
│   │
│   ├── index.ts               # 应用入口
│   └── living-agent.ts        # 旧代码（保留作为参考）
│
├── deploy/                    # 部署配置
│   ├── install.sh
│   ├── uninstall.sh
│   └── exomind-web.service
│
├── tests/                     # 测试文件
│   ├── unit/
│   └── integration/
│
├── docs/
│   └── specs/
│       ├── SPEC-022_REFACTORING.md  # 本文档
│       └── ...
│
├── pm/                        # 项目管理
│   ├── input.md
│   ├── agent.md
│   └── memory/
│       └── long-term.md
│
├── .gitignore
├── package.json
├── tsconfig.json
├── bun.lockb
└── README.md
```

---

## 5. 实现顺序

### 5.1 第一阶段：基础设施

1. **L1-Network** - HTTP 服务基础
2. **L2-Storage** - 数据持久化

### 5.2 第二阶段：核心机制

3. **L5-Signals** - 事件驱动
4. **L4-Actor** - 消息处理

### 5.3 第三阶段：数据同步

5. **L3-Sync** - 状态同步

### 5.4 第四阶段：业务逻辑

6. **L6-Agent** - 功能迁移

### 5.5 第五阶段：界面展示

7. **L7-UI** - 视图迁移

---

## 6. 验收标准

- [ ] 7 层目录结构创建完成
- [ ] L1-Network 层实现，API 端点兼容
- [ ] L2-Storage 层实现，数据持久化正常
- [ ] L3-Sync 层实现，状态同步正常
- [ ] L4-Actor 层实现，消息处理正常
- [ ] L5-Signals 层实现，事件驱动正常
- [ ] L6-Agent 层实现，原有功能迁移完成
- [ ] L7-UI 层实现，界面展示正常
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试全部通过
- [ ] 部署测试通过

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| API 兼容性问题 | 用户无感知升级失败 | 保持端点不变，逐步迁移 |
| 性能下降 | 用户体验受影响 | 性能测试，基准对比 |
| 功能缺失 | 原有功能丢失 | 完整的功能迁移清单 |
| 团队协作困难 | 开发效率低 | 清晰的接口定义，文档完善 |

---

## 8. 参考资料

- [RALPH_LOOP.md](life-os/agents/RALPH_LOOP.md) - Ralph Loop 工作流程
- [input.md](pm/input.md) - 任务队列
- [tasks_plan.md](pm/tasks_plan.md) - 任务计划
- [long-term.md](pm/memory/long-term.md) - 技术决策

---

*创建时间：2026-01-29*
*版本：v1.0*
