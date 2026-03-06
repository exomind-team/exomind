# ECS Phase 1 Transport Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Freeze the ECS MVP contract and extract a minimal transport abstraction for the current single-runtime signal stack.

**Architecture:** Phase 1 keeps the existing Rust runtime endpoints unchanged and introduces a thin `HTTP/SSE transport adapter（HTTP/SSE 传输适配器）` above them. Frontend `SignalStreamService` and `ts-agent-cli` signal sender/listener are refactored to depend on the adapter contract instead of hand-written protocol calls.

**Tech Stack:** TypeScript, Vitest, Bun, existing Rust Axum signal endpoints, Tauri fast publish bridge

---

### Task 1: Freeze ECS MVP Spec

**Files:**
- Create: `docs/architecture/ECS-mvp-spec.md`
- Modify: GitHub issues `#366`, `#367`, `#368` via comment sync

**Step 1: Ensure the approved MVP and DoD are written down**

Write the approved scope, non-goals, protocol decisions, and phase DoD in the spec document.

**Step 2: Sync the spec summary to GitHub issues**

Comment on `#366`, `#367`, and `#368` with the approved MVP boundary and the local document path.

**Step 3: Verify the document exists**

Run: `Test-Path "D:\project\exomind\docs\architecture\ECS-mvp-spec.md"`
Expected: `True`

### Task 2: Add failing frontend transport tests

**Files:**
- Create: `tests/unit/services/signal-http-sse-transport.issue368.test.ts`
- Modify: `src/lib/services/signal-stream.service.ts`

**Step 1: Write a failing test for publish abstraction**

Cover:
- Tauri invoke fast-path
- invoke failure fallback to HTTP
- explicit `openStream()` request with `Last-Event-ID`

**Step 2: Run the targeted test**

Run: `npx vitest run tests/unit/services/signal-http-sse-transport.issue368.test.ts`
Expected: FAIL because the transport adapter does not exist yet

### Task 3: Implement frontend transport adapter

**Files:**
- Create: `src/lib/services/signal-http-sse-transport.ts`
- Modify: `src/lib/services/signal-stream.service.ts`

**Step 1: Add a minimal transport contract**

Introduce a class that owns:
- base URL construction
- publish path selection
- Tauri fast-path fallback
- SSE `openStream()` connection bootstrap
- history fetch

**Step 2: Refactor `SignalStreamService`**

Make `SignalStreamService` delegate network operations to the adapter while keeping:
- reconnect behavior
- SSE parse behavior
- listener fanout behavior

**Step 3: Run the frontend tests**

Run: `npx vitest run tests/unit/services/signal-http-sse-transport.issue368.test.ts tests/unit/services/signal-stream-fast-publish.m1.test.ts tests/unit/services/signal-stream-retry-log.m4.test.ts`
Expected: PASS

### Task 4: Add failing `ts-agent-cli` transport tests

**Files:**
- Create: `packages/ts-agent-cli/test/sse/http-sse-signal-transport.test.ts`
- Modify: `packages/ts-agent-cli/src/sse/signal-sender.ts`
- Modify: `packages/ts-agent-cli/src/sse/signal-listener.ts`

**Step 1: Write a failing test for agent transport**

Cover:
- `publish()` request shape
- `openStream()` request headers
- sender/listener delegation to the transport

**Step 2: Run the targeted package test**

Run: `bun test packages/ts-agent-cli/test/sse/http-sse-signal-transport.test.ts`
Expected: FAIL because the agent transport adapter does not exist yet

### Task 5: Implement `ts-agent-cli` transport adapter

**Files:**
- Create: `packages/ts-agent-cli/src/sse/http-sse-signal-transport.ts`
- Modify: `packages/ts-agent-cli/src/sse/signal-sender.ts`
- Modify: `packages/ts-agent-cli/src/sse/signal-listener.ts`

**Step 1: Add the package-local adapter**

Keep the contract aligned with the frontend transport model while avoiding cross-package coupling in phase 1.

**Step 2: Refactor sender and listener**

Move direct fetch and stream bootstrap logic into the transport adapter.

**Step 3: Run package tests**

Run: `bun test packages/ts-agent-cli/test/sse/http-sse-signal-transport.test.ts packages/ts-agent-cli/test/sse/signal-sender.test.ts packages/ts-agent-cli/test/sse/signal-listener.test.ts packages/ts-agent-cli/test/sse/signal-client.test.ts`
Expected: PASS

### Task 6: Run phase 1 verification

**Files:**
- Verify only

**Step 1: Run TypeScript verification**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 2: Run phase 1 target tests**

Run: `npx vitest run tests/unit/services/signal-http-sse-transport.issue368.test.ts tests/unit/services/signal-stream-fast-publish.m1.test.ts tests/unit/services/signal-stream-retry-log.m4.test.ts`
Expected: PASS

**Step 3: Run package tests**

Run: `bun test packages/ts-agent-cli/test/sse/http-sse-signal-transport.test.ts packages/ts-agent-cli/test/sse/signal-sender.test.ts packages/ts-agent-cli/test/sse/signal-listener.test.ts packages/ts-agent-cli/test/sse/signal-client.test.ts`
Expected: PASS

**Step 4: Check requirement coverage**

Confirm:
- spec written
- issue sync done
- frontend transport abstraction landed
- `ts-agent-cli` transport abstraction landed
- single-RT behavior still covered by tests
