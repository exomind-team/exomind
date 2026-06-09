# Batch Q DAG Search Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Task DAG text search, tag search, and the `过滤` toggle into one coherent search system where text and tags stack as search conditions and `过滤` only controls whether non-matches are dimmed or hidden.

**Architecture:** Keep the change scoped to the Task DAG page. Reframe the current tag controls from an independent filter pipeline into tag-based search criteria, evaluate matching per node instead of merging separate match sets, and let `filterMode` decide between soft search presentation and hard graph pruning. Preserve existing focus-series and manual-layout behavior, but explicitly recompute smart-terminal weakening from the already-search-pruned graph whenever unified hard-hide is active so secondary-node classification stays correct.

**Tech Stack:** React, TypeScript, `@xyflow/react`, Vitest, runtime-backed DAG preferences

---

## Context

- Current Task DAG search has two different semantics:
  - text search defaults to highlight/dim unless `过滤` is enabled
  - tag buttons currently act as an independent hard filter
- Product decision for this round:
  - only the DAG surface changes
  - text search and tag search are one unified search system
  - text and tags stack with `AND`
  - tag-internal multi-select keeps its existing `and/or` meaning
  - `过滤` belongs to the unified search system and only decides whether non-matches are dimmed or hidden
- Out of scope:
  - `/tasks` list page
  - RT contract changes
  - task truth data
  - new search UI modes beyond the existing controls

## File Map

- Modify: `src/ui/app/pages/TaskDagPage.tsx`
  - Own the unified DAG search pipeline and node-level match predicate
- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
  - Adjust visible wording so tag controls read as search criteria instead of a separate hard filter
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
  - Cover unified search semantics end-to-end
- Optional Test Touch: `tests/unit/config/task-dag-preferences.test.ts`
  - Only if preference persistence wording or normalization needs coverage updates

## Behavior Contract

### Unified Match Rule

For each visible DAG node, evaluate:

```ts
matchesNodeSearch = matchesTextSearch(node) && matchesTagSearch(node)
```

Where:

- `matchesTextSearch(node)`:
  - returns `true` when the search box is empty
  - otherwise uses the existing text search options (`描述`, `模糊`) to decide whether the node matches
- `matchesTagSearch(node)`:
  - returns `true` when no tag is selected
  - otherwise uses the existing tag `and/or` rule across selected tags

### Active Search Rule

Introduce one unified flag:

```ts
hasActiveUnifiedSearch = Boolean(searchQuery.trim()) || tagFilter.selectedTags.length > 0
```

This unified flag must replace text-only search gating anywhere that currently decides:

- whether search match styling is active
- whether non-matches should be dimmed
- whether `searchMatchCount` is visible
- whether `filterMode` should prune the graph

### Display Rule

- If there is no active unified search condition:
  - keep the current graph unchanged
- If there is active unified search and `过滤` is off:
  - keep the whole graph
  - matching nodes use current search-highlight styling
  - non-matching nodes use current search-dim styling
  - edges follow the current node-search semantics
- If there is active unified search and `过滤` is on:
  - prune the graph to matching nodes only
  - non-matching nodes and their edges are hidden

### Interaction Rule

- Tag buttons are no longer a separate “hard filter” concept in behavior
- `过滤` applies to the unified result of text + tag matching
- `searchMatchCount` counts unified matches, not text-only matches
- Tag-only search is still a real search state, not a passive tag selection state
- The hidden-running notice must only be driven by actual unified hard-hide state:
  - active unified search
  - `filterMode=true`
  - current running task is outside the final unified match set
- If that condition is not met, the notice must not appear and existing detail selection must remain visible

### Smart-Terminal Rule

- Unified hard-hide search must feed smart-terminal classification, not the other way around
- When `filterMode=true`, the graph used for smart-terminal weakening must already reflect the unified search-pruned node set
- This prevents completed/cancelled nodes from remaining as `次要节点` because of unfinished neighbors that have already been excluded by unified hard-hide search
- Non-filter search must not change smart-terminal classification order because it keeps the full graph visible

## Non-Goals

- Do not change `/tasks` list search behavior
- Do not rename storage keys unless strictly required
- Do not add a new combined “search mode” control
- Do not refactor unrelated DAG stages such as smart terminal, focus-series, or manual layout

### Task 1: Lock Down Unified Search Semantics in Tests

**Files:**
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] **Step 1: Add a failing regression for text search without `过滤`**

Cover:
- entering a text query keeps unmatched nodes mounted
- matched nodes remain highlighted
- unmatched nodes are dimmed instead of hidden

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx -t "supports description, fuzzy, and filter search options with localStorage persistence"
```

Expected: FAIL because current assertions or implementation still couple parts of the flow to hard hiding.

- [ ] **Step 2: Add a failing regression for tag search without `过滤`**

Cover:
- selecting one tag with `过滤` off keeps unmatched nodes mounted
- selected-tag matches are highlighted
- non-matches are dimmed
- hidden-running notice does not appear just because a running task is outside tag search while `过滤` is off

Expected failure: current tag tests still expect hard hiding.

- [ ] **Step 3: Add a failing regression for text + tag `AND` semantics**

Cover:
- text-only match is insufficient when selected tags do not match
- tag-only match is insufficient when text does not match
- only nodes satisfying both conditions count as matches

- [ ] **Step 4: Add a failing regression for `过滤` as unified search mode**

Cover:
- with both text and tag conditions active, enabling `过滤` hides all non-matches
- disabling `过滤` restores the dimmed full graph
- hidden-running notice only appears after hard-hide is active

- [ ] **Step 5: Add a failing regression for smart-terminal after unified hard-hide**

Cover:
- when text+tag search with `过滤` removes the unfinished neighbor of a completed node
- smart-terminal classification no longer keeps that completed node as a surviving `次要节点`

- [ ] **Step 6: Re-run the focused DAG page tests**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: new unified-search cases fail before implementation.

### Task 2: Replace Separate Match Sets with a Node-Level Unified Search Predicate

**Files:**
- Modify: `src/ui/app/pages/TaskDagPage.tsx`

- [ ] **Step 1: Introduce a node-level text-match helper**

Implement a helper near the existing search pipeline that answers whether a single task/node matches the current text search options.

Requirements:
- empty text query returns `true`
- reuse existing `filterTasksBySearch(...)` semantics or equivalent matching logic
- do not duplicate fuzzy logic in multiple places without extracting a shared helper

- [ ] **Step 2: Introduce a node-level tag-match helper**

Implement a helper that evaluates the current selected tags against one node/task.

Requirements:
- no selected tags returns `true`
- selected tags use existing `and/or` rule
- task tags must still come from `taskById`, not graph nodes

- [ ] **Step 3: Compute one unified per-node match predicate**

Add a single `matchesUnifiedSearch(nodeId)` style path that combines:
- text match
- tag match

with `AND`.

- [ ] **Step 4: Derive unified match ids and counts from that predicate**
- [ ] **Step 4: Derive unified match ids, counts, and active-search state from that predicate**

Update:
- `searchMatchCount`
- `hasActiveUnifiedSearch`
- any search-driven match set passed into node rendering

So they represent unified matches, not text-only matches.

- [ ] **Step 5: Keep non-filter search in full-graph mode**

Update `renderedVisibleGraph` so:
- no active search condition returns the current pre-search graph
- active unified search with `filterMode=false` also returns the full pre-search graph
- only `filterMode=true` prunes by the unified match predicate

- [ ] **Step 6: Move smart-terminal hard-hide input behind unified hard-hide search**

Update the pipeline so:
- non-filter unified search keeps current pre-search graph flowing into smart-terminal logic
- filter-mode unified search prunes first
- smart-terminal weakening/classification then runs against that pruned graph

- [ ] **Step 7: Preserve current node highlight/dim contracts**

Keep wiring so:
- `isSearchMatch` uses unified search match
- `isSearchDimmed` is `true` only when there is active unified search and the node is not a match
- text-only gating is removed in favor of `hasActiveUnifiedSearch`

Do not change focus-series or secondary-node precedence unless a failing test proves a conflict.

- [ ] **Step 8: Re-run the focused DAG page tests**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: unified search cases now pass.

### Task 3: Align Control-Surface Copy with Unified Search Semantics

**Files:**
- Modify: `src/ui/app/components/TaskDagControlPanel.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`

- [ ] **Step 1: Review current tag-area wording**

Check which visible strings imply “tag filtering” as a separate hard filter.

- [ ] **Step 2: Change only the minimum necessary copy**

Adjust wording so the control surface reads consistently with unified search semantics.

## Follow-Up Completeness Gap

This round completes DAG-side unified search semantics, but it does **not** yet make task tags fully operable from the UI. To treat the overall feature surface as complete, the product still needs a dedicated task-tag editing path.

### Required Follow-Up: Task Tag CRUD in UI

- Primary landing surface:
  - `src/ui/app/pages/TaskDetailPage.tsx`
- Goal:
  - let users add, remove, rename, and review task tags from the task detail surface
- Minimum acceptance:
  - current task tags are visible in the detail page
  - users can add one or more tags
  - users can delete existing tags
  - users can edit/rename an existing tag without manually rewriting the whole task description
  - save calls `getTaskService().updateTask(task.id, { tags: ... })`
  - DAG tag search reflects updated tags after returning to `/tasks/dag`
- Explicitly not required for the first follow-up slice:
  - DAG inline tag editing
  - `/tasks` list-page bulk tag editing
  - new RT/storage contracts

### Why This Follow-Up Is Required

- DAG unified search now depends more heavily on tags as first-class search criteria
- without an in-UI tag editing path, users can search by tags but cannot reliably maintain those tags from the main task-detail workflow
- the service/runtime stack already supports `tags` updates, so this is primarily a UI completeness gap rather than a backend blocker

Targets may include:
- tag summary badge copy
- clear-action copy
- unified search count visibility when only tags are active
- any nearby helper text introduced by this round

Keep test ids stable unless a failing test proves otherwise.

- [ ] **Step 3: Re-run DAG page tests after copy alignment**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

Expected: UI assertions still pass.

### Task 4: Run Regression Suite for Search + DAG Interactions

**Files:**
- Modify if needed: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/task-dag-page.issue394.test.tsx`
- Test: `tests/unit/ui/task-dag-flow.issue564.test.ts`
- Test: `tests/unit/ui/task-dag-keyboard.test.ts`
- Test: `tests/unit/config/task-dag-preferences.test.ts`

- [ ] **Step 1: Run the DAG regression bundle**

Run:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-keyboard.test.ts tests/unit/config/task-dag-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 2: Fix any interaction regressions without expanding scope**

If regressions appear, keep fixes limited to:
- unified search pipeline
- search-related UI copy
- preference persistence directly tied to the new semantics
- unified active-search gating
- hidden-running notice semantics tied to hard-hide only

- [ ] **Step 3: Re-run the DAG regression bundle**

Run the same command again.

Expected: PASS.

### Task 5: Manual Verification

**Files:**
- No code changes required

- [ ] **Step 1: Start the local web stack**

Run:

```bash
EXOMIND_WEB_PORT=5173 EXOMIND_HMR_PORT=5174 bun run dev --host 0.0.0.0
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```

Expected: `HTTP 200`.

- [ ] **Step 2: Verify text-only search without `过滤`**

In `/tasks/dag`:
- enter a text query that matches only part of the graph
- confirm unmatched nodes remain visible but dimmed

- [ ] **Step 3: Verify tag-only search without `过滤`**

In `/tasks/dag`:
- select one or more tags
- confirm unmatched nodes remain visible but dimmed

- [ ] **Step 4: Verify text + tag `AND` semantics**

In `/tasks/dag`:
- use a text query and selected tags that only overlap on one node
- confirm only overlapping nodes are highlighted

- [ ] **Step 5: Verify unified `过滤` behavior**

With the same search conditions:
- enable `过滤`
- confirm non-matches disappear
- disable `过滤`
- confirm the full graph returns in dimmed/highlight mode

## Acceptance Criteria

- Text search and tag search are one unified DAG search system
- Text and tag conditions combine with `AND`
- Tag multi-select still honors its internal `and/or` rule
- `过滤` only controls dim-vs-hide behavior for unified search results
- Non-filter search never hard-hides unmatched nodes
- The change remains scoped to the Task DAG page

## Verification Summary

Primary command set:

```bash
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-keyboard.test.ts tests/unit/config/task-dag-preferences.test.ts
EXOMIND_WEB_PORT=5173 EXOMIND_HMR_PORT=5174 bun run dev --host 0.0.0.0
curl -sS -D - -o /dev/null http://127.0.0.1:5173 | head -n 8
```
