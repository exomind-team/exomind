# ECS Phase 3 Test Baseline Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the current ECS Phase 2 mesh relay implementation into a regression-safe multi-runtime baseline for `#373`.

**Architecture:** Reuse the existing runtime mesh implementation and integration test style, but consolidate the tests around a shared two-runtime harness. The first target is not new protocol behavior; the first target is reliable proof that relay / replay / dedupe / hop guard / reconnect remain green while Phase 3 continues. This also creates the verification bedrock required before adding observability (`#372`) and same-host IPC transport (`#371`).

**Tech Stack:** Rust, Tokio, Axum, reqwest, exomind-runtime integration tests, GitHub issue sync

---

## 1. Why `#373` goes first

`#371` and `#372` both depend on stable verification:

- `#371` introduces transport variation (`Named Pipe / Unix Socket` fallback), which will be much harder to debug without a known-good relay baseline.
- `#372` adds runtime observability surfaces, but the UI/debug output is only useful if the underlying mesh behaviors already have deterministic regression coverage.

Therefore Phase 3 should start with `#373`.

## 2. Scope of `#373`

`#373` should deliver:

- a shared multi-runtime integration harness
- explicit failure-injection scenarios
- a small but authoritative regression matrix for ECS Phase 2 behavior
- reproducible verification commands for issue review

`#373` should **not** deliver:

- same-host IPC transport
- Agent Hub observability UI
- desktop ↔ mobile user-data replication

That last point is important: desktop/mobile data interoperability without the current sync server is **larger** than `#373`, and larger than Phase 3 as currently scoped. The ECS mesh can carry signals, but user data replication for tasks / eventlog / reminders still needs a dedicated data-sync design on top of ECS or a replacement storage sync path.

## 3. Definition of Done

`#373` is done only when all of the following are true:

- there is a shared two-runtime test harness instead of ad-hoc setup copied across multiple tests
- the automated suite covers:
  - relay success
  - peer reconnect
  - `Last-Event-ID` replay
  - dedupe by `event.id`
  - hop-limit skip
  - origin bounce suppression
  - bounded runtime shutdown with active peer stream
- at least one failure-injection test proves the system reports or recovers from a broken peer path
- test commands are documented and reproducible from the repository root
- `#373` issue comment contains the local doc path, scope boundary, and verification commands

## 4. Test Matrix

### 4.1 Green-path matrix

1. `relay_success`
   runtime A publishes a `TargetType::Remote` event and runtime B receives it once.

2. `replay_after_gap`
   runtime B reconnects or reads from `Last-Event-ID`, and only the missing event(s) are replayed.

3. `dedupe_overlap`
   the same `event.id` appears through overlapping relay/replay paths, and runtime B ingests it only once.

4. `hop_limit_enforced`
   an event at `MAX_HOP` is skipped and not re-injected.

5. `origin_bounce_suppressed`
   an event is not sent back toward its origin host.

6. `shutdown_bounded`
   a runtime with active peer stream(s) can still stop within the bounded timeout.

### 4.2 Failure-injection matrix

1. `peer_http_failure_marks_error`
   a configured peer endpoint is unreachable or returns error; the mesh state should mark the peer error path without crashing the runtime.

2. `stream_disconnect_recovery`
   an existing stream drops; the worker should reconnect and resume from `Last-Event-ID`.

## 5. Implementation Tasks

### Task 1: Document the baseline and sync `#373`

**Files:**
- Create: `docs/plans/2026-03-06-ecs-phase3-test-baseline-plan.md`
- Modify: GitHub issue `#373` via progress comment

**Step 1: Freeze the scope**

Capture:
- why `#373` starts before `#372` and `#371`
- what is included in the baseline
- what is explicitly out of scope

**Step 2: Sync issue context**

Comment on `#373` with:
- local document path
- DoD
- test matrix
- final acceptance gap note for desktop/mobile no-sync-server replication

### Task 2: Introduce shared multi-runtime harness

**Files:**
- Create or modify: `crates/exomind-runtime/tests/support/mod.rs`
- Modify: `crates/exomind-runtime/tests/mesh_relay_integration.rs`
- Modify: `crates/exomind-runtime/tests/mesh_guard_integration.rs`

**Step 1: Write a failing harness test or refactor target**

Extract common setup for:
- start runtime with custom `host_id`
- create peer links
- install remote/local routes
- publish event and inspect signal window
- stop runtimes with timeout

**Step 2: Run targeted tests**

Run:
`cargo test -p exomind-runtime mesh_relay_integration`

Expected:
either FAIL from missing harness extraction or PASS before refactor; if already PASS, add a new harness-only test that fails first.

### Task 3: Add missing failure-injection coverage

**Files:**
- Modify: `crates/exomind-runtime/tests/mesh_relay_integration.rs`
- Create or modify: `crates/exomind-runtime/tests/mesh_failure_integration.rs`

**Step 1: Add red tests**

Add at least:
- broken peer HTTP path marks peer error
- dropped stream can recover and replay from `Last-Event-ID`

**Step 2: Verify red**

Run:
`cargo test -p exomind-runtime mesh_failure_integration`

Expected:
FAIL if the failure handling path is not fully covered yet.

### Task 4: Implement minimal runtime changes for testability

**Files:**
- Modify: `crates/exomind-runtime/src/mesh/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`

**Step 1: Add only the minimum hooks needed by tests**

Possible examples:
- expose peer delivery state accessors needed by integration tests
- ensure reconnect timing or error-state transitions are deterministic enough for tests
- avoid adding production-only complexity

**Step 2: Re-run targeted tests**

Run:
- `cargo test -p exomind-runtime mesh_relay_integration`
- `cargo test -p exomind-runtime mesh_guard_integration`
- `cargo test -p exomind-runtime mesh_failure_integration`

Expected:
PASS

### Task 5: Run the authoritative verification set

**Files:**
- Verify only

Run:
- `cargo test -p exomind-runtime`
- `npx tsc --noEmit`

Expected:
- all runtime tests green
- TypeScript contracts remain green

## 6. Review Note About Final Acceptance

If the project goal is:

`desktop + mobile can exchange user data without the current sync server`

then `#373 -> #372 -> #371` is only the Phase 3 protocol-stack order. It is **not** the full delivery path.

After `#373/#372/#371`, one more track is still required:

- ECS-backed data replication for user state (`eventlog / task / reminder / active block`) over mesh or a new storage-sync layer

Without that extra track, the project can claim:

- cross-runtime signal interoperability
- observability
- same-host IPC optimization

but it still cannot honestly claim:

- full desktop/mobile user-data interoperability without the current sync server

---

## Implementation Result（实施结果）

**Status:** In progress on 2026-03-06

### Delivered in this round

- Added a shared runtime test harness:
  - `crates/exomind-runtime/tests/support/mod.rs`
- Refactored relay integration tests to use the shared harness:
  - `crates/exomind-runtime/tests/mesh_relay_integration.rs`
- Added failure-injection coverage:
  - `crates/exomind-runtime/tests/mesh_failure_integration.rs`
- Added minimal test-facing runtime accessors:
  - `RuntimeHandle::clone_mesh_state()`
  - `RuntimeHandle::clone_mesh_relay()`

### Verified scenarios

- `relay_success`
- `replay_after_gap`
- `dedupe_overlap`
- `hop_limit_enforced`
- `peer_http_failure_marks_error`
- `stream_disconnect_recovery`
- `shutdown_bounded`

### Verification commands

- `cargo test -p exomind-runtime --test mesh_relay_integration -- --nocapture`
- `cargo test -p exomind-runtime --test mesh_failure_integration -- --nocapture`
- `cargo test -p exomind-runtime --test mesh_guard_integration -- --nocapture`
- `cargo test -p exomind-runtime`
- `npx tsc --noEmit`

### Current conclusion

`#373` is now materially underway and no longer just a placeholder issue. The multi-runtime ECS baseline has:

- shared harness support
- explicit failure-injection coverage
- full runtime regression proof still green

What is **still not delivered** is the separate cross-device user-data replication track needed for desktop/mobile interoperability without the current sync server.
