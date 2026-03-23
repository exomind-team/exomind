# Agent TypeScript 开发方案

**版本**：v3.0（精简版）
**生成时间**：2026-02-11
**依据**：Python版Agent架构

---

## 一、核心原则

### 1.1 四大原则

| 原则 | 说明 | 实践 |
|------|------|------|
| **类型安全** | 编译时捕获错误 | strict模式、泛型、接口 |
| **渐进迁移** | 从Py到TS平滑过渡 | 混合运行、逐步替换 |
| **模块解耦** | 高内聚、低耦合 | 按功能拆分、独立测试 |
| **运行时兼容** | Node.js环境 | 纯TS实现 |

### 1.2 代码规范

```typescript
// ✅ 推荐：显式类型 + Result模式
function parse(data: unknown): Result<Event> {
  return isValid(data) ? ok(new Event(data)) : err(invalid);
}

// ❌ 避免：隐式类型 + 异常
function parse(data) {
  if (!data) throw new Error();
  return data;
}
```

---

## 二、类型定义

### 2.1 事件类型

```typescript
type EventType = 'message' | 'system' | 'raw' | 'error';

interface BaseEvent {
  uuid: string;
  timestamp: number;
  session_id: string;
}

interface MessageEvent extends BaseEvent {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
}

interface SystemEvent extends BaseEvent {
  type: 'system';
  sub_type: 'init' | 'status' | 'compact_boundary';
}

type ClaudeEvent = MessageEvent | SystemEvent | RawEvent;
```

### 2.2 Fact消息

```typescript
interface Fact {
  fact_id: string;
  content: string;
  source: 'human' | 'agent';
  meta: {
    sender: string;
    topics: string[];
    reply_to?: string;
  };
  timestamp: number;
}
```

### 2.3 健康指标

```typescript
interface ClaudeHealth {
  // 时之度量
  physical_age_days: number;
  psychological_age_days: number;
  cognitive_density: number;

  // 空之度量
  memory_size_kb: number;
  file_count: number;

  // 成本
  usage: {
    total_tokens: number;
    cost_rmb: number;
    cache_hit_rate: number;
  };
}
```

### 2.4 状态

```typescript
interface AgentState {
  agent_id: string;
  session_id: string;
  status: 'idle' | 'running' | 'paused';
  health: ClaudeHealth;
  queue: MessageQueue;
}
```

---

## 三、模块架构

### 3.1 目录结构

```
src/
├── core/           # 核心类型
│   ├── types.ts    # 通用类型
│   ├── Event.ts    # 事件解析
│   ├── Health.ts   # 健康指标
│   └── State.ts    # 状态管理
│
├── messenger/      # 消息处理
│   ├── Fact.ts
│   └── Queue.ts
│
├── sse/            # SSE通信
│   ├── Client.ts
│   └── Agent.ts
│
├── util/           # 工具
│   ├── Result.ts   # 错误处理
│   └── helpers.ts
│
└── index.ts        # 入口
```

### 3.2 模块关系

```
Agent (cli)
    │
    ├── Messenger (消息队列)
    ├── SSE (通信)
    └── Health (监控)
```

---

## 四、开发阶段

### 阶段一：基础（Week 1）

| 任务 | 产出 | 验收 |
|------|------|------|
| 项目初始化 | package.json, tsconfig.json | npm install成功 |
| 核心类型 | types.ts, Event.ts | 无类型错误 |
| Result类型 | util/Result.ts | 单元测试通过 |
| 工具函数 | helpers.ts | 覆盖80%Py功能 |

**里程碑**：类型检查零错误

### 阶段二：核心（Week 2）

| 任务 | 产出 | 验收 |
|------|------|------|
| 消息模块 | Fact.ts, Queue.ts | CRUD完整 |
| 健康指标 | Health.ts | 误差<1% |
| 状态持久 | State.ts | JSON读写 |

**里程碑**：功能完整

### 阶段三：通信（Week 3）

| 任务 | 产出 | 验收 |
|------|------|------|
| SSE客户端 | Client.ts | 断线重连 |
| Agent基类 | Agent.ts | 生命周期管理 |
| CLI集成 | CLI.ts | 子进程调用 |

**里程碑**：可运行

### 阶段四：优化（Week 4）

| 任务 | 产出 | 验收 |
|------|------|------|
| 线程池 | async/Pool.ts | 并发控制 |
| 性能测试 | benchmark | 达Py的90% |
| 文档完善 | README.md | 覆盖率100% |

**里程碑**：性能达标

---

## 五、测试策略

| 层级 | 覆盖率 | 工具 |
|------|--------|------|
| 单元 | ≥80% | Vitest |
| 集成 | ≥60% | Mock |
| E2E | ≥40% | Playwright |

---

## 六、Python兼容

| Python | TypeScript |
|--------|-------------|
| dict | Record<K,V> |
| list | T[] |
| Optional | T \| null |
| Generator | AsyncGenerator |
| @dataclass | interface |

---

## 七、风险

| 风险 | 对策 |
|------|------|
| 类型不完整 | 测试先行 |
| Py兼容 | 保留Py版fallback |
| 性能差距 | Profiling定位 |

---

## 八、下一步

1. ✅ 创建项目骨架
2. ⏳ 定义核心类型
3. ⏳ 编写单元测试

---

**版本**：v3.0
**下次更新**：根据反馈优化
