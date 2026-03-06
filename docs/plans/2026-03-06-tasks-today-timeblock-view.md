# Tasks Today Timeblock View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `/tasks` 页中的 `today` tab 升级为与 Pencil 页面 `WhKhf` 对齐的“今日时间块视图”，展示进行中任务、今日时间块分组和底部快速添加输入。

**Architecture:** 保持现有 `/tasks` 路由与 `TasksPage` 作为唯一入口，不新增页面。数据层继续使用 `TaskService` 提供任务列表、`TimeBlockService` 提供今日已完成/进行中的时间块，再通过一个纯函数把任务与时间块整理为 `today` 视图模型，避免把展示逻辑散落在 JSX 中。

**Tech Stack:** React 18 + TypeScript, TanStack Router, Vitest, Testing Library, existing TaskService / TimeBlockService

---

### Task 1: 明确 today 视图的数据整理契约

**Files:**
- Create: `tests/unit/ui/tasks-today-timeblock-view.test.ts`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Create: `src/ui/app/pages/tasks-today-view.ts`

**Step 1: Write the failing test**

在 `tests/unit/ui/tasks-today-timeblock-view.test.ts` 中为纯函数写失败测试，至少覆盖：

```ts
it('groups today blocks into 上午/中午/下午/晚上 sections', () => {
  // 传入今天 09:00、13:00、16:00、20:00 的 block
  // 断言返回 section 标题顺序为 上午/中午/下午/晚上
})

it('collects in-progress tasks into the top summary section', () => {
  // 传入 2 个 in_progress task
  // 断言 count === 2，且任务标题顺序稳定
})

it('links completed blocks back to tasks through task.timeBlockIds', () => {
  // 传入 task.timeBlockIds = ['block-1']，block.id = 'block-1'
  // 断言 block item title / meta 使用任务信息
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/tasks-today-timeblock-view.test.ts`

Expected: FAIL，提示 `tasks-today-view.ts` 或导出函数不存在。

**Step 3: Write minimal implementation**

在 `src/ui/app/pages/tasks-today-view.ts` 中创建纯函数与类型，职责限定为：
- 过滤“今天”的已完成时间块
- 按 6-12 / 12-14 / 14-18 / 18-24 分组
- 从 `task.timeBlockIds` 回连任务
- 输出 `inProgressTasks`、`timelineSections`、`todayBlockCount`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/tasks-today-timeblock-view.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/ui/tasks-today-timeblock-view.test.ts src/ui/app/pages/tasks-today-view.ts
git commit -m "feat: add tasks today timeline view model"
```

### Task 2: 用组件测试锁定 today 页面渲染

**Files:**
- Create: `tests/unit/ui/tasks-page-today-view.test.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`

**Step 1: Write the failing test**

在 `tests/unit/ui/tasks-page-today-view.test.tsx` 中 mock：
- `getTaskService().listTasks`
- `getTimeBlockService().loadTimeBlocks`
- `getTimeBlockService().loadActiveBlock`

覆盖以下行为：

```tsx
it('renders today timeblock layout when 今日 tab is active', async () => {
  render(<TasksPage />);
  fireEvent.click(screen.getByRole('button', { name: '今日' }));

  expect(await screen.findByText('进行中')).toBeInTheDocument();
  expect(screen.getByText('上午')).toBeInTheDocument();
  expect(screen.getByText('下午')).toBeInTheDocument();
  expect(screen.getByText('完成 Task List 视图设计')).toBeInTheDocument();
})

it('keeps quick add input visible in today view', async () => {
  render(<TasksPage />);
  fireEvent.click(screen.getByRole('button', { name: '今日' }));
  expect(screen.getByPlaceholderText('快速添加任务...')).toBeInTheDocument();
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/tasks-page-today-view.test.tsx`

Expected: FAIL，提示 today 视图缺少 section header / timeline item。

**Step 3: Write minimal implementation**

在 `src/ui/app/pages/TasksPage.tsx` 中：
- 新增时间块加载状态
- 当 `activeTab === 'today'` 时渲染专用布局
- 顶部显示“进行中”摘要卡片
- 下方显示 timeline section 与 block card
- 保留现有 header / tab / quick add 外壳

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/tasks-page-today-view.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/ui/tasks-page-today-view.test.tsx src/ui/app/pages/TasksPage.tsx
git commit -m "feat: render today timeblock view on tasks page"
```

### Task 3: 补稳定性与现有行为回归

**Files:**
- Modify: `tests/e2e/task-ui.issue213.test.ts`
- Modify: `tests/unit/ui/task-command-palette.issue243.test.tsx`（如受影响）
- Modify: `tests/unit/ui/task-tab-filters.issue338.test.ts`（仅当 today 过滤契约变化时）

**Step 1: Write/adjust failing test**

若 `today` tab 现在有独立布局，则在 `tests/e2e/task-ui.issue213.test.ts` 中增加最小断言：

```ts
await page.getByRole('button', { name: '今日' }).click();
await expect(page.getByText('进行中')).toBeVisible();
await expect(page.getByPlaceholder('快速添加任务...')).toBeVisible();
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/task-command-palette.issue243.test.tsx`

Run: `npx playwright test tests/e2e/task-ui.issue213.test.ts --project=chromium`

Expected: 至少一个断言先失败，证明新增行为被测试覆盖。

**Step 3: Write minimal implementation**

只修复为适配 today 新布局所必需的测试或可访问性属性，不扩大范围。

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/tasks-today-timeblock-view.test.ts tests/unit/ui/tasks-page-today-view.test.tsx tests/unit/ui/task-command-palette.issue243.test.tsx`

Run: `npx playwright test tests/e2e/task-ui.issue213.test.ts --project=chromium`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/e2e/task-ui.issue213.test.ts tests/unit/ui/task-command-palette.issue243.test.tsx
git commit -m "test: cover tasks today timeblock view"
```

### Task 4: 最终验证

**Files:**
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Create: `src/ui/app/pages/tasks-today-view.ts`
- Create: `tests/unit/ui/tasks-today-timeblock-view.test.ts`
- Create: `tests/unit/ui/tasks-page-today-view.test.tsx`
- Modify: `tests/e2e/task-ui.issue213.test.ts`

**Step 1: Type check**

Run: `npx tsc --noEmit`

Expected: PASS

**Step 2: Run targeted unit tests**

Run: `npx vitest run tests/unit/ui/tasks-today-timeblock-view.test.ts tests/unit/ui/tasks-page-today-view.test.tsx tests/unit/ui/task-command-palette.issue243.test.tsx tests/unit/ui/task-tab-filters.issue338.test.ts`

Expected: PASS

**Step 3: Run targeted E2E**

Run: `npx playwright test tests/e2e/task-ui.issue213.test.ts --project=chromium`

Expected: PASS

**Step 4: Manual visual check**

Run: `npx vite --host 0.0.0.0 --port 5173`

Then open `/tasks?tab=today` and compare against Pencil page `WhKhf`:
- 顶部 Header / tab 样式保持一致
- “进行中”卡片在时间轴之前
- 时间块按上午/中午/下午/晚上分组
- 底部快速添加输入固定可用

**Step 5: Commit**

```bash
git add src/ui/app/pages/TasksPage.tsx src/ui/app/pages/tasks-today-view.ts tests/unit/ui/tasks-today-timeblock-view.test.ts tests/unit/ui/tasks-page-today-view.test.tsx tests/e2e/task-ui.issue213.test.ts
git commit -m "feat: implement tasks today timeblock view"
```
