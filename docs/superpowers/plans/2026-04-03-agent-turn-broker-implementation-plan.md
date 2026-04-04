# Agent Turn Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first batch of `#823` by introducing a unified Rust `AgentTurnBroker`, keeping HTTP as a thin session wrapper, migrating internal Rust callers to the same broker, and proving the two-step weather flow through broker tests, Rust real-upstream tests, and HTTP RT validation.

**Architecture:** Add a new `agent/broker.rs` module as the only turn orchestration layer. Keep `/agent-sessions` as a transport + persistence wrapper on top of broker results, and migrate internal callers such as `life.rs` to explicitly handle tool results and continuation through the same broker API.

**Tech Stack:** Rust, Axum, Reqwest, Serde, Tokio, existing ExoMind runtime agent/provider code, `cargo test`, `curl`

---

## File Map

### New files

- `crates/exomind-runtime/src/agent/broker.rs`
  - Unified broker request/response model
  - Provider-neutral broker API
  - OpenAI-compatible / Anthropic turn orchestration
- `crates/exomind-runtime/tests/agent_turn_broker_rt.rs`
  - Real-upstream Rust integration test for the two-step weather flow
- `docs/testing/agent-turn-broker-http-weather.md`
  - Copyable RT startup and `curl` validation commands for the two-step HTTP weather flow

### Modified files

- `crates/exomind-runtime/src/agent/mod.rs`
  - Export `broker`
- `crates/exomind-runtime/src/agent/api.rs`
  - Reuse or expose provider parsing helpers if needed by broker
- `crates/exomind-runtime/src/agent/session.rs`
  - Reduce to session store/runtime support and thin session wrapper helpers
- `crates/exomind-runtime/src/routes/agent_sessions.rs`
  - Parse new request schema and wrap broker results into persisted session responses
- `crates/exomind-runtime/src/agent/life.rs`
  - Migrate internal caller path to `AgentTurnBroker`
- `crates/exomind-runtime/tests/agent_api_rt.rs`
  - Replace old route/internal integration assumptions tied to fixed-tool execution
  - Add broker-backed route and internal-caller integration coverage

### Existing references to inspect while implementing

- `crates/exomind-runtime/src/agent/session.rs`
- `crates/exomind-runtime/src/routes/agent_sessions.rs`
- `crates/exomind-runtime/src/agent/life.rs`
- `crates/exomind-runtime/src/agent/api.rs`
- `docs/superpowers/specs/2026-04-03-agent-turn-broker-design.md`

## Task 1: Scaffold Broker Types And Failing Core Tests

**Files:**
- Create: `crates/exomind-runtime/src/agent/broker.rs`
- Modify: `crates/exomind-runtime/src/agent/mod.rs`
- Test: `crates/exomind-runtime/src/agent/broker.rs`

- [ ] **Step 1: Add failing broker unit tests for the minimal model**

Add tests covering:

```rust
#[test]
fn request_rejects_duplicate_last_user_turn_and_new_user_message() {}

#[test]
fn assistant_turn_exposes_tool_calls_for_continuation() {}

#[test]
fn needs_tool_calls_result_keeps_assistant_turn_and_flat_tool_calls() {}
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `cargo test -p exomind-runtime broker::tests -- --nocapture`

Expected: FAIL because `agent::broker` does not exist yet.

- [ ] **Step 3: Add minimal broker data structures and validation helpers**

Implement:

```rust
pub struct AgentTurnRequest { /* provider, system_prompt, tools, history, new_user_message */ }
pub enum TurnItem { /* User, Assistant, ToolResult */ }
pub struct ToolDef { /* name, description, input_schema */ }
pub struct ToolCall { /* id, name, input */ }
pub struct AssistantTurn { /* content, tool_calls */ }
pub enum AgentTurnResult { /* Final, NeedsToolCalls */ }

impl AgentTurnRequest {
    pub fn validate(&self) -> Result<(), BrokerError> { /* duplicate-last-user rule */ }
}
```

- [ ] **Step 4: Export the new module**

Update `crates/exomind-runtime/src/agent/mod.rs` to expose `broker`.

- [ ] **Step 5: Run targeted tests to verify pass**

Run: `cargo test -p exomind-runtime broker::tests -- --nocapture`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/exomind-runtime/src/agent/broker.rs crates/exomind-runtime/src/agent/mod.rs
git commit -m "feat(rt): add agent turn broker core types"
```

## Task 2: Implement Fake-Provider Broker Turn Flow

**Files:**
- Modify: `crates/exomind-runtime/src/agent/broker.rs`
- Modify: `crates/exomind-runtime/src/agent/api.rs`
- Test: `crates/exomind-runtime/src/agent/broker.rs`

- [ ] **Step 1: Add failing async broker tests for two-step turn flow**

Add tests covering:

```rust
#[tokio::test]
async fn broker_returns_final_when_provider_answers_without_tools() {}

#[tokio::test]
async fn broker_returns_needs_tool_calls_without_dispatching_tools() {}

#[tokio::test]
async fn broker_continues_with_history_and_tool_result() {}
```

Use fake OpenAI-compatible / Anthropic handlers that:
- first return `tool_call(get_weather)`
- then, after receiving assistant tool call + tool result in history, return final weather text

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `cargo test -p exomind-runtime broker::tests::broker_ -- --nocapture`

Expected: FAIL because broker turn orchestration is not implemented.

- [ ] **Step 3: Implement provider-neutral broker entrypoint**

Add minimal API:

```rust
pub struct AgentTurnBroker;

impl AgentTurnBroker {
    pub async fn run(request: AgentTurnRequest) -> Result<AgentTurnResult, BrokerError> {
        request.validate()?;
        // route to openai/anthropic adapter
    }
}
```

Implement:
- request normalization of `history + new_user_message`
- OpenAI-compatible message building/parsing
- Anthropic message building/parsing
- `NeedsToolCalls` return path without tool execution
- `Final` return path

- [ ] **Step 4: Reuse or extract provider helper logic from `agent/api.rs` only when needed**

Keep parsing/schema reuse focused. Do not copy old `session.rs` tool-dispatch flow into broker.

- [ ] **Step 5: Run targeted tests to verify pass**

Run: `cargo test -p exomind-runtime broker::tests::broker_ -- --nocapture`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/exomind-runtime/src/agent/broker.rs crates/exomind-runtime/src/agent/api.rs
git commit -m "feat(rt): implement agent turn broker flow"
```

## Task 3: Convert `/agent-sessions` Into A Thin Session Wrapper

**Files:**
- Modify: `crates/exomind-runtime/src/routes/agent_sessions.rs`
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Test: `crates/exomind-runtime/src/routes/agent_sessions.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Add failing route tests for the new HTTP contract**

Add tests covering:

```rust
#[tokio::test]
async fn post_agent_sessions_returns_session_wrapper_with_tool_calls() {}

#[tokio::test]
async fn post_agent_sessions_returns_completed_wrapper_after_tool_result_history() {}

#[tokio::test]
async fn get_agent_session_returns_persisted_wrapper_result() {}
```

Assertions must check:
- `sessionId`
- `status`
- top-level `content`
- `assistantTurn`
- `toolCalls` when applicable

Also update or replace the old integration test in `crates/exomind-runtime/tests/agent_api_rt.rs` that still encodes the deprecated one-shot fixed-tool behavior. The route migration must be driven by failing tests against the new wrapper contract, not leave the old expectation until a later task.

- [ ] **Step 2: Run targeted route tests to verify failure**

Run: `cargo test -p exomind-runtime routes::agent_sessions::tests -- --nocapture`

Expected: FAIL because request/response schema still follows the old fixed-tool model.

- [ ] **Step 3: Replace old route request schema with broker-backed schema**

Update request parsing to accept:

```rust
struct RunAgentSessionRequest {
    provider_profile: Option<ApiProviderProfile>,
    profile_id: Option<String>,
    user_id: Option<String>,
    system_prompt: Option<String>,
    tools: Vec<ToolDef>,
    history: Vec<HttpTurnItem>,
    new_user_message: Option<String>,
}
```

Translate HTTP input to `AgentTurnRequest`.

- [ ] **Step 4: Add thin session wrapper logic**

In `session.rs`, keep or add helpers for:
- generating `sessionId`
- persisting broker results as session-wrapper records
- reading persisted wrapper results for `GET /agent-sessions/:id`

Explicitly migrate the persisted wrapper/store shape so it can represent the new contract:
- `sessionId`
- `status`
- top-level `content`
- `assistantTurn`
- flat `toolCalls` when applicable
- any other required wrapper metadata

Do not shim this through the old `prompt/content/tool_calls(output)` record shape that assumed RT-side tool execution.

Do not reintroduce turn orchestration here.

- [ ] **Step 5: Run targeted route and integration tests to verify pass**

Run: `cargo test -p exomind-runtime routes::agent_sessions::tests --test agent_api_rt -- --nocapture`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/exomind-runtime/src/routes/agent_sessions.rs crates/exomind-runtime/src/agent/session.rs
git commit -m "feat(rt): wrap broker in agent sessions route"
```

## Task 4: Migrate Internal Rust Callers To The Broker

**Files:**
- Modify: `crates/exomind-runtime/src/agent/life.rs`
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/src/agent/life.rs`

- [ ] **Step 1: Add failing internal-caller tests**

Add tests covering:

```rust
#[tokio::test]
async fn life_agent_uses_broker_and_receives_tool_calls() {}

#[tokio::test]
async fn life_agent_can_continue_after_local_tool_result() {}
```

The test should prove:
- internal caller no longer depends on `build_tool_registry_for_runtime()`
- tool execution responsibility stays in the internal caller path

- [ ] **Step 2: Run targeted internal-caller tests to verify failure**

Run: `cargo test -p exomind-runtime life_agent_uses_broker -- --nocapture`

Expected: FAIL because `life.rs` still uses old runtime session helpers.

- [ ] **Step 3: Migrate `life.rs` to explicit broker calls**

Implement:
- build `AgentTurnRequest`
- call `AgentTurnBroker`
- when `NeedsToolCalls`, explicitly handle allowed internal tool execution in caller code
- construct `ToolResult` and continue with a second broker call if desired by the caller flow

Do not recreate old runtime-owned fixed-tool dispatch helpers.

- [ ] **Step 4: Remove or bypass old fixed-tool internal path**

Delete usages of:
- `build_tool_registry_for_runtime(...)`
- `run_agent_session_with_runtime(...)`

from the internal caller path being migrated.

- [ ] **Step 5: Run targeted internal-caller tests to verify pass**

Run: `cargo test -p exomind-runtime life_agent_uses_broker -- --nocapture`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/exomind-runtime/src/agent/life.rs crates/exomind-runtime/tests/agent_api_rt.rs
git commit -m "refactor(rt): migrate internal callers to agent turn broker"
```

## Task 5: Add Rust Real-Upstream Internal-Caller Weather Test With Env-Gated Skip

**Files:**
- Create: `crates/exomind-runtime/tests/agent_turn_broker_rt.rs`
- Modify: `crates/exomind-runtime/src/agent/life.rs`

- [ ] **Step 1: Add failing real-upstream integration test**

Add one main test:

```rust
#[tokio::test]
async fn internal_caller_real_upstream_weather_flow_skips_without_env() {}
```

The test must:
- read env vars for provider/model/base_url/api_key
- skip early if required env vars are missing
- fail explicitly on `401`
- exercise an internal Rust caller path that uses the new broker
- perform the same two-step weather flow through that internal caller path:
  - ask weather
  - expect `toolCalls`
  - inject fixed tool result `今天是阴天，气温21.45度`
  - continue and assert final answer contains that content

- [ ] **Step 2: Run the targeted test without env to verify skip path**

Run: `cargo test -p exomind-runtime --test agent_turn_broker_rt -- --nocapture`

Expected: PASS with explicit skip message when env is absent.

- [ ] **Step 3: Run the same test with locally exported env vars to verify real-upstream path**

Run:

```bash
EXOMIND_AGENT_API_PROVIDER=...
EXOMIND_AGENT_API_MODEL=...
EXOMIND_AGENT_API_BASE_URL=...
EXOMIND_AGENT_API_KEY=...
cargo test -p exomind-runtime --test agent_turn_broker_rt -- --nocapture
```

Expected:
- PASS on valid credentials
- FAIL with clear auth message on `401`

This task is not complete if it only proves `AgentTurnBroker::run(...)` directly. It must prove that at least one real internal Rust caller/helper path is wired through the same broker contract under real-upstream conditions.

- [ ] **Step 4: Commit**

```bash
git add crates/exomind-runtime/tests/agent_turn_broker_rt.rs
git commit -m "test(rt): add real-upstream internal caller weather flow"
```

## Task 6: Document And Validate Real RT HTTP Weather Flow

**Files:**
- Create: `docs/testing/agent-turn-broker-http-weather.md`

- [ ] **Step 1: Write the RT startup and `curl` validation document**

Include:
- RT build/start commands
- env export example without hardcoding secrets
- first request example
- how to extract `assistantTurn` and `toolCalls`
- second request example with fixed weather tool result
- expected final response

- [ ] **Step 2: Run the documented HTTP flow against a real RT instance**

Run the documented commands in order.

Expected:
- first response contains `toolCalls`
- second response contains `今天是阴天，气温21.45度`

- [ ] **Step 3: Update the document with any corrections discovered during validation**

- [ ] **Step 4: Commit**

```bash
git add docs/testing/agent-turn-broker-http-weather.md
git commit -m "docs(rt): add broker http weather validation flow"
```

## Task 7: Full Verification And Cleanup

**Files:**
- Modify: `crates/exomind-runtime/src/agent/broker.rs`
- Modify: `crates/exomind-runtime/src/routes/agent_sessions.rs`
- Modify: `crates/exomind-runtime/src/agent/life.rs`
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Modify: `crates/exomind-runtime/tests/agent_turn_broker_rt.rs`
- Modify: `docs/testing/agent-turn-broker-http-weather.md`

- [ ] **Step 1: Run broker-focused tests**

Run: `cargo test -p exomind-runtime broker::tests routes::agent_sessions::tests -- --nocapture`

Expected: PASS

- [ ] **Step 2: Run internal caller tests**

Run: `cargo test -p exomind-runtime agent::life -- --nocapture`

Expected: PASS

- [ ] **Step 3: Run the Rust real-upstream broker test**

Run:

```bash
cargo test -p exomind-runtime --test agent_turn_broker_rt -- --nocapture
```

Expected:
- PASS with skip when env missing
- PASS with real flow when env present

- [ ] **Step 4: Run a compile-only safety pass**

Run: `cargo check -p exomind-runtime`

Expected: PASS

- [ ] **Step 5: Review diff and remove any accidental fallback to old fixed-tool execution**

Run:

```bash
git diff -- crates/exomind-runtime/src/agent/session.rs \
             crates/exomind-runtime/src/routes/agent_sessions.rs \
             crates/exomind-runtime/src/agent/life.rs \
             crates/exomind-runtime/src/agent/broker.rs
```

Expected: no new RT-side dispatch of caller-defined tools in broker or route code.

- [ ] **Step 6: Final commit**

```bash
git add crates/exomind-runtime docs/testing
git commit -m "feat(rt): unify agent session flow on agent turn broker"
```
