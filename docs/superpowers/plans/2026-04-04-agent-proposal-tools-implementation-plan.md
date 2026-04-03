# Agent Proposal Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the real external API Agent read realistic event-log-style context, choose among Rust-side proposal tools, and create proposal drafts in `ProposalStore`, with at least one real `create_task` proposal verified in tests.

**Architecture:** Keep #823's broker model unchanged: the caller defines tools per turn, the broker forwards tool definitions and history to the upstream LLM, and the Rust caller executes returned tool calls and continues the turn. Add a reusable Rust proposal-tool helper that can be used both by integration tests and by internal Rust callers such as `agent/life.rs`, then validate it with one deterministic fake-provider contract test and one real-upstream regression test.

**Tech Stack:** Rust, Tokio, Serde JSON, Reqwest, existing ExoMind broker/session runtime, `ProposalStore`, `cargo test`, real upstream OpenAI-compatible provider from `~/.codex`

---

## File Map

### New files

- `crates/exomind-runtime/src/agent/proposal_tools.rs`
  - Shared proposal-tool definitions
  - Input parsing / validation for proposal tool calls
  - Mapping from broker `ToolCall` to `CreateProposalInput`
  - Shared execution helper that writes into `ProposalStore`
- `docs/testing/agent-turn-broker-proposal-tools.md`
  - Post-implementation execution and evidence guide for the proposal-tool story

### Modified files

- `crates/exomind-runtime/src/agent/mod.rs`
  - Export the new proposal tool helper module
- `crates/exomind-runtime/src/agent/session.rs`
  - Extend `AgentSessionRuntime` to carry `proposal_store`
  - Update runtime constructors and call sites
- `crates/exomind-runtime/src/agent/life.rs`
  - Reuse the shared proposal-tool helper for internal Rust callers
  - Keep `get_recent_events` working unchanged
- `crates/exomind-runtime/tests/agent_api_rt.rs`
  - Add deterministic fake-provider proposal story contract test
  - Add real-upstream proposal story regression test
  - Add proposal-tool execution helpers and evidence logging

### Existing references to inspect while implementing

- `crates/exomind-runtime/src/agent/broker.rs`
- `crates/exomind-runtime/src/agent/life.rs`
- `crates/exomind-runtime/src/agent/session.rs`
- `crates/exomind-runtime/src/proposal/mod.rs`
- `crates/exomind-runtime/src/proposal/store.rs`
- `crates/exomind-runtime/src/proposal/executor.rs`
- `crates/exomind-runtime/tests/agent_api_rt.rs`
- `docs/superpowers/specs/2026-04-03-agent-file-search-tools-design.md`
- `docs/superpowers/plans/2026-04-03-agent-file-search-tools-implementation-plan.md`
- GitHub issues: `#830`, `#823`, `#677`

## Shared Story Contract

The story we are implementing and testing is:

1. A Rust caller sends realistic event-log-style context to the external API Agent.
2. The Agent receives three proposal tools:
   - `add_task_proposal`
   - `add_timeblock_proposal`
   - `add_event_proposal`
3. The Agent reads the context and chooses which draft(s) to create.
4. The Rust caller executes the tool call by writing into the real `ProposalStore`.
5. The Rust caller sends the `assistant(tool_call) + tool_result + prior history` back to the broker.
6. The Agent returns a final natural-language summary grounded in the created draft(s).

The core event-log narrative used by the tests must include at least:

- `对了，明天可能要验收下任务依赖图新布局`
- A recent completion/summarization cue such as `完成一个时间块，准备开始总结`
- Recent repository progress context derived from current `dev` commits, for example:
  - `test(rt): add broker file search validation`
  - `feat(task-dag): unify dag text and tag search`
  - `feat(task-dag): land batch q interaction upgrades`

The system prompt should frame the model as a proposal-drafting assistant that must:

- extract concrete next actions from event-log context
- prefer creating structured drafts via tools instead of free-form promises
- create a task proposal when the context implies a follow-up deliverable
- create a timeblock proposal when the context implies scheduled focused work
- create an event proposal when the context implies logging a summary / milestone / reflection
- avoid guessing facts not present in the provided context

## Tool Contract To Freeze

Use three semantic tools rather than one generic `create_proposal` tool. This keeps the LLM-facing schema smaller, aligns better with the existing `ActionType` enum, and makes the real-upstream test easier to stabilize.

### `add_task_proposal`

Input shape:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "body": { "type": "string" },
    "taskTitle": { "type": "string" },
    "description": { "type": "string" },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "priority": {
      "type": "string",
      "enum": ["low", "medium", "high"]
    }
  },
  "required": ["title", "body", "taskTitle"],
  "additionalProperties": false
}
```

Store mapping:

- `action_type = ActionType::CreateTask`
- `action_params = CreateTaskParams`

### `add_timeblock_proposal`

Input shape:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "body": { "type": "string" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "mode": { "type": "string" },
    "targetMinutes": {
      "type": "integer",
      "minimum": 1
    },
    "taskIds": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["title", "body", "name"],
  "additionalProperties": false
}
```

Store mapping:

- `action_type = ActionType::StartTimeblock`
- `action_params = StartTimeblockParams`

### `add_event_proposal`

Input shape:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "body": { "type": "string" },
    "content": { "type": "string" },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["title", "body", "content"],
  "additionalProperties": false
}
```

Store mapping:

- `action_type = ActionType::AppendEvent`
- `action_params = AppendEventParams`

### Tool result contract

Every successful tool execution should return a short JSON string payload that is useful both to the model and to the tests:

```json
{
  "proposalId": 1,
  "status": "pending",
  "actionType": "create_task",
  "title": "验收任务依赖图新布局",
  "scopeKey": "profile-alpha"
}
```

Every failed tool execution should return a stable error string starting with:

```text
Tool error:
```

Use a stable publisher identity for tool-created drafts unless the caller explicitly overrides it. Recommended default:

```rust
Publisher {
    publisher_type: PublisherType::Agent,
    id: "api-agent".to_string(),
    name: "API Agent".to_string(),
}
```

## Task 1: Add Deterministic Failing Contract Test First

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Add a scripted fake-provider proposal story test**

Add a new test near the existing broker tests:

```rust
#[tokio::test]
async fn broker_proposal_story_contract_creates_real_proposals() {}
```

The fake provider should script this sequence:

1. first turn requests `add_task_proposal`
2. second turn requests `add_timeblock_proposal`
3. third turn requests `add_event_proposal`
4. fourth turn returns final Chinese summary mentioning the created drafts

The test harness must execute tool calls through the real shared proposal helper and query the real in-memory `ProposalStore`.

- [ ] **Step 2: Build the narrative fixture inside the test**

Use an explicit multi-line context string containing:

```text
2026-04-04 09:10 事件：刚推送 test(rt): add broker file search validation
2026-04-04 09:35 事件：feat(task-dag): unify dag text and tag search 已在 dev
2026-04-04 10:20 事件：对了，明天可能要验收下任务依赖图新布局
2026-04-04 10:45 事件：刚完成一轮 pwd/ls/cd 文件搜索验证，准备回填 issue
2026-04-04 11:05 事件：完成一个时间块，准备开始总结
```

- [ ] **Step 3: Run the targeted test to verify failure**

Run:

```bash
cargo test -p exomind-runtime broker_proposal_story_contract_creates_real_proposals --test agent_api_rt -- --nocapture
```

Expected:

- compile failure because the shared proposal helper does not exist yet, or
- assertion failure because proposals are not actually created yet

- [ ] **Step 4: Do not commit yet**

Wait until the implementation and both test paths pass.

## Task 2: Add Shared Proposal Tool Helper

**Files:**
- Create: `crates/exomind-runtime/src/agent/proposal_tools.rs`
- Modify: `crates/exomind-runtime/src/agent/mod.rs`

- [ ] **Step 1: Create the shared tool constants and schemas**

Define:

```rust
pub const ADD_TASK_PROPOSAL_TOOL: &str = "add_task_proposal";
pub const ADD_TIMEBLOCK_PROPOSAL_TOOL: &str = "add_timeblock_proposal";
pub const ADD_EVENT_PROPOSAL_TOOL: &str = "add_event_proposal";
```

Export helper(s):

```rust
pub fn proposal_tool_defs() -> Vec<broker::ToolDef>;
```

or a pair of helpers that can be used by both tests and `life.rs`:

```rust
pub fn proposal_tool_defs() -> Vec<super::broker::ToolDef>;
pub async fn execute_proposal_tool_call(...);
```

- [ ] **Step 2: Add input structs and validation**

Add serde-deserializable input structs for the three tools. Validation rules:

- `title`, `body`, and the action-specific primary field must be non-empty after trim
- `priority` must map cleanly to `TaskPriority`
- `targetMinutes`, if present, must be positive
- empty string arrays must be normalized away rather than stored

- [ ] **Step 3: Map tool calls to `CreateProposalInput`**

Implement one shared executor that accepts:

```rust
pub async fn execute_proposal_tool_call(
    store: Arc<ProposalStore>,
    scope_key: Option<String>,
    publisher: Publisher,
    tool_call: &broker::ToolCall,
) -> Result<String, ProposalToolError>
```

Required behavior:

- route by tool name
- build the correct `CreateProposalInput`
- call `ProposalStore::create_scoped(...)`
- return the stable JSON tool-result payload

- [ ] **Step 4: Add focused unit tests in the new module**

Add small unit tests that verify:

- each tool maps to the correct `ActionType`
- invalid input returns `Tool error: ...`
- successful execution creates `Pending` proposals

- [ ] **Step 5: Run targeted tests**

Run:

```bash
cargo test -p exomind-runtime proposal_tools -- --nocapture
cargo test -p exomind-runtime broker_proposal_story_contract_creates_real_proposals --test agent_api_rt -- --nocapture
```

Expected:

- unit tests pass
- deterministic contract test passes because it only depends on the shared helper plus the test harness

## Task 3: Connect Internal Rust Callers To The Same Helper

**Files:**
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Modify: `crates/exomind-runtime/src/agent/life.rs`

- [ ] **Step 1: Extend `AgentSessionRuntime`**

Add:

```rust
pub proposal_store: Arc<crate::proposal::ProposalStore>,
```

Update:

- `AgentSessionRuntime::new(...)`
- `AgentSessionRuntime::from_state(...)`
- all integration-test constructors in `agent_api_rt.rs`
- all unit-test helpers in `session.rs`
- all direct test constructors in `agent/life.rs`

- [ ] **Step 2: Reuse the shared helper in `life.rs`**

Update `build_internal_tools(...)` so that:

- existing `get_recent_events` behavior stays unchanged
- requested proposal tool names are converted into broker tool defs via the shared helper

Update `execute_internal_tool_calls(...)` so that:

- proposal tool calls are executed through `execute_proposal_tool_call(...)`
- tool outputs are stored in `ToolCallRecord.output`
- the continuation path remains the same `assistant(tool_call) + tool_result`

- [ ] **Step 3: Add a targeted internal caller regression test**

Add one focused test in `life.rs` or `agent_api_rt.rs` that proves:

- internal Rust callers can expose at least `add_task_proposal`
- the tool call is executed through the shared helper
- the resulting proposal appears in `ProposalStore`

This test can use a fake provider rather than real upstream.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
cargo test -p exomind-runtime agent::life -- --nocapture
cargo test -p exomind-runtime broker_proposal_story_contract_creates_real_proposals --test agent_api_rt -- --nocapture
```

Expected:

- internal-caller regression passes
- deterministic contract path is now green

## Task 4: Add Real-Upstream Proposal Story Test

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Add a real-upstream test skeleton**

Add:

```rust
#[tokio::test]
async fn broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present() {}
```

This test must:

- use the existing `.codex`-style provider env loading pattern
- require no `EXOMIND_AGENT_API_RT_FS_ROOT` or other extra env vars
- use a real `ProposalStore`
- use the shared proposal tool helper

- [ ] **Step 2: Write the system prompt for proposal extraction**

Use a system prompt that explicitly says:

- you are a draft-proposal assistant for ExoMind
- you must convert event-log evidence into concrete draft proposals
- you should prefer tool calls over natural-language intent
- you may create task, timeblock, and event proposals when justified
- you may request one or more proposal tool calls when justified by the context
- once enough drafts exist, summarize what was drafted in Chinese

- [ ] **Step 3: Use a realistic user message**

The user message should include the story context and a direct request such as:

```text
下面是最近的事件记录和开发上下文。请先阅读这些内容，提取其中值得形成草案的事项。你可以按需要调用添加任务提案、添加计划时间块提案、添加事件提案这三种工具。至少应为“明天可能要验收下任务依赖图新布局”创建一个任务提案；如果上下文表明应该安排时间块或补一条总结事件，也请创建相应草案。完成后请用中文总结你创建了哪些草案以及原因。
```

- [ ] **Step 4: Implement a multi-turn harness with detailed logging**

The harness must:

- run broker turn-by-turn
- execute exactly the tool(s) returned by the model
- append:
  - original user message
  - assistant turn with tool calls
  - tool result
- continue until `status == "completed"` or the turn budget is exceeded

Log with `--nocapture`:

- turn number
- returned tool call
- tool input JSON
- tool result JSON
- proposal list snapshot after each tool execution
- final assistant answer

- [ ] **Step 5: Define real-upstream acceptance criteria**

Required:

- test skips cleanly when provider env vars are missing
- no 401 occurs; if a 401 occurs during manual execution, stop and report to the user
- at least one real proposal is created
- the created proposal set includes:
  - at least one `CreateTask`
  - at least one `StartTimeblock`
  - at least one `AppendEvent`
- at least one created task proposal has title/body consistent with the validation story
- all created proposals have:
  - `publisher.publisher_type == Agent`
  - `status == Pending`
- final assistant answer mentions the created task proposal in Chinese

- [ ] **Step 6: Run without env to verify skip behavior**

Run:

```bash
cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:

- a clear skip message
- test passes

- [ ] **Step 7: Run with real upstream env**

Run:

```bash
eval "$(python - <<'PY'
import json, pathlib, tomllib
home = pathlib.Path.home()
config = tomllib.loads((home/'.codex'/'config.toml').read_text())
auth = json.loads((home/'.codex'/'auth.json').read_text())
provider_id = config.get('model_provider', 'default')
provider = config.get('model_providers', {}).get(provider_id, {})
base_url = provider.get('base_url', '').rstrip('/')
if base_url and not base_url.endswith('/v1'):
    base_url += '/v1'
print('export EXOMIND_AGENT_API_RT_ENABLE=1')
print('export EXOMIND_AGENT_API_PROVIDER=openai')
print(f\"export EXOMIND_AGENT_API_MODEL={config.get('model', '')!r}\")
print(f\"export EXOMIND_AGENT_API_BASE_URL={base_url!r}\")
print(f\"export EXOMIND_AGENT_API_KEY={auth.get('OPENAI_API_KEY', '')!r}\")
PY
)"

cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:

- PASS
- output shows real tool-calling behavior
- `ProposalStore` contains at least one created task proposal

## Task 5: Capture Evidence And Write The Testing Doc

**Files:**
- Create: `docs/testing/agent-turn-broker-proposal-tools.md`

- [ ] **Step 1: Write the execution guide**

Document:

- what this story validates
- tool names and JSON schemas
- the event-log narrative fixture
- the system prompt shape
- skip-without-token behavior
- the exact `cargo test` commands

- [ ] **Step 2: Include non-sensitive evidence examples**

Add example snippets for:

- one task proposal tool call input
- one tool-result JSON payload
- one resulting proposal JSON excerpt from `ProposalStore`
- one final assistant response excerpt

Do not include real API keys or full sensitive local paths.

- [ ] **Step 3: Include acceptance criteria**

The doc must explicitly state:

- deterministic fake-provider test covers all three action types
- real-upstream test must verify at least one real task proposal
- proposals must be verified from `ProposalStore`, not inferred from assistant prose

## Task 6: Full Verification And Issue Reporting

**Files:**
- Reference: `docs/testing/agent-turn-broker-proposal-tools.md`
- Reference: GitHub issue `#830`

- [ ] **Step 1: Run targeted verification**

Run:

```bash
cargo test -p exomind-runtime proposal_tools -- --nocapture
cargo test -p exomind-runtime broker_proposal_story_contract_creates_real_proposals --test agent_api_rt -- --nocapture
cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

- [ ] **Step 2: Run broader regression around the touched path**

Run:

```bash
cargo test -p exomind-runtime --test agent_api_rt -- --nocapture
```

If unrelated pre-existing failures appear, document them separately rather than folding them into this task.

- [ ] **Step 3: Prepare the issue report for `#830`**

The report should include:

- what now works
- what remains partial
- GitHub permalinks to the key shared helper and tests
- code-block excerpts of:
  - the three tool definitions
  - the event-log sample
  - the proposal verification snippet
- non-sensitive test output excerpts

- [ ] **Step 4: Add backlinks only if needed**

If this work materially advances `#823` or `#677`, add short backlink comments there that point back to the main `#830` report rather than duplicating the full details.

## Out Of Scope For This Batch

- adding a new public HTTP contract dedicated to proposal tool execution
- auto-approving or auto-executing created proposals
- proposal editing or review workflow changes
- using filesystem path env vars or other unrelated test-only globals

## Final Completion Criteria

- [ ] shared Rust proposal-tool helper exists and is reusable
- [ ] internal Rust callers can use the same helper instead of bespoke proposal logic
- [ ] deterministic fake-provider contract test creates and verifies:
  - [ ] one `CreateTask` proposal
  - [ ] one `StartTimeblock` proposal
  - [ ] one `AppendEvent` proposal
- [ ] real-upstream regression test skips without API env and passes with API env
- [ ] real-upstream regression test verifies all three real proposal action types in `ProposalStore`:
  - [ ] `CreateTask`
  - [ ] `StartTimeblock`
  - [ ] `AppendEvent`
- [ ] testing doc is written with non-sensitive evidence examples
- [ ] issue `#830` receives the main progress report with permalinks and evidence
