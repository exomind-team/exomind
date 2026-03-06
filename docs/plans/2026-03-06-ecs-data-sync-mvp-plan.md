# ECS Data Sync MVP Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a finite ECS data-sync MVP so desktop and mobile can exchange user-visible data without the current PouchDB sync server.

**Architecture:** Reuse the existing ECS mesh relay as the transport plane, but move selected user data into `signal + projection（信号 + 投影）` flow. The first MVP intentionally covers only append-friendly `EventLog` and single-state `ActiveBlock`, because they can be replicated over ECS with much lower conflict complexity than `Task` or `Reminder`.

**Tech Stack:** Rust runtime mesh, TypeScript signal services, PouchDB local storage, projection services, Vitest, Rust integration tests

---

## 1. Finite Goal

This plan does **not** try to replace the entire sync architecture in one step.

The finite goal is:

- desktop ↔ mobile `EventLog` interoperability
- desktop ↔ mobile `ActiveBlock / TimeBlock` interoperability
- no dependency on the current PouchDB sync server (`6984`)

## 2. Why this scope

### Included

- `EventLog`
  - append-only by nature
  - already has signal semantics around `user.input.text` and `eventlog.appended`
  - easiest way to prove real cross-device user value

- `ActiveBlock`
  - single logical state object
  - lower conflict surface than task trees
  - directly visible in focus/timeblock UX

### Deferred

- `Task`
  - tree structure + status transitions + parent linkage
  - needs explicit conflict semantics

- `Reminder`
  - scheduling semantics + mutation ordering
  - lower priority than EventLog / ActiveBlock for proving the transport

## 3. Proposed Delivery Order

This sits **after** `#373`, and ideally after `#372`:

1. `#373` test baseline
2. `#372` observability
3. `#381` EventLog over ECS
4. `#381` ActiveBlock over ECS
5. desktop/mobile acceptance without sync server

`#371` same-host IPC can continue in parallel for optimization, but it is not the dependency that unlocks cross-device data interoperability.

## 3.1 Connection Model（连接模型）

The approved MVP connection model is:

- peers are logically symmetric (`peer-to-peer`, 对等节点)
- either desktop or mobile may initiate the first connection
- after a successful connection, both sides may persist each other as peers
- a peer is remembered only after:
  - the connection succeeds
  - remote `host_id` is known
  - a reachable remote address is known
  - local user confirmation is granted

### Default addressing rule

- primary manual input: `IP`
- default port: `1949`
- advanced option: optional manual port override
- random runtime ports are not part of the product default path

### Address truth

If a device self-reports one address but another address was actually used to connect:

- persist the **actually reachable address**
- do not prioritize self-reported address over real connectivity

## 4. MVP Shape

### 4.1 EventLog path

Desktop/mobile local write:

- append to local storage
- publish ECS data signal such as `eventlog.replication.appended`

Remote runtime:

- receives signal
- dedupes by stable logical event id
- projects into local `EventStorage`

### 4.1.1 EventLog sync model

- hot path: ECS relay in real time
- short-gap recovery: `Last-Event-ID + WindowCache`
- cold sync: explicit incremental pull after connect / reconnect

Recommended cursor:

- `createdAt + id`

Idempotency:

- transport dedupe: `event.id`
- storage projection dedupe: `event.id`

### 4.2 ActiveBlock path

Desktop/mobile local mutation:

- update local active-block storage
- publish ECS data signal such as:
  - `active_block.started`
  - `active_block.updated`
  - `active_block.ended`

Remote runtime:

- receives signal
- compares logical block version / timestamp
- projects into local `ActiveBlockStorage`

### 4.2.1 ActiveBlock sync model

- identity: explicit global `blockId`
- hot path: ECS relay in real time
- short-gap recovery: `Last-Event-ID + WindowCache`
- cold sync: fetch latest current state after connect / reconnect

Conflict rule:

- `last-write-wins`
- compare `updatedAt` first, or explicit `version` if introduced during implementation

### 4.3 Two-Layer Replication Model（双层复制模型）

The MVP deliberately combines:

1. `hot relay`
   - real-time ECS delivery
   - handles online / near-online experience

2. `cold sync pull`
   - explicit catch-up after successful connect or reconnect
   - handles long offline gaps, replay window loss, and first-time device join

For the covered domains in this MVP, the target consistency model is:

- `strong eventual consistency（强最终一致）`

This does not mean instant consistency in all cases. It means:

- online updates flow immediately where possible
- offline gaps are later reconciled through pull-based catch-up
- the final state converges across desktop/mobile for `EventLog` and `ActiveBlock`

## 5. DoD

This MVP is done only when:

1. Two runtimes can connect via static peers
2. Desktop append to EventLog is visible on mobile without the current sync server
3. Mobile append to EventLog is visible on desktop without the current sync server
4. Desktop ActiveBlock mutation is visible on mobile without the current sync server
5. Mobile ActiveBlock mutation is visible on desktop without the current sync server
6. Replay after reconnect restores missed EventLog / ActiveBlock changes
7. Acceptance proof does not rely on `syncToRemote()` or PouchDB remote replication
8. Successful first connect can persist peer using reachable `host_id + host + port`
9. First connect still requires explicit local confirmation before trust is stored

## 6. Test Strategy

### 6.1 Rust runtime integration

- relay + replay for new data topics
- dedupe by logical replication id
- reconnect recovery
- reachable-address-wins persistence rule
- successful-connect peer remembering path

### 6.2 TypeScript unit tests

- local storage write publishes ECS replication signal
- remote projection service writes to storage exactly once
- PouchDB sync path is bypassed in ECS mode
- EventLog cold incremental pull fills long offline gap
- ActiveBlock cold latest-state sync overrides stale local state

### 6.3 End-to-end acceptance

- simulate two runtimes
- simulate two UI clients
- verify data appears across devices with sync server disabled
- verify first successful connect needs confirmation
- verify saved peer uses the actually reachable `IP:port`

## 7. Implementation Tasks

### Task 1: Freeze the MVP contract

**Files:**
- Create: `docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md`
- Modify: GitHub issue `#381` via comment

**Step 1: Capture exact MVP boundary**

Lock:
- EventLog first
- ActiveBlock second
- Task/Reminder deferred

**Step 2: Sync issue context**

Comment on `#381` with:
- local doc path
- DoD
- delivery order

### Task 2: EventLog over ECS

**Files:**
- Modify: `src/lib/storage/event-storage.ts`
- Modify: `src/lib/services/eventlog.service.ts`
- Modify: peer connect / remember flow under runtime host services and Agent Hub connection UI as needed
- Create: projection / replication helpers under `src/lib/services/`
- Add related tests under `tests/unit/services/`

**Step 1: Write red tests**

Cover:
- local append emits ECS replication signal
- remote replication signal projects into local EventStorage
- duplicate replication signal is ignored
- cold incremental pull fills long-offline gap
- no call path reaches `syncToRemote()`

### Task 3: ActiveBlock over ECS

**Files:**
- Modify: `src/lib/storage/active-block-storage.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Create: projection / replication helpers under `src/lib/services/`
- Add related tests under `tests/unit/services/`

**Step 1: Write red tests**

Cover:
- local active block mutations emit ECS replication signal
- remote active block signal updates local storage
- older updates are ignored
- cold sync fetches latest remote active-block state

### Task 4: Acceptance and no-sync-server proof

**Files:**
- Add or modify E2E/integration tests under `tests/e2e/` and runtime integration suites

**Step 1: Verify no sync-server dependency**

Acceptance runs must not call:
- `storage.syncToRemote(...)`
- `PouchDB.replicate(...)`
- current sync server endpoint on `6984`

**Step 2: Verify peer persistence rule**

Acceptance should prove:
- mobile may initiate the first connection
- desktop records mobile only after successful connect + confirmation
- saved peer uses the actually reachable address

## 8. Current Repo Reality

Current data layer is still tightly coupled to PouchDB remote sync:

- `src/lib/storage/event-storage.ts`
- `src/lib/storage/task-storage.ts`
- `src/lib/storage/active-block-storage.ts`
- `src/lib/storage/reminder-storage.ts`
- `src/adapters/pouch-sync.ts`

So this MVP should be treated as:

`ECS-backed data replication for selected domains`

not as:

`a full storage architecture replacement`
