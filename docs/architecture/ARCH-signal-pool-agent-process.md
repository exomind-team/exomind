# SignalPool + Agent-as-Process Architecture

> **Status**: Draft v0.2 (2026-03-03)
> **Origin**: Starlin + Claude 架构对话，融合 SensoryNet v4 + Agent-as-Process
> **前序文档**: `docs/plans/2026-03-01-signal-pool-sse-runtimehost-mvp-mlp-plan.md`
> **GitHub Issues**: #308-#311 (SensoryNet 4 Phase)

---

## 0. 为什么做 SignalPool

### 0.1 产品定位

> **帮你看见自己、自动记录、收工反馈、持续学习的 AI 生命成长镜子**

### 0.2 四个核心价值

| # | 价值 | 说明 |
|---|------|------|
| 1 | **看见自己** | 你以为在做 A，ExoMind 告诉你其实在做 B |
| 2 | **自动执行** | 说一句话，任务自动建好 |
| 3 | **做完反馈** | 收工时 Agent 给你诚实复盘 |
| 4 | **学习复习** | 新知自动记录，到期自动提醒复习 |

### 0.3 核心问题

`product-plan.md` 的诊断：**外心系统只有模板，没有信息通道。**

SignalPool 就是这个缺失的信息通道——让多个 Agent 能独立响应同一事件，无需硬编码连接。

### 0.4 第一个付费场景

目标用户：想要自我成长但看不清自己行为模式的人。¥30/月。

一天的体验：
- **早上**：输入今天计划 → 任务自动创建 → 知识复习提醒
- **白天**：随手记（语音/文字）→ 自动归类（任务/知识/日志）
- **晚上**：说"收工" → 四行复盘 + 今日新知总结 + 计划 vs 实际差距

补充的前端载体分工：
- **主程序 Ritual Home（仪式首页）**：承接“开始今天 / 收住今天”
- **Now Workbench Overlay（当下悬浮窗）**：承接“执行中 / 块后反馈 / 收工轻提醒”
- **收工提示链路**：overlay 先轻提示，正式收工回主程序完成

---

## 1. 核心理念

**Agent 是独立进程，不是函数调用。RT 是路由引擎。**

```
Agent = 持续运行的进程 + JSON 流式通信 + 心跳 + 可被监督重启
RT    = SignalBus + RouteTable(主动路由) + Journal + WindowCache
```

### 1.1 架构决策（已冻结）

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| D1 | 路由模式 | **RT 主动推给 Agent** | RouteTable 是路由引擎，集中管理谁收什么；Agent Hub UI 可视化和在线改路由的基础 |
| D2 | 通信协议 | **SSE 统一，无分级** | 手机 Termux 也跑 RT，桌面/手机/Agent 全部对等 SSE + POST |
| D3 | Agent 模型 | **双轨：进程内 Actor + 进程外 Agent** | 轻量机械任务用 Actor（零开销），LLM 驱动的用独立进程（Claude CLI） |
| D4 | 任务管理 | **Agent 全权 CRUD** | 像 Vibe Kanban 一样，Agent 动态创建/更新/排序/完成任务和时间块 |
| D5 | 投递语义 | **at-most-once** | 简单可靠，失败写 Journal 审计 |
| D6 | 安全边界 | **MVP 仅本机/LAN** | 默认 127.0.0.1，EXOMIND_RT_BIND=0.0.0.0 开放 |

### 1.2 生命判据对齐

- **过程性存在** → Agent 是持续运行的 daemon
- **失败不可回滚** → 崩溃日志留下不可抹平的痕迹
- **环境裁决** → supervisor 决定重启策略
- **边界归因** → 每个 Agent 进程有独立的边界和责任

---

## 2. 系统拓扑

```
                    exomind-rt (Rust, Axum, 独立进程)
                    ┌──────────────────────────────────┐
                    │  SignalBus                        │
                    │  ┌────────────────────────────┐  │
 POST /signals/ ──→ │  │ RouteTable (主动路由引擎)  │  │
   publish          │  │ WindowCache (1000 ring)    │  │
                    │  │ Journal (审计日志)          │  │
                    │  └────────────┬───────────────┘  │
                    │               │ 查表 → fanout     │
                    │  ┌────────────┴───────────────┐  │
                    │  │ 进程内 Actor                │  │
                    │  │  · EventLog Actor           │  │
                    │  │  · 任务 Actor               │  │
                    │  └────────────────────────────┘  │
                    └───────────────┬──────────────────┘
                                    │ SSE push (基于 RouteTable)
                    ┌───────────────┼───────────────────┐
                    │               │                    │
               SSE stream      SSE stream           SSE stream
                    │               │                    │
          ┌─────────▼──────┐  ┌────▼─────────┐  ┌──────▼──────┐
          │ 分类 Agent      │  │ Review Agent │  │  前端        │
          │ (Claude CLI)   │  │ (Claude CLI) │  │  (Browser)  │
          │                │  │              │  │             │
          │ 收: user.input │  │ 收: session  │  │ 收: 全部     │
          │ 发: classified │  │ 发: review   │  │ 发: user.*  │
          └────────┬───────┘  └──────┬───────┘  └──────┬──────┘
                   │                 │                  │
                   └──── POST /signals/publish ─────────┘
```

### 2.1 两条通信通道

| 方向 | 协议 | 端点 | 说明 |
|------|------|------|------|
| **下行** (RT → 订阅者) | SSE | `GET /signals/stream?agent_id=xxx` | RT 根据 RouteTable 推送匹配的信号 |
| **上行** (订阅者 → RT) | HTTP POST | `POST /signals/publish` | 任何订阅者都能发布信号 |

**注意**：Agent 连接时只报 `agent_id`，**不指定 topics**。由 RT 的 RouteTable 决定推什么给它。

### 2.2 RT 的职责边界

RT 只做四件事，不碰业务逻辑：
1. **接收信号** (POST /signals/publish)
2. **主动路由** (查 RouteTable → 推送到匹配的 SSE 连接 / 进程内 Actor)
3. **缓存窗口** (WindowCache 1000 条 Ring Buffer，支持 Last-Event-ID 重放)
4. **审计日志** (Journal 记录投递轨迹)

### 2.3 Agent 双轨模型

| 类型 | 运行方式 | 通信方式 | 适用场景 | 示例 |
|------|---------|---------|---------|------|
| **进程内 Actor** | RT 进程内 Rust 代码 | tokio channel 直接调用 | 轻量机械执行，零延迟 | EventLog Actor、任务 Actor |
| **进程外 Agent** | 独立 OS 进程 | SSE + POST (HTTP) | LLM 驱动，语言无关 | 分类 Agent、Review Agent、知识 Agent |

两者对 SignalBus 和 RouteTable 来说是**同质的目标**——只是投递通道不同。

### 2.4 前端角色

前端**不是只读观测者**，前端也能 publish 信号：
- `user.input.text` — 用户输入
- `session.end` — 用户说"收工"
- `task.manual-update` — 用户手动改任务

前端通过 SSE 接收所有路由给它的信号，实时更新 UI。

---

## 3. 数据契约

### 3.1 SignalEvent

```ts
interface SignalEvent<T = unknown> {
  schemaVersion: 1;     // 协议版本
  id: string;           // 信号ID (nanoid/uuid)
  topic: string;        // 主题 (如 "user.input.text")
  ts: number;           // 事件时间戳 (ms)
  source: string;       // 来源 (如 "ui", "agent:classifier", "actor:eventlog")
  originHostId: string; // 源主机ID
  hop: number;          // 中继跳数
  traceId?: string;     // 追踪ID (同一链路共享)
  payload: T;           // 负载
}
```

### 3.2 SignalRoute

```ts
interface SignalRoute {
  id: string;
  enabled: boolean;
  topic: string;           // 匹配主题
  targetType: 'actor' | 'agent' | 'frontend';
  targetRef: string;       // 目标引用 (如 agent_id)
  createdAt: string;
  updatedAt: string;
}
```

### 3.3 DeliveryRecord (Journal)

```ts
interface DeliveryRecord {
  eventId: string;
  routeId: string;
  targetRef: string;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  startedAt: string;
  finishedAt: string;
}
```

---

## 4. 信号地图（付费场景）

### 4.1 MVP 信号清单

| 信号 | 发布者 | 订阅者 | 说明 |
|------|--------|--------|------|
| `user.input.text` | 前端 UI | 分类 Agent, EventLog Actor | 用户每一句输入 |
| `input.classified` | 分类 Agent | 任务 Actor, 知识 Agent | 分类结果（task/knowledge/log） |
| `task.auto-created` | 任务 Actor | 前端 UI | 自动创建的任务 |
| `task.updated` | 任务 Actor | 前端 UI | 任务状态变更 |
| `task.prioritized` | 任务 Actor | 前端 UI | 任务重排序 |
| `knowledge.captured` | 知识 Agent | 前端 UI | 捕获的知识点 |
| `knowledge.review-due` | 知识 Agent | 前端 UI | 到期复习提醒 |
| `session.end` | 前端 UI | Review Agent, 知识 Agent | 用户说"收工" |
| `review.completed` | Review Agent | 前端 UI | 四行复盘结果 |
| `eventlog.appended` | EventLog Actor | 前端 UI | 日志已记录 |

### 4.2 最小信号链路

```
用户输入 "今天要 review PR #313，然后写 SignalPool 代码"
    │
    ▼
前端 POST /signals/publish
    { topic: "user.input.text", source: "ui", traceId: "t1", payload: { text: "..." } }
    │
    ▼
RT 查 RouteTable，找到 3 条匹配路由：
    │
    ├─→ SSE push → 分类 Agent (Claude CLI 进程)
    │     处理后 POST 回来：
    │     { topic: "input.classified", traceId: "t1",
    │       payload: { type: "task", tasks: ["review PR #313", "写 SignalPool"] } }
    │     │
    │     ▼
    │   RT 再查 RouteTable，"input.classified" 匹配：
    │     ├─→ 任务 Actor (进程内) → TaskService.createTask()
    │     │     → POST 回来：{ topic: "task.auto-created" }
    │     │
    │     └─→ 知识 Agent → 判断不是知识点，跳过
    │
    ├─→ EventLog Actor (进程内) → 直接追加到 EventLog
    │
    └─→ SSE push → 前端
          实时显示："已记录"
          收到 task.auto-created → 任务列表自动刷新
```

2 轮信号传递，全部由 RT RouteTable 路由驱动。

### 4.3 收工信号链路

```
用户点击"收工"
    │
    ▼
前端 POST /signals/publish
    { topic: "session.end", source: "ui" }
    │
    ▼
RT 查 RouteTable：
    │
    ├─→ SSE push → Review Agent (Claude CLI)
    │     读取今日 EventLog → 生成四行复盘
    │     → POST: { topic: "review.completed", payload: { effective, stuck, improve, avoid } }
    │
    ├─→ SSE push → 知识 Agent (Claude CLI)
    │     读取今日知识点 → 总结
    │     → POST: { topic: "knowledge.daily-summary", payload: { ... } }
    │
    └─→ SSE push → 前端
          显示复盘面板
```

---

## 5. Agent 地图

| Agent | 类型 | 职责 | 信号 | 实施优先级 |
|-------|------|------|------|-----------|
| **EventLog Actor** | 进程内 | 所有输入追加到 EventLog | 收 `user.input.text` → 发 `eventlog.appended` | L1 (基础) |
| **分类 Agent** | 进程外 (Claude CLI) | 判断输入是任务/知识/日志 | 收 `user.input.text` → 发 `input.classified` | L2 |
| **任务 Actor** | 进程内 | 调用 TaskService CRUD | 收 `input.classified` → 发 `task.auto-created/updated/prioritized` | L2 |
| **Review Agent** | 进程外 (Claude CLI) | 读今日 EventLog 生成复盘 | 收 `session.end` → 发 `review.completed` | L3 |
| **知识 Agent** | 进程外 (Claude CLI) | 知识捕获 + 复习调度 | 收 `input.classified` + `session.end` → 发 `knowledge.*` | L4 |
| **Growth Coach** | 进程外 (Claude CLI) | 跨天行为模式分析 | 收 `session.end` → 发 `growth.insight` | L5 |

任务 Actor 对 TaskService 有**完整 CRUD 能力**（create/update/prioritize/complete），像 Vibe Kanban MCP 一样由 Agent 动态管理任务列表和时间块。

---

## 6. SSE 协议

### 6.1 下行事件类型

```
event: signal
id: sig_abc123
data: {"schemaVersion":1,"id":"sig_abc123","topic":"user.input.text","ts":1709366400000,...}

event: heartbeat
data: {"ts":1709366405000}

event: delivery
data: {"eventId":"sig_abc123","routeId":"r1","targetRef":"agent:classifier","status":"sent"}
```

### 6.2 连接参数

```
GET /signals/stream?agent_id=classifier&heartbeat_interval=30
```

| 参数 | 说明 |
|------|------|
| `agent_id` | 自报身份（RT 根据 RouteTable 推送匹配信号） |
| `heartbeat_interval` | 心跳间隔（秒），默认 30 |

**注意**：不再有 `topics` 参数。路由由 RouteTable 集中管理。

### 6.3 重放支持

- 客户端断线重连时带 `Last-Event-ID` 请求头
- RT 从 WindowCache (1000条) 中查找该 ID 之后的事件重放
- 超出窗口范围的不重放（at-most-once 语义）

---

## 7. Agent 存活检测

| 状态 | 判定条件 |
|------|---------|
| `running` | SSE 连接存活，最近有信号处理 |
| `idle` | SSE 连接存活，但无新投递 |
| `warning` | SSE 连接存活，但最近有投递失败 |
| `offline` | SSE 连接断开，或超过 2 个心跳周期无响应 |

RT 通过 SSE 连接状态天然监控 Agent 存活：
- 连接建立 → 注册（running/idle）
- 连接断开 → 标记 offline
- 心跳超时 → 标记 warning → offline

---

## 8. RT API 总览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/signals/publish` | 发布信号 |
| GET | `/signals/stream` | SSE 订阅信号流（RT 根据 RouteTable 推送） |
| GET | `/signals/history?limit=N` | 查询最近信号（审计面板） |
| GET | `/signal-routes` | 列出所有路由 |
| POST | `/signal-routes` | 创建路由 |
| PUT | `/signal-routes/:id` | 更新路由 |
| DELETE | `/signal-routes/:id` | 删除路由 |
| GET | `/health` | RT 健康检查 |
| GET | `/agents` | 已注册 Agent 列表（含存活状态） |
| GET | `/topology` | 系统拓扑 |

---

## 9. 实施分层

基于付费场景，由内而外分层实施：

| 层 | 内容 | 产出 | 依赖 |
|----|------|------|------|
| **L1** | SignalPool 核心 | Rust: SignalBus + RouteTable + SSE endpoint + Publish endpoint + Journal + WindowCache | 无 |
| **L2** | 前端 SDK + 第一个 Agent | 前端能 publish/subscribe；Echo Agent 验证链路通 | L1 |
| **L3** | 分类 Agent + 任务自动创建 | Claude CLI 分类进程 + 进程内任务 Actor 调用 TaskService | L2 + 已有 TaskService |
| **L4** | EventLog 自动记录 | 进程内 EventLog Actor | L1 + 已有 EventLogService |
| **L5** | 收工复盘 | Review Agent + 前端复盘面板 | L3 + 已有 EventLog |
| **L6** | 知识记录 + 复习 | 知识 Agent + 知识存储 + 复习队列 + UI | L3（新模块） |
| **L7** | Growth Coach | 跨天分析 Agent + MePage 真实数据 | L5 + L6 |
| **L8** | Agent Hub 画布 | @xyflow/react 可视化 RouteTable + Agent 状态 | L1 |

**L1-L2 是基础设施，L3-L4 是第一个可体验的闭环，L5-L7 是完整体验，L8 是开发者工具。**

---

## 10. 设计决策记录

### 10.1 已冻结（v0.2）

| # | 问题 | 决策 | 日期 |
|---|------|------|------|
| D1 | 路由模式 | RT 主动推给 Agent，RouteTable 是路由引擎 | 2026-03-03 |
| D2 | 通信协议 | SSE 统一，去掉 Tauri IPC 分级 | 2026-03-03 |
| D3 | Agent 模型 | 双轨：进程内 Actor + 进程外 Agent | 2026-03-02 |
| D4 | 任务管理 | Agent 全权 CRUD（像 Vibe Kanban） | 2026-03-03 |
| D5 | 投递语义 | at-most-once | 2026-03-01 |
| D6 | 安全边界 | MVP 仅本机/LAN | 2026-03-01 |
| D7 | 前端角色 | 可 publish 信号（user.input, session.end 等） | 2026-03-03 |

### 10.2 待冻结

| # | 问题 | 倾向 | 备注 |
|---|------|------|------|
| D8 | Topic 匹配 | MVP 精确匹配 | 通配符 MLP 再加 |
| D9 | RouteTable 持久化 | 文件 JSON | 重启后路由不丢 |
| D10 | Journal 存储 | 内存 Ring Buffer | MVP 不持久化 |
| D11 | Agent supervisor | 外部（bash 脚本循环） | RT 不管 Agent 生命周期 |

---

## 11. 与前序文档的关系

### 11.1 与 SensoryNet v4（Issues #308-311）

| SensoryNet 特性 | 本方案 |
|-----------------|--------|
| Phase 1 核心 pub/sub | **采纳**，作为 SignalBus 核心 |
| Phase 1 PortRegistry | **延后**，MVP 用 Agent 存活检测替代 |
| Phase 1 Tauri IPC 一等公民 | **去掉**，SSE 统一 |
| Phase 2 通讯模式 request/reply | **简化**，用 traceId 关联实现异步 request/reply |
| Phase 2 马尔可夫毯 | **去掉**，分类 Agent 直接干 |
| Phase 2 TriggerRuleEngine | **延后**，MVP 硬编码 |
| Phase 3 全感觉源 | **延后**，MVP 只有文字输入 |
| Phase 4 具身信号 | **远期** |

### 11.2 与原 MVP 计划（2026-03-01）

| 原计划 | 本方案 |
|--------|--------|
| Agent 是 Rust trait，进程内调用 | **Agent 是独立进程，通过 SSE/POST 通信** |
| T7/T8 在 TS service 层写 Agent 逻辑 | **Agent 逻辑在独立进程中，语言无关** |
| RT 只做 SSE broadcast，Agent 自己声明 topics | **RT 主动路由，RouteTable 决定推给谁** |
| 前端 Signal SDK 是特殊客户端 | **前端也是 SSE 订阅者，也能 publish** |

保留不变：四件套架构、数据契约、SSE + POST 通信、at-most-once、MVP 安全边界。
