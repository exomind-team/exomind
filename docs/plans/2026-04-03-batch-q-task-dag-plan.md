# Batch Q Task DAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split batch Q into three executable segments and land the Task DAG interaction upgrades in a stable order without blocking on batch N.

**Architecture:** Batch Q stays inside the Task DAG web surface. Q-A fixes interaction semantics and task-search ordering, Q-B adds unified manual layout and blank-drop creation on top of the existing ReactFlow + quick-create pipeline, and Q-C adds focus-series, tag filtering, and smart terminal-node weakening without turning view-state into shared task truth.

**Tech Stack:** React, TypeScript, `@xyflow/react`, Vitest, TanStack Router, local/runtime-backed preference storage

---

## Scope Baseline

- Latest published route checked on `2026-04-03` still lists batch Q as `#501 #701 #700 #660 #653 #639 #698 #694`.
- This plan supersedes the older scope assumptions in `docs/plans/2026-04-01-batch-q-task-dag-interaction-plan.md`.
- Batch Q is treated as a Task DAG web-only batch. Do not block Q-A or Q-B on batch N.
- The only remaining soft semantic coupling to batch N is in Q-C UX wording. Implementation should stay on task-local semantics.
- `PouchDB` is explicitly out of scope. Do not add any `PouchDB` startup, sync-server startup, or `6984` verification steps to this plan.

## Segment Order

1. `Q-A`: `#694 #700 #698`
2. `Q-B`: `#639 #701`
3. `Q-C`: `#660 #653`
4. `#501` stays as the epic umbrella and final acceptance roll-up, not a separate execution segment

## Non-Goals

- Do not modify Rust runtime, sync-server, or legacy sync code.
- Do not add goal-system files or goal data-model changes.
- Do not introduce a new `domain` field into task truth data.
- Do not expand shared `TaskDagVisibilityState` unless a later review explicitly approves that spillover.

### Task 1: Q-A Interaction Semantics

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/ui/app/components/TaskDagModeSelector.tsx`
- Modify: `src/ui/app/components/TaskQuickCreateDialog.tsx`
- Modify: `src/ui/app/pages/task-title-fuzzy-search.ts`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/tasks-page.issue546-fuzzy-search.test.tsx`
- Test: `tests/unit/ui/task-title-fuzzy-search.issue546.test.ts`

- [ ] **Step 1: Lock down `#694` with failing tests**

Add or tighten tests in `tests/unit/ui/task-dag-page.issue394.test.tsx` for:
- canvas-region `Ctrl+Alt+wheel` cycles mode
- plain wheel does not change mode
- `Ctrl+Alt+←/→` still works
- `Ctrl+←/→` does not mutate mode

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: at least one test fails before the fix.

- [ ] **Step 2: Fix `#694` in the DAG page event path**

Update `src/ui/app/pages/TaskDagPage.tsx` so the canvas wheel interception is verified against the actual listener surface and target rules used by ReactFlow. Keep the fix scoped to the DAG page. Do not change unrelated keyboard behavior.

- [ ] **Step 3: Re-run Q-A DAG tests**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: the wheel/mode tests pass.

- [ ] **Step 4: Write the failing copy tests for `#700`**

Update `tests/unit/ui/task-dag-page.issue394.test.tsx` so visible copy expects:
- `编辑模式` instead of `连接模式`
- any matching mode button/title text to use `编辑`

Expected failure: existing copy still says `连接`.

- [ ] **Step 5: Implement `#700` visible copy cleanup**

Change only user-facing copy in:
- `src/ui/app/components/TaskDagModeSelector.tsx`
- `src/ui/app/pages/TaskDagPage.tsx`
- `src/ui/app/components/TaskQuickCreateDialog.tsx`

Keep:
- internal mode key as `connect`
- existing storage key/value `exomind:dag-mode=connect`
- existing technical test ids unless a failing test proves they must change

- [ ] **Step 6: Re-run Q-A DAG tests after copy cleanup**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: updated copy assertions pass.

- [ ] **Step 7: Write the failing tests for `#698` on `/tasks` search**

Add tests that prove:
- matched tasks sort by status priority before fuzzy score tie-breakers
- same-status matches sort by `createdAt` descending
- terminal tasks can still appear when searching

Prefer adding coverage in:
- `tests/unit/ui/tasks-page.issue546-fuzzy-search.test.tsx`
- `tests/unit/ui/task-title-fuzzy-search.issue546.test.ts`

- [ ] **Step 8: Implement `/tasks` search ordering**

Update `src/ui/app/pages/task-title-fuzzy-search.ts` so search sorting uses:
1. status priority
2. `createdAt` descending within the same status
3. existing fuzzy ranking tie-breakers

Use this priority:
- `in_progress`
- `suspended`
- `pending`
- `completed`
- `cancelled`

Do not change non-search task listing behavior in `src/ui/app/pages/TasksPage.tsx`.

- [ ] **Step 9: Re-run task-search tests**

Run:

```bash
npx vitest run tests/unit/ui/tasks-page.issue546-fuzzy-search.test.tsx tests/unit/ui/task-title-fuzzy-search.issue546.test.ts
```

Expected: both test files pass.

- [ ] **Step 10: Run typecheck for Q-A**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 11: Manual web verification for Q-A**

Run:

```bash
npx vite --host 0.0.0.0 --port 5173
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

Verify in browser:
- `/tasks/dag`: `Ctrl+Alt+wheel` switches mode without accidental zooming
- `/tasks/dag`: visible mode text uses `编辑模式`
- `/tasks`: search results prioritize active tasks first

### Task 2: Q-B Manual Layout Foundation

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/ui/app/pages/task-dag-flow.ts`
- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
- Modify: `src/config/task-dag-preferences.ts`
- Create: `src/ui/app/pages/task-dag-layout-store.ts`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/task-dag-flow.issue564.test.ts`
- Test: `tests/unit/config/task-dag-preferences.test.ts`
- Test: `tests/unit/ui/task-dag-layout-store.issue639.test.ts`

- [ ] **Step 1: Add failing tests for manual layout mode**

Cover:
- layout mode persistence
- node drag-stop persistence
- remount restore
- switching back from auto to manual restores manual positions

Use:
- `tests/unit/ui/task-dag-page.issue394.test.tsx`
- a new pure store test `tests/unit/ui/task-dag-layout-store.issue639.test.ts`

- [ ] **Step 2: Add layout mode and snapshot storage**

Introduce a dedicated helper `src/ui/app/pages/task-dag-layout-store.ts` modeled after `src/ui/app/pages/topology-layout.ts`.

Recommended shape:

```ts
export type TaskDagLayoutMode = 'auto' | 'manual';

export type TaskDagManualLayoutSnapshot = {
  manualPositions: Record<string, { x: number; y: number }>;
  updatedAt: string;
};
```

Use `src/config/task-dag-preferences.ts` only for the lightweight `layoutMode` preference key, not for the full snapshot merge logic.

Snapshot contract:
- use one unified manual snapshot for the DAG
- do not split snapshots by `TB / LR`
- do not split snapshots by `desktop / mobile`
- keep the storage model abstracted so a later RT-backed migration stays possible without reshaping the UI contract

- [ ] **Step 3: Merge manual positions into DAG flow output**

Update `src/ui/app/pages/task-dag-flow.ts` so a saved manual position overlay can replace Dagre positions node-by-node while leaving unseen/new nodes on auto layout fallback.

Cover cleanup rules:
- stale node ids are dropped
- new node ids fall back to generated layout
- status-only graph changes do not wipe manual positions
- direction changes reuse the same manual positions
- desktop/mobile rendering reuses the same manual positions

- [ ] **Step 4: Add control-surface UI for layout mode**

Update `src/ui/app/components/TaskDagControlPanel.tsx` to expose `auto` / `manual` layout mode.

Requirements:
- mode is visible and explicit
- switching to auto does not delete manual snapshot
- switching back to manual restores prior positions

- [ ] **Step 5: Wire drag-stop persistence in `TaskDagPage`**

Update `src/ui/app/pages/TaskDagPage.tsx` so:
- manual mode enables dragging
- drag-stop commits position
- do not add viewport restore to the manual snapshot contract in this round

### Task 3: Q-B Blank-Drop Create

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/ui/app/components/TaskQuickCreateDialog.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] **Step 1: Add failing tests for `#701`**

Extend the ReactFlow mock in `tests/unit/ui/task-dag-page.issue394.test.tsx` to support:
- `onConnectStart`
- `onConnectEnd`
- optional `screenToFlowPosition`

Cover:
- drag from handle to blank opens quick-create
- upstream/downstream direction is inferred correctly
- created task is connected with the right dependency type
- in manual mode the new node keeps the dropped position

- [ ] **Step 2: Reuse the existing quick-create pipeline**

In `src/ui/app/pages/TaskDagPage.tsx`, route blank-drop create into the existing quick-create state and submit path instead of creating a second creation workflow.

Consolidate fragmented state if needed:
- `quickCreateDependency`
- `quickCreateDirection`
- `quickCreateFromNodeId`
- optional `dropPosition`

- [ ] **Step 3: Implement blank-drop position behavior**

Rules:
- in `auto` mode, blank-drop create may still end up Dagre-positioned
- in `manual` mode, blank-drop create should seed the new node near the drop point and persist that location

- [ ] **Step 4: Re-run Q-B tests**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/config/task-dag-preferences.test.ts tests/unit/ui/task-dag-layout-store.issue639.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and manual web verification for Q-B**

Run:

```bash
npx tsc --noEmit
npx vite --host 0.0.0.0 --port 5173
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

Verify in browser:
- manual mode enables drag and persists layout after reload
- switching auto/manual preserves saved manual layout
- dragging from a handle to blank opens quick-create
- new node placement behaves correctly in manual mode

### Task 4: Q-C Focus-Series

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/lib/task/task-dag-visibility.ts`
- Modify: `src/ui/app/pages/task-dag-flow.ts`
- Modify: `src/ui/app/hooks/useTaskDagKeyboard.ts`
- Modify: `src/ui/app/components/TaskDagKeyHints.tsx`
- Test: `tests/unit/ui/task-dag-visibility.issue395.test.ts`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/task-dag-keyboard.test.ts`

- [ ] **Step 1: Add failing tests for focus-series**

Cover:
- connected-component calculation on the DAG as an undirected graph
- focus dims non-component nodes/edges without removing them
- collapsed hidden nodes do not reappear because of focus
- focus can be cleared cleanly
- browse-mode context menu shows `聚焦此系列` / `取消聚焦此系列` as a toggle
- focus state survives leaving and re-entering `/tasks/dag`
- hiding the focus anchor via tag filtering or terminal hiding keeps implicit focus and restores it when visibility returns

- [ ] **Step 2: Implement connected-component helpers**

Add helper logic in `src/lib/task/task-dag-visibility.ts` for component discovery.

Rules:
- calculate against the currently rendered visible graph basis
- do not mutate shared visibility state shape just to hold focus state

- [ ] **Step 3: Wire page-local focus state into `TaskDagPage`**

Add focus-series view state locally in `src/ui/app/pages/TaskDagPage.tsx`.

Requirements:
- focus affects emphasis only
- focus does not change which nodes exist in the graph
- focus entry appears only in browse-mode node context menu
- connect / execute mode do not expose a focus toggle entry, but an existing focus effect remains active
- clear action supports `Esc / J` and follows the contract `clear selected node first, then clear focused series`
- persistence should align with the current DAG search draft/options behavior: a single runtime-backed UI state, not split by desktop/mobile or direction

- [ ] **Step 4: Reflect focus styling in flow nodes and edges**

Update `src/ui/app/pages/task-dag-flow.ts` so nodes/edges can carry `isFocusDimmed`-style flags without changing graph truth.

### Task 5: Q-C Tag Filter + Smart Terminal Weakening

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
- Modify: `src/ui/app/pages/task-dag-flow.ts`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/task-dag-flow.issue564.test.ts`

- [ ] **Step 1: Add failing tests for tag filtering and smart terminal weakening**

Cover:
- tag filtering uses true hiding rather than weakened placeholders
- hiding a selected node clears selection
- hiding active/running nodes is allowed and surfaces a visible hidden-count notice plus clear-filter entry
- tag filter selection and `AND / OR` mode both persist locally
- search `filterMode` still behaves as a true filter and is not rewritten into another semantic layer
- terminal nodes in `smart` mode are hidden when isolated
- terminal nodes in `smart` mode remain as visually weakened secondary nodes when either side still connects to unfinished work
- `strict` mode hides all terminal nodes

- [ ] **Step 2: Implement tag-only filter UI**

Update `src/ui/app/components/TaskDagControlPanel.tsx` with tag-filter UI.

Constraint:
- use `标签` wording
- do not introduce `领域` wording in this phase
- place the control inside the existing search/filter surface
- provide `AND / OR` mode toggle inside the same surface
- show an inline `已过滤`-style state and hidden-running count notice with a clear-filter affordance

- [ ] **Step 3: Add secondary-node rendering flags for smart terminal mode**

Update `src/ui/app/pages/task-dag-flow.ts`, `src/ui/app/pages/TaskDagPage.tsx`, and `src/lib/task/task-dag-visibility.ts` so secondary nodes:
- only come from smart terminal handling, not tag filtering
- remain in topology
- appear visually weakened
- restore normal terminal brightness when selected
- do not add a second interaction-restriction system; keep existing terminal-node semantics in browse/connect/execute

- [ ] **Step 4: Keep Q-C state page-local unless explicitly approved otherwise**

Do not expand shared `TaskDagVisibilityState` just to hold tag filter or focus-series UI state. Keep focus/tag-filter UI state local to the DAG page and use runtime-backed UI preference storage where persistence is required.

- [ ] **Step 5: Re-run Q-C tests**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-visibility.issue395.test.ts tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-keyboard.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck and manual web verification for Q-C**

Run:

```bash
npx tsc --noEmit
npx vite --host 0.0.0.0 --port 5173
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

Verify in browser:
- focus-series dims non-component nodes and edges
- clearing focus restores normal emphasis
- tag filtering truly hides non-matching nodes and surfaces `已过滤` plus hidden-running notice
- smart terminal mode weakens only the required terminal nodes as secondary nodes
- secondary nodes still follow existing terminal-node interaction semantics

### Task 6: Final Batch-Q Rollup

**Files:**
- Modify: `docs/plans/2026-04-01-batch-q-task-dag-interaction-plan.md`
- Optionally create: `docs/plans/2026-04-03-batch-q-task-dag-acceptance-notes.md`

- [ ] **Step 1: Correct the older plan document**

Update or annotate `docs/plans/2026-04-01-batch-q-task-dag-interaction-plan.md` so it no longer misstates:
- Q depending wholesale on N
- Phase A omitting `#694`
- `#698` being a DAG search issue

- [ ] **Step 2: Run the final targeted verification set**

Run:

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-visibility.issue395.test.ts tests/unit/ui/task-dag-keyboard.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/tasks-page.issue546-fuzzy-search.test.tsx tests/unit/ui/task-title-fuzzy-search.issue546.test.ts tests/unit/config/task-dag-preferences.test.ts tests/unit/ui/task-dag-layout-store.issue639.test.ts
```

Expected: PASS.

- [ ] **Step 3: Record manual web evidence**

Run:

```bash
npx vite --host 0.0.0.0 --port 5173
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

Verify:
- Q-A, Q-B, and Q-C acceptance points all hold in the web UI

## Acceptance Summary

- `#694`: canvas `Ctrl+Alt+wheel` changes mode without accidental zoom behavior
- `#700`: visible copy says `编辑模式`, internal `connect` storage/keys remain stable
- `#698`: `/tasks` search ranks by status priority, then `createdAt` descending
- `#639`: manual layout persists and restores
- `#701`: handle-drag-to-blank opens quick-create and creates linked tasks correctly
- `#660`: focus-series dims non-component nodes/edges without mutating graph membership and restores from runtime-backed UI state on re-entry
- `#653`: tag filtering remains true hiding with local persistence, inline filter status, and hidden-running notice
- smart terminal mode weakens eligible terminal nodes as secondary nodes instead of deleting them
- No `PouchDB` workflow or verification appears anywhere in the batch Q implementation path
