# 实施计划：Agent API — 第二阶段（稳定化 + 提案联动）

> **状态**：待执行
> **设计文档**：[2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)
> **关联 Issue**：#793
> **前置**：第一阶段已完成（agent/tools + agent/session + routes/agent_sessions + routes/proposals 全部已实现）
> **与 #806 的关系**：#806 聚焦「终端 Agent」（PTY 生命周期），本计划聚焦「API Agent」（HTTP 工具调用框架），两者是 Agent Hub 中的不同交互模式，可并行迭代、互不阻塞
> **与提案系统的关系**：提案系统（UI 名称：「提案集」）也可并行迭代，未来 UI 方向是将提案集整合进「任务」页面

---

## 背景

第一阶段实现了 Agent API 和提案系统的完整 MVP。审查发现以下遗留问题需要在第二阶段解决：

| 问题 | 来源 | 严重程度 |
|------|------|---------|
| 3 个 Agent API 测试稳定失败 | 验证发现 | 🔴 阻塞 |
| LLM 请求无超时控制 | 审查 C-1 | 🟡 风险 |
| 无 429/503 重试机制 | 审查 C-2 | 🟡 风险 |
| Agent API → 提案联动路径缺失 | 审查 C-3 | 🟡 功能缺口 |

---

## 步骤 0：代码探索（执行前必读）

```bash
# 确认当前测试状态
cargo test -p exomind-runtime -- agent::tools agent::session agent_sessions 2>&1 | grep -E "FAILED|ok|test result"

# 定位 3 个失败测试
grep -n "fn get_recent_events_tool_formats" crates/exomind-runtime/src/agent/tools/mod.rs
grep -n "fn run_agent_session_executes_tool" crates/exomind-runtime/src/agent/session.rs
grep -n "fn route_runs_session_with_tools" crates/exomind-runtime/src/routes/agent_sessions.rs

# 查看 reqwest Client 构建方式（检查有无 timeout）
grep -n "Client::new\|ClientBuilder\|timeout" crates/exomind-runtime/src/agent/session.rs

# 查看 fake OpenAI server 实现（测试失败的模拟器）
grep -n "fake_openai_handler" crates/exomind-runtime/src/routes/agent_sessions.rs

# 查看提案系统的创建接口（联动用）
grep -n "pub fn create" crates/exomind-runtime/src/proposal/store.rs | head -5

# 查看 Agent tick 触发点（联动挂载位置）
grep -n "AgentApiTickTrigger\|on_tick" crates/exomind-runtime/src/agent/life.rs | head -10
```

---

## 步骤 1：修复 3 个 Agent API 测试

**目标**：`cargo test -p exomind-runtime -- agent::tools agent::session agent_sessions` 全部通过

**失败分析**（已定位）：

| 测试 | 位置 | 失败原因 |
|------|------|---------|
| `get_recent_events_tool_formats_event_lines` | `tools/mod.rs:142` | 断言 `result.content.contains("整理 runtime 路由")` 失败——EventLogStore 降序排列 + limit 可能导致截断，或 user_id scope 不匹配 |
| `run_agent_session_executes_tool_and_persists_result` | `session.rs:940` | 断言 `left: "assistant" right: "tool"` 失败——fake OpenAI 响应格式与解析逻辑不匹配 |
| `route_runs_session_with_tools_and_persists_result` | `agent_sessions.rs:290` | 断言 `left: 422 right: 201` 失败——HTTP 请求返回 422 而非 201 |

**约束**：
- 修复测试本身的断言或 fake 模拟器，不改动已通过的生产代码
- 如果是模拟器格式问题，对齐到 OpenAI API 的实际响应格式
- 修复后必须 `cargo test -p exomind-runtime` 全量通过（不引入新失败）

### 验收

```bash
cargo test -p exomind-runtime -- agent::tools::tests::get_recent_events_tool_formats_event_lines
cargo test -p exomind-runtime -- agent::session::tests::run_agent_session_executes_tool_and_persists_result
cargo test -p exomind-runtime -- routes::agent_sessions::tests::route_runs_session_with_tools_and_persists_result
# 三个都必须 ok
```

---

## 步骤 2：LLM 请求超时控制

**目标**：Agent API 调用 LLM 时设置合理超时，避免无限挂起

**约束**：
- 在 `session.rs` 中构建 `reqwest::Client` 时设置 `timeout(Duration::from_secs(120))`（2 分钟，LLM 生成可能较慢）
- 超时后返回 `SessionError` 明确标注超时原因
- 不影响现有 `api.rs` 中的 streaming 客户端（那边有自己的超时逻辑）

**定位**：
```bash
grep -n "Client::new\|reqwest::Client" crates/exomind-runtime/src/agent/session.rs
```

### 验收

```bash
cargo check -p exomind-runtime
# 超时行为需要手动验证（配置一个不可达的 base_url，确认 120s 后返回错误而非挂起）
```

---

## 步骤 3：429/503 重试机制

**目标**：Agent API 调用 LLM 遇到 rate limit (429) 或临时不可用 (503) 时自动重试

**约束**：
- 最多重试 2 次，指数退避（1s → 4s）
- 仅对 429 和 503 重试，其他错误码直接返回
- 重试行为记录到 `AgentSessionRecord` 的日志中（可选，加入 tool_calls 或 metadata）
- tick 触发场景：连续 3 次失败后，当前 tick 周期跳过后续调用（避免持续消耗 rate limit）

**定位**：
```bash
# 找到 HTTP 请求发送点
grep -n "client.post\|client.request\|send()" crates/exomind-runtime/src/agent/session.rs | head -10
```

### 验收

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime -- agent::session
# 可选：新增一个测试用例模拟 429 响应 → 验证重试后成功
```

---

## 步骤 4：Agent API → 提案联动

**目标**：Agent 分析完事件后，能自动将建议以提案形式提交到提案系统

**约束**：
- 新增工具 `create_proposal`，注册到 `ToolRegistry`
- 工具参数：`{ title, body, action_type, action_params, references? }`
- 工具执行：调用 `ProposalStore::create_scoped`，publisher 标注为当前 Agent
- 不自动批准——提案创建后等待人类审批
- 与 `get_recent_events` 并列为第二个工具，在 `build_tool_registry` 中注册

**定位**：
```bash
# 现有工具注册
grep -n "build_tool_registry\|register" crates/exomind-runtime/src/agent/session.rs | head -10

# 提案创建接口
grep -n "fn create_scoped\|CreateProposalInput" crates/exomind-runtime/src/proposal/store.rs | head -5
```

**新建文件**：`crates/exomind-runtime/src/agent/tools/proposal.rs`

**参考**：`crates/exomind-runtime/src/agent/tools/eventlog.rs` 的实现模式（43 行，结构清晰）

### 验收

```bash
cargo check -p exomind-runtime
cargo test -p exomind-runtime -- agent::tools

# 端到端验证
curl -X POST http://127.0.0.1:1949/agent-sessions \
  -H "Content-Type: application/json" \
  -d '{"prompt":"分析最近事件，如果发现有未跟踪的工作，创建一个提案建议添加任务","tools":["get_recent_events","create_proposal"]}'
# 预期：Agent 调用 get_recent_events 读取事件 → 调用 create_proposal 创建提案 → 提案出现在 /api/proposals 列表中
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

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| Agent API 测试全通过 | `cargo test -p exomind-runtime -- agent::tools agent::session agent_sessions` | 0 failed |
| 全量测试无回归 | `cargo test -p exomind-runtime` | 原 323 通过的继续通过 |
| LLM 超时 | 配置不可达 base_url 后调用 | 120s 内返回超时错误 |
| 429 重试 | 模拟 429 响应 | 自动重试后成功/最终失败 |
| 提案联动 | Agent 调用 create_proposal 工具 | 提案出现在 /api/proposals |
| `cargo check` | 运行 | 0 errors |

---

## 完成回填

| 步骤 | 状态 | commit | 备注 |
|------|------|--------|------|
| 步骤 1 修复测试 | | | |
| 步骤 2 超时控制 | | | |
| 步骤 3 重试机制 | | | |
| 步骤 4 提案联动 | | | |
