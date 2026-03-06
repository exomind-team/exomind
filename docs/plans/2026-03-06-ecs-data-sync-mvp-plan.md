# ECS Data Sync MVP Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a finite ECS data-sync MVP so desktop and mobile can exchange user-visible data without the current PouchDB sync server.

**Architecture:** Reuse the existing ECS mesh relay as the transport plane, but move selected user data into `signal + projection（信号 + 投影）` flow. The first MVP intentionally covers only append-friendly `EventLog` and the singleton `current ActiveBlock（当前进行中时间块快照）`, because they can be replicated over ECS with much lower conflict complexity than `Task`, `Reminder`, or full completed `TimeBlock` history.

**Tech Stack:** Rust runtime mesh, TypeScript signal services, PouchDB local storage, projection services, Vitest, Rust integration tests

---

## 1. Finite Goal

This plan does **not** try to replace the entire sync architecture in one step.

The finite goal is:

- desktop ↔ mobile `EventLog` interoperability
- desktop ↔ mobile `current ActiveBlock` interoperability
- terminal `feedback_submitted` state converges so both ends clear the active block consistently
- no dependency on the current PouchDB sync server (`6984`)

## 2. Why this scope

### Included

- `EventLog`
  - append-only by nature
  - already has signal semantics around `user.input.text` and `eventlog.appended`
  - easiest way to prove real cross-device user value

- `ActiveBlock`
  - singleton logical state object
  - lower conflict surface than task trees
  - directly visible in focus/timeblock UX
  - existing repo already has a canonical conflict order we can reuse

### Deferred

- `Task`
  - tree structure + status transitions + parent linkage
  - needs explicit conflict semantics

- `Reminder`
  - scheduling semantics + mutation ordering
  - lower priority than EventLog / ActiveBlock for proving the transport

- completed `TimeBlock` history
  - current MVP only converges the singleton active-block snapshot and terminal clear-state
  - full completed-block archive sync needs a separate append domain and retention contract

## 3. Proposed Delivery Order

This sits **after** `#373`.

- `#373` is the hard prerequisite because it stabilizes relay / replay / reconnect verification.
- `#372` is a soft prerequisite / parallel track. It improves rollout and debugging, but should not block `#381`.
- `#371` same-host IPC can continue in parallel for optimization, but it is not the dependency that unlocks cross-device data interoperability.

Recommended order:

1. `#373` test baseline
2. `#381` EventLog over ECS
3. `#381` ActiveBlock over ECS
4. `#372` observability landing or catch-up
5. desktop/mobile acceptance without sync server

## 3.1 Connection Model（连接模型）

The approved MVP connection model is:

- peers are logically symmetric (`peer-to-peer`, 对等节点)
- either desktop or mobile may initiate the first connection
- peer persistence is **not** symmetric on first successful single-direction dial
- peer lifecycle is:
  - `manual_seed（手动种子）`
  - `discovered_candidate（已发现候选）`
  - `confirmed_peer（已确认对等节点）`
- outbound initiator may upgrade the remote side to `confirmed_peer` only after:
  - the dial succeeds
  - remote `host_id` is known
  - the successful outbound dial address is known
  - local user confirmation is granted
- inbound receiver may store only a `discovered_candidate` until it also has:
  - the remote self-advertised listen address
  - a successful reciprocal probe, or an explicit manual save by the user

Rationale:

- current `/mesh/stream` transport only identifies the caller by `peer_id`
- TCP source port is not the caller runtime listen port
- therefore one successful `A -> B` dial only proves `A can reach B`; it does **not** prove `B can reach A`

### Default addressing rule

- primary manual input: `IP`
- default port: `1949`
- advanced option: optional manual port override
- random runtime ports are not part of the product default path

### Address truth

If a device self-reports one address but another address was actually used to connect:

- persist the **last successful outbound dial address** as the preferred dial target
- keep the self-reported listen address separately as `advertised_listen_address`
- do not collapse manual override, self-advertised address, and successful dial address into one field

Minimum peer record fields:

- `host_id`
- `advertised_listen_address`
- `last_successful_dial_address`
- `manual_override`
- `trust_state`

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

Cold-sync cursor:

- use a monotonic `replicationSeq（复制序号）`
- `createdAt` stays a business timestamp / pagination key, not a replication boundary
- `event.id` remains the idempotency key, not the incremental cursor

Idempotency:

- transport dedupe: `event.id`
- storage projection dedupe: `event.id`

Mutation contract in ECS mode:

- `EventLog` is append-only
- `updateEvent()` / `deleteEvent()` are out of the replicated MVP contract
- if two peers produce the same `event.id` with different payloads, treat it as a protocol error instead of silently overwriting

### 4.2 ActiveBlock path

Desktop/mobile local mutation:

- update local active-block storage
- publish ECS data signal such as:
  - `active_block.started`
  - `active_block.updated`
  - `active_block.ended`

Remote runtime:

- receives signal
- compares canonical block snapshot ordering
- projects into local `ActiveBlockStorage`

### 4.2.1 ActiveBlock sync model

- identity: reuse existing global `startId` as the block identity
- hot path: ECS relay in real time
- short-gap recovery: `Last-Event-ID + WindowCache`
- cold sync: fetch latest current state after connect / reconnect

Conflict rule:

- replicate canonical snapshot, not loose patches
- same `startId`: compare `phase > version > lastTransitionAt > actorId`
- different `startId`: compare `startTime`, then `lastTransitionAt`
- `updatedAt` is diagnostic only and must not be the primary conflict key

Terminal-state contract:

- `feedback_submitted` is the MVP terminal clear-state signal
- remote peers must converge on the same terminal snapshot and render `no active block`
- explicit completed `TimeBlock` archive sync is deferred to a follow-up track

### 4.3 Two-Layer Replication Model（双层复制模型）

The MVP deliberately combines:

1. `hot relay`
   - real-time ECS delivery
   - handles online / near-online experience

2. `cold sync pull`
   - explicit catch-up after successful connect or reconnect
   - handles long offline gaps, replay window loss, and first-time device join

Mandatory cold-sync triggers:

- first successful peer confirmation
- reconnect after offline gap
- runtime receives `warning: lagged`
- runtime cannot satisfy `Last-Event-ID` from `WindowCache`
- explicit user-triggered repair / re-sync

Cold-sync state tracking:

- store replication watermarks per peer and per replicated domain
- `EventLog` watermark uses monotonic `replicationSeq`
- `ActiveBlock` cold sync pulls the latest canonical snapshot

For the covered domains in this MVP, the target consistency model is:

- `strong eventual consistency（强最终一致）`

This does not mean instant consistency in all cases. It means:

- online updates flow immediately where possible
- offline gaps are later reconciled through pull-based catch-up
- the final state converges across desktop/mobile for `EventLog` and `ActiveBlock`

## 5. DoD

This MVP is done only when:

1. Two runtimes can connect via static peers
2. Mobile may initiate the first connection to desktop using `IP + default 1949` or explicit port override
3. Initiator upgrades the remote side to `confirmed_peer` only after successful dial + `host_id` discovery + local confirmation
4. Receiver does not auto-confirm the initiator until it has a reciprocal proof path or explicit manual save
5. Desktop append to EventLog is visible on mobile without the current sync server
6. Mobile append to EventLog is visible on desktop without the current sync server
7. Desktop ActiveBlock mutation is visible on mobile without the current sync server
8. Mobile ActiveBlock mutation is visible on desktop without the current sync server
9. Long-gap offline recovery restores missed `EventLog` data via cold sync, not only replay window
10. Reconnect / lagged / missing `Last-Event-ID` all escalate to mandatory cold sync
11. Terminal `feedback_submitted` snapshot converges and both ends render `no active block`
12. Acceptance proof explicitly shows:
    - zero calls to `storage.syncToRemote(...)`
    - zero calls to `PouchDB.replicate(...)`
    - zero network requests to port `6984`

## 6. Test Strategy

### 6.1 Rust runtime integration

- relay + replay for new data topics
- dedupe by logical replication id
- reconnect recovery
- initiator-side peer confirmation path
- receiver-side candidate-only path before reciprocal proof
- lagged / replay-miss path escalates to cold-sync trigger

### 6.2 TypeScript unit tests

- local storage write publishes ECS replication signal
- remote projection service writes to storage exactly once
- PouchDB sync path is bypassed in ECS mode
- `EventLog` ECS mode rejects update/delete replication semantics
- EventLog cold incremental pull uses monotonic cursor, not `createdAt + id`
- EventLog cold incremental pull fills long offline gap
- ActiveBlock canonical ordering matches existing `phase > version > lastTransitionAt > actorId`
- ActiveBlock cold latest-state sync overrides stale local state
- terminal `feedback_submitted` snapshot clears remote active-block UI consistently

### 6.3 End-to-end acceptance

- simulate two runtimes
- simulate two UI clients
- explicitly disable / isolate the current sync server
- verify `EventLog` desktop -> mobile
- verify `EventLog` mobile -> desktop
- verify `ActiveBlock` desktop -> mobile
- verify `ActiveBlock` mobile -> desktop
- verify long-gap offline recovery through cold sync
- verify first successful connect still needs confirmation
- verify saved peer prefers the successful dial address and keeps advertised address separate

## 7. Implementation Tasks

### Task 1: Freeze the MVP contract

**Files:**
- Create: `docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md`
- Modify: GitHub issue `#381` via comment

**Step 1: Capture exact MVP boundary**

Lock:
- EventLog first
- ActiveBlock second
- completed `TimeBlock` archive deferred
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
- duplicate `event.id` with different payload is rejected
- cold incremental pull uses monotonic cursor
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
- canonical ordering matches `phase > version > lastTransitionAt > actorId`
- cold sync fetches latest remote active-block state
- terminal `feedback_submitted` clears the remote active state consistently

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
- receiver keeps initiator as candidate until reciprocal proof or manual save
- saved peer prefers the successful outbound dial address while retaining advertised address separately

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
