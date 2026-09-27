# Today Planner Timeline Windows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current form-based Today Planner with a timeline-based scheduling window planner that auto-generates work and break segments inside each draggable window.

**Architecture:** Extend the runtime planner model from flat planned blocks to `Scheduling Window / 可调度区间` plus nested `Planned Segment / 计划片段`, where work segments can link tasks and break segments remain non-task soft guidance. Keep execution on the existing actual timeblock flow, and add a window-local reflow endpoint so frontend and `curl.exe` can re-align only the current scheduling window after actual progress diverges from plan.

**Tech Stack:** Rust `axum`, SQLite runtime store, React 18 + TypeScript, Vitest, `cargo test`, `curl.exe`

---

### Task 1: Runtime Window Model And Persistence

**Files:**
- Modify: `crates/exomind-runtime/src/timeblock.rs`
- Modify: `crates/exomind-runtime/src/timeblock_sqlite.rs`
- Test: `crates/exomind-runtime/src/timeblock.rs`

**Step 1: Write the failing test**

Add tests that prove:
- scheduling windows are isolated by `scope_key`
- a window stores nested generated segments
- segment provenance (`sourcePlannedBlockId`) still round-trips on active/completed timeblocks

**Step 2: Run test to verify it fails**

Run:

```powershell
cargo test -p exomind-runtime sqlite_store_isolates_planner_windows_by_scope
```

Expected: FAIL because window persistence does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `SchedulingWindowData`
- `RhythmPresetData`
- `PlannedSegmentData`
- `PlannedSegmentKind`
- SQLite table and CRUD helpers for scoped planner windows

**Step 4: Run test to verify it passes**

Run:

```powershell
cargo test -p exomind-runtime sqlite_store_isolates_planner_windows_by_scope
```

Expected: PASS

### Task 2: Runtime Timeline API

**Files:**
- Modify: `crates/exomind-runtime/src/routes/today_planner.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`
- Test: `crates/exomind-runtime/tests/today_planner_routes.rs`

**Step 1: Write the failing test**

Add route tests that prove:
- `GET /act/today-planner?date=YYYY-MM-DD` returns scheduling windows and nested segments
- `POST /act/today-planner/windows` creates a window and auto-generates work/break segments from preset
- `PATCH /act/today-planner/segments/:segment_id` updates work-segment title/task links
- `POST /act/today-planner/segments/:segment_id/start` starts only work segments
- `POST /act/today-planner/windows/:window_id/reflow` re-aligns only remaining segments in that window

**Step 2: Run test to verify it fails**

Run:

```powershell
cargo test -p exomind-runtime today_planner_windows_create_start_and_reflow --test today_planner_routes
```

Expected: FAIL because API contract still uses flat planned blocks.

**Step 3: Write minimal implementation**

Implement:
- window snapshot response
- create window endpoint
- update work segment endpoint
- start work segment endpoint
- window-local reflow endpoint

Keep:
- break segments non-startable
- reflow scoped to one window only

**Step 4: Run test to verify it passes**

Run:

```powershell
cargo test -p exomind-runtime today_planner_windows_create_start_and_reflow --test today_planner_routes
```

Expected: PASS

### Task 3: Frontend Planner Types And Adapter

**Files:**
- Modify: `src/lib/types/event.ts`
- Modify: `src/lib/adapters/today-planner-rt-adapter.ts`
- Modify: `src/lib/services/today-planner.service.ts`
- Test: `tests/unit/adapters/today-planner-rt-adapter.test.ts`

**Step 1: Write the failing test**

Add adapter tests that prove:
- window create goes to `/act/today-planner/windows`
- work segment update goes to `/act/today-planner/segments/:id`
- work segment start goes to `/act/today-planner/segments/:id/start`
- window reflow goes to `/act/today-planner/windows/:id/reflow`

**Step 2: Run test to verify it fails**

Run:

```powershell
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts
```

Expected: FAIL because adapter contract still targets flat blocks.

**Step 3: Write minimal implementation**

Implement:
- scheduling window DTOs
- planner adapter methods for windows / segments / reflow
- service facade updates

**Step 4: Run test to verify it passes**

Run:

```powershell
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts
```

Expected: PASS

### Task 4: Timeline UI

**Files:**
- Modify: `src/ui/app/components/NowTodayTab.tsx`
- Create: `tests/unit/ui/now-today-planner.test.tsx`

**Step 1: Write the failing test**

Add UI tests that prove:
- Today renders a 15-minute timeline
- dragging a time range creates a scheduling window draft
- confirming the draft creates a window via service
- generated work and break segments render inside the window
- clicking a work segment can start execution

**Step 2: Run test to verify it fails**

Run:

```powershell
bunx vitest run tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx
```

Expected: FAIL because UI is still form/list based.

**Step 3: Write minimal implementation**

Implement:
- 15-minute timeline grid
- drag selection to create a scheduling window
- preset chooser with default `25/5`
- nested work/break segment rendering
- work-segment actions: assign task later, start now

Non-goals for this round:
- full drag-resize after creation
- multi-window day auto-reschedule
- MCP skill wiring

**Step 4: Run test to verify it passes**

Run:

```powershell
bunx vitest run tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx tests/unit/ui/now-today-blocks-view.issue516.test.ts
```

Expected: PASS

### Task 5: Curl Contract And Completion

**Files:**
- Modify: `docs/development/today-planner-api.md`

**Step 1: Update the doc**

Document:
- get today planner snapshot
- create scheduling window
- update work segment
- start work segment
- reflow one scheduling window

Use Windows-friendly `curl.exe` examples.

**Step 2: Run verification**

Run:

```powershell
bunx tsc --noEmit
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx tests/unit/ui/now-today-blocks-view.issue516.test.ts tests/unit/services/timeblock.service.rt-sqlite.test.ts
cargo test -p exomind-runtime today_planner_windows_create_start_and_reflow --test today_planner_routes
cargo test -p exomind-runtime sqlite_store_isolates_planner_windows_by_scope
bun run build
```

Expected: all PASS
