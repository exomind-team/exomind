# 实施计划：Agent API — RT 逻辑端

> **状态**：待执行
> **设计文档**：[2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)
> **关联 Issue**：#793
> **分支**：`feature/agent-api`
> **验收标准**：RT 内部触发 cognition Agent，Agent 调用 `get_recent_events(20)` 获取近期事件，基于内容输出分析文本，结果返回给触发方并持久化到 RT 数据库

---

## 步骤 0：代码探索（执行前必读）

```bash
# 确认现有 api.rs 的 streaming 实现（stream_openai_turn / stream_anthropic_turn）
grep -n "fn stream_openai_turn\|fn stream_anthropic_turn\|fn handle_chat_request" \
  crates/exomind-runtime/src/agent/api.rs

# 确认 ApiProviderProfile 结构
grep -n "struct ApiProviderProfile\|ApiAgent::managed" \
  crates/exomind-runtime/src/agent/api.rs | head -10

# 确认现有 eventlog 读取接口
grep -n "fn list_events\|fn get_event" \
  crates/exomind-runtime/src/eventlog/ -r | head -10

# 确认 cognition/life agent 的触发机制
cat crates/exomind-runtime/src/agent/cognition.rs | head -60
cat crates/exomind-runtime/src/agent/life.rs | head -60

# 确认 AppState 字段（用于在 AgentSession 中注入依赖）
grep -A 30 "struct AppState" crates/exomind-runtime/src/lib.rs

# 确认 SQLite 存储模式（参考 eventlog_sqlite.rs 的建表和查询方式）
head -100 crates/exomind-runtime/src/eventlog_sqlite.rs
```

---

## Phase 1：工具定义层

### 步骤 1：Tool 类型定义

**新建文件**：`crates/exomind-runtime/src/agent/tools/mod.rs`

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;

/// 工具定义（传给 LLM 的 schema）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,   // JSON Schema object
}

/// 工具调用请求（LLM 返回的）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUse {
    pub id: String,            // LLM 生成的调用 ID（用于匹配 tool_result）
    pub name: String,
    pub input: Value,
}

/// 工具调用结果（回传给 LLM 的）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_use_id: String,   // 匹配 ToolUse.id
    pub content: String,       // 文本结果
}

/// 工具执行函数类型
pub type ToolFn = Box<
    dyn Fn(Value) -> Pin<Box<dyn Future<Output = Result<String, ToolError>> + Send>>
    + Send + Sync
>;

#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("execution failed: {0}")]
    ExecutionFailed(String),
}

/// 工具注册表
pub struct ToolRegistry {
    defs: Vec<ToolDef>,
    fns: std::collections::HashMap<String, ToolFn>,
}

impl ToolRegistry {
    pub fn new() -> Self { Self { defs: vec![], fns: Default::default() } }

    pub fn register(&mut self, def: ToolDef, f: ToolFn) {
        self.fns.insert(def.name.clone(), f);
        self.defs.push(def);
    }

    pub fn list_defs(&self) -> &[ToolDef] { &self.defs }

    pub async fn dispatch(&self, tool_use: &ToolUse) -> ToolResult {
        match self.fns.get(&tool_use.name) {
            None => ToolResult {
                tool_use_id: tool_use.id.clone(),
                content: format!("Unknown tool: {}", tool_use.name),
            },
            Some(f) => {
                let content = match f(tool_use.input.clone()).await {
                    Ok(s) => s,
                    Err(e) => format!("Tool error: {}", e),
                };
                ToolResult { tool_use_id: tool_use.id.clone(), content }
            }
        }
    }
}
```

#### 1.2 验证

```bash
cargo check -p exomind-runtime
```

---

### 步骤 2：get_recent_events 工具实现

**新建文件**：`crates/exomind-runtime/src/agent/tools/eventlog.rs`

```rust
use super::{ToolDef, ToolFn, ToolError};
use crate::eventlog::EventLogStore;
use serde_json::{json, Value};
use std::sync::Arc;

/// 构建 get_recent_events 工具
/// - eventlog_store: RT 的事件日志存储
pub fn get_recent_events_tool(eventlog_store: Arc<EventLogStore>) -> (ToolDef, ToolFn) {
    let def = ToolDef {
        name: "get_recent_events".to_string(),
        description: "获取事件日志中最近 N 条事件，按时间倒序返回".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "返回条数，默认 20，最大 100",
                    "minimum": 1,
                    "maximum": 100
                }
            }
        }),
    };

    let f: ToolFn = Box::new(move |input: Value| {
        let store = eventlog_store.clone();
        Box::pin(async move {
            let limit = input.get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(20)
                .min(100) as usize;

            let events = store
                .list_events(Some(crate::eventlog::EventLogListOptions { limit: Some(limit), ..Default::default() }))
                .await
                .map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;

            if events.is_empty() {
                return Ok("（暂无事件记录）".to_string());
            }

            // 格式化为 LLM 友好的文本
            let formatted = events.iter()
                .map(|e| format!("[{}] {} (tags: {})",
                    e.timestamp,
                    e.content,
                    e.tags.join(", ")
                ))
                .collect::<Vec<_>>()
                .join("\n");

            Ok(formatted)
        })
    });

    (def, f)
}
```

#### 2.2 验证

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime agent::tools
```

---

## Phase 2：AgentSession 服务层

### 步骤 3：AgentSession 核心实现

**新建文件**：`crates/exomind-runtime/src/agent/session.rs`

**核心概念**：单次调用模式（Single-Shot）——RT 触发 → Agent 思考 → 可能调用工具 → 返回结果

```rust
use super::api::{ApiProviderProfile, ApiAgent};
use super::tools::{ToolRegistry, ToolUse};
use crate::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 单次 Agent 调用的结果
#[derive(Debug, Serialize)]
pub struct AgentSessionResult {
    pub session_id: String,
    pub content: String,           // 最终输出文本
    pub tool_calls: Vec<ToolCallRecord>, // 调用了哪些工具
    pub created_at: String,
    pub completed_at: String,
}

#[derive(Debug, Serialize)]
pub struct ToolCallRecord {
    pub tool_name: String,
    pub input: Value,
    pub output: String,
}

/// 触发来源
pub enum AgentTrigger {
    Internal { source: String },   // cognition/life agent 内部触发
    HttpRequest,                    // HTTP API 触发
}

/// Agent 单次调用（Single-Shot Mode）
///
/// 不强制循环——模型在一次（或少量轮次）内思考并择机调用工具后返回。
pub async fn run_agent_session(
    profile: ApiProviderProfile,
    system_prompt: Option<String>,
    user_prompt: String,
    tools: &ToolRegistry,
    trigger: AgentTrigger,
    state: &AppState,
) -> Result<AgentSessionResult, SessionError> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = Utc::now();
    let mut tool_calls = vec![];

    // 构建初始消息
    let mut messages = vec![
        json!({"role": "user", "content": user_prompt})
    ];

    // 调用 LLM（携带工具列表）
    // 注意：调用现有 api.rs 中的 stream_openai_turn 或 stream_anthropic_turn
    // 或提取其核心 HTTP 调用逻辑为可复用函数
    let response = call_llm_with_tools(
        &profile,
        system_prompt.as_deref(),
        &messages,
        tools.list_defs(),
    ).await?;

    let final_content = if response.stop_reason == "tool_use" {
        // 执行工具调用
        let tool_uses: Vec<ToolUse> = extract_tool_uses(&response.content);

        for tool_use in &tool_uses {
            let result = tools.dispatch(tool_use).await;
            tool_calls.push(ToolCallRecord {
                tool_name: tool_use.name.clone(),
                input: tool_use.input.clone(),
                output: result.content.clone(),
            });

            // 将工具结果追加到消息历史
            messages.push(json!({"role": "assistant", "content": response.content}));
            messages.push(json!({
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": result.tool_use_id, "content": result.content}]
            }));
        }

        // 用工具结果再次调用模型（无工具列表，仅让其总结）
        let final_response = call_llm_with_tools(&profile, system_prompt.as_deref(), &messages, &[]).await?;
        extract_text_content(&final_response.content)
    } else {
        extract_text_content(&response.content)
    };

    let result = AgentSessionResult {
        session_id: session_id.clone(),
        content: final_content,
        tool_calls,
        created_at: created_at.to_rfc3339(),
        completed_at: Utc::now().to_rfc3339(),
    };

    // 持久化到 RT 数据库
    persist_session(&state, &result).await?;

    Ok(result)
}
```

**注意事项**：
1. `call_llm_with_tools` 需要提取自 `api.rs` 中 `stream_openai_turn` / `stream_anthropic_turn` 的核心逻辑
   - 先检查 `api.rs` 第 223 行 `stream_openai_turn` 的参数结构，评估是否可直接复用
   - 如果 streaming 逻辑无法直接复用，实现一个 non-streaming 版本
2. OpenAI 与 Anthropic 的工具格式不同：
   - OpenAI：`tools: [{type: "function", function: {name, description, parameters}}]`
   - Anthropic：`tools: [{name, description, input_schema}]`
3. `extract_tool_uses` 需要区分 provider 格式解析

#### 3.2 验证

```bash
cargo check -p exomind-runtime
```

---

### 步骤 4：会话持久化

**在 `session.rs` 中实现 `persist_session`**（或新建 `session_store.rs`）

参考 `eventlog_sqlite.rs` 的存储模式，建表：

```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id   TEXT PRIMARY KEY,
    trigger_source TEXT NOT NULL DEFAULT 'unknown',
    prompt       TEXT NOT NULL,
    content      TEXT NOT NULL,   -- 最终输出
    tool_calls   TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
    status       TEXT NOT NULL DEFAULT 'completed',  -- completed | failed
    created_at   TEXT NOT NULL,
    completed_at TEXT NOT NULL
);
```

#### 4.2 验证

```bash
cargo test -p exomind-runtime agent::session
```

---

## Phase 3：触发接入

### 步骤 5：HTTP 触发端点

**新建文件**：`crates/exomind-runtime/src/routes/agent_sessions.rs`

```rust
// POST /api/agent-sessions
// 允许外部通过 HTTP 触发一次 Agent 调用
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agent-sessions", post(run_session))
        .route("/agent-sessions/:id", get(get_session_result))
}
```

**在 `routes/mod.rs` 注册**：

```rust
pub mod agent_sessions;  // ★ 新增
// ...
.merge(agent_sessions::router())  // ★ 新增
```

**手动验证**：

```bash
# 触发一次 Agent 调用
curl -s -X POST http://127.0.0.1:1949/api/agent-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "分析我最近的事件日志，告诉我我最近在做什么",
    "tools": ["get_recent_events"]
  }' | jq .

# 验证会话结果
curl -s http://127.0.0.1:1949/api/agent-sessions/{session_id} | jq .
```

---

### 步骤 6：内部触发接入（cognition agent）

**修改文件**：`crates/exomind-runtime/src/agent/cognition.rs`

在 `on_tick` 或 `on_signal` 中接入 `run_agent_session`：

```rust
// 在 cognition agent 的 on_tick 中
async fn on_tick(&self, energy: &AgentEnergySnapshot) -> Vec<SignalEvent> {
    // 构建工具注册表
    let tools = build_default_tool_registry(&self.state);

    let result = run_agent_session(
        self.provider_profile.clone(),
        Some("你是外心助理，帮助用户分析近期活动并给出建议".to_string()),
        "请分析最近 20 条事件，用一段话总结用户近期的主要活动".to_string(),
        &tools,
        AgentTrigger::Internal { source: "cognition-tick".to_string() },
        &self.state,
    ).await;

    // 结果可发布为信号或写入提案
    vec![]
}
```

**前置检查**：
```bash
grep -n "struct CognitionAgent\|impl Agent for\|on_tick\|AppState" \
  crates/exomind-runtime/src/agent/cognition.rs | head -20
```

#### 6.2 验证

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime agent::cognition
```

---

## ⚠️ 容易出错的关键点

1. **OpenAI vs Anthropic 工具格式差异**
   - OpenAI：`tools[].function.parameters`（JSON Schema）
   - Anthropic：`tools[].input_schema`（JSON Schema）
   - 需要在 `call_llm_with_tools` 中根据 provider 分别构建请求体

2. **工具调用 ID 匹配**
   - Anthropic 在 `content[]` 中同时返回文本和 `tool_use` 块
   - 回传 `tool_result` 时必须匹配 `tool_use_id`，否则 API 报错

3. **复用 api.rs 的 HTTP 调用逻辑**
   - `stream_openai_turn`（第 223 行）和 `stream_anthropic_turn`（第 286 行）是 streaming 模式
   - AgentSession 需要 non-streaming 版本：建议提取公共 HTTP client 逻辑，避免重复
   - 先检查 `api.rs` 是否已有 non-streaming 路径

4. **单次调用 vs 完整循环**
   - 本实现为单次工具调用（工具结果 → 最终输出），不做递归循环
   - 如果模型在第二次回复中又请求工具，MVP 阶段忽略，直接取文本输出

5. **ToolRegistry 线程安全**
   - `ToolRegistry` 需要 `Send + Sync`，工具函数也需要满足此约束
   - 使用 `Arc<EventLogStore>` 而非裸引用

6. **LLM API Key 获取**
   - 从 `AppState.config_store` 获取当前 LLM 设置（apiKey/baseUrl/model）
   - 参考 `crates/exomind-runtime/src/agent/api.rs` 中 `ApiProviderProfile` 的构建方式

---

## 验证总表

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| HTTP 触发 | `POST /api/agent-sessions` | 返回 session_id 和分析文本 |
| 工具调用记录 | 查看 session 结果 | `tool_calls` 包含 `get_recent_events` 的调用记录 |
| 持久化 | RT 重启后查询 | 历史 session 仍可读取 |
| 内部触发 | cognition agent tick | 无报错，session 写入数据库 |
| LLM 无 API Key | 触发时未配置 | 返回明确错误，不 panic |
| `cargo check` | 运行 | 0 errors |
| `cargo test` | 运行 agent 相关测试 | 0 failed |

---

## 完成回填

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 Tool 类型定义 | | | |
| 步骤 2 get_recent_events 工具 | | | |
| 步骤 3 AgentSession 核心 | | | |
| 步骤 4 会话持久化 | | | |
| 步骤 5 HTTP 触发端点 | | | |
| 步骤 6 cognition 内部触发 | | | |
