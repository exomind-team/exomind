# Issue #213 Task UI + Mock Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pixel-level restore of Task UI from Pencil, including `/tasks` + `/tasks/:id`, gradient-glow task card, mode switch (`countdown`/`countup`), pause control, input row, and mock adapter injection via bootstrap.

**Architecture:** Add a dedicated Task domain port (`ITaskPort`), a real web adapter and a mock adapter (fixtures-based), then inject adapter by `useMockData` flag in runtime bootstrap. UI uses a Task service layer and new pages in new-router mode, with route-level lazy loading and developer toggle for mock switch.

**Tech Stack:** React 18 + TypeScript + TanStack Router + Tailwind + Zustand/local state + Vitest + Playwright.

---

### Task 1: Plan & PR bootstrap（计划与 PR 启动）

**Files:**
- Create: `docs/plans/2026-02-23-issue-213-task-ui-mock-plan.md`
- Create: `docs/pr/issue-213-plan-comment.md`

**Step 1: Write plan markdown**

```md
# ...Implementation Plan
```

**Step 2: Push branch and open PR to dev**

Run: `git push -u origin vk/f06f-gh-213-feat-task && gh pr create --base dev --head vk/f06f-gh-213-feat-task --title "feat(Task): 前端 UI 设计 + 实现 (GH#213)" --body-file docs/pr/issue-213-plan-comment.md`

Expected: PR URL returned.

**Step 3: Post plan comment to PR**

Run: `bun Scripts/dev/github-comment.ts --type pr --number <PR_NUMBER> --file docs/pr/issue-213-plan-comment.md`

Expected: comment URL returned.

**Step 4: Commit**

```bash
git add docs/plans/2026-02-23-issue-213-task-ui-mock-plan.md docs/pr/issue-213-plan-comment.md
git commit -m "docs(plan): define issue-213 TDD implementation and acceptance flow"
```

### Task 2: Define Task contract + mock flag config（领域契约与 mock 开关）

**Files:**
- Create: `src/lib/environment/interfaces/task.port.ts`
- Create: `src/lib/types/task.ts`
- Create: `src/config/mock-data.ts`
- Create: `tests/unit/config/mock-data.test.ts`

**Step 1: Write failing tests (mock-data config)**

```ts
it('persists mock flag to localStorage and emits change event', () => { ... })
```

**Step 2: Run test to verify red**

Run: `bun vitest tests/unit/config/mock-data.test.ts`

Expected: FAIL (module/function missing).

**Step 3: Implement minimal config + types/port**

```ts
export function getUseMockDataEnabled(): boolean { ... }
```

**Step 4: Run test to verify green**

Run: `bun vitest tests/unit/config/mock-data.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/config/mock-data.ts src/lib/environment/interfaces/task.port.ts src/lib/types/task.ts tests/unit/config/mock-data.test.ts
git commit -m "feat(task): add task port contract and mock-data feature flag config"
```

### Task 3: Build adapters + bootstrap injection（适配器与注入）

**Files:**
- Create: `src/lib/adapters/task-web-adapter.ts`
- Create: `src/lib/adapters/mock/fixtures/tasks.ts`
- Create: `src/lib/adapters/mock/task-mock-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/environment/environment.ts`
- Modify: `tests/unit/environment/bootstrap.test.ts`

**Step 1: Write failing bootstrap tests**

```ts
it('injects TaskMockAdapter when useMockData is enabled', () => { ... })
```

**Step 2: Run test to verify red**

Run: `bun vitest tests/unit/environment/bootstrap.test.ts`

Expected: FAIL (no task adapter wiring).

**Step 3: Implement adapters + injection**

```ts
task: useMockData ? new TaskMockAdapter() : new TaskWebAdapter()
```

**Step 4: Run test to verify green**

Run: `bun vitest tests/unit/environment/bootstrap.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/adapters/task-web-adapter.ts src/lib/adapters/mock/fixtures/tasks.ts src/lib/adapters/mock/task-mock-adapter.ts src/lib/environment/bootstrap.ts src/lib/environment/environment.ts tests/unit/environment/bootstrap.test.ts
git commit -m "feat(task): inject mock/real task adapters from runtime bootstrap"
```

### Task 4: Task service + state for UI（服务层与页面状态）

**Files:**
- Create: `src/lib/services/task.service.ts`
- Modify: `src/lib/services/index.ts`
- Create: `tests/unit/services/task.service.test.ts`

**Step 1: Write failing service tests**

```ts
it('loads list, updates timer mode, pauses running task', async () => { ... })
```

**Step 2: Run test to verify red**

Run: `bun vitest tests/unit/services/task.service.test.ts`

Expected: FAIL.

**Step 3: Implement minimal service**

```ts
export interface TaskService { listTasks(); getTaskById(); pauseTask(); ... }
```

**Step 4: Run test to verify green**

Run: `bun vitest tests/unit/services/task.service.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/services/task.service.ts src/lib/services/index.ts tests/unit/services/task.service.test.ts
git commit -m "feat(task): add task service over environment task port"
```

### Task 5: Implement Task pages pixel restore（页面像素还原）

**Files:**
- Create: `src/ui/new/pages/NewTasksPage.tsx`
- Create: `src/ui/new/pages/NewTaskDetailPage.tsx`
- Create: `src/ui/new/components/NewTaskTimerCard.tsx`
- Create: `tests/unit/ui/task-pages.issue213.test.tsx`

**Step 1: Write failing UI tests (structure tokens + key interactions)**

```ts
it('renders gradient glow card with rounded 24px and translucent white layer', () => { ... })
it('supports timer mode switch, pause button, and task input', () => { ... })
```

**Step 2: Run test to verify red**

Run: `bun vitest tests/unit/ui/task-pages.issue213.test.tsx`

Expected: FAIL.

**Step 3: Implement `/tasks` and `/tasks/:id` UI**

```tsx
<div className="rounded-[24px] ... bg-[linear-gradient(...rgba(255,255,255,0.64)...)]" />
```

**Step 4: Run test to verify green**

Run: `bun vitest tests/unit/ui/task-pages.issue213.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ui/new/pages/NewTasksPage.tsx src/ui/new/pages/NewTaskDetailPage.tsx src/ui/new/components/NewTaskTimerCard.tsx tests/unit/ui/task-pages.issue213.test.tsx
git commit -m "feat(task-ui): implement task list/detail pages with pencil-aligned timer card"
```

### Task 6: Route/nav integration + developer toggle（路由导航与设置开关）

**Files:**
- Modify: `src/routes-new.tsx`
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Create: `tests/unit/ui/task-routing.issue213.test.ts`
- Create: `tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx`

**Step 1: Write failing tests for route + toggle**

```ts
expect(source).toContain("path: '/tasks'");
expect(screen.getByText('使用测试数据')).toBeInTheDocument();
```

**Step 2: Run test to verify red**

Run: `bun vitest tests/unit/ui/task-routing.issue213.test.ts tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx`

Expected: FAIL.

**Step 3: Implement route + bottom nav + settings toggle**

```tsx
{ title: '任务', path: '/tasks', icon: SquareCheckBig }
```

**Step 4: Run test to verify green**

Run: `bun vitest tests/unit/ui/task-routing.issue213.test.ts tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/routes-new.tsx src/ui/new/pages/NewSettingsPage.tsx tests/unit/ui/task-routing.issue213.test.ts tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx
git commit -m "feat(task-ui): add tasks routes/nav and developer mock-data toggle"
```

### Task 7: Playwright correctness validation（端到端正确性）

**Files:**
- Create: `tests/e2e/playwright.issue213.config.ts`
- Create: `tests/e2e/task-ui.issue213.test.ts`

**Step 1: Write failing E2E first**

```ts
test('navigates to tasks and validates mode switch + pause + input', async ({ page }) => { ... })
```

**Step 2: Run E2E to verify red**

Run: `bunx playwright test -c tests/e2e/playwright.issue213.config.ts tests/e2e/task-ui.issue213.test.ts`

Expected: FAIL before full wiring.

**Step 3: Finalize missing UI wiring**

Ensure test ids/ARIA hooks and behavior match assertions.

**Step 4: Run E2E to verify green**

Run: `bunx playwright test -c tests/e2e/playwright.issue213.config.ts tests/e2e/task-ui.issue213.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/e2e/playwright.issue213.config.ts tests/e2e/task-ui.issue213.test.ts
git commit -m "test(e2e): add issue-213 playwright coverage for task ui flow"
```

### Task 8: Verification + PR review comments（验证与评审闭环）

**Files:**
- Create: `docs/pr/issue-213-progress-comment.md`
- Create: `docs/pr/issue-213-review-comment.md`

**Step 1: Run required verification set**

Run:
- `bun vitest tests/unit/config/mock-data.test.ts tests/unit/environment/bootstrap.test.ts tests/unit/services/task.service.test.ts tests/unit/ui/task-pages.issue213.test.tsx tests/unit/ui/task-routing.issue213.test.ts tests/unit/settings/settings-mock-data-toggle.issue213.test.tsx`
- `bunx playwright test -c tests/e2e/playwright.issue213.config.ts tests/e2e/task-ui.issue213.test.ts`
- `bun run build`

Expected: all PASS.

**Step 2: Post progress/test evidence comment to PR**

Run: `bun Scripts/dev/github-comment.ts --type pr --number <PR_NUMBER> --file docs/pr/issue-213-progress-comment.md`

**Step 3: Request and process review**

Run: `gh pr comment <PR_NUMBER> --body-file docs/pr/issue-213-review-comment.md` (or script wrapper)

**Step 4: Commit docs/evidence**

```bash
git add docs/pr/issue-213-progress-comment.md docs/pr/issue-213-review-comment.md
git commit -m "docs(pr): add issue-213 test evidence and review report"
```

---

Plan complete and saved to `docs/plans/2026-02-23-issue-213-task-ui-mock-plan.md`.

Two execution options:

1. Subagent-Driven (Recommended) - execute task-by-task in this session, each task ends with tests + commit.
2. Parallel Session - open a separate session with `executing-plans` and execute in batches.
