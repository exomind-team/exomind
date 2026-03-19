# Issue 590 Task End State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix issue `#590` so overlay/task-detail flows can reliably end tasks under the `taskIds` model and expose direct task status actions where users need them.

**Architecture:** Keep the fix narrow. Reuse `resolveActiveBlockTaskIds()` as the single source of truth for active block task resolution, keep overlay transitions aligned with existing timer/DAG flows, and add direct status actions in `TaskDetailPage` without reshaping the page architecture. Tests should pin both the regression path and the new UI affordance.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Bun.

---

### Task 1: Lock the regressions with failing tests

**Files:**
- Create: `tests/unit/ui/now-workbench-overlay-controller.issue590.test.tsx`
- Create: `tests/unit/pages/NowWorkbenchOverlayPage.issue590.test.tsx`
- Modify: `tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`

**Step 1: Write the failing overlay controller regression test**

Cover this case:
- active block uses `taskIds: ['task-1', 'task-2']`
- selected outcome is `completed`
- calling `handleConfirmEnd()` must call `endBlock()`
- then call `transitionTask('task-1', 'completed')` and `transitionTask('task-2', 'completed')`

**Step 2: Run the overlay controller test to verify it fails**

Run: `bunx vitest run tests/unit/ui/now-workbench-overlay-controller.issue590.test.tsx`

Expected: FAIL because the current code still gates on deprecated `taskId`.

**Step 3: Write the failing overlay page selector test**

Cover this case:
- overlay feedback dialog is open
- active block only has `taskIds`
- `TaskStatusSelector` must still render

**Step 4: Run the overlay page test to verify it fails**

Run: `bunx vitest run tests/unit/pages/NowWorkbenchOverlayPage.issue590.test.tsx`

Expected: FAIL because the dialog currently checks `model.activeBlock?.taskId`.

**Step 5: Write the failing task detail action test**

Add a test proving:
- when task status is `in_progress`, the detail page shows direct actions for `完成 / 挂起 / 取消`
- clicking an action calls `taskService.transitionTask()`
- when task status is `suspended`, the page exposes `恢复执行 / 完成 / 取消`

**Step 6: Run the task detail page test to verify it fails**

Run: `bunx vitest run tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`

Expected: FAIL because the page currently has no direct transition actions.

### Task 2: Fix overlay task resolution and feedback affordance

**Files:**
- Modify: `src/ui/app/overlay/use-now-workbench-overlay-controller.ts`
- Modify: `src/pages/NowWorkbenchOverlayPage.tsx`

**Step 1: Replace deprecated task resolution in overlay controller**

Implementation requirements:
- import/use `resolveActiveBlockTaskIds(blockBeforeEnd)`
- build one `taskStatusOutcomes` map when the selected choice is not `continue`
- pass outcomes into `timeBlockService.endBlock(feedback, { taskStatusOutcomes })`
- iterate all resolved task IDs and call `taskService.transitionTask(taskId, choice)`
- keep existing error capture / debug info behavior

**Step 2: Restore feedback dialog status selector under the new model**

Implementation requirements:
- in `NowWorkbenchOverlayPage`, stop checking `model.activeBlock?.taskId`
- instead, show the selector whenever `resolveActiveBlockTaskIds(model.activeBlock).length > 0`

**Step 3: Re-run the two overlay tests**

Run:
- `bunx vitest run tests/unit/ui/now-workbench-overlay-controller.issue590.test.tsx`
- `bunx vitest run tests/unit/pages/NowWorkbenchOverlayPage.issue590.test.tsx`

Expected: PASS.

### Task 3: Add direct task status actions to the detail page

**Files:**
- Modify: `src/ui/app/pages/TaskDetailPage.tsx`
- Modify: `tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`

**Step 1: Add a minimal transition action model**

Implementation requirements:
- derive actions from current `task.status`
- for `in_progress`: expose `完成 / 挂起 / 取消`
- for `suspended`: expose `恢复执行 / 完成 / 取消`
- keep terminal tasks unchanged

**Step 2: Add a narrow handler**

Implementation requirements:
- call `getTaskService().transitionTask(task.id, nextStatus)`
- clear old action errors before submit
- refresh local view after success via existing reload path
- surface failures with the same lightweight error messaging style already used on the page

**Step 3: Render the actions in both mobile and desktop timer/action area**

Implementation requirements:
- avoid creating a separate large component tree
- reuse one small action group renderer or one shared data structure
- keep labels explicit:
  - `完成（Complete）`
  - `挂起（Suspend）`
  - `恢复执行（Resume）`
  - `取消（Cancel）`

**Step 4: Re-run the task detail page test**

Run: `bunx vitest run tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`

Expected: PASS.

### Task 4: Verify the whole change set

**Files:**
- No additional code files unless verification uncovers a defect

**Step 1: Run focused tests**

Run:
- `bunx vitest run tests/unit/ui/now-workbench-overlay-controller.issue590.test.tsx`
- `bunx vitest run tests/unit/pages/NowWorkbenchOverlayPage.issue590.test.tsx`
- `bunx vitest run tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`

**Step 2: Run targeted type checking**

Run: `bunx tsc --noEmit`

**Step 3: Run build if the targeted checks are clean**

Run: `bun run build`

**Step 4: Commit**

```bash
git add src/pages/NowWorkbenchOverlayPage.tsx src/ui/app/overlay/use-now-workbench-overlay-controller.ts src/ui/app/pages/TaskDetailPage.tsx tests/unit/ui/now-workbench-overlay-controller.issue590.test.tsx tests/unit/pages/NowWorkbenchOverlayPage.issue590.test.tsx tests/unit/ui/task-detail-page.timeblock-detail.test.tsx
git commit -m "fix(issue-590): restore task end actions"
```
