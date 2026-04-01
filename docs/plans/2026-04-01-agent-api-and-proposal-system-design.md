# 设计文档：Agent API 与提案系统

> **状态**：设计阶段
> **日期**：2026-04-01
> **关联 Issue**：#677（提案系统 = 请求箱实现）

---

## 背景与目标

ExoMind 的 Agent 系统分两个方向并行推进，互相独立、后续可联动：

| 方向 | 名称 | 核心问题 |
|------|------|---------|
| 方向一 | **提案系统**（Proposal System） | Agent 的操作如何经由人类审批后执行？ |
| 方向二 | **Agent API** | RT 如何为模型提供工具能力，让模型能自主感知并操作？ |

---

## 方向一：提案系统

### 概念

「提案」是 ExoMind 中 **操作的草稿箱**——存放「尚待执行的行动方案」。

类比：
- 类似 GitHub Pull Request：有编号、有讨论区、最终批准才执行
- 类似 Claude Code 的工具审批：人类批准才执行，但**不阻塞** Agent 继续运行
- 与 GitHub PR 不同：生命周期较短，聚焦「行动批准」而非代码审查

**不变量**：提案一旦创建，不可删除，只能转换状态。每条提案有自增编号永久标定。

### 数据模型

```rust
struct Proposal {
    // 标识
    id: u64,                        // 自增编号 #1, #2...（永久不变）

    // 内容
    title: String,
    body: String,                   // 理由、说明、分析依据

    // 动作
    action_type: ActionType,        // 要执行的操作类型
    action_params: serde_json::Value, // 操作参数（按 action_type 解析）

    // 溯源引用（可点击跳转）
    references: Vec<ProposalRef>,

    // 状态
    status: ProposalStatus,

    // 发布者
    publisher: Publisher,

    // 讨论
    comments: Vec<Comment>,

    // 时间戳
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

enum ActionType {
    CreateTask,         // 创建任务
    AppendEvent,        // 添加事件日志
    StartTimeblock,     // 启动时间块（含名称与描述）
    ApproveAgentAccess, // 批准外部 Agent 接入档案（#677）
}

// ActionParams 示例：
//
// CreateTask:
//   { title: String, description?: String, tags?: Vec<String>, priority?: i32 }
//
// AppendEvent:
//   { content: String, tags?: Vec<String> }
//
// StartTimeblock:
//   { name: String, description?: String, tags?: Vec<String> }
//
// ApproveAgentAccess:
//   { agent_id: String, agent_name: String, profile_id: String, scopes: Vec<String> }

struct ProposalRef {
    ref_type: RefType,  // "event" | "timeblock" | "task"
    id: String,
    display_text: String, // UI 展示文本（不需要跳转时已可读）
}

enum RefType { Event, Timeblock, Task }

enum ProposalStatus {
    Pending,    // 待处理
    InReview,   // 审议中（已有人开始处理，防止重复操作）
    Approved,   // 已批准（立即触发执行）
    Rejected,   // 已拒绝
    Snoozed,    // 暂缓（回到 pending，带可选的唤醒时间）
}

struct Publisher {
    publisher_type: PublisherType,  // "agent" | "human"
    id: String,
    name: String,
}

struct Comment {
    author: Publisher,
    content: String,
    created_at: DateTime<Utc>,
}
```

### HTTP API

```
POST   /api/proposals              # 创建提案（外部 Agent 通过 curl 调用）
GET    /api/proposals              # 列出提案（支持 status/action_type 过滤）
GET    /api/proposals/:id          # 获取单条提案详情
PATCH  /api/proposals/:id          # 更新状态/内容/评论
  body: {
    status?: ProposalStatus,
    action_params?: JSON,          # 用户编辑动作参数
    snooze_until?: DateTime,       # 暂缓时的唤醒时间
  }
POST   /api/proposals/:id/comments # 添加评论
```

### 状态转换

```
                    ┌──── rejected
pending ──► in_review ──► approved ──► （立即执行）
    ▲           │
    └─── snoozed ─┘  （snoozed 回到 pending，可设唤醒时间）
```

**批准即执行**：状态变为 `approved` 时，RT 立即执行对应的 `action_type` 操作。

### 引用展示（MVP）

MVP 阶段：文本 + 跳转按钮，如：
```
参考事件：2026-04-01 09:32 "开了设计会议" [↗ 跳转]
```

后续迭代：悬浮预览卡片，点击展开内联详情。

### UI 架构

**全局通知**：导航栏徽章显示待处理提案数量，点击进入请求箱页面。

**请求箱页面**：
- 左侧：提案列表（按状态分组，pending/in_review 优先）
- 右侧：提案详情（标题、理由、引用、动作参数编辑区、评论区、操作按钮）
- 操作按钮：同意执行 / 编辑后执行 / 拒绝 / 暂缓

**非阻塞原则**：提案不阻塞 Agent 的其他操作，Agent 可继续运行和提交新提案。

### 与 #677 的关系

提案系统是 #677「请求箱」的具体实现。`ApproveAgentAccess` 是第一类提案，后续 `CreateTask` / `AppendEvent` / `StartTimeblock` 是扩展的行为类提案。

---

## 方向二：Agent API

### 概念

RT 直接调用 OpenAI/Anthropic API，封装模型能力，向 RT 内部机制暴露一个「可思考的操作者」：

```
RT 内部触发 → AgentSession → 调用 LLM（携带工具列表）→ 模型决定是否调用工具
           → 执行工具（读取 EventLog 等）→ 将结果回传模型 → 返回最终输出
```

**不强制循环**：Agent API 为单次调用模式——RT 触发一次请求，模型在一次或少量轮次内思考并择机调用工具，最终返回结果给调用者。

### 架构层次

```
RT 内部触发层（signal/tick/HTTP）
        ↓
AgentSession 服务层（新增，管理会话生命周期）
        ↓
api.rs（现有：封装 HTTP 调用 + 内存会话）
        ↓
OpenAI/Anthropic API（外部）
```

### AgentSession 服务层职责

1. **工具注册**：维护可用工具列表（对齐 RT HTTP 端点，排除危险操作）
2. **工具派发**：解析模型返回的 `tool_use` 请求 → 调用对应 RT 功能 → 返回 `tool_result`
3. **会话持久化**：将会话关键节点（触发、工具调用记录、最终输出）存入 RT 数据库（SQLite）
4. **结果返回**：将最终输出返回给调用者（可以是 RT 内部的 cognition/life Agent 或 HTTP 调用方）

### 单次调用流程（Single-Shot Mode）

```rust
async fn run_agent_session(
    trigger: AgentTrigger,  // 触发来源（signal/tick/HTTP）
    prompt: String,
    tools: Vec<ToolDef>,    // 本次可用工具列表
) -> AgentResult {
    let messages = vec![
        Message::user(prompt)
    ];

    // 调用模型（携带工具定义）
    let response = llm_client.complete(messages, tools).await?;

    // 如果模型请求工具调用
    if response.stop_reason == StopReason::ToolUse {
        let tool_results = dispatch_tools(&response.tool_uses).await?;

        // 将工具结果回传模型，获取最终回复
        let final_response = llm_client.complete(
            messages + assistant_turn + user_turn(tool_results),
            tools
        ).await?;

        return AgentResult { content: final_response.content, tool_calls: response.tool_uses };
    }

    AgentResult { content: response.content, tool_calls: vec![] }
}
```

### MVP 试点工具

**第一个工具**：`get_recent_events`

```json
{
  "name": "get_recent_events",
  "description": "获取事件日志中最近 N 条事件",
  "input_schema": {
    "type": "object",
    "properties": {
      "limit": { "type": "integer", "description": "返回条数，默认 20", "minimum": 1, "maximum": 100 }
    }
  }
}
```

工具执行：调用 RT 内部 EventLog 读取接口，格式化为 LLM 友好的文本后返回。

### 工具安全策略

- **白名单制**：只暴露明确安全的 RT HTTP 端点
- **排除范围**：档案删除、API Key 读写、用户权限管理、危险 config 操作
- **未来扩展**：工具集可通过配置扩展，但每个工具需明确标注「可读」或「可写」

### 会话持久化

存入 RT SQLite，记录：
- 触发来源和时间
- 工具调用历史（调用了哪些工具，输入输出）
- 最终输出文本
- 会话状态（completed/failed）

**未来**：支持导入导出会话记录。

---

## MVP 实施计划（3 份，并行）

| 计划 | 文件 | 执行者 | 依赖 |
|------|------|--------|------|
| 提案系统 RT 逻辑端 | [proposal-system-rt-plan.md](./2026-04-01-proposal-system-rt-plan.md) | Codex (Rust) | 无 |
| 提案系统 UI 端 | [proposal-system-ui-plan.md](./2026-04-01-proposal-system-ui-plan.md) | Claude Code (TS) | 依赖 RT 计划完成 |
| Agent API RT 逻辑端 | [agent-api-rt-plan.md](./2026-04-01-agent-api-rt-plan.md) | Codex (Rust) | 无 |

---

## 决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 命名 | 「提案」 | 搭配词自然（提交/审批/撤回/执行提案），暗示「需要做出决定」，符合 AI-人协作调性 |
| 提案不可删除 | 是 | 不变量：操作生效=留下痕迹，所有行动可追溯 |
| Agent API 调用模式 | 单次调用（non-loop） | RT 触发的场景是有界事务，比无界循环更易推理和测试 |
| 提案 action 执行时机 | 批准即执行 | 最小惊讶原则：用户点批准就是要执行 |
| 会话持久化位置 | RT SQLite | 就近原则，与 RT 其他数据统一存储 |
| 工具集范围 | 对齐现有 RT HTTP 端点（白名单） | 最小权限，危险操作由 #677 的身份认证体系管理 |
| 认证 | 不在本设计范围 | 由 #677 统一追踪 |
