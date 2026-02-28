# Agent TypeScript 开发方案（增强版）

**生成时间**：2026-02-11
**版本**：v2.0
**依据**：Python版Agent架构 + TS_STRUCTURE.md

---

## 一、核心设计原则

### 1.1 架构原则

| 原则 | 说明 | 实现方式 | 决策理由 |
|------|------|----------|----------|
| **类型安全** | 充分利用TS类型系统 | 严格模式、泛型约束、接口定义 | 编译时捕获错误，提升代码质量 |
| **渐进式迁移** | 从Python到TS平滑过渡 | 混合运行、双向兼容、逐步替换 | 降低迁移风险，保持业务连续性 |
| **模块解耦** | 高内聚、低耦合 | 按功能拆分、独立包管理 | 便于测试、维护和并行开发 |
| **运行时兼容** | 支持Node.js环境 | 纯TS实现、无DOM依赖 | 服务端运行，性能优先 |

### 1.2 代码风格规范

```typescript
// ✅ 推荐：显式类型 + 函数式 + Result模式
function processEvent(event: ClaudeEvent): Result<ProcessedEvent, ProcessingError> {
  return event.type === 'message'
    ? ok(parseMessage(event))
    : err(new UnknownEventType(event.type));
}

// ❌ 避免：隐式类型 + 过程式 + 异常抛出
function processEvent(event) {
  if (event.type != 'message') {
    throw new Error('Unknown type');  // 运行时错误
  }
  return parseMessage(event);  // 返回类型不明确
}
```

**命名规范**：
- 接口：`PascalCase`（如 `ClaudeEvent`）
- 类型别名：`PascalCase`（如 `EventType`）
- 函数：`camelCase`（如 `processEvent`）
- 常量：`SCREAMING_SNAKE_CASE`（如 `MAX_RETRY_COUNT`）

---

## 二、核心类型定义

### 2.1 事件类型体系

```typescript
// === 基础事件类型 ===

type EventType = 'message' | 'system' | 'raw' | 'error';
type MessageRole = 'user' | 'assistant' | 'system';

interface BaseEvent {
  readonly uuid: string;
  readonly timestamp: number;
  readonly session_id: string;
}

// === 消息事件 ===

interface MessageEvent extends BaseEvent {
  readonly type: 'message';
  readonly role: MessageRole;
  readonly content: MessageContent[];
  readonly topics?: string[];
  readonly reply_to?: string;  // 引用的消息ID
}

type MessageContent =
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

interface ToolUseContent {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

interface ToolResultContent {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

interface ThinkingContent {
  readonly type: 'thinking';
  readonly thinking: string;
}

// === 系统事件 ===

interface SystemEvent extends BaseEvent {
  readonly type: 'system';
  readonly sub_type: 'init' | 'status' | 'compact_boundary' | 'agent_control';
  readonly status?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly tools?: ToolInfo[];
  readonly compact_metadata?: {
    readonly trigger: 'auto' | 'manual';
    readonly pre_tokens: number;
  };
}

interface ToolInfo {
  readonly name: string;
  readonly description: string;
}

// === 原始事件（解析失败时） ===

interface RawEvent extends BaseEvent {
  readonly type: 'raw';
  readonly raw_content: string;
}

// === 联合类型 ===

type ClaudeEvent = MessageEvent | SystemEvent | RawEvent;
```

### 2.2 消息类型体系

```typescript
// === Fact 消息 ===

interface Fact {
  readonly fact_id: string;
  readonly content: string;
  readonly source: 'human' | 'agent';
  readonly meta: FactMeta;
  readonly timestamp: number;
}

interface FactMeta {
  readonly sender: string;
  readonly topics: string[];
  readonly reply_to?: string;
  readonly priority?: 'P0' | 'P1' | 'P2';
}

// === 消息引用链 ===

interface FactRefChain {
  readonly chain: readonly string[];  // fact_id 链
  readonly depth: number;
  readonly root_id?: string;

  // 方法
  add(factId: string): FactRefChain;
  contains(factId: string): boolean;
}

// === 消息队列 ===

interface MessageQueue {
  readonly facts: ReadonlyMap<string, Fact>;
  readonly pending: readonly string[];      // 待处理 fact_id
  readonly processed: ReadonlySet<string>;  // 已处理 fact_id

  // 方法
  enqueue(fact: Fact): void;
  dequeue(): Fact | undefined;
  markProcessed(factId: string): void;
  getByTopic(topic: string): Fact[];
}
```

### 2.3 健康指标类型

```typescript
// === Claude 使用统计 ===

interface ClaudeUsage {
  readonly total_tokens: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_cost_rmb: number;
  readonly cache_hit_rate: number;  // 0-100

  // 计算方法
  calculateCost(): number;
  getEfficiency(): number;
}

// === Claude 健康指标 ===

interface ClaudeHealth {
  // 时之度量
  readonly physical_age_days: number;      // 物理年龄
  readonly psychological_age_days: number;  // 心理年龄
  readonly cognitive_density: number;       // 认知密度（心理/物理）

  // 空之度量
  readonly memory_size_kb: number;
  readonly file_count: number;
  readonly document_count: number;

  // 运行时指标
  readonly total_turns: number;
  readonly total_reasoning_count: number;
  readonly average_turn_duration_ms: number;
  readonly average_interaction_duration_ms: number;

  // 成本效率
  readonly usage: ClaudeUsage;

  // 方法
  update(turn: TurnMetrics): void;
  toReport(): HealthReport;
}

interface TurnMetrics {
  readonly duration_ms: number;
  readonly interaction_ms: number;
  readonly reasoning_count: number;
  readonly tokens: number;
}

interface HealthReport {
  readonly summary: string;
  readonly warnings: string[];
  readonly recommendations: string[];
}
```

### 2.4 状态持久化

```typescript
// === Agent 状态 ===

interface AgentState {
  // 标识
  readonly agent_id: string;
  readonly session_id: string;
  readonly version: string;

  // 运行状态
  readonly status: AgentStatus;
  readonly start_time: number;
  readonly last_active_time: number;
  readonly last_health_check?: number;

  // 健康指标
  readonly health: ClaudeHealth;

  // 消息状态
  readonly message_queue: MessageQueue;
  readonly last_processed_id?: string;

  // 配置
  readonly config: AgentConfig;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

interface AgentConfig {
  readonly max_turns?: number;
  readonly timeout_ms?: number;
  readonly auto_save_interval_ms?: number;
  readonly health_check_interval_ms?: number;
}

// === 持久化接口 ===

interface StateStore {
  save(state: AgentState): Promise<void>;
  load(): Promise<AgentState | null>;
  clear(): Promise<void>;
  backup(): Promise<string>;  // 返回备份文件路径
}

// === JSON 文件存储实现 ===

interface JsonStateStoreOptions {
  readonly file_path: string;
  readonly pretty_print?: boolean;
  readonly max_backups?: number;
}

class JsonStateStore implements StateStore {
  constructor(options: JsonStateStoreOptions);
  save(state: AgentState): Promise<void>;
  load(): Promise<AgentState | null>;
  clear(): Promise<void>;
  backup(): Promise<string>;
}
```

---

## 三、模块架构

### 3.1 目录结构

```
agents/ts/
├── src/
│   ├── index.ts              # 主入口（聚合导出）
│   │
│   ├── core/                 # ⭐ 核心类型与逻辑
│   │   ├── index.ts
│   │   ├── types.ts          # 通用类型定义
│   │   ├── ClaudeEvent.ts    # 事件解析
│   │   ├── ClaudeUsage.ts    # Token/成本统计
│   │   ├── ClaudeHealth.ts   # 健康指标追踪
│   │   └── State.ts          # 持久化状态
│   │
│   ├── util/                 # 工具函数
│   │   ├── index.ts
│   │   ├── extract.ts        # Generator 返回值提取 ⭐
│   │   ├── JsonData.ts      # JSON 序列化
│   │   ├── Result.ts         # Result 类型（ok/err）
│   │   └── helpers.ts        # 杂项工具
│   │
│   ├── async/                # 异步工具
│   │   ├── index.ts
│   │   ├── syncToAsync.ts   # 同步→异步适配器
│   │   ├── ThreadPool.ts    # 线程池
│   │   └── EventEmitter.ts  # 事件总线
│   │
│   ├── messenger/            # 消息处理
│   │   ├── index.ts
│   │   ├── Message.ts
│   │   ├── Fact.ts
│   │   ├── FactRefChain.ts
│   │   └── MessengerAgent.ts
│   │
│   ├── sse/                 # SSE 通信
│   │   ├── index.ts
│   │   ├── SSEEvent.ts
│   │   ├── SSEClient.ts
│   │   └── SSEAgent.ts
│   │
│   └── cli/                  # 命令行
│       ├── index.ts
│       ├── ClaudeClient.ts
│       └── Agent.ts
│
├── test/                    # 测试文件
│   ├── core/
│   ├── util/
│   ├── async/
│   ├── messenger/
│   └── sse/
│
├── scripts/                 # 开发脚本
│   ├── dev.sh
│   ├── test.sh
│   └── bench.sh
│
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 3.2 核心模块关系

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI入口                              │
│                    (cli/Agent.ts)                           │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌───────────────┐ ┌──────────┐ ┌─────────────────┐
│  消息处理模块  │ │ SSE通信  │ │   健康监控模块   │
│(messenger/)   │ │ (sse/)   │ │  (core/Health)  │
└───────┬───────┘ └────┬─────┘ └────────┬────────┘
        │              │                │
        ▼              ▼                ▼
┌───────────────┐ ┌──────────┐ ┌─────────────────┐
│ Message解析   │ │SSE事件   │ │ Token统计       │
│ Fact管理      │ │客户端    │ │ 成本计算        │
│ 引用链处理    │ │          │ │ 健康指标        │
└───────────────┘ └──────────┘ └─────────────────┘
```

### 3.3 关键设计决策

#### 决策1：使用 `readonly` 实现不可变性

```typescript
// ✅ 所有数据模型使用 readonly
interface Fact {
  readonly fact_id: string;
  readonly content: string;
  // ...
}

// 更新时创建新对象
function updateFact(fact: Fact, newContent: string): Fact {
  return { ...fact, content: newContent };
}
```

**理由**：
- 防止意外修改
- 便于追踪变更
- 支持时间旅行调试

#### 决策2：Result 类型替代异常

```typescript
// === Result 类型定义 ===

type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// === 使用示例 ===

function parseEvent(data: unknown): Result<ClaudeEvent, ParseError> {
  if (!isValidEvent(data)) {
    return err(new ParseError('Invalid event format'));
  }
  return ok(new ClaudeEvent(data));
}

// 调用方必须处理错误
const result = parseEvent(rawData);
if (result.ok) {
  processEvent(result.value);
} else {
  logError(result.error);
}
```

**理由**：
- 强制错误处理
- 类型安全
- 可组合（配合 `map`, `flatMap`）

---

## 四、开发阶段规划

### 4.1 阶段一：基础骨架（Week 1）

**目标**：搭建TS项目结构，实现核心类型

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| 初始化项目 | `package.json`, `tsconfig.json` | `npm install` 成功 |
| 核心类型定义 | `core/types.ts` | 无类型错误 |
| JSON序列化 | `util/JsonData.ts` | 通过单元测试 |
| Result类型 | `util/Result.ts` | 支持 `map`, `flatMap` |
| 工具函数 | `util/helpers.ts` | 覆盖Python版80%功能 |
| 单元测试框架 | `test/` 目录 | Vitest运行成功 |

**里程碑**：通过所有单元测试，类型检查零错误

### 4.2 阶段二：核心功能（Week 2）

**目标**：实现事件处理、消息队列

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| ClaudeEvent实现 | `core/ClaudeEvent.ts` | 支持所有事件类型 |
| 消息处理模块 | `messenger/Message.ts` | 支持嵌套消息展开 |
| Fact管理 | `messenger/Fact.ts` | CRUD完整 |
| 引用链管理 | `messenger/FactRefChain.ts` | 支持深度检测 |
| 健康指标计算 | `core/ClaudeHealth.ts` | 与Python版误差<1% |
| 状态持久化 | `core/State.ts` | JSON读写正常 |

**里程碑**：健康指标计算误差 < 1%

### 4.3 阶段三：通信模块（Week 3）

**目标**：实现SSE通信、CLI调用

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| SSE事件解析 | `sse/SSEEvent.ts` | 支持流式解析 |
| SSE客户端 | `sse/SSEClient.ts` | 支持断线重连 |
| CLI客户端 | `cli/ClaudeClient.ts` | 支持子进程调用 |
| Agent基类 | `cli/Agent.ts` | 支持生命周期管理 |
| 集成测试 | `test/integration/` | 端到端测试通过 |

**里程碑**：支持真实SSE流式通信

### 4.4 阶段四：工具增强（Week 4）

**目标**：异步工具、性能优化

| 任务 | 产出 | 验收标准 |
|------|------|----------|
| 线程池 | `async/ThreadPool.ts` | 支持并发控制 |
| 事件总线 | `async/EventEmitter.ts` | 支持订阅发布 |
| Generator提取 | `util/extract.ts` | 兼容Python Generator |
| 性能测试 | `scripts/bench.sh` | 吞吐量达标 |
| 文档完善 | `README.md`, `API.md` | 覆盖率100% |

**里程碑**：吞吐量达到Python版90%

---

## 五、Python兼容性方案

### 5.1 Generator返回值提取

Python版核心功能是处理Generator返回：

```python
# Python 实现
def process_events():
    for line in stream:
        yield parse_event(line)
```

TS实现：

```typescript
// TypeScript 实现
async function* processEvents(stream: ReadableStream): AsyncGenerator<ClaudeEvent> {
  for await (const line of readLines(stream)) {
    const event = parseEvent(line);
    if (event.ok) {
      yield event.value;
    }
  }
}

// 使用示例
for await (const event of processEvents(stream)) {
  console.log(event.type);
}
```

### 5.2 类型映射表

| Python 类型 | TypeScript 类型 | 说明 |
|-------------|------------------|------|
| `dict[K, V]` | `Record<K, V>` | 字典映射 |
| `list[T]` | `T[]` | 数组 |
| `Optional[T]` | `T \| null \| undefined` | 可选值 |
| `Generator[T]` | `AsyncGenerator<T>` | 异步生成器 |
| `@dataclass` | `interface` + 构造函数 | 数据类 |
| `Union[A, B]` | `A \| B` | 联合类型 |
| `Callable` | `(args: T) => R` | 函数类型 |

### 5.3 兼容层实现

```typescript
// === Python Generator 适配器 ===

interface PythonGenerator<T> {
  next(): { value: T; done: boolean };
  send(value: unknown): { value: T; done: boolean };
}

class PythonGeneratorAdapter<T> {
  constructor(private pyGenerator: PythonGenerator<T>) {}

  async *toAsyncGenerator(): AsyncGenerator<T> {
    while (true) {
      const result = this.pyGenerator.send(undefined);
      if (result.done) break;
      yield result.value;
    }
  }

  // 转换为数组
  toArray(): T[] {
    const results: T[] = [];
    while (true) {
      const result = this.pyGenerator.next();
      if (result.done) break;
      results.push(result.value);
    }
    return results;
  }
}
```

---

## 六、测试策略

### 6.1 测试覆盖目标

| 层级 | 覆盖率 | 工具 | 说明 |
|------|--------|------|------|
| 单元测试 | ≥ 80% | Vitest | 核心逻辑全覆盖 |
| 集成测试 | ≥ 60% | Vitest + Mock | 模块间交互 |
| 端到端 | ≥ 40% | Playwright | 完整流程测试 |

### 6.2 测试用例示例

```typescript
// === ClaudeEvent.test.ts ===

describe('ClaudeEvent', () => {
  describe('解析', () => {
    it('应该解析消息事件', () => {
      const event = new ClaudeEvent({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        uuid: 'test-uuid',
        timestamp: Date.now(),
        session_id: 'session-123'
      });

      expect(event.type).toBe('message');
      expect(event.role).toBe('assistant');
    });

    it('应该处理原始事件', () => {
      const raw = 'Error: something went wrong';
      const event = new ClaudeEvent(raw);

      expect(event.type).toBe('raw');
      expect(event.raw_content).toBe(raw);
    });
  });

  describe('展开', () => {
    it('应该展开嵌套消息', () => {
      const parent = new ClaudeEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' }
          ]
        }
      });

      const flattened = Array.from(parent.flatten());
      expect(flattened).toHaveLength(2);
    });
  });
});
```

---

## 七、构建与部署

### 7.1 npm 脚本

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.ts\""
  }
}
```

### 7.2 依赖管理

```json
{
  "dependencies": {
    "typescript": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0",
    "eslint": "^8.55.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "prettier": "^3.0.0",
    "vite": "^5.0.0"
  }
}
```

---

## 八、风险与对策

| 风险 | 影响 | 概率 | 对策 |
|------|------|------|------|
| 类型定义不完整 | 运行时错误 | 中 | 增量式开发，先有测试后有实现 |
| Python兼容性问题 | 功能缺失 | 高 | 保留Python版作为fallback |
| 性能差距 | 吞吐量不足 | 中 | 性能测试先行，Profiling定位瓶颈 |
| 学习曲线 | 开发效率低 | 低 | 完善文档，TypeScript最佳实践指南 |

---

## 九、验收标准

### 9.1 功能验收

- [ ] 核心类型定义完整（ClaudeEvent, Fact, ClaudeHealth）
- [ ] 消息处理模块支持Fact创建、引用链管理
- [ ] 健康指标计算误差 < 1%
- [ ] SSE通信支持断线重连
- [ ] 状态持久化支持JSON文件

### 9.2 质量验收

- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 无类型错误（`tsc --noEmit`）
- [ ] ESLint通过
- [ ] 构建产物可用（`npm run build`）

---

## 十、下一步行动

1. **立即执行**：创建项目骨架，初始化 `package.json`
2. **本周完成**：核心类型定义（`core/types.ts`）
3. **本周完成**：首个单元测试（`ClaudeEvent.test.ts`）

---

**报告生成时间**：2026-02-11
**数据来源**：Python版Agent架构 + TS_STRUCTURE.md
**版本**：v2.0（增强版）
