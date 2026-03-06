# ECS Phase 2 Mesh Relay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the first working ECS-3 loop for ExoMind: `PeerRegistry + TargetType::Remote + interest snapshot + cross-runtime relay`.

**Architecture:** Phase 2 keeps the existing SignalPool as the only local bus and adds a thin mesh layer around it. Each runtime stores static peers, derives local interests from non-remote routes, exposes a peer-facing SSE mesh stream, and runs lightweight peer workers that subscribe to remote mesh streams and inject deduped relay events back into the local SignalPool.

**Tech Stack:** Rust, Axum, Tokio, reqwest, existing SignalPool / RouteTable / Journal / WindowCache, TypeScript signal contracts

---

### Task 1: Freeze the phase 2 design

**Files:**
- Create: `docs/plans/2026-03-06-ecs-phase2-mesh-relay-plan.md`
- Modify: GitHub issues `#369`, `#370` via progress comment

**Step 1: Capture the chosen relay model**

Document the approved implementation shape:
- `TargetType::Remote`
- `PeerRegistry`
- `interest snapshot` derived from local non-remote routes
- `/mesh/stream` with `Last-Event-ID`
- in-process dedupe + hop limit on remote ingest

**Step 2: Sync the implementation approach to issues**

Comment on `#369` and `#370` with the chosen direction and expected verification commands.

### Task 2: Write failing Rust tests for peer model and remote route support

**Files:**
- Create: `crates/exomind-runtime/tests/mesh_routes_integration.rs`
- Modify: `crates/exomind-runtime/src/signal/types.rs`
- Modify: `crates/exomind-runtime/src/routes/signals.rs`

**Step 1: Add tests for peer CRUD and remote routes**

Cover:
- `TargetType::Remote` round-trip
- `/mesh/peers` CRUD
- remote route persistence / list visibility

**Step 2: Run the targeted Rust test**

Run: `cargo test -p exomind-runtime mesh_routes_integration`
Expected: FAIL because mesh routes and peers do not exist yet

### Task 3: Write failing relay tests

**Files:**
- Create: `crates/exomind-runtime/tests/mesh_relay_integration.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`

**Step 1: Add two-runtime relay tests**

Cover:
- live relay from runtime A to runtime B
- replay via peer mesh stream `Last-Event-ID`
- loop suppression / dedupe / hop limit

**Step 2: Run the targeted Rust test**

Run: `cargo test -p exomind-runtime mesh_relay_integration`
Expected: FAIL because mesh worker and relay ingest do not exist yet

### Task 4: Implement peer registry and remote route model

**Files:**
- Create: `crates/exomind-runtime/src/mesh/mod.rs`
- Create: `crates/exomind-runtime/src/routes/mesh.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`
- Modify: `crates/exomind-runtime/src/signal/types.rs`
- Modify: `crates/exomind-runtime/src/signal/route_table.rs`
- Modify: `crates/exomind-runtime/Cargo.toml`

**Step 1: Add host and peer identity model**

Introduce:
- runtime `host_id`
- `PeerInfo`
- `PeerStatus`
- peer persistence

**Step 2: Add API surface**

Expose:
- `GET /mesh/peers`
- `POST /mesh/peers`
- `PUT /mesh/peers/:id`
- `DELETE /mesh/peers/:id`
- `GET /mesh/interests/:peer_id`
- `PUT /mesh/interests/:peer_id`

**Step 3: Add `TargetType::Remote`**

Allow remote routes in shared signal route contracts.

### Task 5: Implement relay worker, interest sync, dedupe, and replay

**Files:**
- Modify: `crates/exomind-runtime/src/mesh/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/mesh.rs`
- Modify: `crates/exomind-runtime/src/routes/topology.rs`
- Modify: `src/lib/types/signal-pool.ts`
- Modify: `src/ui/app/pages/agents-signal-topology.ts`
- Modify: `src/components/RouteEditPanel.tsx`

**Step 1: Add mesh SSE stream and worker loop**

Each peer worker:
- advertises local interests
- opens remote `/mesh/stream?peer_id=self`
- reconnects with `Last-Event-ID`
- injects remote events after hop/dedupe validation

**Step 2: Add outgoing mesh filtering**

Only emit events to a peer when:
- local route includes `TargetType::Remote` to that peer
- peer interest snapshot matches the topic
- event is not being sent back to its origin peer

**Step 3: Update public TS contracts**

Expose `remote` target type and any minimal peer-facing types needed for future API clients.

### Task 6: Verify phase 2

**Files:**
- Verify only

**Step 1: Run Rust mesh tests**

Run: `cargo test -p exomind-runtime mesh_routes_integration`
Expected: PASS

Run: `cargo test -p exomind-runtime mesh_relay_integration`
Expected: PASS

**Step 2: Run key runtime regressions**

Run: `cargo test -p exomind-runtime routes::signals`
Expected: PASS

**Step 3: Run TypeScript verification**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Sync evidence to issues**

Comment on `#369` and `#370` with:
- changed files
- test commands
- results

---

## Implementation Result（实施结果）

**Status:** Completed on 2026-03-06

### Delivered scope

- Added runtime `host_id` and exposed it from `/topology`
- Added `TargetType::Remote` to the shared Rust / TypeScript signal contract
- Added `MeshState` with:
  - static peer registry
  - peer interest snapshots
  - remote ingest dedupe by `event.id`
  - hop limit guard
  - origin bounce suppression
- Added `/mesh/peers` CRUD
- Added `PUT /mesh/interests/:peer_id`
- Added peer-facing `/mesh/stream` with `Last-Event-ID` replay
- Added `POST /mesh/events` as the immediate relay path
- Added `MeshRelayManager` with:
  - peer worker connect / reconnect loop
  - interest sync
  - direct relay push for `TargetType::Remote`
  - bounded stop behavior for long-lived SSE shutdown
- Added Phase 2 integration tests:
  - `mesh_routes_integration`
  - `mesh_guard_integration`
  - `mesh_relay_integration`

### Intentional scope decisions

- Peer persistence is now **opt-in** via `EXOMIND_RT_MESH_STATE_PATH`
  - Rationale: implicit global persistence polluted tests and local runtimes with stale peers
  - This keeps the Phase 2 MVP deterministic while preserving a persistence hook
- Relay is implemented as a **hybrid path**
  - `/mesh/events` provides immediate delivery
  - `/mesh/stream + Last-Event-ID` remains the replay / recovery path
  - `event.id` dedupe prevents double-delivery when both paths overlap

### Verification

- `cargo test -p exomind-runtime`
- `npx tsc --noEmit`

### Outcome

- Two-runtime relay works with stable `event.id`, `origin_host_id`, and incremented `hop`
- Duplicate relay is suppressed on ingest
- `MAX_HOP` guard is enforced
- Remote route creation is accepted end-to-end
- Runtime stop no longer hangs on active peer SSE streams
