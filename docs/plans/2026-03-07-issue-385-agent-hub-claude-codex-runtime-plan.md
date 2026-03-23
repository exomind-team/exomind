# Issue #385 Agent Runtime Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Agent Hub create and control `Claude CLI`, `Codex CLI`, and `API Agent` runtime nodes with runtime capability filtering, provider profile reuse, typed streaming events, and release tracking under `v0.3.6`.

**Architecture:** Keep `exomind-runtime` as the single runtime authority for agent lifecycle. Extend `/topology` with runtime capabilities, introduce a unified create-agent contract for `claude_cli / codex_cli / api`, add typed SSE runtime events, then refactor Agent Hub create flow around `Agent kind + Provider profile + Runtime target` with single-target auto-direct and multi-target explicit selection.

**Tech Stack:** Rust, Tokio, Axum SSE, Tauri runtime bridge, React 18, TypeScript, Vitest, Playwright, GitHub Issues, localStorage profile persistence

---

### Task 1: Add runtime capability contract and client parsing

**Files:**
- Modify: `crates/exomind-runtime/src/routes/topology.rs`
- Modify: `src/lib/types/runtime-topology.ts`
- Modify: `src/services/runtime-client.ts`
- Modify: `src/services/runtime-manager.ts`
- Test: `tests/unit/services/runtime-client.issue201.test.ts`
- Test: `tests/unit/services/runtime-manager.issue385.test.ts`

**Step 1: Write the failing tests**

Add assertions that `/topology` parsing requires `capabilities` and that runtime snapshots expose `agentKinds` + `apiProviders`.

```ts
expect(result.ok).toBe(true);
expect(result.data.capabilities.agentKinds).toContain('claude_cli');
expect(result.data.capabilities.apiProviders).toContain('openai');
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts`
Expected: FAIL because topology currently has no capabilities.

**Step 3: Add the minimal capability contract**

- Extend Rust `TopologyResponse` with:
  - `capabilities.agent_kinds`
  - `capabilities.api_providers`
- Extend TypeScript parsing accordingly
- Keep backward-compatible fallback only where absolutely required by old tests

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/routes/topology.rs src/lib/types/runtime-topology.ts src/services/runtime-client.ts src/services/runtime-manager.ts tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts
git commit -m "feat(runtime): expose runtime capabilities for issue-385"
```

### Task 2: Add Provider Profile storage with meta/secret split

**Files:**
- Create: `src/lib/agent-provider/provider-profile-storage.ts`
- Create: `src/lib/agent-provider/types.ts`
- Test: `tests/unit/agent-provider/provider-profile-storage.issue385.test.ts`

**Step 1: Write the failing tests**

Cover:

- create profile stores meta + secret separately
- list returns meta only
- get resolved profile returns merged snapshot
- update `lastUsedAt`

```ts
expect(listProviderProfiles()).toHaveLength(1);
expect(getProviderProfileSecret(profileId)?.apiKey).toBe('sk-test');
expect(resolveProviderProfile(profileId)?.provider).toBe('openai');
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-provider/provider-profile-storage.issue385.test.ts`
Expected: FAIL because storage module does not exist.

**Step 3: Write the minimal implementation**

- Reuse localStorage meta/secret pattern from `src/lib/profile/profile-storage.ts`
- Support `openai` and `anthropic`
- Support custom model text

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-provider/provider-profile-storage.issue385.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-provider/provider-profile-storage.ts src/lib/agent-provider/types.ts tests/unit/agent-provider/provider-profile-storage.issue385.test.ts
git commit -m "feat(agent-provider): add provider profile storage for issue-385"
```

### Task 3: Freeze the cross-layer event contract and create-agent contract

**Files:**
- Create: `crates/exomind-runtime/src/agent/runtime_event.rs`
- Modify: `crates/exomind-runtime/src/agent/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/agents.rs`
- Modify: `src/services/runtime-client.ts`
- Modify: `src/lib/types/agent-hub.ts`
- Test: `tests/unit/services/runtime-client.issue201.test.ts`

**Step 1: Write the failing contract tests**

Add assertions that runtime chat SSE can parse typed events and that `createAgent()` accepts `claude_cli / codex_cli / api`.

```ts
expect(chunks[0]).toEqual({
  type: 'session.started',
  sessionId: 'session-1',
});

expect(chunks[1]).toEqual({
  type: 'output.delta',
  content: 'hello',
});

expect(request.kind).toBe('api');
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/runtime-client.issue201.test.ts`
Expected: FAIL because `RuntimeAgentConversationChunk` and create payload union do not support the new contract.

**Step 3: Add the minimal shared contract**

Define a runtime event payload in Rust and TypeScript with at least:

```ts
type RuntimeAgentEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'output.delta'; content: string }
  | { type: 'thinking.delta'; content: string }
  | { type: 'tool.call'; callId: string; toolName: string; argsText?: string }
  | { type: 'tool.result'; callId: string; toolName: string; status: 'ok' | 'error'; content?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'error'; code?: string; message: string }
  | { type: 'done'; finishReason?: string };
```

**Step 4: Update the route encoder/decoder**

- `routes/agents.rs` should SSE-encode the typed runtime event JSON.
- `runtime-client.ts` should parse SSE into typed chunks without losing backward-compatible handling for legacy `{ content, session_id }`.
- Extend `RuntimeCreateAgentRequest` to:
  - `claude_cli`
  - `codex_cli`
  - `api { profile snapshot }`

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/runtime-client.issue201.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add crates/exomind-runtime/src/agent/runtime_event.rs crates/exomind-runtime/src/agent/mod.rs crates/exomind-runtime/src/routes/agents.rs src/services/runtime-client.ts src/lib/types/agent-hub.ts tests/unit/services/runtime-client.issue201.test.ts
git commit -m "feat(runtime): add typed agent stream event contract for issue-385"
```

### Task 4: Refactor Claude into a provider adapter and add Codex/API providers

**Files:**
- Create: `crates/exomind-runtime/src/agent/provider.rs`
- Create: `crates/exomind-runtime/src/agent/codex.rs`
- Create: `crates/exomind-runtime/src/agent/api.rs`
- Modify: `crates/exomind-runtime/src/agent/claude.rs`
- Modify: `crates/exomind-runtime/src/agent/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/agents.rs`
- Test: `crates/exomind-runtime/tests/claude_persistent_streaming.rs`
- Test: `crates/exomind-runtime/tests/codex_app_server_streaming.rs`
- Test: `crates/exomind-runtime/tests/api_agent_streaming.rs`
- Test: `crates/exomind-runtime/tests/agent_lifecycle_routes.rs`

**Step 1: Write the failing provider tests**

Create a fake Codex app-server fixture that speaks minimal JSON-RPC over stdio and assert:

- `POST /agents` with `kind: "codex_cli"` succeeds
- `/agents/:id/chat` yields `session.started`, `output.delta`, `done`
- `DELETE /agents/:id` stops the process cleanly

Add API agent tests that assert:

- `POST /agents` with `kind: "api"` succeeds
- provider snapshot is validated
- `/agents/:id/chat` yields typed events from API adapter

```rust
assert_eq!(create_response.status(), StatusCode::CREATED);
assert!(events.iter().any(|evt| evt.event_type() == "output.delta"));
assert_eq!(delete_response.status(), StatusCode::OK);
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind-runtime --test claude_persistent_streaming --test codex_app_server_streaming --test api_agent_streaming --test agent_lifecycle_routes --manifest-path src-tauri/Cargo.toml`
Expected: FAIL because the provider abstraction and new create kinds are not supported yet.

**Step 3: Implement the provider abstraction**

Define a Rust trait similar to:

```rust
pub trait AgentProvider: Send + Sync {
    fn submit(&self, request: ChatRequest) -> BoxStream<'static, RuntimeAgentEvent>;
    fn list_sessions(&self) -> Vec<SessionInfo>;
    fn get_session(&self, session_id: &str) -> Option<SessionInfo>;
    fn close_session(&self, session_id: &str) -> bool;
}
```

Then:

- Adapt `ClaudeAgent` to emit typed events
- Add `CodexAgent`
- Add `ApiAgent`

**Step 4: Implement the Codex adapter**

Spawn:

```text
codex app-server --listen stdio://
```

Implement minimal protocol flow:

1. process spawn
2. session init
3. submit prompt
4. map streamed notifications into `RuntimeAgentEvent`
5. stop/interrupt by closing protocol or killing child as fallback

**Step 5: Implement the API adapter**

- Use provider snapshot from create payload
- Support `OpenAI` and `Anthropic`
- Stream API text deltas as `output.delta`
- Emit `error` and `done`

**Step 6: Expose providers on runtime routes**

- Extend `RuntimeCreateAgentRequest` union to include `codex`
- Extend `create_agent()` route branch to build:
  - `ClaudeAgent`
  - `CodexAgent`
  - `ApiAgent`

**Step 7: Run tests to verify they pass**

Run: `cargo test -p exomind-runtime --test claude_persistent_streaming --test codex_app_server_streaming --test api_agent_streaming --test agent_lifecycle_routes --manifest-path src-tauri/Cargo.toml`
Expected: PASS

**Step 8: Commit**

```bash
git add crates/exomind-runtime/src/agent/provider.rs crates/exomind-runtime/src/agent/claude.rs crates/exomind-runtime/src/agent/codex.rs crates/exomind-runtime/src/agent/api.rs crates/exomind-runtime/src/routes/agents.rs crates/exomind-runtime/src/agent/mod.rs crates/exomind-runtime/tests/claude_persistent_streaming.rs crates/exomind-runtime/tests/codex_app_server_streaming.rs crates/exomind-runtime/tests/api_agent_streaming.rs crates/exomind-runtime/tests/agent_lifecycle_routes.rs
git commit -m "feat(agent): add runtime providers for claude codex and api in issue-385"
```

### Task 5: Add Runtime target candidate resolution and Agent Hub create flow

**Files:**
- Create: `src/ui/app/pages/agents/runtime-target-candidate.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/AgentConversationPage.tsx`
- Modify: `src/lib/types/agent-hub.ts`
- Modify: `src/config/runtime-target.ts`
- Test: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`
- Test: `tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx`

**Step 1: Write the failing UI tests**

Cover:

- add-node sheet offers `Claude CLI`, `Codex CLI`, `API Agent`
- single compatible target auto-directs
- multiple compatible targets require explicit selection
- `API Agent` requires `Provider profile`
- create request sends the selected kind + profile snapshot + binding target
- conversation page renders typed runtime events
- stop button works for runtime-backed agents

```tsx
expect(screen.getByText('Claude CLI')).toBeInTheDocument();
expect(screen.getByText('Codex CLI')).toBeInTheDocument();
expect(screen.getByText('API Agent')).toBeInTheDocument();
expect(screen.getByTestId('agent-runtime-event-output')).toHaveTextContent('hello');
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx`
Expected: FAIL because UI currently only creates `echo`, does not model target candidates, and only renders text chunks.

**Step 3: Implement the minimal UI changes**

- Add `RuntimeTargetCandidate` resolution
- Treat `embedded runtime` as an implicit target candidate
- Filter compatible targets by runtime capabilities
- Auto-start embedded runtime when it is the single compatible target and is `startable`
- Expand create sheet to `Agent kind + Provider profile + Runtime target`
- Persist `AgentRuntimeBinding`
- Render typed runtime events in conversation/detail views
- Preserve existing fallback behavior for legacy/mock adapters

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/agents/runtime-target-candidate.ts src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/agents/AgentConversationPage.tsx src/lib/types/agent-hub.ts src/config/runtime-target.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx
git commit -m "feat(agent-hub): add runtime target selection and typed chat for issue-385"
```

### Task 6: Add end-to-end verification, issue sync, and release evidence

**Files:**
- Create: `tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts`
- Create: `tests/e2e/agent-hub.runtime-api.issue385.test.ts`
- Create: `tests/e2e/playwright.issue385.config.ts`
- Modify: `package.json`
- Modify: `docs/plans/2026-03-07-issue-385-agent-runtime-orchestration-design.md`
- Modify: `docs/plans/2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md`
- Modify: GitHub issue `#385` via comment
- Modify: GitHub issue `#363` via comment/checklist sync if needed

**Step 1: Write the failing E2E**

Cover one Claude fixture runtime, one Codex fixture runtime, and one API fixture runtime:

- create agent
- open chat panel
- receive streaming output
- stop agent

```ts
await expect(page.getByText('Claude CLI')).toBeVisible();
await expect(page.getByTestId('agent-runtime-event-output')).toContainText('hello');
await expect(page.getByText(/stopped/i)).toBeVisible();
```

**Step 2: Run test to verify it fails**

Run: `node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts tests/e2e/agent-hub.runtime-api.issue385.test.ts --config tests/e2e/playwright.issue385.config.ts`
Expected: FAIL before the new runtime flow is fully connected.

**Step 3: Add E2E config and script**

- Create isolated Playwright config for issue 385
- Add `test:e2e:issue385` script in `package.json`

**Step 4: Run all relevant verification**

Run:

```bash
npx tsc --noEmit
npx vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts tests/unit/agent-provider/provider-profile-storage.issue385.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx
cargo test -p exomind-runtime --test claude_persistent_streaming --test codex_app_server_streaming --test api_agent_streaming --test agent_lifecycle_routes --manifest-path src-tauri/Cargo.toml
node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts tests/e2e/agent-hub.runtime-api.issue385.test.ts --config tests/e2e/playwright.issue385.config.ts
```

Expected:

- `tsc`: PASS
- Vitest: PASS
- Rust integration tests: PASS
- Playwright issue385 flow: PASS

**Step 5: Sync issue context**

- Comment on `#385` with:
  - design path
  - plan path
  - chosen architecture
  - verification commands
- Confirm `#363` body still includes `#385` in the `v0.3.6` checklist

**Step 6: Commit**

```bash
git add tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts tests/e2e/agent-hub.runtime-api.issue385.test.ts tests/e2e/playwright.issue385.config.ts package.json docs/plans/2026-03-07-issue-385-agent-runtime-orchestration-design.md docs/plans/2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md
git commit -m "test(agent-hub): add runtime orchestration acceptance coverage for issue-385"
```
