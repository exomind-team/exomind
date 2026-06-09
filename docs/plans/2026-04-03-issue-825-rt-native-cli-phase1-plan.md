# ExoMind RT Client CLI Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Rust-native ExoMind CLI that acts as the third client shell beside Web and Tauri, with Phase 1 covering `task / proposal / eventlog` and giving both humans and notebook skills one stable command surface over a running RT.

**Architecture:** Add a new workspace crate `crates/exomind-cli` that behaves as an RT client shell, not a store-side bypass tool. The CLI defaults to `connect-first` by resolving and connecting to an existing local RT, supports explicit `--target host:port`, and only spawns a local RT when the user explicitly asks or enables `--spawn-if-missing`. The top-level UX is homepage-first: running `exomind` without arguments shows a readable help homepage with examples, while `--json` keeps the same commands stable for Agent / script use.

**Tech Stack:** Rust 2024, `clap` derive parsing, `reqwest`, `serde`, `serde_json`, `tokio`, `chrono`, `thiserror`, `dirs`, existing `exomind-runtime` route/domain types

---

## Scope

### In Scope

- Add a new workspace crate and binary for ExoMind CLI
- Define CLI as **client shell（客户端外壳）**, not direct SQLite/store editor
- Default topology: one machine, one primary local RT
- Phase 1 command families:
  - `eventlog add / list / get / watch`
  - `task add / list / get / update / start / complete / cancel / suspend / resume`
  - `proposal add / list / get / approve / reject / snooze / comment`
  - `rt status / probe / use / clear-default`
  - `examples`
- Explicit target selection via `--target host:port`
- Explicit scope selection via `--profile` / `--user-id`
- Lightweight local CLI state for default target / default profile / auth token caching
- Optional local RT bootstrap when explicitly requested
- Homepage-style zero-arg help with examples for humans and Agents
- `--json` output path for stable machine-readable invocation
- Docs/examples for downstream notebook skill invocation

### Out of Scope

- No TUI in this phase
- No PTY / terminal agent workbench
- No full mirror of every RT route
- No multi-RT sync orchestration in Phase 1
- No notebook-repo code changes in this plan
- No silent background RT spawn by default

## Architecture Principles

1. **Connect-first（优先连接）**
   - CLI first tries to connect to an existing RT
   - It does not silently create a second RT by default

2. **CLI = RT client shell（CLI 是 RT 客户端外壳）**
   - Business actions go through RT HTTP contracts
   - CLI does not directly mutate stores as the normal path

3. **Single local RT first（单机单主 RT 优先）**
   - Default local usage assumes one primary RT on the machine
   - Multi-RT is an explicit advanced mode, not baseline behavior

4. **Human-first homepage, Agent-first contract（首页对人友好，契约对 Agent 稳定）**
   - `exomind` with no args prints a usable homepage with examples
   - `--json` keeps command outputs deterministic for automation

5. **RT remains source of truth（RT 是真相源）**
   - Signal emission, session behavior, proposal execution, watches, and auth all stay in RT
   - CLI should not bypass those semantics by touching stores directly

## Default Target Resolution

Phase 1 should resolve the target in this order:

1. `--target host:port`
2. saved default target in CLI state
3. local discovery over candidate ports:
   - `9124`
   - `1950`
   - `1949`
4. if not found and `--spawn-if-missing` is set:
   - start a local RT via `exomind-rt`
   - wait for `/health`
   - connect
5. otherwise fail with a clear message

## Local CLI State

The CLI should maintain a small local state file, for example:

```json
{
  "default_target": "127.0.0.1:9124",
  "targets": {
    "127.0.0.1:9124": {
      "default_profile": "profile-argon",
      "auth_token": "optional",
      "last_seen_at": "2026-04-03T11:20:00Z"
    }
  }
}
```

This is **client state（客户端状态）**, not new business data.

## UX Shape

### Zero-arg homepage

```text
exomind
```

Should print:

- what the CLI is
- `connect-first` default behavior
- common human examples
- Agent / script examples with `--json`
- pointers to `exomind examples`, `exomind task`, `exomind proposal`, `exomind eventlog`, `exomind rt`

### Example command surface

```text
exomind rt status
exomind rt probe
exomind rt use 127.0.0.1:9124
exomind examples

exomind task add --profile argon --title "整理浏览器标签" --tag cleanup --priority high
exomind task list --profile argon --status pending
exomind task get --profile argon <task-id>
exomind task update --profile argon <task-id> --title "整理三个屏幕程序"
exomind task start --profile argon <task-id>
exomind task complete --profile argon <task-id>
exomind task cancel --profile argon <task-id>

exomind proposal add --profile argon --action create_task --title "建议：整理浏览器标签" --params-file proposal.json
exomind proposal list --profile argon --status pending
exomind proposal get --profile argon <proposal-id>
exomind proposal approve --profile argon <proposal-id>
exomind proposal reject --profile argon <proposal-id>
exomind proposal snooze --profile argon <proposal-id>
exomind proposal comment --profile argon <proposal-id> --content "先改成低优先级"

exomind eventlog add --profile argon --content "补记今天的口述" --tag note --tag voice
exomind eventlog list --profile argon --limit 20
exomind eventlog get --profile argon <event-id>
exomind eventlog watch --profile argon --since-id <event-id>
```

### Important route compatibility note

- `task / proposal` routes already accept `profile_id` and `user_id`
- `eventlog` currently only accepts `user_id`
- CLI should keep a single public flag surface and map internally to the current RT contracts
- `eventlog add` should trust the RT-generated event ID returned by the server

## File Map

### Create

- `crates/exomind-cli/Cargo.toml`
- `crates/exomind-cli/src/lib.rs`
- `crates/exomind-cli/src/main.rs`
- `crates/exomind-cli/src/cli.rs`
- `crates/exomind-cli/src/error.rs`
- `crates/exomind-cli/src/output.rs`
- `crates/exomind-cli/src/examples.rs`
- `crates/exomind-cli/src/state.rs`
- `crates/exomind-cli/src/profile_scope.rs`
- `crates/exomind-cli/src/target.rs`
- `crates/exomind-cli/src/runtime_client.rs`
- `crates/exomind-cli/src/commands/mod.rs`
- `crates/exomind-cli/src/commands/eventlog.rs`
- `crates/exomind-cli/src/commands/task.rs`
- `crates/exomind-cli/src/commands/proposal.rs`
- `crates/exomind-cli/src/commands/rt.rs`
- `crates/exomind-cli/tests/cli_parse.rs`
- `crates/exomind-cli/tests/help_output.rs`
- `crates/exomind-cli/tests/target_resolution.rs`
- `crates/exomind-cli/tests/eventlog_smoke.rs`
- `crates/exomind-cli/tests/task_smoke.rs`
- `crates/exomind-cli/tests/proposal_smoke.rs`
- `docs/development/exomind-cli.md`

### Modify

- `Cargo.toml`
- `docs/README.md`

---

### Task 1: Scaffold the workspace crate, homepage help, and root command tree

**Files:**
- Modify: `Cargo.toml`
- Create: `crates/exomind-cli/Cargo.toml`
- Create: `crates/exomind-cli/src/lib.rs`
- Create: `crates/exomind-cli/src/main.rs`
- Create: `crates/exomind-cli/src/cli.rs`
- Create: `crates/exomind-cli/src/output.rs`
- Create: `crates/exomind-cli/src/examples.rs`
- Create: `crates/exomind-cli/tests/cli_parse.rs`
- Create: `crates/exomind-cli/tests/help_output.rs`

**Step 1: Write failing parser and homepage tests**

Add tests that expect:

```rust
#[test]
fn root_help_mentions_eventlog_task_proposal_rt_and_examples() {}

#[test]
fn running_without_args_renders_homepage_help() {}

#[test]
fn examples_command_lists_human_and_agent_examples() {}

#[test]
fn global_target_and_profile_flags_parse() {}

#[test]
fn proposal_approve_parses_numeric_id() {}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test -p exomind-cli --test cli_parse --test help_output
```

Expected: fail because the crate does not exist yet.

**Step 3: Implement the crate skeleton**

- Add `crates/exomind-cli` to workspace members
- Add dependencies:
  - `clap = { version = "4", features = ["derive"] }`
  - `reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }`
  - `serde`, `serde_json`, `tokio`, `chrono`, `thiserror`, `dirs`
  - `exomind-runtime = { path = "../exomind-runtime" }`
- Define root command tree:
  - global: `--target`, `--profile`, `--user-id`, `--json`, `--spawn-if-missing`
  - subcommands: `eventlog`, `task`, `proposal`, `rt`, `examples`
- Make `exomind` with no args print homepage help instead of missing-args failure
- Put examples in a single reusable registry

**Step 4: Run parser and help tests**

Run:

```bash
cargo test -p exomind-cli --test cli_parse --test help_output
```

Expected: pass.

**Step 5: Commit**

```bash
git add Cargo.toml crates/exomind-cli docs/plans/2026-04-03-issue-825-rt-native-cli-phase1-plan.md
git commit -m "feat(cli): scaffold rt client cli crate"
```

**Step 6: Push branch and open draft PR**

Run:

```bash
git push -u origin feature/issue-825-rt-native-cli-phase1
gh pr create --draft --base dev --head feature/issue-825-rt-native-cli-phase1 --title "feat(cli): add RT-native connect-first CLI shell" --body-file docs/plans/2026-04-03-issue-825-rt-native-cli-phase1-plan.md
```

Expected:

- branch pushed
- draft PR created against `dev`

---

### Task 2: Add CLI local state, target resolution, and scope normalization

**Files:**
- Create: `crates/exomind-cli/src/state.rs`
- Create: `crates/exomind-cli/src/target.rs`
- Create: `crates/exomind-cli/src/profile_scope.rs`
- Create: `crates/exomind-cli/tests/target_resolution.rs`

**Step 1: Write failing resolution tests**

Add tests for:

```rust
#[test]
fn explicit_target_wins_over_saved_target() {}

#[test]
fn saved_target_wins_over_local_probe() {}

#[test]
fn profile_flag_becomes_profile_scope_key() {}

#[test]
fn profile_scope_is_not_double_prefixed() {}

#[test]
fn eventlog_scope_maps_profile_to_user_id_query() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: fail because state/target helpers do not exist.

**Step 3: Implement local state**

Define a small persisted state file under a standard client config path, for example:

- Windows: `%APPDATA%/ExoMind/cli-state.json`
- fallback: project-local temp path in tests

State should include:

- `default_target`
- `targets[target].default_profile`
- `targets[target].auth_token`
- `targets[target].last_seen_at`

**Step 4: Implement target resolution and scope normalization**

Resolution order:

1. explicit `--target`
2. saved default target
3. local probe over `9124`, `1950`, `1949`
4. optional spawn path if `--spawn-if-missing`

Profile resolution:

- `--profile argon` -> `profile-argon`
- `--profile profile-argon` stays `profile-argon`
- `--user-id profile-argon` stays exact
- `eventlog` routes should receive the resolved scope through `user_id`

**Step 5: Run tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: pass.

**Step 6: Commit**

```bash
git add crates/exomind-cli/src/state.rs crates/exomind-cli/src/target.rs crates/exomind-cli/src/profile_scope.rs crates/exomind-cli/tests/target_resolution.rs
git commit -m "feat(cli): add target resolution and client state"
```

---

### Task 3: Implement the shared RT HTTP client, errors, and output modes

**Files:**
- Create: `crates/exomind-cli/src/runtime_client.rs`
- Create: `crates/exomind-cli/src/error.rs`
- Modify: `crates/exomind-cli/src/output.rs`
- Modify: `crates/exomind-cli/src/main.rs`

**Step 1: Write a failing smoke test for health resolution**

Add a test that spins up a tiny mock HTTP server and asserts the client:

- resolves a healthy RT target
- attaches saved auth token correctly
- appends scope query helpers correctly
- preserves clean JSON output mode

**Step 2: Run the failing test**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: fail because the HTTP client does not exist yet.

**Step 3: Implement `RuntimeClient`**

Required helpers:

- `health()`
- `get_json(path)`
- `post_json(path, body)`
- `put_json(path, body)`
- `patch_json(path, body)`
- `delete_json(path)`
- `with_scope(path, scope_query)`

Requirements:

- respect optional saved token
- support `--json` output cleanly
- return structured errors with status code + body preview

**Step 4: Run tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: pass.

**Step 5: Commit**

```bash
git add crates/exomind-cli/src/runtime_client.rs crates/exomind-cli/src/error.rs crates/exomind-cli/src/output.rs crates/exomind-cli/src/main.rs
git commit -m "feat(cli): add shared runtime http client"
```

---

### Task 4: Implement `rt` commands for inspect, connect, and explicit bootstrap

**Files:**
- Create: `crates/exomind-cli/src/commands/rt.rs`
- Modify: `crates/exomind-cli/src/cli.rs`
- Modify: `crates/exomind-cli/tests/target_resolution.rs`

**Step 1: Write failing tests for RT control commands**

Add tests for:

```rust
#[test]
fn rt_status_reports_selected_target() {}

#[test]
fn rt_use_sets_default_target() {}

#[test]
fn rt_probe_lists_candidate_ports() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: fail because `rt` subcommands are missing.

**Step 3: Implement `rt` command family**

Phase 1 commands:

- `rt status`
- `rt probe`
- `rt use <host:port>`
- `rt clear-default`

Optional, only if straightforward:

- `rt ensure --spawn-if-missing`

Important:

- if spawn is implemented in Phase 1, it must be explicit
- do not make ordinary business commands silently launch a new RT

**Step 4: Run tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: pass.

**Step 5: Commit**

```bash
git add crates/exomind-cli/src/commands/rt.rs crates/exomind-cli/src/cli.rs crates/exomind-cli/tests/target_resolution.rs
git commit -m "feat(cli): add rt target management commands"
```

---

### Task 5: Implement eventlog commands over RT routes

**Files:**
- Create: `crates/exomind-cli/src/commands/eventlog.rs`
- Create: `crates/exomind-cli/tests/eventlog_smoke.rs`

**Step 1: Write failing eventlog smoke tests**

Add tests for:

```rust
#[test]
fn eventlog_add_posts_to_scoped_rt_endpoint() {}

#[test]
fn eventlog_list_reads_latest_first() {}

#[test]
fn eventlog_watch_polls_for_new_events() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test eventlog_smoke
```

Expected: fail because command handlers do not exist.

**Step 3: Implement `eventlog add / list / get / watch`**

Requirements:

- `add`
  - sends timestamp/content/tags to RT
  - trusts the RT-generated event ID returned by the server
  - supports repeated `--tag`
- `list`
  - supports `--limit`
  - supports `--tag`
- `get`
  - fetches one event by id
- `watch`
  - uses RT `/eventlog/watch`
  - supports `--since-id`
- scope should be sent through `user_id`

**Step 4: Run tests**

Run:

```bash
cargo test -p exomind-cli --test eventlog_smoke
```

Expected: pass.

**Step 5: Commit**

```bash
git add crates/exomind-cli/src/commands/eventlog.rs crates/exomind-cli/tests/eventlog_smoke.rs
git commit -m "feat(cli): add eventlog command family"
```

---

### Task 6: Implement task commands over RT routes with high-level wrappers

**Files:**
- Create: `crates/exomind-cli/src/commands/task.rs`
- Create: `crates/exomind-cli/tests/task_smoke.rs`

**Step 1: Write failing task smoke tests**

Add tests for:

```rust
#[test]
fn task_add_posts_create_task_payload() {}

#[test]
fn task_cancel_hides_pending_to_in_progress_transition_detail() {}

#[test]
fn task_complete_uses_transition_shortcut_path() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test task_smoke
```

Expected: fail because handlers do not exist.

**Step 3: Implement `task` command family**

Required commands:

- `add`
- `list`
- `get`
- `update`
- `start`
- `suspend`
- `resume`
- `complete`
- `cancel`

Implementation rules:

- prefer application-level verbs
- CLI may internally call `/tasks/:id/transition?shortcut=true`
- user should not need to remember raw RT transition constraints
- support `--status`, `--tag`, `--parent-id` on list

**Step 4: Run tests**

Run:

```bash
cargo test -p exomind-cli --test task_smoke
```

Expected: pass.

**Step 5: Commit**

```bash
git add crates/exomind-cli/src/commands/task.rs crates/exomind-cli/tests/task_smoke.rs
git commit -m "feat(cli): add task command family"
```

---

### Task 7: Implement proposal commands over RT routes

**Files:**
- Create: `crates/exomind-cli/src/commands/proposal.rs`
- Create: `crates/exomind-cli/tests/proposal_smoke.rs`

**Step 1: Write failing proposal smoke tests**

Add tests for:

```rust
#[test]
fn proposal_add_posts_pending_proposal() {}

#[test]
fn proposal_approve_patches_status_to_approved() {}

#[test]
fn proposal_comment_posts_discussion_entry() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test proposal_smoke
```

Expected: fail because handlers do not exist.

**Step 3: Implement `proposal add / list / get / approve / reject / snooze / comment`**

Requirements:

- `add`
  - supports `--action create_task|append_event|start_timeblock`
  - supports `--params-json` or `--params-file`
- `approve`
  - sends patch to RT; RT executes the approved proposal
- `reject`
  - patch status to rejected
- `snooze`
  - patch status to snoozed
- `comment`
  - supports content + optional author override

**Step 4: Run tests**

Run:

```bash
cargo test -p exomind-cli --test proposal_smoke
```

Expected: pass.

**Step 5: Commit**

```bash
git add crates/exomind-cli/src/commands/proposal.rs crates/exomind-cli/tests/proposal_smoke.rs
git commit -m "feat(cli): add proposal command family"
```

---

### Task 8: Persist target-scoped defaults, finalize docs, and verify CLI UX

**Files:**
- Modify: `crates/exomind-cli/src/state.rs`
- Modify: `crates/exomind-cli/src/target.rs`
- Modify: `crates/exomind-cli/src/output.rs`
- Create: `docs/development/exomind-cli.md`
- Modify: `docs/README.md`

**Step 1: Write failing tests for target-scoped defaults**

Add tests for:

```rust
#[test]
fn saved_default_profile_is_reused_for_same_target() {}

#[test]
fn saved_token_is_attached_only_for_matching_target() {}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test -p exomind-cli --test target_resolution
```

Expected: fail until state wiring is complete.

**Step 3: Implement state persistence polish**

- allow saving default profile per target
- allow storing optional auth token per target
- ensure explicit flags override saved values
- make homepage/examples output reflect final command surface

**Step 4: Write user-facing documentation**

Document:

- how target resolution works
- why CLI defaults to connect-first
- how to set a default target
- how notebook skills should call the CLI
- examples for `task / proposal / eventlog`
- how `--spawn-if-missing` differs from default behavior
- how zero-arg homepage help and `examples` command work

**Step 5: Run final verification**

Run:

```bash
cargo test -p exomind-cli
cargo run -p exomind-cli
cargo run -p exomind-cli -- examples
cargo run -p exomind-cli -- rt status
cargo run -p exomind-cli -- task --help
cargo run -p exomind-cli -- proposal --help
cargo run -p exomind-cli -- eventlog --help
```

Expected:

- all CLI tests pass
- zero-arg homepage renders
- examples command renders all samples
- help output renders
- docs reflect connect-first topology

**Step 6: Commit**

```bash
git add crates/exomind-cli docs/development/exomind-cli.md docs/README.md
git commit -m "docs(cli): finalize connect-first rt client guide"
```

---

## Verification Checklist

- `cargo test -p exomind-cli`
- `cargo run -p exomind-cli`
- `cargo run -p exomind-cli -- examples`
- `cargo run -p exomind-cli -- rt probe`
- `cargo run -p exomind-cli -- task --help`
- `cargo run -p exomind-cli -- proposal --help`
- `cargo run -p exomind-cli -- eventlog --help`

## Notes for Implementers

- Keep `CLI = RT client shell` as the first principle
- Do not bypass RT runtime behavior by directly editing stores as the default path
- Do not silently spawn an RT for ordinary commands
- Keep multi-RT support explicit and minimal in Phase 1
- Treat issue #825 as the concrete implementation track and #74 as the broader CLI umbrella
- Keep the public command surface stable for notebook skills and other automation
