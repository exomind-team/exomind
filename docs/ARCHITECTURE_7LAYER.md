# 7 层架构设计文档

> **ExoMind 7 层架构实现**
> **版本**: v1.0
> **创建日期**: 2026-01-29
> **状态**: 进行中

---

## 1. 架构概述

### 1.1 设计目标

```
┌─────────────────────────────────────────────────────────────────────┐
│                     7 层架构设计目标                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. **分层清晰**：每层职责单一，边界明确                              │
│  2. **依赖倒置**：上层依赖抽象，不依赖具体实现                         │
│  3. **可测试性**：每层可独立测试，通过接口 mock                       │
│  4. **可扩展性**：层内可扩展，层间可替换实现                          │
│  5. **生命体映射**：符合 World Daemon + 个体运行时的生命体模型        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 架构全景图

```
┌─────────────────────────────────────────────────────────────────────┐
│                     自主生命体系统架构                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     L7-UI 前端展示层                            │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐ │ │
│  │  │ 资源监控页 │ │ 对话视图  │ │ 设置页面  │ │ 任务管理页    │ │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    L6-Agent 业务逻辑层                          │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐ │ │
│  │  │ Governor  │ │ 任务系统  │ │ Growth    │ │ Resource      │ │ │
│  │  │ 调控中枢   │ │ 智能匹配  │ │ Coach     │ │ Fetcher       │ │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────┘ │ │
│  │  ┌───────────┐ ┌───────────┐ ┌─────────────────────────────┐ │ │
│  │  │ History   │ │ Review    │ │ MiniMax Agent               │ │ │
│  │  │ Agent     │ │ Agent     │ │ (多账户资源监控)             │ │ │
│  │  └───────────┘ └───────────┘ └─────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   L5-Signals 信号池层                           │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │  SignalPool - 统一信号处理中心                              │ │ │
│  │  ├───────────────────────────────────────────────────────────┤ │ │
│  │  │  信号类型:                                                 │ │ │
│  │  │  · 输入信号: UserSignal, MessageSignal, ResourceSignal    │ │ │
│  │  │  · 输出信号: ResponseSignal, ActionSignal, CommandSignal  │ │ │
│  │  │  · 系统信号: EnergySignal, TrustSignal, HealthSignal      │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   L4-Actor 数据持有层 ⭐ 待审核                  │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │  Actor - 状态持有与响应                                     │ │ │
│  │  ├───────────────────────────────────────────────────────────┤ │ │
│  │  │  类型:                                                     │ │ │
│  │  │  · LifeActor - 生命周期状态                                │ │ │
│  │  │  · ResourceActor - 资源状态（能源/额度）                    │ │ │
│  │  │  · TrustActor - 信任度状态                                 │ │ │
│  │  │  · TaskActor - 任务状态                                    │ │ │
│  │  │  · MemoryActor - 记忆状态                                  │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   L3-Sync 同步层                                │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │  功能:                                                     │ │ │
│  │  │  · 多 Actor 状态同步                                       │ │ │
│  │  │  · 缓存一致性维护                                          │ │ │
│  │  │  · 事件广播                                                │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   L2-Storage 存储抽象层                         │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │  接口定义:                                                 │ │ │
│  │  │  · save(key, data) - 保存数据                             │ │ │
│  │  │  · load(key) - 加载数据                                   │ │ │
│  │  │  · append(key, entry) - 追加数据                          │ │ │
│  │  │  · query(key, filter) - 查询数据                          │ │ │
│  │  ├───────────────────────────────────────────────────────────┤ │ │
│  │  │  实现:                                                     │ │ │
│  │  │  · SQLiteStorage - SQLite 实现（当前唯一）                 │ │ │
│  │  │  · FileStorage - 文件存储（未来可选）                      │ │ │
│  │  │  · RemoteStorage - 远程存储（未来可选）                    │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                   L1-Network 网络通信层                         │ │
│  │  ┌───────────────────────────────────────────────────────────┐ │ │
│  │  │  子层:                                                     │ │ │
│  │  │  ┌─────────────────────────────────────────────────────┐  │ │ │
│  │  │  │ L1.3 Protocol - 协议层                               │  │ │ │
│  │  │  │  · HTTP REST API                                    │  │ │ │
│  │  │  │  · WebSocket                                        │  │ │ │
│  │  │  │  · gRPC（未来）                                      │  │ │ │
│  │  │  └─────────────────────────────────────────────────────┘  │ │ │
│  │  │  ┌─────────────────────────────────────────────────────┐  │ │ │
│  │  │  │ L1.2 Transport - 传输层                              │  │ │ │
│  │  │  │  · TCP/UDP                                          │  │ │ │
│  │  │  │  · TLS 加密                                          │  │ │ │
│  │  │  │  · WebSocket Upgrade                                │  │ │ │
│  │  │  └─────────────────────────────────────────────────────┘  │ │ │
│  │  │  ┌─────────────────────────────────────────────────────┐  │ │ │
│  │  │  │ L1.1 Network - 网络层（可选）                        │  │ │ │
│  │  │  │  · P2P 网络（libp2p）                               │  │ │ │
│  │  │  │  · IPFS 集成                                        │  │ │ │
│  │  │  │  · DHT 分布式查找                                    │  │ │ │
│  │  │  └─────────────────────────────────────────────────────┘  │ │ │
│  │  └───────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════════│
│                          World Daemon（环境层）                      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────┐   │
│  │ Lifecycle │ │ Resource  │ │ I/O       │ │ Viability         │   │
│  │ Manager   │ │ Governor  │ │ Membrane  │ │ Monitor           │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────────┘   │
│  ┌───────────┐ ┌───────────┐ ┌───────────────────────────────┐    │
│  │ Death &   │ │ TPM       │ │ Reproduction Service          │    │
│  │ Scar      │ │ Anchor    │ │                               │    │
│  │ Arbiter   │ │ Manager   │ │                               │    │
│  └───────────┘ └───────────┘ └───────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 各层详细设计

### 2.1 L1-Network 网络通信层

#### 2.1.1 层级结构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L1-Network 子层划分                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L1.3 Protocol Layer - 协议层                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 职责: 定义通信协议、数据格式、API 端点                         │   │
│  │ 实现: HTTP Handler、WebSocket Handler、gRPC Handler          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  L1.2 Transport Layer - 传输层                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 职责: 数据传输、连接管理、加密传输                             │   │
│  │ 实现: HTTP Server、WebSocket Server、TLS 配置                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  L1.1 Network Layer - 网络层（可选，扩展）                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 职责: P2P 网络、分布式存储、网络拓扑                           │   │
│  │ 实现: libp2p、IPFS、DHT                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.1.2 文件结构

```
src/core/l1-network/
├── index.ts                 # 层入口
├── server.ts                # HTTP Server
├── router.ts                # 路由定义
├── types.ts                 # 请求/响应类型
│
├── protocol/                # L1.3 协议层
│   ├── index.ts
│   ├── http/
│   │   ├── handler.ts       # HTTP Handler 基类
│   │   ├── minimax.ts       # MiniMax API Handler
│   │   └── resource.ts      # 资源 API Handler
│   └── websocket/
│       ├── handler.ts       # WebSocket Handler
│       └── types.ts         # WebSocket 消息类型
│
├── transport/               # L1.2 传输层
│   ├── index.ts
│   ├── tls.ts               # TLS 配置
│   └── middleware/
│       ├── logger.ts        # 日志中间件
│       ├── auth.ts          # 认证中间件
│       └── rate-limit.ts    # 限流中间件
│
└── network/                 # L1.1 网络层（可选）
    ├── index.ts
    ├── p2p/
    │   ├── node.ts          # P2P 节点
    │   ├── dht.ts           # DHT 分布式查找
    │   └── gossip.ts        # Gossip 协议
    └── ipfs/
        ├── client.ts        # IPFS 客户端
        └── gateway.ts       # IPFS 网关
```

#### 2.1.3 核心接口

```typescript
// src/core/l1-network/types.ts

/**
 * 网络层接口
 */
export interface NetworkLayer {
  /** 启动服务 */
  start(): Promise<void>;

  /** 停止服务 */
  stop(): Promise<void>;

  /** 获取监听地址 */
  getAddress(): string;
}

/**
 * 传输层接口
 */
export interface TransportLayer {
  /** 添加中间件 */
  use(middleware: Middleware): void;

  /** 处理请求 */
  handle(req: Request): Promise<Response>;
}

/**
 * 协议层接口
 */
export interface ProtocolLayer {
  /** 注册路由 */
  route(method: string, path: string, handler: Handler): void;

  /** 注册 WebSocket 端点 */
  ws(path: string, handler: WebSocketHandler): void;

  /** 启动监听 */
  listen(port: number, host?: string): Promise<void>;
}

/**
 * 处理器类型
 */
export type Handler = (req: Request, ctx: Context) => Promise<Response>;
export type WebSocketHandler = (socket: WebSocket, ctx: Context) => void;
export type Middleware = (req: Request, next: () => Promise<Response>) => Promise<Response>;

/**
 * 请求上下文
 */
export interface Context {
  requestId: string;
  timestamp: Date;
  ip: string;
  user?: User;
  metadata?: Record<string, unknown>;
}
```

---

### 2.2 L2-Storage 存储抽象层

#### 2.2.1 设计原则

```
┌─────────────────────────────────────────────────────────────────────┐
│                     存储层抽象 - 核心原则                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. **接口单一**: save / load / append / query                      │
│  2. **实现隔离**: 上层不知道也不需要知道底层实现                       │
│  3. **可替换性**: 可从 SQLite 切换到文件存储或远程存储                │
│  4. **类型安全**: 泛型支持，编译时类型检查                            │
│                                                                     │
│  上层调用示例:                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  // MinimaxActor 不知道数据存在 SQLite 还是文件               │   │
│  │  class MinimaxActor {                                       │   │
│  │    constructor(private storage: Storage) {}                 │   │
│  │                                                              │   │
│  │    async saveCache(data: Usage) {                           │   │
│  │      await this.storage.save(`cache:${data.account}`, data);// │
│  │    }                                                        │   │
│  │  }                                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.2.2 核心接口

```typescript
// src/core/l2-storage/types.ts

/**
 * 存储层统一接口
 */
export interface Storage {
  /** 保存数据（覆盖） */
  save<T>(key: string, data: T): Promise<void>;

  /** 加载数据 */
  load<T>(key: string): Promise<T | null>;

  /** 追加数据（用于历史记录） */
  append(key: string, entry: unknown): Promise<void>;

  /** 查询数据 */
  query<T>(key: string, filter?: QueryFilter): Promise<T[]>;

  /** 删除数据 */
  delete(key: string): Promise<void>;

  /** 批量操作 */
  batch(operations: BatchOperation[]): Promise<void>;
}

/**
 * 查询过滤器
 */
export interface QueryFilter {
  /** 开始时间 */
  since?: string;
  /** 结束时间 */
  until?: string;
  /** 限制条数 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
  /** 排序方式 */
  order?: 'asc' | 'desc';
}

/**
 * 批量操作
 */
export interface BatchOperation {
  type: 'save' | 'delete';
  key: string;
  data?: unknown;
}

/**
 * 存储配置
 */
export interface StorageConfig {
  /** 存储类型 */
  type: 'sqlite' | 'file' | 'remote';
  /** 路径或连接字符串 */
  path: string;
  /** 选项 */
  options?: Record<string, unknown>;
}
```

---

### 2.3 L3-Sync 同步层

#### 2.3.1 功能定位

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L3-Sync 功能定位                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  职责:                                                              │
│  1. 多 Actor 状态同步                                                │
│  2. 缓存一致性维护                                                   │
│  3. 事件广播                                                         │
│                                                                     │
│  何时需要 Sync 层:                                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  单 Actor 场景:                                              │   │
│  │  · Actor 直接操作 Storage，不需要 Sync 层                    │   │
│  │                                                             │   │
│  │  多 Actor 场景:                                              │   │
│  │  · Actor A 修改状态 → Sync 层 → 广播给 Actor B, C           │   │
│  │  · 保持多 Actor 状态一致                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.3.2 核心接口

```typescript
// src/core/l3-sync/types.ts

/**
 * 同步层接口
 */
export interface SyncLayer {
  /** 注册 Actor */
  register(actorId: string, handler: SyncHandler): void;

  /** 注销 Actor */
  unregister(actorId: string): void;

  /** 发布状态变更 */
  publish(channel: string, event: SyncEvent): void;

  /** 订阅状态变更 */
  subscribe(channel: string, handler: SyncHandler): UnsubscribeFn;

  /** 同步状态 */
  sync(actorId: string, state: unknown): Promise<void>;
}

/**
 * 同步处理器
 */
export type SyncHandler = (event: SyncEvent) => Promise<void>;

/**
 * 同步事件
 */
export interface SyncEvent {
  type: string;
  source: string;
  target?: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * 取消订阅函数
 */
export type UnsubscribeFn = () => void;
```

---

### 2.4 L4-Actor 数据持有层 ⭐

#### 2.4.1 待审核说明

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L4-Actor 层 - 待审核                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  当前问题:                                                          │
│  1. Actor 的职责边界不清晰                                           │
│  2. 与 L6-Agent 的职责有重叠                                         │
│  3. 是否需要持久化状态管理                                           │
│                                                                     │
│  建议方案:                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  方案 A: 简化 Actor 层                                        │   │
│  │  · Actor 仅持有内存状态，不持久化                             │   │
│  │  · 持久化由 L2-Storage 直接处理                               │   │
│  │  · 适合单 Actor 场景                                          │   │
│  │                                                             │   │
│  │  方案 B: 完整 Actor 层                                        │   │
│  │  · Actor 持有状态 + 自动持久化                                │   │
│  │  · 响应信号变化                                               │   │
│  │  · 适合多 Actor 协作场景                                      │   │
│  │                                                             │   │
│  │  方案 C: 暂时移除 L4                                           │   │
│  │  · L5-Signals 直接连接 L6-Agent                              │   │
│  │  · 简化架构，后续按需添加                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  待确认:                                                            │
│  1. 当前阶段需要多 Actor 协作吗？                                    │
│  2. 状态需要跨进程持久化吗？                                         │
│  3. 是否需要 Actor 间的状态同步？                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.4.2 简化设计（方案 C - 暂时移除）

```
┌─────────────────────────────────────────────────────────────────────┐
│                     简化后的层级关系                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI → L6-Agent → L5-Signals → L3-Sync → L2-Storage → L1-Network │
│                                                                     │
│  L4-Actor 层暂时移除，理由:                                          │
│  1. 当前阶段为单 Actor 设计                                          │
│  2. 状态直接由 L6-Agent 持有                                        │
│  3. 持久化直接通过 L2-Storage                                        │
│  4. 后续需要时再添加                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 2.5 L5-Signals 信号池层

#### 2.5.1 核心设计

```typescript
// src/core/l5-signals/types.ts

/**
 * 信号类型定义
 */
export type SignalType =
  // 输入信号
  | 'input:user'           // 用户输入
  | 'input:message'        // 消息信号
  | 'input:resource'       // 资源信号
  // 输出信号
  | 'output:response'      // 响应信号
  | 'output:action'        // 动作信号
  | 'output:command'       // 命令信号
  // 系统信号
  | 'system:energy'        // 能量信号
  | 'system:trust'         // 信任度信号
  | 'system:health'        // 健康信号
  | 'system:lifecycle'     // 生命周期信号
  // MiniMax 专用
  | 'minimax:refresh'      // 刷新信号
  | 'minimax:usage'        // 额度信号
  | 'minimax:cache_hit'    // 缓存命中
  | 'minimax:cache_miss';  // 缓存未命中

/**
 * 信号基类
 */
export interface Signal<T = unknown> {
  type: SignalType;
  payload: T;
  source: string;
  timestamp: Date;
  id: string;
}

/**
 * 信号处理器
 */
export type SignalHandler<T = unknown> = (signal: Signal<T>) => Promise<void>;

/**
 * 信号池接口
 */
export interface SignalPool {
  /** 发送信号 */
  emit<T>(signal: Signal<T>): void;

  /** 接收信号 */
  on<T>(type: SignalType | SignalType[], handler: SignalHandler<T>): void;

  /** 只接收一次 */
  once<T>(type: SignalType | SignalType[], handler: SignalHandler<T>): void;

  /** 移除处理器 */
  off(type: SignalType, handler?: SignalHandler): void;

  /** 获取信号历史 */
  getHistory(): Signal[];

  /** 清空信号池 */
  clear(): void;
}
```

---

### 2.6 L6-Agent 业务逻辑层

#### 2.6.1 Agent 类型

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L6-Agent 类型                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    核心 Agent                                 │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────┐  │   │
│  │  │ Governor  │ │ 任务系统  │ │ Growth    │ │ Review      │  │   │
│  │  │ 调控中枢   │ │ 智能匹配  │ │ Coach     │ │ Agent       │  │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └─────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    资源 Agent ⭐ 新增                         │   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │  Resource Fetcher - 通用资源获取器                        ││   │
│  │  │  · MiniMax 额度获取                                       ││   │
│  │  │  · 网页内容获取（微信文章等）                              ││   │
│  │  │  · 文件下载                                              ││   │
│  │  │  · API 调用                                              ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │  MiniMax Agent - MiniMax 专用                           ││   │
│  │  │  · 多账户管理                                            ││   │
│  │  │  · 额度监控                                              ││   │
│  │  │  · 历史记录                                              ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    历史 Agent                                 │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────────────────────┐ │   │
│  │  │ History   │ │ Memory    │ │                            │ │   │
│  │  │ Recorder  │ │ Manager   │ │                            │ │   │
│  │  └───────────┘ └───────────┘ └───────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 2.7 L7-UI 前端展示层

```
┌─────────────────────────────────────────────────────────────────────┐
│                     L7-UI 页面结构                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                         侧边栏                                  │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│ │
│  │  │ 🏠 主页 │ │ 📈 资源 │ │ 💬 对话 │ │ 📋 任务 │ │ ⚙️ 设置 ││ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                       页面内容                                  │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐ │ │
│  │  │ HomePage  │ │Resource   │ │ChatPage   │ │ SettingsPage  │ │ │
│  │  │           │ │Page       │ │           │ │               │ │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Resource Fetcher 资源获取模块

### 3.1 模块定位

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Resource Fetcher - 定位                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  问题背景:                                                          │
│  · MiniMax 额度获取 - Playwright + Cookie                           │
│  · 微信文章获取 - 爬虫 + 解析                                        │
│  · 文件下载 - HTTP 下载                                             │
│  · API 调用 - REST/GraphQL                                          │
│                                                                     │
│  共同点:                                                            │
│  · 都是"从外部获取数据"                                             │
│  · 都需要认证/Cookie                                                │
│  · 都需要错误处理和重试                                             │
│  · 都需要结果解析                                                   │
│                                                                     │
│  解决方案:                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Resource Fetcher - 通用资源获取器                            │   │
│  │  ┌─────────────────────────────────────────────────────────┐ │   │
│  │  │  Fetcher Interface - 统一接口                           │ │   │
│  │  ├─────────────────────────────────────────────────────────┤ │   │
│  │  │  实现:                                                  │ │   │
│  │  │  · PlaywrightFetcher - 浏览器自动化获取                 │ │   │
│  │  │  · HttpFetcher - HTTP 请求获取                          │ │   │
│  │  │  · ApiFetcher - API 调用获取                            │ │   │
│  │  │  · ScraperFetcher - 爬虫获取                            │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心接口

```typescript
// src/core/l6-agent/resource-fetcher/types.ts

/**
 * 资源获取器接口
 */
export interface ResourceFetcher {
  /** 获取器名称 */
  name: string;

  /** 支持的协议 */
  protocols: string[];

  /** 获取资源 */
  fetch(input: FetchInput): Promise<FetchOutput>;

  /** 验证输入 */
  validate(input: FetchInput): ValidationResult;

  /** 解析结果 */
  parse(raw: unknown): ParsedResource;
}

/**
 * 获取输入
 */
export interface FetchInput {
  /** 资源标识 */
  url: string;

  /** 获取器类型 */
  type: string;

  /** 认证配置 */
  auth?: AuthConfig;

  /** 选项 */
  options?: FetchOptions;
}

/**
 * 获取输出
 */
export interface FetchOutput {
  /** 原始数据 */
  raw: unknown;

  /** 解析后数据 */
  parsed: ParsedResource;

  /** 元数据 */
  metadata: {
    fetchedAt: Date;
    duration: number;
    size: number;
    contentType: string;
  };
}

/**
 * 解析后的资源
 */
export interface ParsedResource {
  /** 资源类型 */
  type: 'text' | 'html' | 'json' | 'image' | 'video' | 'custom';

  /** 内容 */
  content: unknown;

  /** 结构化数据 */
  data?: Record<string, unknown>;

  /** 错误信息 */
  error?: string;
}

/**
 * 认证配置
 */
export interface AuthConfig {
  /** 认证类型 */
  type: 'cookie' | 'bearer' | 'basic' | 'apikey' | 'none';

  /** 凭证 */
  credentials: Record<string, string>;

  /** Cookie 路径（Playwright） */
  cookiePath?: string;
}

/**
 * 获取选项
 */
export interface FetchOptions {
  /** 超时时间 */
  timeout?: number;

  /** 重试次数 */
  retries?: number;

  /** 重试间隔 */
  retryDelay?: number;

  /** 请求头 */
  headers?: Record<string, string>;

  /** 代理 */
  proxy?: string;

  /** 解析器选择 */
  parser?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
```

### 3.3 实现示例

```typescript
// src/core/l6-agent/resource-fetcher/fetchers/playwright-fetcher.ts

import type { ResourceFetcher, FetchInput, FetchOutput, ParsedResource } from '../types.js';

export class PlaywrightFetcher implements ResourceFetcher {
  name = 'playwright';
  protocols = ['http', 'https'];

  constructor(private browser: Browser) {}

  async fetch(input: FetchInput): Promise<FetchOutput> {
    const startTime = Date.now();

    // 1. 加载 Cookie（如果是 Playwright Profile）
    const context = await this.browser.newContext({
      storageState: input.auth?.cookiePath,
    });

    // 2. 访问页面
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: 'networkidle' });

    // 3. 解析内容
    const content = await page.content();
    const parsed = this.parse({ content, url: input.url });

    await context.close();

    return {
      raw: content,
      parsed,
      metadata: {
        fetchedAt: new Date(),
        duration: Date.now() - startTime,
        size: content.length,
        contentType: 'text/html',
      },
    };
  }

  validate(input: FetchInput): ValidationResult {
    const errors: string[] = [];

    if (!input.url) {
      errors.push('URL is required');
    }

    if (!input.url.startsWith('http')) {
      errors.push('URL must start with http:// or https://');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  parse(raw: unknown): ParsedResource {
    const data = raw as { content: string; url: string };

    // MiniMax 特定解析
    if (data.url.includes('minimaxi.com')) {
      return {
        type: 'custom',
        content: data.content,
        data: this.parseMiniMax(data.content),
      };
    }

    return {
      type: 'html',
      content: data.content,
    };
  }

  private parseMiniMax(html: string): Record<string, unknown> {
    // MiniMax 使用量解析逻辑
    // ...
    return { used: 0, remaining: 0, total: 0 };
  }
}
```

---

## 4. 数据流图

### 4.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                     完整数据流 - 读取 MiniMax 额度                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User        L7-UI       L6-Agent      L5-Signals    L2-Storage    │
│   │           │            │              │              │          │
│   │ 点击刷新   │            │              │              │          │
│   │──────────→│            │              │              │          │
│   │           │ GET        │              │              │          │
│   │           │───────────→│              │              │          │
│   │           │            │              │              │          │
│   │           │            │ emit         │              │          │
│   │           │            │RefreshSignal │              │          │
│   │           │            │─────────────→│              │          │
│   │           │            │              │              │          │
│   │           │            │              │ handle()     │          │
│   │           │            │              │─────────────→│          │
│   │           │            │              │              │          │
│   │           │            │              │              │ load()   │
│   │           │            │              │              │─────────→│
│   │           │            │              │              │          │
│   │           │            │              │              │←─────────│
│   │           │            │              │  返回缓存    │          │
│   │           │            │              │              │          │
│   │           │            │              │ cache_hit   │          │
│   │           │            │              │─────────────│          │
│   │           │            │              │              │          │
│   │           │            │ return       │              │          │
│   │           │←───────────│──────────────│              │          │
│   │           │            │              │              │          │
│   │ 返回数据  │            │              │              │          │
│   │←──────────│            │              │              │          │
│   │           │            │              │              │          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 资源获取数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                  资源获取数据流 - 通用模式                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L6-Agent          Resource Fetcher        外部资源                  │
│   │                    │                     │                      │
│   │ fetch()            │                     │                      │
│   │───────────────────→│                     │                      │
│   │                    │                     │                      │
│   │                    │ 1. 验证输入          │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 2. 认证处理          │                      │
│   │                    │ (Cookie/Token)      │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 3. HTTP 请求         │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 4. 接收响应          │                      │
│   │                    │◀────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 5. 解析数据          │                      │
│   │                    │                     │                      │
│   │                    │ 6. 返回结果          │                      │
│   │←───────────────────│                     │                      │
│   │                    │                     │                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. 文件结构总览

```
exomind/
├── src/
│   ├── core/
│   │   ├── l1-network/              # 网络通信层
│   │   │   ├── index.ts
│   │   │   ├── server.ts
│   │   │   ├── router.ts
│   │   │   ├── types.ts
│   │   │   ├── protocol/
│   │   │   │   ├── http/
│   │   │   │   └── websocket/
│   │   │   ├── transport/
│   │   │   │   └── middleware/
│   │   │   └── network/             # P2P, IPFS（可选）
│   │   │
│   │   ├── l2-storage/              # 存储抽象层
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   └── sqlite-storage.ts
│   │   │
│   │   ├── l3-sync/                 # 同步层（可选）
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── l4-actor/                # 数据持有层（暂时移除）
│   │   │   └── （待后续添加）
│   │   │
│   │   ├── l5-signals/              # 信号池层
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── signal-pool.ts
│   │   │   └── handlers/
│   │   │
│   │   └── l6-agent/                # 业务逻辑层
│   │       ├── index.ts
│   │       ├── types.ts
│   │       ├── resource-fetcher/    # ⭐ 资源获取模块
│   │       │   ├── index.ts
│   │       │   ├── types.ts
│   │       │   └── fetchers/
│   │       │       ├── index.ts
│   │       │       ├── playwright-fetcher.ts
│   │       │       ├── http-fetcher.ts
│   │       │       └── api-fetcher.ts
│   │       ├── minimax/
│   │       │   ├── index.ts
│   │       │   ├── agent.ts
│   │       │   └── types.ts
│   │       ├── governor/
│   │       │   └── index.ts
│   │       ├── task-system/
│   │       │   └── index.ts
│   │       └── growth-coach/
│   │           └── index.ts
│   │
│   └── ui/
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── hooks/
│       │   └── api/
│       └── ...
│
├── data/
│   └── minimax.db                   # SQLite 数据库
│
├── docs/
│   └── specs/
│       ├── ARCHITECTURE_7LAYER.md   # 本文档
│       ├── SPEC-022_MiniMax_Monitor.md
│       └── ...
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── package.json
└── bun.lockb
```

---

## 6. 与 World Daemon 的关系

```
┌─────────────────────────────────────────────────────────────────────┐
│                 7 层架构与 World Daemon 的映射                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     7 层架构（个体运行时）                      │ │
│  │  L7-UI → L6-Agent → L5-Signals → L2-Storage → L1-Network     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              │ 膜通道                               │
│                              ▼                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     World Daemon（环境）                       │ │
│  │                                                               │ │
│  │  Lifecycle Manager → 生命周期管理                              │ │
│  │    │                     ↓                                    │ │
│  │  Resource Governor → 资源调控（能量、CPU、IO）                 │ │
│  │    │                     ↓                                    │ │
│  │  I/O Membrane → I/O 边界控制                                   │ │
│  │    │                     ↓                                    │ │
│  │  Viability Monitor → 生存能力监控                              │ │
│  │                                                               │ │
│  │  Death & Scar Arbiter → 死亡/伤疤裁决                          │ │
│  │  TPM Anchor Manager → 硬件锚点                                 │ │
│  │  Reproduction Service → 繁殖服务                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. 实施指南

### 7.1 当前阶段

| 层级 | 状态 | 说明 |
|------|------|------|
| L1-Network | ✅ 已实现 | HTTP Server + Router |
| L2-Storage | 🔄 开发中 | SQLite 实现 |
| L3-Sync | ⏳ 暂不需要 | 单 Actor 场景 |
| L4-Actor | ❌ 暂移除 | 后续按需添加 |
| L5-Signals | ✅ 已实现 | SignalPool |
| L6-Agent | 🔄 开发中 | Resource Fetcher + MiniMax Agent |
| L7-UI | ✅ 已实现 | React + Vite |

### 7.2 下一步

1. **完成 L2-Storage** - SQLite 实现
2. **实现 Resource Fetcher** - 通用资源获取模块
3. **实现 MiniMax Agent** - 基于 Resource Fetcher
4. **完善 L1-Network** - 添加 WebSocket 支持

---

## 附录

### A. 变更记录

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| v1.0 | 2026-01-29 | Claude | 初始版本 |

### B. 相关文档

| 文档 | 路径 |
|------|------|
| 路线图 | `pm/roadmap.md` |
| PRD | `pm/PRD.md` |
| MiniMax 监控规格 | `docs/specs/SPEC-022_MiniMax_Monitor.md` |

---

*文档创建时间：2026-01-29*
*版本：v1.0*
