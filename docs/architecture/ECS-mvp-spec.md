# ExoMind Communication Stack MVP Spec

> Status: Draft v0.1 (Approved for Phase 1 execution)
> Date: 2026-03-06
> Scope: `#366` / `#367` / `#368`

## 1. Goal

This document freezes the `ECS-2 (Transport Abstraction, 传输抽象层)` and
`ECS-3 (Mesh / Relay, 组网与中继)` MVP boundary for the current ExoMind cycle.

The MVP target is not "complete ECS". The MVP target is:

- Keep the current single-runtime (`single RT`, 单运行时) signal chain stable.
- Introduce a minimal transport contract that hides `HTTP publish + SSE subscribe`.
- Make the future `static peers + remote route + relay` work additive rather than invasive.
- Define a clear `Definition of Done (DoD, 完成定义)` for the three delivery phases in `#366`.

## 2. Current Ground Truth

Current code already provides:

- `SignalEvent` with `origin_host_id`, `hop`, `trace_id`
- `POST /signals/publish`
- `GET /signals/stream`
- `Last-Event-ID` replay
- Tauri fast publish via `signal_publish_fast`

Current code does not yet provide:

- `TargetType::Remote`
- `PeerRegistry`
- `Remote route`
- Cross-runtime relay
- IPC transport

Therefore the MVP must start from a stable single-RT transport abstraction, then
extend into cross-RT routing.

## 3. Total MVP

The approved MVP for `#366` is:

1. Preserve existing single-RT behavior.
2. Support two runtimes connected by `static peers`.
3. Support explicit remote routing with `TargetType::Remote` or an equivalent model.
4. Support `interest advertisement (兴趣声明)` as full snapshot sync in MVP.
5. Support cross-RT relay over the existing `HTTP/SSE` transport family.
6. Support `hop limit`, `dedupe`, `loop prevention`, and `Last-Event-ID replay`.
7. Support minimal observability for peer / remote route / relay status.
8. Support same-host `IPC transport` with `HTTP/SSE fallback`.

## 4. Explicit Non-Goals

The following items are out of scope for this MVP:

- `mDNS`, `iroh`, `libp2p`, or any automatic peer discovery
- `BLE`, `NearLink`, `LoRa`
- `E2EE`, pairing, NAT traversal, WAN federation
- `CRDT`, `EDS`, distributed memory
- Full self-organizing mesh
- Binary encoding negotiation (`MessagePack`, `CBOR`) in this cycle

## 5. Protocol Decisions

These decisions are frozen for the MVP unless explicitly revised:

### 5.1 Identity and Delivery

- `event.id` is the canonical event identity.
- `origin_host_id` is assigned at origin and must remain immutable during relay.
- Relay must not rewrite `event.id`.
- Relay may only increment `hop`.

### 5.2 Dedupe and Trace

- `dedupe key = event.id`
- `trace_id` is for correlation only, not for dedupe

### 5.3 Interest Advertisement

- MVP uses `interest snapshot` instead of incremental diff
- Snapshot payload is a full set of topics a peer is interested in
- Topic matching remains exact match plus `*` wildcard only for MVP

### 5.4 Encoding

- MVP wire format remains JSON
- No binary encoding negotiation in phase 1 or phase 2

## 6. Wire Contract vs Local Detail

### 6.1 Wire Contract

The following are part of the protocol-facing contract:

- `SignalEvent`
- `PublishRequest / PublishResponse`
- `Last-Event-ID` replay semantics
- Future `PeerInfo` public shape
- Future `Remote route` public shape
- Future `Interest snapshot` payload shape
- Relay rules for `origin_host_id`, `hop`, `event.id`

### 6.2 Local Implementation Detail

The following are implementation details and may change without protocol breakage:

- Tauri `signal_publish_fast`
- local fetch wrappers
- SSE parsing internals
- in-memory caches and helper classes

## 7. Phase Breakdown and DoD

## 7.1 Phase 1: `#367 + #368`

### Objective

Freeze the MVP spec and extract a minimal transport abstraction without changing
single-RT behavior.

### DoD

- A spec document exists and is sufficient to guide phase 2.
- The spec defines: `PeerInfo`, `PeerStatus`, `PeerCapabilities`, `Remote route`,
  `Interest snapshot`, relay rules, `hop`, `dedupe`, and replay semantics.
- A minimal transport contract exists in code and hides direct `HTTP publish + SSE subscribe`.
- Existing frontend and `ts-agent-cli` signal entry points use the transport contract.
- Tauri fast publish remains an adapter optimization, not a business-layer concern.
- Single-RT publish / subscribe / heartbeat / replay behavior does not regress.

## 7.2 Phase 2: `#369 + #370`

### Objective

Deliver the first user-visible ECS-3 capability: cross-runtime signal relay.

### DoD

- Runtime persists and exposes `PeerRegistry`.
- Static peers can be configured and loaded.
- Routing can express a remote destination.
- Two runtimes can exchange `interest snapshot`.
- A signal published on runtime A can be relayed to runtime B exactly once.
- `event.id` and `origin_host_id` survive relay unchanged.
- `hop limit`, dedupe, and loop prevention are enforced and observable.
- Replay after reconnect works with `Last-Event-ID`.

## 7.3 Phase 3: `#371 + #372 + #373`

### Objective

Make the MVP operable, observable, and regression-safe.

### DoD

- Same-host IPC transport works on supported desktop platforms.
- IPC failure falls back to `HTTP/SSE`.
- At least one real agent chain runs over IPC.
- UI or debug endpoints expose peer / route / relay / transport / dropped reason.
- Automated multi-runtime tests cover relay, reconnect, replay, hop limit, and dedupe.

## 8. Acceptance Scenarios

The project can claim ECS MVP completion only if all of the following are true:

1. A single runtime still behaves as before.
2. Two runtimes can be wired with static peers.
3. Runtime A can relay one signal to runtime B.
4. Runtime B receives the relayed signal once, not multiple times.
5. A reconnect path can replay missed signals.
6. Failures are visible instead of silently dropped.

## 9. Phase 1 Implementation Notes

Phase 1 will intentionally not introduce:

- remote routing behavior
- peer registry behavior
- protocol auto-discovery

Phase 1 is a contract and adapter phase. Its main job is to prevent future ECS-3
work from scattering protocol details across UI and agent code.
