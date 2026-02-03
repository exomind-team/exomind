# SPEC-001: 信号池系统架构

> 文档版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发

---

## 1. 用户需求

### 1.1 问题描述

自主生命体需要像生物一样感知环境（输入）和与外界交互（输出）。现有的 `LivingAgent` 只处理 Telegram 消息，缺乏统一的信号处理架构来支持：

- 多平台消息接入（QQ、微信、小红书）
- 系统级事件监听（文件变化、服务器状态）
- 网络信息获取
- 物理世界操作（通过执行器）

### 1.2 使用场景

- **场景1**：用户通过 QQ 发送消息，Agent 能接收并响应
- **场景2**：项目文件变化时，Agent 自动感知并更新上下文
- **场景3**：Agent 需要主动搜索网络获取信息
- **场景4**：Agent 可以通过 bash 命令执行操作

### 1.3 期望行为

建立统一的 **信号池（Signal Pool）** 架构：
- 输入信号：分类为 6 种类型，统一进入输入缓冲区
- 输出信号：分类为 4 种类型，统一通过执行器发出
- 优先级：根据信号类型和来源确定处理优先级
- 隔离性：不同平台的信号互不干扰

---

## 2. 功能定义

### 2.1 输入（信号类型）

| 信号类型 | 来源 | 优先级 | 说明 |
|---------|------|--------|------|
| **USER_INPUT** | 用户直接交互 | P0 | 文字、图片、语音、链接 |
| **PLATFORM_MSG** | 多平台消息 | P1 | QQ、微信、Telegram、小红书 |
| **SYSTEM_NOTIF** | 系统通知 | P2 | 手机/电脑通知、邮箱 |
| **NETWORK_SIGNAL** | 网络信息 | P2 | 搜索结果、新闻、网页 |
| **LOCAL_SIGNAL** | 本地环境 | P3 | 文件变化、服务器状态 |
| **CONTEXT_UPDATE** | 内部上下文 | P4 | 群聊信息、usage统计 |

### 2.2 输出（信号类型）

| 信号类型 | 执行方式 | 优先级 | 说明 |
|---------|---------|--------|------|
| **PHYSICAL_ACT** | 物理设备控制 | P0 | 小车前进/后退、开关控制 |
| **INFO_FETCH** | 网络请求 | P1 | 搜索、文件读取、API调用 |
| **USER_RESPONSE** | 消息回复 | P1 | Telegram、QQ、微信回复 |
| **SYSTEM_EXEC** | 系统命令 | P2 | bash指令、API调用 |

### 2.3 处理逻辑

```
信号源 → [信号分类器] → [优先级队列] → [输入缓冲区] → 思考引擎
                                                             ↓
信号结果 ← [执行器] ← [输出缓冲区] ← [决策引擎] ← 处理结果
```

---

## 3. 验收标准

- [ ] 输入信号能正确分类到 6 种类型
- [ ] 输出信号能正确分类到 4 种类型
- [ ] 信号优先级正确影响处理顺序
- [ ] 新增信号源不影响现有功能
- [ ] 单元测试覆盖率 > 80%

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 同一毫秒多条信号 | 按优先级顺序处理 |
| 信号源离线 | 标记为 unavailable，不影响整体 |
| 优先级冲突 | 高优先级信号优先处理 |
| 信号格式错误 | 记录错误，跳过该信号 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| 信号源连接失败 | "Signal source {name} disconnected" | 重试 3 次后标记离线 |
| 信号解析失败 | "Failed to parse signal from {source}" | 记录错误，跳过该信号 |
| 信号队列满 | "Signal queue overflow" | 丢弃最低优先级信号 |
| 执行超时 | "Signal execution timeout" | 中止执行，返回超时错误 |

---

## 6. 依赖关系

### 6.1 依赖模块

- `LivingAgent` - 信号消费者
- `MiniMaxClient` - 思考引擎依赖
- `AgentStorage` - 信号持久化

### 6.2 外部依赖

- 无（纯 TypeScript 实现）

---

## 7. 架构设计

### 7.1 类设计

```typescript
/**
 * 信号类型枚举
 */
enum SignalType {
  // 输入信号
  USER_INPUT = "USER_INPUT",
  PLATFORM_MSG = "PLATFORM_MSG",
  SYSTEM_NOTIF = "SYSTEM_NOTIF",
  NETWORK_SIGNAL = "NETWORK_SIGNAL",
  LOCAL_SIGNAL = "LOCAL_SIGNAL",
  CONTEXT_UPDATE = "CONTEXT_UPDATE",

  // 输出信号
  PHYSICAL_ACT = "PHYSICAL_ACT",
  INFO_FETCH = "INFO_FETCH",
  USER_RESPONSE = "USER_RESPONSE",
  SYSTEM_EXEC = "SYSTEM_EXEC",
}

/**
 * 信号优先级
 */
enum SignalPriority {
  CRITICAL = 0,   // P0
  HIGH = 1,       // P1
  NORMAL = 2,     // P2
  LOW = 3,        // P3
  BACKGROUND = 4, // P4
}

/**
 * 信号元数据
 */
interface SignalMetadata {
  source: string;        // 信号来源标识
  timestamp: number;     // 信号产生时间
  priority: SignalPriority;
  platform?: string;     // 平台名称（QQ/微信/Telegram）
  userId?: string;       // 用户标识
  sessionId?: string;    // 会话标识
  tags?: string[];       // 信号标签
}

/**
 * 输入信号
 */
interface InputSignal {
  id: string;                    // 唯一标识
  type: SignalType;              // 信号类型
  payload: unknown;              // 信号内容
  metadata: SignalMetadata;      // 元数据
  receivedAt: number;            // 接收时间
  processedAt?: number;          // 处理时间
}

/**
 * 输出信号
 */
interface OutputSignal {
  id: string;                    // 唯一标识
  type: SignalType;              // 信号类型
  payload: unknown;              // 信号内容
  target: string;                // 目标（用户/系统/设备）
  metadata: SignalMetadata;      // 元数据
  createdAt: number;             // 创建时间
  executedAt?: number;           // 执行时间
  result?: unknown;              // 执行结果
  error?: string;                // 执行错误
}

/**
 * 信号池配置
 */
interface SignalPoolConfig {
  maxQueueSize: number;          // 最大队列长度
  processingInterval: number;    // 处理间隔（ms）
  enablePriorityQueue: boolean;  // 启用优先级队列
  signalTimeout: number;         // 信号超时（ms）
}
```

### 7.2 核心类

```typescript
/**
 * 信号池 - 管理输入输出信号的统一架构
 */
class SignalPool {
  // 配置
  private config: SignalPoolConfig;

  // 输入相关
  private inputQueue: PriorityQueue<InputSignal>;
  private inputHandlers: Map<SignalType, InputHandler>;
  private signalClassifier: SignalClassifier;

  // 输出相关
  private outputQueue: PriorityQueue<OutputSignal>;
  private outputExecutors: Map<SignalType, OutputExecutor>;

  // 状态
  private isProcessing: boolean = false;
  private stats: SignalPoolStats;

  // 方法
  constructor(config: SignalPoolConfig);
  registerInputHandler(type: SignalType, handler: InputHandler): void;
  registerOutputExecutor(type: SignalType, executor: OutputExecutor): void;
  submitInput(signal: Omit<InputSignal, "id" | "receivedAt">): Promise<void>;
  submitOutput(signal: Omit<OutputSignal, "id" | "createdAt">): Promise<void>;
  startProcessing(): void;
  stopProcessing(): void;
  getStats(): SignalPoolStats;
}
```

### 7.3 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                        信号池数据流                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  输入端：                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Telegram │  │    QQ    │  │  系统    │  │  网络    │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │             │             │             │                   │
│       └─────────────┴──────┬──────┴─────────────┘                   │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │  信号分类器     │                               │
│                   │  Classifier     │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │  优先级队列     │                               │
│                   │  PriorityQueue  │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │   输入缓冲区    │                               │
│                   │    Inbox        │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │   思考引擎      │                               │
│                   │  LivingAgent    │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │   输出缓冲区    │                               │
│                   │    Outbox       │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│                   ┌─────────────────┐                               │
│                   │  执行器路由     │                               │
│                   │  ExecutorRouter │                               │
│                   └────────┬────────┘                               │
│                            ↓                                        │
│       ┌────────────────────┼────────────────────┐                   │
│       ↓                    ↓                    ↓                   │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐               │
│  │ Telegram│         │  Bash   │         │ 搜索    │               │
│  └─────────┘         └─────────┘         └─────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.4 状态变化

```
┌─────────────────────────────────────────────────────────────────────┐
│                     信号池状态机                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     ┌─────────┐     startProcessing()      ┌─────────────┐         │
│     │  IDLE   │ ─────────────────────────→ │ PROCESSING  │         │
│     └─────────┘                            └──────┬──────┘         │
│           ↑                                         │               │
│           │            stopProcessing()             │               │
│           └──────────────────────────────────────────┘               │
│                                                                     │
│  PROCESSING 状态下的信号流转：                                        │
│                                                                     │
│  submitInput() → [输入队列] → [处理] → submitOutput()               │
│                                                                     │
│  如果队列满：丢弃最低优先级信号                                       │
│  如果处理超时：标记信号为失败                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 信号分类正确 | USER_INPUT 类型信号 | 类型被正确识别 |
| 优先级排序 | 5个不同优先级的信号 | 按优先级降序处理 |
| 队列满时丢弃 | 第 101 个信号 | 最低优先级信号被丢弃 |
| 信号超时处理 | 处理时间 > timeout | 信号标记为失败 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| Telegram 消息处理 | 通过 Mock 注入 Telegram 消息 | 消息进入输入队列 |
| 信号完整流转 | 输入信号 → 处理 → 输出信号 | 信号完成完整生命周期 |

---

## 9. 文档更新

- [ ] 更新 README.md（信号池系统说明）
- [ ] 更新 ARCHITECTURE.md（架构图和数据流）
- [ ] 更新 API.md（SignalPool 类文档）
- [ ] 新增使用示例

---

## 10. 实施计划

### Step 1: 基础架构
- [ ] 定义信号类型枚举
- [ ] 定义信号接口
- [ ] 实现信号分类器

### Step 2: 输入系统
- [ ] 实现输入队列
- [ ] 实现输入处理器接口
- [ ] 集成 Telegram 输入适配器

### Step 3: 输出系统
- [ ] 实现输出队列
- [ ] 实现输出执行器接口
- [ ] 集成 Telegram 输出适配器

### Step 4: 测试
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 验证覆盖率

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | Ralph |

---

*文档创建：2026-01-29*
*状态：待开发*
