# Today Planner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a minimal manual Today Planner that lets users create, edit, delete, reorder, and start today's planned work/rest blocks through shared runtime APIs.

**Architecture:** Extend the runtime timeblock store with `PlannedTimeBlockData` plus `sourcePlannedBlockId` provenance on active/completed blocks, expose a new `/act/today-planner/*` feature API, and add a thin frontend planner service + Today UI that consumes that API. Keep the implementation vertical and minimal: manual planning only, two block types only, up/down reorder only, and reuse the existing active/completed timeblock execution flow.

**Tech Stack:** Rust `axum` runtime routes, SQLite-backed runtime store, React 18 + TypeScript UI, Vitest unit tests, `gh` CLI, `curl`

---

### Task 1: Runtime Model And Store

**Files:**
- Modify: `crates/exomind-runtime/src/timeblock.rs`
- Modify: `crates/exomind-runtime/src/timeblock_sqlite.rs`
- Test: `crates/exomind-runtime/src/timeblock.rs`

**Step 1: Write the failing test**

Add tests that prove:
- planned blocks are isolated by `scope_key`
- planned blocks can be listed per `date`
- `sourcePlannedBlockId` round-trips on active/completed timeblocks

**Step 2: Run test to verify it fails**

Run:

```powershell
cargo test -p exomind-runtime sqlite_store_isolates_planned_timeblocks_by_scope
```

Expected: FAIL because planned block model/store methods do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `PlannedTimeBlockData`
- `PlannedTimeBlockType`
- `source_planned_block_id` on `ActiveBlockData` and `TimeBlockData`
- in-memory planned-block storage
- SQLite planned-block table and migration helpers
- scoped CRUD/list helpers needed by Today Planner routes

**Step 4: Run test to verify it passes**

Run:

```powershell
cargo test -p exomind-runtime sqlite_store_isolates_planned_timeblocks_by_scope
```

Expected: PASS

### Task 2: Runtime Today Planner API

**Files:**
- Create: `crates/exomind-runtime/src/routes/today_planner.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Test: `crates/exomind-runtime/src/routes/today_planner.rs`

**Step 1: Write the failing test**

Add route tests that prove:
- `GET /act/today-planner?date=YYYY-MM-DD` returns today's planned blocks with derived status
- `POST /act/today-planner/blocks` creates a `work/rest` block
- `PATCH /act/today-planner/blocks/:id` updates fields
- `POST /act/today-planner/blocks/reorder` updates `order`
- `POST /act/today-planner/blocks/:id/start` creates an active block with `sourcePlannedBlockId`
- `DELETE /act/today-planner/blocks/:id` removes a planned block

**Step 2: Run test to verify it fails**

Run:

```powershell
cargo test -p exomind-runtime today_planner_routes_create_reorder_and_start_blocks
```

Expected: FAIL because route module does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `GET /act/today-planner`
- `POST /act/today-planner/blocks`
- `PATCH /act/today-planner/blocks/:block_id`
- `POST /act/today-planner/blocks/reorder`
- `POST /act/today-planner/blocks/:block_id/start`
- `DELETE /act/today-planner/blocks/:block_id`

Rules:
- planned block start always bridges to current active timeblock flow
- runtime owns side effects, not the frontend
- return enough fields for frontend/curl to render status

**Step 4: Run test to verify it passes**

Run:

```powershell
cargo test -p exomind-runtime today_planner_routes_create_reorder_and_start_blocks
```

Expected: PASS

### Task 3: Frontend Planner Adapter And Service

**Files:**
- Create: `src/lib/adapters/today-planner-rt-adapter.ts`
- Create: `src/lib/services/today-planner.service.ts`
- Modify: `src/lib/types/event.ts`
- Test: `tests/unit/adapters/today-planner-rt-adapter.test.ts`

**Step 1: Write the failing test**

Add adapter tests that prove:
- requests go to `/act/today-planner/*`
- active profile scope is appended
- create/update/reorder/start/delete use expected HTTP methods and payloads

**Step 2: Run test to verify it fails**

Run:

```powershell
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts
```

Expected: FAIL because adapter/service do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- planner DTO types in `event.ts`
- RT adapter
- singleton planner service wrapping the adapter

**Step 4: Run test to verify it passes**

Run:

```powershell
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts
```

Expected: PASS

### Task 4: Today UI

**Files:**
- Modify: `src/ui/app/components/NowTodayTab.tsx`
- Create: `tests/unit/ui/now-today-planner.test.tsx`
- Optionally modify: `src/ui/app/pages/now-today-blocks-view.ts`

**Step 1: Write the failing test**

Add UI tests that prove:
- Today tab renders planned work/rest blocks
- user can create a block
- user can edit and delete a block
- user can reorder blocks with up/down actions
- user can start a planned block
- current active block and today's history still remain visible enough for continuity

**Step 2: Run test to verify it fails**

Run:

```powershell
bunx vitest run tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx
```

Expected: FAIL because planner UI does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- compact planner form
- planned block cards with work/rest badges
- edit/delete/up/down/start actions
- planner list above the existing today history list

Non-goals for this round:
- no auto scheduling
- no drag-and-drop
- no task picker UI

**Step 4: Run test to verify it passes**

Run:

```powershell
bunx vitest run tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx tests/unit/ui/now-today-blocks-view.issue516.test.ts
```

Expected: PASS

### Task 5: Curl Contract And Final Verification

**Files:**
- Create: `docs/development/today-planner-api.md`

**Step 1: Write the doc**

Document:
- create block
- list blocks
- reorder blocks
- start block
- delete block

Include Windows-friendly `curl.exe` examples with `user_id`.

**Step 2: Run verification**

Run:

```powershell
bunx tsc --noEmit
bunx vitest run tests/unit/adapters/today-planner-rt-adapter.test.ts tests/unit/ui/now-today-planner.test.tsx tests/unit/ui/now-today-tab.issue605.test.tsx tests/unit/ui/now-today-blocks-view.issue516.test.ts tests/unit/services/timeblock.service.rt-sqlite.test.ts
cargo test -p exomind-runtime today_planner
```

If runtime test naming differs after implementation, run the matching `today_planner` subset or the full `exomind-runtime` crate tests touched by this change.

**Step 3: Manual curl verification**

Run representative commands:

```powershell
curl.exe -sS "http://127.0.0.1:9124/act/today-planner?date=2026-03-26&user_id=profile-argon"
curl.exe -sS -X POST "http://127.0.0.1:9124/act/today-planner/blocks?user_id=profile-argon" -H "Content-Type: application/json" -d "{\"date\":\"2026-03-26\",\"type\":\"work\",\"title\":\"Deep Work\",\"plannedStartAt\":1774490400000,\"plannedDurationMinutes\":50}"
```

Expected: JSON response with created/listed planned blocks.

### Task 6: Branch And PR

**Files:**
- No code changes required

**Step 1: Check diff**

Run:

```powershell
git status --short
git diff --stat
```

**Step 2: Commit**

```powershell
git add .
git commit -m "feat: add today planner runtime api and ui"
```

**Step 3: Push and create PR**

```powershell
git push -u origin feature/issue-751-today-planner
gh pr create --base dev --head feature/issue-751-today-planner --title "feat: add manual today planner" --body-file .github/pull_request_template.md
```

Expected: open PR linked to `#751 #752 #753 #754`
