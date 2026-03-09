# ECS #381 Remaining Work Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the remaining implementation work for `#381` so desktop and mobile can exchange `EventLog` and `current ActiveBlock` data without the current PouchDB sync server.

**Architecture:** Keep PouchDB as local persistence only, and replace the covered cross-device sync path with `local write -> RT publish -> ECS mesh relay -> remote RT -> frontend projector -> local storage`. Reuse the existing mesh relay, SSE client, and signal handler infrastructure where it is already real, but add explicit replication topics, peer trust metadata, and no-`6984` acceptance proof.

**Tech Stack:** Rust runtime mesh, SignalPool routes, TypeScript services, PouchDB local storage, Vitest, Playwright

---

## 0. Current Status Snapshot（当前状态快照）

Already done:

- `#373` baseline is in place:
  - mesh relay
  - replay
  - reconnect
  - hop/dedupe/failure coverage
- `#381` MVP contract has been frozen in:
  - `docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md`
- runtime host manual add/probe UI already exists for `host + port`
- frontend already has:
  - `SignalStreamService`
  - `signal-handlers.ts`
  - app-level `useSignalStream`

Not done yet:

- `EventLog` still syncs through `EventStorage.syncToRemote()`
- `ActiveBlock` still syncs through `ActiveBlockStorage.syncToRemote()`
- `ChatPage` still starts sync-server replication directly
- `TimeBlockSyncCoordinator` still builds `6984` remote DB URL
- runtime host record does not yet store:
  - `host_id`
  - `trust_state`
  - `advertised_listen_address`
  - `last_successful_dial_address`
- there is still no acceptance proof showing:
  - `0` calls to `syncToRemote()`
  - `0` calls to `PouchDB.replicate()`
  - `0` requests to `6984`

## 1. Remaining Work Count（剩余任务数量）

From the original `#381` high-level plan, only **Task 1 / 4** is complete:

- done: MVP contract freeze
- not started: EventLog over ECS
- not started: ActiveBlock over ECS
- not started: acceptance and no-sync-server proof

From the engineering execution view, the remaining work is better treated as **5 main work packages + 1 preflight risk check**:

1. UI signal delivery preflight
2. EventLog ECS replication
3. peer persistence / trust model
4. ActiveBlock ECS replication
5. no-sync-server acceptance and regression proof

Preflight risk:

- `/signals/stream` currently filters by `TargetType::Agent`, while default route config still contains `* -> frontend:ui`
- this must be explicitly resolved before relying on UI-side projectors for ECS data sync

## 2. Suggested Execution Order（建议执行顺序）

1. Preflight: freeze UI signal delivery contract
2. EventLog ECS path end-to-end
3. peer persistence / trust metadata
4. ActiveBlock ECS path end-to-end
5. acceptance with sync server disabled

Rationale:

- `EventLog` is the cheapest real user-value slice
- peer trust metadata is required for honest `#381` DoD, but does not need to block the first EventLog hot-path proof
- `ActiveBlock` is more complex because it must preserve canonical ordering and terminal clear-state

## 3. Implementation Tasks

### Task 1: Freeze UI Signal Delivery Contract（冻结前端信号投递契约）

**Files:**
- Modify: `crates/exomind-runtime/src/routes/signals.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/tests/signal_sse_stream.rs`
- Test: `tests/unit/services/signal-stream.service.test.ts`

**Step 1: Write a failing runtime test**

Cover one of these explicit contracts:

- `/signals/stream?agent_id=ui` can receive topics that are intended for the UI projector path
- or route config is switched so UI projector topics target `agent:ui` instead of `frontend:ui`

**Step 2: Run the failing test**

Run:
`cargo test -p exomind-runtime --test signal_sse_stream -- --nocapture`

Expected:
- FAIL until the delivery contract is made explicit

**Step 3: Implement the minimal fix**

Pick exactly one contract and freeze it:

- Option A: allow `/signals/stream` to deliver `TargetType::Frontend`
- Option B: keep `/signals/stream` agent-only, but route ECS projector topics to `agent:ui`

**Step 4: Re-run tests**

Run:
- `cargo test -p exomind-runtime --test signal_sse_stream -- --nocapture`
- `npx vitest run tests/unit/services/signal-stream.service.test.ts`

Expected:
- PASS

### Task 2: EventLog Over ECS（EventLog ECS 复制）

**Files:**
- Modify: `src/lib/storage/event-storage.ts`
- Modify: `src/lib/services/eventlog.service.ts`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `src/components/Chat/ChatPage.tsx`
- Create: `src/lib/services/ecs-eventlog-replication.service.ts`
- Test: `tests/unit/eventlog/service-pouchdb-backend.test.ts`
- Test: `tests/unit/signal-pool/signal-handlers.test.ts`
- Test: `tests/components/ChatPage.test.tsx`
- Test: `tests/storage/event-storage.test.ts`

**Step 1: Write failing tests for the new contract**

Cover:

- local append publishes `eventlog.replication.appended`
- projector writes remote event into `EventStorage` exactly once
- duplicate `event.id` is ignored
- duplicate `event.id` with different payload is rejected
- ECS mode does not call `EventStorage.syncToRemote()`

**Step 2: Run the failing tests**

Run:
`npx vitest run tests/unit/signal-pool/signal-handlers.test.ts tests/unit/eventlog/service-pouchdb-backend.test.ts tests/components/ChatPage.test.tsx tests/storage/event-storage.test.ts`

Expected:
- FAIL on missing ECS replication path

**Step 3: Implement minimal EventLog replication**

Required implementation shape:

- `EventStorage` keeps local persistence
- `EventLogService` owns the “append locally + publish replication signal” path
- new replication topic carries:
  - `event.id`
  - content
  - created timestamp
  - metadata/source
  - future-friendly replication cursor field
- `useSignalStream` projects remote replication topic into local storage

**Step 4: Add cold-sync placeholder contract**

Do not build the full long-gap implementation yet, but do add:

- a monotonic cursor type for EventLog replication
- projector-side hook point for later cold pull
- tests proving code does **not** use `createdAt + id` as the replication boundary

**Step 5: Re-run tests**

Run:
- `npx vitest run tests/unit/signal-pool/signal-handlers.test.ts tests/unit/eventlog/service-pouchdb-backend.test.ts tests/components/ChatPage.test.tsx tests/storage/event-storage.test.ts`
- `npx tsc --noEmit`

Expected:
- PASS

### Task 3: Peer Persistence And Trust Model（Peer 持久化与信任模型）

**Files:**
- Modify: `src/lib/types/agent-hub-runtime.ts`
- Modify: `src/lib/services/runtime-host.service.ts`
- Modify: `src/services/runtime-manager.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/services/runtime-host.service.issue205.test.ts`
- Test: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

**Step 1: Write failing tests**

Cover:

- runtime host record can store:
  - `host_id`
  - `trust_state`
  - `advertised_listen_address`
  - `last_successful_dial_address`
  - `manual_override`
- manual add defaults port to `1949`
- inbound candidate is not auto-promoted to confirmed without reciprocal proof or manual save

**Step 2: Run the failing tests**

Run:
`npx vitest run tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected:
- FAIL until new fields and state transitions exist

**Step 3: Implement minimal trust-state model**

State machine:

- `manual_seed`
- `discovered_candidate`
- `confirmed_peer`

Persist:

- `host_id`
- `advertised_listen_address`
- `last_successful_dial_address`
- `manual_override`
- `trust_state`

**Step 4: Re-run tests**

Run:
`npx vitest run tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected:
- PASS

### Task 4: ActiveBlock Over ECS（ActiveBlock ECS 复制）

**Files:**
- Modify: `src/lib/storage/active-block-storage.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Modify: `src/ui/app/components/TimeBlockSyncCoordinator.tsx`
- Modify: `src/lib/services/signal-handlers.ts`
- Create: `src/lib/services/ecs-active-block-replication.service.ts`
- Test: `tests/unit/services/timeblock.service.issue104-sync.test.ts`
- Test: `tests/storage/active-block-storage.issue104.test.ts`
- Test: `tests/unit/ui/timeblock-sync-url-wiring.issue104.test.ts`

**Step 1: Write failing tests**

Cover:

- local state transition publishes canonical snapshot signal
- remote snapshot projects into `ActiveBlockStorage`
- canonical ordering matches `phase > version > lastTransitionAt > actorId`
- terminal `feedback_submitted` clears remote active state
- ECS mode bypasses `ActiveBlockStorage.syncToRemote()`

**Step 2: Run the failing tests**

Run:
`npx vitest run tests/unit/services/timeblock.service.issue104-sync.test.ts tests/storage/active-block-storage.issue104.test.ts tests/unit/ui/timeblock-sync-url-wiring.issue104.test.ts`

Expected:
- FAIL until ECS path exists

**Step 3: Implement minimal ActiveBlock replication**

Required shape:

- `TimeBlockService` publishes canonical snapshot topics
- projector writes snapshots into `ActiveBlockStorage`
- `TimeBlockSyncCoordinator` no longer builds a `6984` DB URL for ECS mode
- terminal `feedback_submitted` converges to “no active block”

**Step 4: Re-run tests**

Run:
- `npx vitest run tests/unit/services/timeblock.service.issue104-sync.test.ts tests/storage/active-block-storage.issue104.test.ts tests/unit/ui/timeblock-sync-url-wiring.issue104.test.ts`
- `npx tsc --noEmit`

Expected:
- PASS

### Task 5: Acceptance And No-Sync-Server Proof（验收与无同步服务器证明）

**Files:**
- Create: `tests/e2e/eventlog-ecs-multi-device.issue381.test.ts`
- Create: `tests/e2e/active-block-ecs-multi-device.issue381.test.ts`
- Create: `tests/e2e/playwright.issue381.config.ts`
- Modify: `tests/e2e/eventlog-multi-device-sync.issue27.test.ts`
- Modify: `docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md`

**Step 1: Write failing acceptance tests**

Acceptance matrix:

- EventLog desktop -> mobile
- EventLog mobile -> desktop
- ActiveBlock desktop -> mobile
- ActiveBlock mobile -> desktop
- long-gap recovery after reconnect
- zero requests to `6984`

**Step 2: Run the failing acceptance tests**

Run:
`node Scripts/test/playwright-runner.cjs test tests/e2e/eventlog-ecs-multi-device.issue381.test.ts tests/e2e/active-block-ecs-multi-device.issue381.test.ts --config tests/e2e/playwright.issue381.config.ts`

Expected:
- FAIL until ECS path is fully wired

**Step 3: Implement no-sync-server proof hooks**

Need explicit assertions/log capture for:

- `0` calls to `syncToRemote()`
- `0` calls to `PouchDB.replicate()`
- `0` requests to `6984`

**Step 4: Re-run final verification**

Run:
- `cargo test -p exomind-runtime`
- `npx vitest run tests/unit/signal-pool/signal-handlers.test.ts tests/unit/eventlog/service-pouchdb-backend.test.ts tests/components/ChatPage.test.tsx tests/storage/event-storage.test.ts tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/services/timeblock.service.issue104-sync.test.ts tests/storage/active-block-storage.issue104.test.ts tests/unit/ui/timeblock-sync-url-wiring.issue104.test.ts`
- `node Scripts/test/playwright-runner.cjs test tests/e2e/eventlog-ecs-multi-device.issue381.test.ts tests/e2e/active-block-ecs-multi-device.issue381.test.ts --config tests/e2e/playwright.issue381.config.ts`
- `npx tsc --noEmit`

Expected:
- PASS

## 4. Practical Estimate（实际估算）

If measured as implementation slices, `#381` still needs:

- **1 preflight fix** for UI signal delivery semantics
- **2 domain implementations**:
  - EventLog
  - ActiveBlock
- **1 peer model upgrade**
- **1 acceptance package**

So the honest status is:

- protocol foundation: mostly ready
- product-facing data sync: **not started yet**
- remaining effort to reach honest `#381` DoD: **medium-large**, but now bounded and executable

## 5. Recommended Immediate Next Step（下一步建议）

Start with **Task 1 + Task 2 together**:

- first freeze the UI delivery contract
- then immediately land the EventLog ECS slice

Reason:

- it is the smallest real user-visible proof
- it removes the most obvious `6984` dependency in the current app
- it will validate whether the `SignalStreamService + projector` route is viable before touching ActiveBlock
