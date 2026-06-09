# 实施计划：Agent API — 第二阶段（稳定化 + 提案联动）

> **状态**：待执行
> **设计文档**：[2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)
> **关联 Issue**：#793
> **前置**：第一阶段结构已在，基线未绿——agent/tools + agent/session + routes/agent_sessions + routes/proposals 全部已实现，但 3 个 Agent API 测试仍红
> **与 #806 的关系**：#806 聚焦「终端 Agent」（PTY 生命周期），本计划聚焦「API Agent」（HTTP 工具调用框架），两者是 Agent Hub 中的不同交互模式，可并行迭代、互不阻塞
> **与提案系统的关系**：提案系统（UI 名称：「提案集」）也可并行迭代，未来 UI 方向是将提案集整合进「任务」页面

---

## 背景

第一阶段实现了 Agent API 和提案系统的 MVP 结构。但测试基线尚未全绿，且审查发现以下遗留问题：

| 问题 | 来源 | 严重程度 |
|------|------|---------|
| 3 个 Agent API 测试稳定失败 | 验证发现 | 🔴 阻塞 |
| OpenAI/Anthropic 请求逻辑分散，无共享 helper | 代码审查 | 🟡 结构债务 |
| LLM 请求无超时控制 | 审查 C-1 | 🟡 风险 |
| 无 429/503 重试机制 | 审查 C-2 | 🟡 风险 |
| Agent API → 提案联动路径缺失 | 审查 C-3 | 🟡 功能缺口 |

**执行顺序**：步骤 1 → 2a → 2b → 3a →（可选 3b）→ 4，不建议并行——当前 3 个测试红着，后续改动会放大噪音。

---

## 步骤 0：代码探索（执行前必读）

```bash
# 确认当前测试状态（预期 3 失败）
cargo test -p exomind-runtime -- agent::tools agent::session agent_sessions 2>&1 | grep -E "FAILED|ok|test result"

# 定位 3 个失败测试
grep -n "fn get_recent_events_tool_formats" crates/exomind-runtime/src/agent/tools/mod.rs
grep -n "fn run_agent_session_executes_tool" crates/exomind-runtime/src/agent/session.rs
grep -n "fn route_runs_session_with_tools" crates/exomind-runtime/src/routes/agent_sessions.rs

# 理解 session.rs 中两个 provider 分支的请求逻辑
grep -n "fn run_openai_single_shot\|fn run_anthropic_single_shot\|fn send_openai_request\|fn send_anthropic_request" \
  crates/exomind-runtime/src/agent/session.rs

# 查看 reqwest Client 构建方式（检查有无 timeout）
grep -n "Client::new\|ClientBuilder\|timeout" crates/exomind-runtime/src/agent/session.rs

# 查看 AgentSessionRuntime 结构（步骤 4 需要扩展）
grep -A 10 "struct AgentSessionRuntime" crates/exomind-runtime/src/agent/session.rs

# 查看 build_tool_registry_for_runtime 的 match 分支（步骤 4 需要扩展）
grep -A 15 "fn build_tool_registry_for_runtime" crates/exomind-runtime/src/agent/session.rs

# 查看 ApiProviderProfile 的 serde 配置（步骤 1 的 422 根因）
grep -B 2 -A 8 "struct ApiProviderProfile" crates/exomind-runtime/src/agent/api.rs
grep -B 2 -A 4 "struct RunAgentSessionRequest" crates/exomind-runtime/src/routes/agent_sessions.rs

# 查看提案系统的创建接口（步骤 4 联动用）
grep -n "fn create_scoped\|CreateProposalInput" crates/exomind-runtime/src/proposal/store.rs | head -5

# 查看 AgentApiTickTrigger 结构（步骤 3b 熔断相关）
grep -A 20 "struct AgentApiTickTrigger" crates/exomind-runtime/src/agent/life.rs
```

---

## 步骤 1：修复 3 个 Agent API 测试

**目标**：`cargo test -p exomind-runtime -- agent::tools agent::session agent_sessions` 全部通过

**失败根因分析**：

### 1a. `route_runs_session_with_tools_and_persists_result`（agent_sessions.rs:290）

**现象**：返回 422 而非 201

**根因**：serde `rename_all` 不一致。`RunAgentSessionRequest`（agent_sessions.rs:14）标注了 `#[serde(rename_all = "camelCase")]`，所以外层字段如 `providerProfile` 用 camelCase 可以正确解析。但内嵌的 `ApiProviderProfile`（api.rs:73）没有任何 `rename_all` 标注——它的字段名 `base_url`、`api_key` 是 snake_case。如果测试请求体以 camelCase 传 `baseUrl`/`apiKey`，内层反序列化会失败，导致 422。

**定位**：
```bash
# 对比外层和内层的 serde 配置
grep -B 2 "struct RunAgentSessionRequest" crates/exomind-runtime/src/routes/agent_sessions.rs
grep -B 2 "struct ApiProviderProfile" crates/exomind-runtime/src/agent/api.rs
# 查看测试中传入的请求体格式
grep -A 20 "fn route_runs_session_with_tools" crates/exomind-runtime/src/routes/agent_sessions.rs
```

**修复方向**：给 `ApiProviderProfile` 加 `#[serde(rename_all = "camelCase")]`，或在测试请求体中用 snake_case。需评估哪个方向对现有调用方影响更小。

### 1b. `run_agent_session_executes_tool_and_persists_result`（session.rs:940）

**现象**：`assert_eq!(payload["messages"][2]["role"], "tool")` 失败，实际值为 `"assistant"`

**根因**：mock handler 假设第二次请求的 `messages[2]` 是 `role: "tool"` 的工具结果。但实际 `run_openai_single_shot`（session.rs:576-588）先 push assistant 消息（包含 tool_use），再逐个 push `role: "tool"` 的工具结果。所以 `messages[2]` 是 assistant 而非 tool，`messages[3]` 才是 tool。

**定位**：
```bash
# 查看实际消息构建逻辑
sed -n '570,593p' crates/exomind-runtime/src/agent/session.rs
# 查看 mock handler 的断言
sed -n '938,945p' crates/exomind-runtime/src/agent/session.rs
```

**修复方向**：将 mock handler 的断言改为检查 `messages[3]["role"] == "tool"` 或用 `.iter().any()` 查找 tool 消息。

### 1c. `get_recent_events_tool_formats_event_lines`（tools/mod.rs:142）

**现象**：`result.content.contains("整理 runtime 路由")` 返回 false

**根因不确定**——需先诊断实际输出。

**定位**：
```bash
# 先在测试中临时加 eprintln! 或 dbg! 打印 result.content
# 确认：是否为空？是否只包含一条？是否格式不同？
sed -n '130,145p' crates/exomind-runtime/src/agent/tools/mod.rs
# 检查 EventLogStore 的 JSON 文件后端排序行为
grep -n "sort\|reverse\|desc" crates/exomind-runtime/src/eventlog.rs | head -10
```

**修复方向**：先打印实际输出确认根因，再决定是修工具实现的排序/scope 逻辑，还是修测试断言。**允许修改实现代码**。

### 约束

- **允许修改测试代码和实现代码**，只要不破坏已通过的其他测试
- 修复后必须 `cargo test -p exomind-runtime` 全量通过（不引入新失败）

### 验收

```bash
cargo test -p exomind-runtime -- agent::tools::tests::get_recent_events_tool_formats_event_lines
cargo test -p exomind-runtime -- agent::session::tests::run_agent_session_executes_tool_and_persists_result
cargo test -p exomind-runtime -- routes::agent_sessions::tests::route_runs_session_with_tools_and_persists_result
# 三个都必须 ok

# 全量回归
cargo test -p exomind-runtime 2>&1 | grep "test result"
# 预期：0 failed
```

---

## 步骤 2a：抽取共享 HTTP provider request helper

**目标**：将 OpenAI/Anthropic 的 HTTP 请求逻辑抽取为共享函数，为后续加 timeout/retry 提供统一注入点

**现状**：`run_openai_single_shot`（session.rs:553）和 `run_anthropic_single_shot`（session.rs:595）各自独立构建 `reqwest::Client` 和发送请求。`send_openai_request` 和 `send_anthropic_request` 是底层 HTTP 调用。

**改动**：
- 提取一个 `create_llm_client() -> reqwest::Client`（或 `LlmHttpClient` struct），集中管理 `timeout`、`default_headers` 等配置
- `send_openai_request` 和 `send_anthropic_request` 改为接收该 client 实例
- 后续步骤 2b/3a 在此 helper 上加 timeout 和 retry，只改一处

**定位**：
```bash
grep -n "Client::new\|reqwest::Client" crates/exomind-runtime/src/agent/session.rs
grep -n "fn send_openai_request\|fn send_anthropic_request" crates/exomind-runtime/src/agent/session.rs
```

**约束**：
- 提取是纯重构，不改变任何行为
- 提取后 3 个修复的测试仍通过

### 验收

```bash
cargo test -p exomind-runtime -- agent::session agent_sessions 2>&1 | grep "test result"
# 0 failed
```

---

## 步骤 2b：LLM 请求超时控制

**目标**：Agent API 调用 LLM 时设置合理超时，避免无限挂起

**改动**：
- 在步骤 2a 抽取的 `create_llm_client` 中设置 `timeout(Duration::from_secs(120))`
- 超时后返回 `SessionError::RequestFailed` 明确标注超时原因
- 不影响 `api.rs` 中的 streaming 客户端（那边有自己的超时逻辑）

### 验收

```bash
cargo check -p exomind-runtime

# 自动化测试：新增测试用例
# 启动一个 mock server 延迟 5 秒响应，设置 client timeout 为 2 秒
# 断言返回 SessionError 且 message 包含 "timeout" 或 "timed out"
cargo test -p exomind-runtime -- agent::session::tests::llm_request_times_out
```

---

## 步骤 3a：429/503 重试机制

**目标**：Agent API 调用 LLM 遇到 rate limit (429) 或临时不可用 (503) 时自动重试

**改动**：
- 在步骤 2a 的 provider request helper 中加入重试逻辑
- 最多重试 2 次，指数退避（1s → 4s）
- 仅对 429 和 503 重试，其他错误码直接返回
- 重试行为写入 `AgentSessionRecord.metadata` 的 `retry_attempts` 字段（类型 `u32`），不改 schema 表结构——`metadata` 已是 JSON TEXT 列

**定位**：
```bash
# 确认 AgentSessionRecord 的 metadata 字段
grep -n "metadata" crates/exomind-runtime/src/agent/session.rs | head -10
# 确认现有 HTTP 错误处理
grep -n "status()\|StatusCode\|is_success" crates/exomind-runtime/src/agent/session.rs | head -10
```

### 验收

```bash
# 强制自动化测试（非可选）：
# 新增测试用例：mock server 第一次返回 429，第二次返回 200
# 断言最终成功且 metadata.retry_attempts == 1
cargo test -p exomind-runtime -- agent::session::tests::retries_on_429

# 新增测试用例：mock server 连续 3 次返回 429
# 断言最终失败且 metadata.retry_attempts == 2
cargo test -p exomind-runtime -- agent::session::tests::gives_up_after_max_retries
```

---

## 步骤 3b（可选，可延后）：tick 触发熔断

**目标**：tick 触发的 Agent 调用连续失败时临时跳过，避免持续消耗 rate limit

**现状**：`AgentApiTickTrigger`（life.rs:40-73）只有 `min_energy_ratio` 阈值，没有失败计数或熔断状态。

**改动**：
- 在 `AgentApiTickTrigger` 中新增 `consecutive_failures: AtomicU32` 字段
- `should_run` 增加判断：`consecutive_failures >= 3` 时返回 false
- 成功调用后重置为 0

**注意**：这是一个额外设计点，不是在 send request 上顺手加。如果本批次时间不足，可延后到下一批次。

### 验收

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime -- agent::life
```

---

## 步骤 4：Agent API → 提案联动

**目标**：Agent 分析完事件后，能自动将建议以提案形式提交到提案系统

### 4a. 扩展 `AgentSessionRuntime`

**现有结构**（session.rs:23-28）：
```rust
pub struct AgentSessionRuntime {
    pub config_store: Arc<ConfigStore>,
    pub eventlog_store: Arc<EventLogStore>,
    pub agent_api_session_store: Arc<AgentSessionStore>,
}
```

**改为**：
```rust
pub struct AgentSessionRuntime {
    pub config_store: Arc<ConfigStore>,
    pub eventlog_store: Arc<EventLogStore>,
    pub agent_api_session_store: Arc<AgentSessionStore>,
    pub proposal_store: Arc<ProposalStore>,  // ★ 新增
}
```

**同步修改**：
- `AgentSessionRuntime::new()` — 新增 `proposal_store` 参数
- `AgentSessionRuntime::from_state()` — 从 `state.proposal_store` clone
- 所有调用 `AgentSessionRuntime::new` 或 `from_state` 的地方（搜索确认）

**定位**：
```bash
grep -n "AgentSessionRuntime::new\|AgentSessionRuntime::from_state\|AgentSessionRuntime {" \
  crates/exomind-runtime/src/ -r | head -20
```

### 4b. 新建 `create_proposal` 工具

**新建文件**：`crates/exomind-runtime/src/agent/tools/proposal.rs`

**参考**：`agent/tools/eventlog.rs` 的实现模式

**工具签名**：
```json
{
  "name": "create_proposal",
  "description": "向提案集提交一条待审批的操作建议",
  "input_schema": {
    "type": "object",
    "required": ["title", "action_type", "action_params"],
    "properties": {
      "title": { "type": "string" },
      "body": { "type": "string" },
      "action_type": { "enum": ["create_task", "append_event", "start_timeblock"] },
      "action_params": { "type": "object" },
      "references": { "type": "array", "items": { "$ref": "#ProposalRef" } }
    }
  }
}
```

**实现要点**：
- 调用 `ProposalStore::create_scoped(scope_key, input)`
- `scope_key` 沿用当前 session 的 scope 语义（从 `run_agent_session` 的 `user_id` 参数透传）
- `publisher` 映射为 `Publisher { publisher_type: Agent, id: "agent-api", name: "Agent API" }`
- 不自动批准——提案创建后等待人类审批

### 4c. 注册到 `build_tool_registry_for_runtime`

**现有代码**（session.rs:357-366）只有一个 match 分支：
```rust
match tool_name.as_str() {
    GET_RECENT_EVENTS_TOOL => { ... }
    other => return Err(SessionError::UnsupportedTool(...))
}
```

**改为**：
```rust
match tool_name.as_str() {
    GET_RECENT_EVENTS_TOOL => { ... }
    CREATE_PROPOSAL_TOOL => {
        let (def, tool_fn) = create_proposal_tool(
            Arc::clone(&runtime.proposal_store),
            user_id.clone(),
        );
        registry.register(def, tool_fn);
    }
    other => return Err(SessionError::UnsupportedTool(...))
}
```

**同步修改**：
- `tools/mod.rs` 新增 `pub mod proposal;` 和 `pub const CREATE_PROPOSAL_TOOL: &str = "create_proposal";`

### 4d. 测试

**工具级测试**（tools/mod.rs 或 tools/proposal.rs）：
- 调用 `create_proposal` 工具，验证提案出现在 `ProposalStore` 中
- 验证 publisher 正确标注为 Agent

**路由级联动测试**（agent_sessions.rs）：
- `POST /agent-sessions` 带 `tools: ["get_recent_events", "create_proposal"]`
- mock LLM 返回 tool_use 调用 `create_proposal`
- 验证 `/api/proposals` 列表中出现新提案

### 验收

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime -- agent::tools
cargo test -p exomind-runtime -- agent_sessions

# 端到端验证（需 LLM API Key）
curl -X POST http://127.0.0.1:1949/agent-sessions \
  -H "Content-Type: application/json" \
  -d '{"prompt":"分析最近事件，如果发现有未跟踪的工作，创建一个提案建议添加任务","tools":["get_recent_events","create_proposal"]}'

# 验证提案创建
curl http://127.0.0.1:1949/api/proposals | jq '.[] | select(.publisher.id == "agent-api")'
```

---

## ⚠️ 不要做

| 禁止项 | 原因 |
|--------|------|
| 不改动已通过的提案系统测试（7/7） | 回归风险 |
| 不改动 `api.rs` 的 streaming 逻辑 | 与终端 Agent (#806) 的工作域冲突 |
| 不添加前端 UI | 本阶段纯 RT 端 |
| 不实现完整 agentic loop | 维持单次调用模式 |
| 不碰 PTY 相关代码 | #806 的工作域 |

---

## 验证总表

| 场景 | 操作 | 期望结果 | 类型 |
|------|------|---------|------|
| 3 个红测修绿 | `cargo test -- agent::tools agent::session agent_sessions` | 0 failed | 自动化 |
| 全量回归 | `cargo test -p exomind-runtime` | 原通过的继续通过 | 自动化 |
| 超时控制 | mock server 延迟 > timeout | 返回超时错误 | **自动化测试** |
| 429 重试成功 | mock 第 1 次 429，第 2 次 200 | 最终成功，retry_attempts=1 | **自动化测试** |
| 重试耗尽 | mock 连续 3 次 429 | 最终失败，retry_attempts=2 | **自动化测试** |
| create_proposal 工具 | 工具级调用 | ProposalStore 中出现提案 | **自动化测试** |
| 提案联动 e2e | `POST /agent-sessions` 带两个工具 | `/api/proposals` 出现新提案 | **自动化测试** |
| `cargo check` | 运行 | 0 errors | 自动化 |

---

## 完成回填

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 修复 3 个红测 | | | |
| 步骤 2a 抽取 HTTP helper | | | |
| 步骤 2b 超时控制 | | | |
| 步骤 3a 429/503 重试 | | | |
| 步骤 3b tick 熔断（可选） | | | |
| 步骤 4a 扩展 AgentSessionRuntime | | | |
| 步骤 4b 新建 create_proposal 工具 | | | |
| 步骤 4c 注册到 build_tool_registry | | | |
| 步骤 4d 测试 | | | |
