# Agent File Search Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an upgraded API Agent experiment that only reveals the filename `agent_api_rt.rs`, gives the Agent read-only `pwd` / `ls` / `cd` tools, validates one real HTTP free-search run, and adds one real-upstream Rust regression test that proves genuine multi-step search behavior.

**Architecture:** Keep runtime production behavior unchanged. Extend the existing real-upstream integration test harness in `agent_api_rt.rs` to simulate external `pwd` / `ls` / `cd` tools under a root directory boundary, and add a separate HTTP validation document for the free-search experiment. Use mixed validation: HTTP for realism, Rust for strict regression guarantees.

**Tech Stack:** Rust, Axum, Reqwest, Serde, Tokio, existing ExoMind runtime broker/session code, `cargo test`, `curl`, shell/Python helper commands

---

## File Map

### Modified files

- `crates/exomind-runtime/tests/agent_api_rt.rs`
  - Add upgraded real-upstream file-search test
  - Extend external tool harness with `pwd` and `cd("..")`
  - Add stronger behavioral assertions and detailed logging
- `docs/testing/agent-turn-broker-http-file-search.md`
  - New HTTP free-search validation procedure

### Existing references to inspect while implementing

- `docs/superpowers/specs/2026-04-03-agent-file-search-tools-design.md`
- `crates/exomind-runtime/tests/agent_api_rt.rs`
- `crates/exomind-runtime/src/agent/broker.rs`
- `crates/exomind-runtime/src/routes/agent_sessions.rs`
- `docs/testing/agent-turn-broker-http-weather.md`

## Task 1: Add Failing Rust Test For Real-Upstream File Search

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Write the failing test skeleton**

Add a new real-upstream test next to the current `broker_ls_cd_flow...` test:

```rust
#[tokio::test]
async fn broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present() {}
```

The new test must:
- reuse the existing real-upstream provider env loader
- reuse `EXOMIND_AGENT_API_RT_FS_ROOT`
- use tools `pwd`, `ls`, `cd`
- only mention filename `agent_api_rt.rs` in the prompt

- [ ] **Step 2: Run the targeted test to verify failure**

Run:

```bash
cargo test -p exomind-runtime broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:
- compile or assertion failure because the new test/harness behavior is not implemented yet

- [ ] **Step 3: Commit nothing yet**

Do not commit until the test passes.

## Task 2: Extend External Tool Harness With `pwd` And Safe `cd("..")`

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Update the external tool helper**

Extend the existing helper so it supports:

```rust
fn execute_external_fs_tool_call(...)
```

Required behavior:
- `pwd` returns relative current directory or `.`
- `ls` requires empty input object and returns sorted entries
- `cd` accepts a direct child directory name or `..`
- `cd ..` at root returns a stable explicit error
- all resulting paths must remain under `EXOMIND_AGENT_API_RT_FS_ROOT`

- [ ] **Step 2: Add strict helper assertions**

Add assertions for:
- `pwd` input is empty
- `ls` input is empty
- `cd` input exists and is a single segment or `..`
- no escape above root

- [ ] **Step 3: Re-run targeted test**

Run:

```bash
cargo test -p exomind-runtime broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:
- still failing, but now because the scenario assertions are not complete yet

## Task 3: Implement Strong Search-Behavior Assertions In Rust Test

**Files:**
- Modify: `crates/exomind-runtime/tests/agent_api_rt.rs`
- Test: `crates/exomind-runtime/tests/agent_api_rt.rs`

- [ ] **Step 1: Implement mixed-behavior assertions**

The Rust test must not require one exact path, but it must require search evidence:

- at least one `pwd`
- at least one `ls`
- at least one `cd`
- more than one total tool call
- not `completed` in the first two turns
- final path equals `crates/exomind-runtime/tests/agent_api_rt.rs`
- final answer includes the full path

- [ ] **Step 2: Add detailed `--nocapture` logging**

Print per turn:
- turn number
- history length
- current directory
- session id
- status
- assistant tool calls
- executed tool
- tool output
- final answer

- [ ] **Step 3: Run without env to verify skip path**

Run:

```bash
cargo test -p exomind-runtime broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:
- skip message
- test passes

- [ ] **Step 4: Run with real upstream env to verify success**

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
print(f"export EXOMIND_AGENT_API_MODEL={config.get('model', '')!r}")
print(f"export EXOMIND_AGENT_API_BASE_URL={base_url!r}")
print(f"export EXOMIND_AGENT_API_KEY={auth.get('OPENAI_API_KEY', '')!r}")
print('export EXOMIND_AGENT_API_RT_FS_ROOT=/data/data/com.termux/files/home/A137442/exomind')
PY
)"

cargo test -p exomind-runtime broker_file_search_flow_skips_without_env_and_uses_real_upstream_when_present --test agent_api_rt -- --nocapture
```

Expected:
- PASS
- output shows multi-step search behavior
- output includes `pwd`, `ls`, and `cd`

- [ ] **Step 5: Commit**

```bash
git add crates/exomind-runtime/tests/agent_api_rt.rs
git commit -m "test(rt): add real-upstream file search broker flow"
```

## Task 4: Write HTTP Free-Search Validation Doc

**Files:**
- Create: `docs/testing/agent-turn-broker-http-file-search.md`

- [ ] **Step 1: Write the HTTP validation procedure**

Document:
- RT startup commands
- `.codex`-derived provider env commands
- first request body with tools `pwd` / `ls` / `cd`
- harness loop concept for continuation history
- final validation checks

- [ ] **Step 2: Include the key schema rule**

Explicitly state:

```text
tool_result.toolCallId must come from assistantTurn.toolCalls[*].id
```

- [ ] **Step 3: Include free-search acceptance criteria**

Document must require:
- prompt only contains filename `agent_api_rt.rs`
- final answer contains repo-relative full path
- logs prove multi-step tool usage

- [ ] **Step 4: Commit**

```bash
git add docs/testing/agent-turn-broker-http-file-search.md
git commit -m "docs(testing): add HTTP file search broker validation"
```

## Task 5: Run End-To-End HTTP Free-Search Experiment

**Files:**
- Reference: `docs/testing/agent-turn-broker-http-file-search.md`

- [ ] **Step 1: Start RT on an isolated port**

Run:

```bash
export EXOMIND_RT_PORT=1952
export EXOMIND_RT_BIND=127.0.0.1
export EXOMIND_RT_DISABLE_TS_AGENTS=1
export EXOMIND_RT_DATA_DIR="$PWD/.tmp/rt-agent-file-search"
cargo run -p exomind-runtime
```

- [ ] **Step 2: Verify `/health`**

Run:

```bash
curl -sS http://127.0.0.1:1952/health
```

Expected:

```json
{"status":"ok"}
```

- [ ] **Step 3: Execute the free-search loop**

Use a harness script or documented commands to:
- send the first request
- execute returned `pwd` / `ls` / `cd`
- append continuation history
- repeat until `completed`

- [ ] **Step 4: Verify acceptance**

Confirm:
- Agent only got filename information
- Agent produced the full path
- tool logs show multiple turns and real search behavior

- [ ] **Step 5: Capture evidence**

Save or summarize:
- tool sequence
- final path
- final answer
- any notable failures or retries

## Task 6: Issue Tracking Backfill

**Files:**
- Reference: `#823`

- [ ] **Step 1: Post a progress comment**

Include:
- pushed test commit
- GitHub permalinks for the new Rust test
- HTTP validation doc path
- sample non-sensitive request/response structures
- key `--nocapture` output snippet

- [ ] **Step 1.5: Push before permlink backfill**

Run:

```bash
git push origin dev
```

Expected:
- remote contains the new test/doc commit before issue comment uses permalinks

- [ ] **Step 2: Link both validation modes**

The comment must clearly distinguish:
- HTTP free-search validation
- Rust strong-assertion validation

- [ ] **Step 3: Verify worktree is clean**

Run:

```bash
git status --short
```

Expected:
- empty output
