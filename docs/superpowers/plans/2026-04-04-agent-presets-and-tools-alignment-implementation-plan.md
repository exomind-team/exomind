# API Agent Presets And Tools Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `toolGroups`-centric API Agent source model with a clearer `presets + tools` model, while allowing Rust/HTTP callers to combine Rust-internal presets and caller-defined custom tools in the same session.

**Architecture:** Keep the existing three-layer split: broker only accepts final `Vec<ToolDef>`, final-tools runner persists and maps broker results, and source-aware runner accepts source-level inputs and normalizes them. The source-aware layer must rename `toolGroups` to `presets`, expand presets inside Rust, merge them with explicit `tools`, reject duplicate tool names, and keep HTTP as a pure transport adapter.

**Tech Stack:** Rust, Axum, serde, cargo test, GitHub issue tracking

---

## File Structure

### Existing files to modify

- `docs/superpowers/specs/2026-04-04-agent-tool-sourcing-alignment-design.md`
  - Update terminology and normative rules from `toolGroups` to `presets`, and replace the temporary mutual-exclusion rule with merge semantics.
- `crates/exomind-runtime/src/agent/session.rs`
  - Rename source-aware request semantics, replace `toolGroups` resolver behavior with `presets` expansion + merge, and keep broker-facing APIs on final tool lists only.
- `crates/exomind-runtime/src/routes/agent_sessions.rs`
  - Rename HTTP request field from `toolGroups` to `presets` and continue forwarding source-level inputs without route-side merging.
- `crates/exomind-runtime/src/agent/life.rs`
  - Rename internal trigger configuration from `tool_groups` to `presets` and keep internal callers on the shared source-aware runner.
- `crates/exomind-runtime/src/agent/tools/mod.rs`
  - Keep or extend regression coverage around preset-expanded tool definitions, especially `recent_events`.
- `crates/exomind-runtime/tests/agent_api_rt.rs`
  - Add/adjust runtime-level tests proving explicit tools and presets can coexist in one session request.

### New files to create

- `docs/testing/agent-turn-broker-presets-and-tools.md`
  - Record the updated request/response examples and verification flow for combined `presets + tools`.

## Task 1: Update the design contract

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-agent-tool-sourcing-alignment-design.md`
- Modify: `docs/superpowers/plans/2026-04-04-agent-presets-and-tools-alignment-implementation-plan.md`

- [ ] **Step 1: Rewrite the source terminology in the design doc**

Update the design doc so it explicitly distinguishes:
- `tools`: caller-defined custom tools
- `presets`: Rust-internal preset tool bundles

Required language to capture:
- API Agent still defaults to no tools
- callers may provide `tools`, `presets`, or both
- HTTP only transports source-level fields
- Rust source-aware normalization expands presets and merges them with explicit tools

- [ ] **Step 2: Replace the old mutual-exclusion rule with merge semantics**

Document the new rule:
- `tools=[]` and `presets=[]` => no tools
- `tools` only => explicit custom tools
- `presets` only => Rust preset tools
- `tools + presets` => allowed; Rust expands and merges

Also document conflict handling:
- duplicate preset names => error
- duplicate tool names after merge => error
- no silent override
- no route-side merging

- [ ] **Step 3: Commit the spec/doc update**

Run:

```bash
git add docs/superpowers/specs/2026-04-04-agent-tool-sourcing-alignment-design.md \
        docs/superpowers/plans/2026-04-04-agent-presets-and-tools-alignment-implementation-plan.md
git commit -m "docs(rt): plan presets and tools alignment"
```

Expected: commit created with only doc changes.

## Task 2: Write failing tests for `presets + tools` normalization

**Files:**
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Modify: `crates/exomind-runtime/src/routes/agent_sessions.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Add unit tests in `session.rs` for source-aware merging**

Add failing tests covering:
- explicit `tools` plus `presets=["recent_events"]` returns a merged final tool list
- duplicate preset names are rejected
- duplicate final tool names across explicit tools and preset-expanded tools are rejected
- missing `scopeKey` for a scope-bound preset is rejected

Test cases should assert exact error messages where practical.

- [ ] **Step 2: Add route-level test for HTTP request carrying both `tools` and `presets`**

Add a failing route test that posts a single `/agent-sessions` request with:
- one explicit tool, e.g. `get_weather`
- one preset, e.g. `recent_events`
- a valid `scopeKey`

Expected behavior:
- route accepts the request
- route forwards both source types through Rust
- upstream fake provider sees both resulting tool definitions

- [ ] **Step 3: Add runtime integration test in `agent_api_rt.rs`**

Add a failing integration test that proves a combined request can produce a tool-visible session surface. Use a fake upstream provider that asserts the request includes both:
- `get_recent_events`
- `get_weather`

Run:

```bash
cargo test -p exomind-runtime agent::session::tests::resolve_requested_tools_ -- --nocapture
cargo test -p exomind-runtime routes::agent_sessions::tests::route_ -- --nocapture
cargo test -p exomind-runtime combined_presets_and_tools_ --test agent_api_rt -- --nocapture
```

Expected: new tests fail before implementation, existing adjacent tests may still pass.

- [ ] **Step 4: Commit the failing tests**

```bash
git add crates/exomind-runtime/src/agent/session.rs \
        crates/exomind-runtime/src/routes/agent_sessions.rs \
        crates/exomind-runtime/tests/agent_api_rt.rs
git commit -m "test(rt): cover presets and tools merging"
```

## Task 3: Implement source-aware `presets` normalization

**Files:**
- Modify: `crates/exomind-runtime/src/agent/session.rs`
- Modify: `crates/exomind-runtime/src/agent/life.rs`

- [ ] **Step 1: Rename source-level APIs from `toolGroups` to `presets`**

Update public/source-aware function parameters, internal helper names, and comments so that source terminology consistently uses `presets`.

Keep the broker-facing APIs unchanged:
- broker still only consumes final `Vec<ToolDef>`
- final-tools runner still only consumes final `Vec<ToolDef>`

- [ ] **Step 2: Replace the mutual-exclusion branch with merge logic**

Implementation requirements:
- normalize and deduplicate preset keys
- expand each preset into concrete `ToolDef`s
- append explicit `tools`
- validate uniqueness across the final merged list

Pseudo-shape:

```rust
let mut resolved_tools = explicit_tools;
let mut expanded = expand_presets(...)?;
resolved_tools.append(&mut expanded);
validate_unique_tool_names(&resolved_tools)?;
```

Use the actual order preferred by the codebase, but keep it stable and documented.

- [ ] **Step 3: Keep preset-specific validation in Rust**

Required behaviors:
- unknown preset => `InvalidRequest`
- empty preset key => `InvalidRequest`
- duplicate preset key => `InvalidRequest`
- missing `scopeKey` for data-bound preset => `InvalidRequest`
- duplicate tool name after merge => `InvalidRequest`

- [ ] **Step 4: Update internal life-agent trigger config**

Rename:
- `tool_groups` -> `presets`

Preserve current behavior:
- built-in life agent still explicitly opts into `recent_events`
- it must not gain any new default tools implicitly

- [ ] **Step 5: Run focused tests**

Run:

```bash
cargo test -p exomind-runtime agent::session::tests::resolve_requested_tools_ -- --nocapture
cargo test -p exomind-runtime agent::life::tests::on_tick_can_persist_internal_agent_api_session -- --nocapture
cargo test -p exomind-runtime agent::life::tests::internal_proposal_tool_calls_use_shared_helper_and_persist_proposals -- --nocapture
```

Expected: source-aware tests and affected life-agent tests pass.

- [ ] **Step 6: Commit the implementation**

```bash
git add crates/exomind-runtime/src/agent/session.rs \
        crates/exomind-runtime/src/agent/life.rs
git commit -m "feat(rt): merge presets with explicit tools"
```

## Task 4: Update HTTP request surface and route tests

**Files:**
- Modify: `crates/exomind-runtime/src/routes/agent_sessions.rs`

- [ ] **Step 1: Rename request field from `toolGroups` to `presets`**

Adjust the request struct so the public route accepts `presets` as the source-level field name. Keep route logic thin: parse JSON, forward `tools + presets + scopeKey`, map errors, serialize response.

- [ ] **Step 2: Decide and implement compatibility behavior**

Preferred implementation:
- accept only `presets` in the formal contract
- if temporary backward compatibility for `toolGroups` is needed, document it explicitly and isolate it to serde compatibility only

Do not preserve both names as first-class long-term semantics.

- [ ] **Step 3: Run route-focused tests**

Run:

```bash
cargo test -p exomind-runtime routes::agent_sessions::tests::route_ -- --nocapture
```

Expected: route tests pass with the renamed request surface.

- [ ] **Step 4: Commit the route update**

```bash
git add crates/exomind-runtime/src/routes/agent_sessions.rs
git commit -m "feat(rt): rename agent tool presets surface"
```

## Task 5: Re-verify end-to-end stories and refresh docs

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Create: `docs/testing/agent-turn-broker-presets-and-tools.md`

- [ ] **Step 1: Add/update non-sensitive request examples**

Document combined-source request examples such as:

```json
{
  "presets": ["recent_events"],
  "tools": [
    {
      "name": "get_weather",
      "description": "返回今天的天气",
      "inputSchema": {
        "type": "object",
        "properties": {
          "date": { "type": "string", "enum": ["today"] }
        },
        "required": ["date"],
        "additionalProperties": false
      }
    }
  ],
  "scopeKey": "profile-alpha"
}
```

- [ ] **Step 2: Re-run the current real-upstream and route regressions**

Run serially:

```bash
cargo test -p exomind-runtime route_runs_session_with_runtime_config_fallback --test agent_api_rt -- --nocapture
cargo test -p exomind-runtime broker_weather_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
cargo test -p exomind-runtime broker_proposal_story_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

And if the preset+tool combined HTTP harness exists, run that too against an actually started RT instance.

If any real-upstream run hits `401`, stop immediately and report instead of continuing.

- [ ] **Step 3: Write/update the testing note**

Create `docs/testing/agent-turn-broker-presets-and-tools.md` with:
- updated source model (`tools` + `presets`)
- request/response examples
- exact commands
- expected results
- note that HTTP still does not execute tools

- [ ] **Step 4: Commit verification/docs updates**

```bash
git add crates/exomind-runtime/tests/agent_api_rt.rs \
        docs/testing/agent-turn-broker-presets-and-tools.md
git commit -m "test(rt): verify presets and tools session flow"
```

## Task 6: Push and sync issue tracking

**Files:**
- Modify: GitHub issue `#823`
- Optional back-link: GitHub issue `#830`

- [ ] **Step 1: Push the branch**

```bash
git push origin dev
```

- [ ] **Step 2: Post the main progress comment to `#823`**

The issue comment should include:
- why `toolGroups` is being replaced by `presets`
- why `tools + presets` must be allowed together
- the Rust-layer merge rule
- the duplicate-name rejection rule
- GitHub permalinks for the updated design, route, resolver, and tests
- non-sensitive request examples

- [ ] **Step 3: Add a short back-link to `#830` only if proposal-story verification changed materially**

If proposal behavior is only re-verified and not materially changed, keep `#830` to a short back-link rather than another full report.

- [ ] **Step 4: Final verification before close-out**

Run:

```bash
git status --short
git log --oneline -5
```

Expected:
- working tree clean
- commits present locally and remotely

