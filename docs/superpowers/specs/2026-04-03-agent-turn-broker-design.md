# #823 Agent Turn Broker 设计与第一批实施计划

> 日期：2026-04-03
> 关联 Issue：#823
> 当前分支基线：`dev@b9fb796a`
> 状态：设计中，待用户评审

## 1. 背景

当前 `dev` 上已经有两条与 API Agent 相关的可运行路径：

- managed `ApiAgent` 聊天主链路可用
- `/agent-sessions` 可用，但仍是“固定工具名 + RT 内执行工具 + 再回送给 LLM”的旧模型

在继续做“天气工具”测试时，已经确认当前实现与目标方向不一致：

- 请求方需要为每个 session 自定义工具集
- RT 不应执行调用方自定义工具
- RT 应返回 `toolCalls`
- HTTP 外部调用者与 RT 内部 Rust 调用方都应复用同一套 Agent turn 逻辑

因此，本批工作的目标不是再给 RT 增加一个固定天气工具，而是把 API Agent 背后的“一次 LLM 回合”收口为一个统一的 Rust 内核能力。

## 2. 术语与定位

本设计中的 `broker` 指：

- 英文：`AgentTurnBroker`
- 推荐中文名：`Agent 轮次代理器`

它不是消息队列意义上的 broker，也不是任务调度器。

它的准确定位是：

> 一个 Rust 内核层能力，用于统一接收一次 Agent 回合输入，向 LLM 发起请求，解析并标准化返回 `final answer` 或 `toolCalls`，供 HTTP 与 RT 内部共同复用。

### 2.1 它负责什么

- 接收一次 Agent turn 的统一输入
- 将统一输入翻译为 provider 请求
- 向 OpenAI-compatible / Anthropic 发起调用
- 解析 provider 返回
- 标准化返回：
  - 最终文本回答
  - 或需要调用方处理的 `toolCalls`

### 2.2 它不负责什么

- 不执行调用方定义的工具
- 不承载 HTTP 参数解析与响应序列化职责
- 不把 life/internal caller 的业务决策写进自身
- 不直接实现自动循环多轮工具执行

## 3. 设计原则

本设计遵守以下原则：

1. HTTP 只负责 transport adapter：
   - 解析请求参数
   - 调用 Rust 内核 broker / 功能函数
   - 接收返回值并整理成 HTTP 响应
2. Agent turn 的关键业务逻辑不写在 HTTP handler 中。
3. Rust 侧公开的 Agent turn / broker 功能函数必须同时支持：
   - HTTP 外部调用
   - RT 内部 Rust 调用
4. 第一批即统一新旧逻辑：
   - 内部 Rust 调用方也必须切到新 broker
   - 不接受 HTTP 走新逻辑、内部调用保留旧逻辑的双轨状态
5. 第一批按“两步模式”实现：
   - 第一步返回 `toolCalls`
   - 第二步由调用方补 `tool_result` 后续跑

## 4. 分层架构

第一批采用 3 层结构。

### 4.1 Kernel/Broker 层

新增独立模块：

- `crates/exomind-runtime/src/agent/broker.rs`

职责：

- 定义统一请求/响应模型
- 编排一次 Agent turn
- 做 provider 适配
- 标准化输出

### 4.2 HTTP/Transport 层

保留现有路由文件：

- `crates/exomind-runtime/src/routes/agent_sessions.rs`

但将其职责收缩为：

- JSON 解析
- 调 broker
- 响应序列化

第一批明确 **保留 session wrapper**，但它只能是 broker 之上的薄包装层：

- 负责生成 `sessionId`
- 负责把 broker 返回值包装为 HTTP 响应
- 负责第一批仍需保留的 session 持久化
- 负责 `GET /agent-sessions/:id` 所需的读取包装

它不得承担：

- turn 状态机编排
- provider 差异处理
- 工具执行
- continuation 业务判断

不得继续承担：

- 固定工具注册
- RT 内工具执行
- provider 业务编排

### 4.3 Internal Caller 层

内部 Rust 调用方，例如：

- `crates/exomind-runtime/src/agent/life.rs`

第一批就要切到统一 broker：

- 直接构造 `AgentTurnRequest`
- 调用 `AgentTurnBroker`
- 按返回结果决定是否续跑

第一批明确约定：

- 对于 RT 内部调用场景，**工具执行责任仍在调用方**
- 也就是 `life.rs` 等内部调用者在拿到 `NeedsToolCalls` 后，自己决定：
  - 是否执行本地工具
  - 如何生成 `ToolResult`
  - 是否再次调用 broker 续跑

如果需要抽辅助函数，也只能是 **broker 之上的显式 helper**，例如：

- `run_internal_agent_turn_step(...)`
- `continue_internal_agent_turn(...)`

不得回退到：

- runtime 固定工具注册表
- broker 内部自动 dispatch 工具
- “换个名字的旧 `run_agent_session_with_runtime`”

## 5. 最小输入/输出模型

### 5.1 Rust 输入模型

```rust
pub struct AgentTurnRequest {
    pub provider: ApiProviderProfile,
    pub system_prompt: Option<String>,
    pub tools: Vec<ToolDef>,
    pub history: Vec<TurnItem>,
    pub new_user_message: Option<String>,
}
```

```rust
pub enum TurnItem {
    User {
        content: String,
    },
    Assistant {
        content: String,
        tool_calls: Vec<ToolCall>,
    },
    ToolResult {
        tool_call_id: String,
        tool_name: String,
        content: String,
    },
}
```

```rust
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}
```

### 5.2 Rust 输出模型

```rust
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

pub enum AgentTurnResult {
    Final {
        assistant_turn: AssistantTurn,
    },
    NeedsToolCalls {
        assistant_turn: AssistantTurn,
        tool_calls: Vec<ToolCall>,
    },
}
```

设计理由：

- `assistant_turn` 是“可续跑上下文”
- `tool_calls` 是便利字段，方便 HTTP 调用者和测试代码直接取用
- `history` 只支持 `user / assistant / tool_result`，足以覆盖第一批两步模式
- `new_user_message` 单独存在，避免调用方每次手动改写 `history`

### 5.3 请求合法性与归一化规则

第一批明确以下规则：

1. `history` 中的条目顺序必须是调用方已确认发生过的真实顺序。
2. 若 `new_user_message` 存在，broker 在内部归一化时总是把它视为：
   - 追加在 `history` 末尾的一个新的 `User` turn
3. 因此 continuation 请求允许两种合法形态：
   - 只带 `history`，不带 `new_user_message`
   - 带已有 `history`，并在本轮再追加一个新的 `new_user_message`
4. 第一批不允许调用方在 `history` 末尾已经手工放入一个新的 user turn，同时又再传 `new_user_message` 表示同一轮用户输入。
5. 若出现该歧义输入，broker 应返回请求错误，而不是自行猜测合并。

这样可以保证：

- HTTP 外部调用者与内部 Rust 调用方遵守同一规则
- continuation 场景里不会因为消息归一化顺序不同而分叉
- 第一批天气两步测试保持最小模型，不引入额外复杂度

## 6. HTTP 契约

### 6.0 第一批 session 包装约定

虽然 turn 逻辑已经下沉到 broker，但第一批仍保留 `/agent-sessions` 的 session 语义。

第一批约定：

- `POST /agent-sessions` 仍返回一个 session 包装结果
- 包装结果中包含：
  - `sessionId`
  - `status`
  - `assistantTurn`
  - 在适用时包含 `toolCalls`
  - 在适用时包含顶层便利字段 `content`
- `GET /agent-sessions/:id` 仍可读取最近一次持久化的 session 结果

但 session wrapper 只是：

- 以 broker 结果为源数据
- 做持久化和读取适配
- 不拥有独立的 turn 编排逻辑

也就是说，第一批不是取消 session surface，而是把它降格为 broker 上层的 transport/persistence wrapper。

### 6.1 第一次请求

```json
{
  "providerProfile": {
    "provider": "openai",
    "model": "gpt-5.4",
    "baseUrl": "https://example.invalid/v1",
    "apiKey": "env-injected"
  },
  "systemPrompt": "你是一个助手",
  "tools": [
    {
      "name": "get_weather",
      "description": "获取天气",
      "inputSchema": {
        "type": "object",
        "properties": {
          "date": { "type": "string" }
        },
        "required": ["date"]
      }
    }
  ],
  "history": [],
  "newUserMessage": "今天是什么天气"
}
```

### 6.2 第一次响应

```json
{
  "sessionId": "session_123",
  "status": "needs_tool_calls",
  "content": "",
  "assistantTurn": {
    "content": "",
    "toolCalls": [
      {
        "id": "call_1",
        "name": "get_weather",
        "input": { "date": "today" }
      }
    ]
  },
  "toolCalls": [
    {
      "id": "call_1",
      "name": "get_weather",
      "input": { "date": "today" }
    }
  ]
}
```

### 6.3 第二次请求

```json
{
  "providerProfile": {
    "provider": "openai",
    "model": "gpt-5.4",
    "baseUrl": "https://example.invalid/v1",
    "apiKey": "env-injected"
  },
  "systemPrompt": "你是一个助手",
  "tools": [
    {
      "name": "get_weather",
      "description": "获取天气",
      "inputSchema": {
        "type": "object",
        "properties": {
          "date": { "type": "string" }
        },
        "required": ["date"]
      }
    }
  ],
  "history": [
    { "role": "user", "content": "今天是什么天气" },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "id": "call_1",
          "name": "get_weather",
          "input": { "date": "today" }
        }
      ]
    },
    {
      "role": "tool",
      "toolCallId": "call_1",
      "toolName": "get_weather",
      "content": "今天是阴天，气温21.45度"
    }
  ]
}
```

### 6.4 第二次响应

```json
{
  "sessionId": "session_123",
  "status": "completed",
  "content": "今天是阴天，气温21.45度。",
  "assistantTurn": {
    "content": "今天是阴天，气温21.45度。",
    "toolCalls": []
  }
}
```

## 7. 模块边界与代码落点

### 7.1 新增模块

- `crates/exomind-runtime/src/agent/broker.rs`

放置：

- `AgentTurnRequest`
- `TurnItem`
- `ToolDef`
- `ToolCall`
- `AssistantTurn`
- `AgentTurnResult`
- `AgentTurnBroker`

### 7.2 既有模块调整

- `crates/exomind-runtime/src/routes/agent_sessions.rs`
  - 收缩为 transport + session wrapper adapter
- `crates/exomind-runtime/src/agent/life.rs`
  - 迁移为直接调用 broker
- `crates/exomind-runtime/src/agent/session.rs`
  - 暂时保留 session record / store / runtime support
  - 负责 broker 结果的 session 包装与持久化配套
  - 不继续扩展旧 single-shot 固定工具逻辑
- `crates/exomind-runtime/src/agent/api.rs`
  - 视需要复用 provider schema / parser
  - 但 turn 级 orchestration 迁入 broker

## 8. 测试分层

第一批采用 3 层测试。

### 8.1 Layer A：Broker 核心测试

目标：

- 验证统一 turn 状态机
- 不经过 HTTP
- 使用 fake provider 保持稳定

至少覆盖：

- 无工具直答
- 第一次返回 `NeedsToolCalls`
- 第二次 `history + tool_result` 续跑得到 `Final`
- OpenAI-compatible 解析正确
- Anthropic 解析正确
- broker 不执行调用方定义工具

### 8.2 Layer B：内部 Rust 真上游测试

目标：

- 验证内部 Rust 调用方已接入新 broker
- 验证真上游 provider 下的两步天气流程

策略：

- 普通 Rust 测试
- 自动读取环境变量
- 缺少必要变量则跳过
- 不能把 token 写入仓库或输出

最小主用例：

1. 第一次请求：`今天是什么天气`
2. 断言返回 `toolCalls`
3. 测试代码注入固定工具结果：`今天是阴天，气温21.45度`
4. 第二次续跑
5. 断言最终回复包含该天气结果

补充要求：

- 若上游返回 `401`，测试必须直接失败并明确报鉴权问题

### 8.3 Layer C：HTTP 黑盒验收

目标：

- 验证真实启动 RT 后，HTTP 路由只是 transport adapter

方式：

- 实际启动 RT
- 使用 `curl` 做两步天气测试

验收链路：

1. 第一次请求带 `tools + newUserMessage`
2. 响应返回 `toolCalls`
3. 调用方自行补 `tool_result`
4. 第二次请求带 `history`
5. 响应返回最终天气答案

第一批不强求将这层塞进 `cargo test`，但必须有可重复执行的验收命令或脚本。

## 9. 第一批实施切分

### Step 1：定义 broker 核心模型

- 新增 `agent/broker.rs`
- 定义统一 request/result/turn 数据结构
- 定义 provider-neutral 的 broker 接口

### Step 2：实现 broker provider 适配

- 将 OpenAI-compatible / Anthropic 的 turn 级适配收口到 broker
- 实现：
  - 无工具直答
  - 工具调用返回 `NeedsToolCalls`
  - 带 `history + tool_result` 的续跑

### Step 3：迁移 HTTP route

- 将 `/agent-sessions` 改为薄适配层
- 保留第一批 session wrapper 与持久化语义
- 输入从旧 `prompt + Vec<String>` 升级到：
  - `tools: ToolDef[]`
  - `history`
  - `newUserMessage`

### Step 4：迁移内部 Rust 调用方

- 把现有内部 API Agent / life 调用迁到 broker
- 由内部调用方显式处理 `NeedsToolCalls -> ToolResult -> continue`
- 移除或绕开旧的 fixed-tool single-shot 执行路径

### Step 5：补齐三层测试

- 先写 Layer A
- 再补 Layer B
- 最后补 Layer C 验收脚本/命令

## 10. 第一批完成条件

- [ ] Rust 内核存在统一 `AgentTurnBroker`
- [ ] HTTP `/agent-sessions` 只承担 transport adapter 职责
- [ ] 第一批保留 session wrapper，但其职责仅限于 `sessionId` / 持久化 / 读取适配
- [ ] 内部 Rust 调用方已切到新 broker
- [ ] 内部 Rust 调用方对工具执行的责任边界明确，不再依赖旧 runtime 固定工具注册逻辑
- [ ] 第一轮请求返回 `toolCalls` 时，RT 不执行调用方自定义工具
- [ ] 第二轮带 `history + tool_result` 可续跑并得到最终答案
- [ ] Broker 核心测试通过
- [ ] Rust 真上游天气测试在有环境变量时通过、无环境变量时跳过
- [ ] 实际启动 RT 的 HTTP 两步天气测试可复现通过

## 11. 第一批刻意不做的内容

- RT 自动执行调用方工具
- 多模态 content
- 复杂 session 恢复协议
- 并行多轮自动工具循环
- 提案系统联动
- 高级重试/熔断/限流策略

## 12. 风险与注意点

1. 旧 `session.rs` 中已有较多 provider/tool 逻辑，迁移时要避免把新 broker 做成旧逻辑的薄包装。
2. OpenAI-compatible 与 Anthropic 的消息格式不同，broker 内部需要统一抽象，但第一批不应为此引入过大的通用层。
3. HTTP 与内部 Rust 调用必须同步切换，否则第一批就会形成双轨逻辑。
4. 真上游测试可能受到 `429` 干扰，但这不应掩盖 `401` 鉴权错误；两者需要明确区分。
