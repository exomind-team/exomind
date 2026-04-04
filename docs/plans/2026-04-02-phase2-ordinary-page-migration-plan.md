# Phase 2 Ordinary Page Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成普通页面迁移补齐与一致性回归，把高频日常页面稳定收口成同一套页面系统。

**Architecture:** 本阶段不再发明新的 UI 基础设施，而是复用已经在 Phase 1 落地的 `PageShell / PageTabs / Select / TaskDomainTabs`，集中处理普通页面之间仍然残留的 header、content spacing、section recipe、domain navigation 与 Tauri 回归差异。特殊 surface（如 Workbench 深层 pane、Goals graph、Agents topology）不在本计划主体范围内，只允许做最小兼容修边。

**Tech Stack:** React 18、TypeScript、TanStack Router、Tailwind CSS、Radix/shadcn、Vitest、Chrome DevTools / Tauri dev manager

---

## Scope Lock

### In Scope

- `NowPage`
- `TasksPage`
- `ProposalInboxPage`
- `MePage`
- `RemindersPage`
- `SettingsPage`
- `TaskDetailPage`（谨慎补齐）
- 普通页面之间的一致性回归测试

### Out of Scope

- `WorkbenchPage` 深层交互与 pane 骨架
- `GoalsPage` graph 风格
- `AgentsPage` topology / tiled / right panel 结构重做
- RT 业务边界迁移（放到 Phase 2.5）

---

## File Map

### Shared / cross-page

- Modify: `src/ui/app/components/PageShell.tsx`
- Modify or Create: `src/ui/app/components/TaskDomainTabs.tsx`
- Create: `tests/unit/ui/ordinary-pages.phase2-regression.test.tsx`

### Ordinary pages

- Modify: `src/ui/app/pages/NowPage.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Modify: `src/ui/app/pages/proposals/ProposalInboxPage.tsx`
- Modify: `src/ui/app/pages/MePage.tsx`
- Modify: `src/ui/app/pages/RemindersPage.tsx`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `src/ui/app/pages/TaskDetailPage.tsx`

### Page-specific tests

- Modify: `tests/unit/ui/now-page.tab-routing.test.tsx`
- Modify: `tests/unit/ui/tasks-page-today-view.test.tsx`
- Modify: `tests/unit/ui/me-pages.issue215.test.tsx`
- Modify or Create: `tests/unit/ui/reminders-page.phase2.test.tsx`
- Modify: `tests/unit/settings/settings-page-layout-dispatch.test.tsx`
- Modify: `tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`
- Modify: `tests/unit/ui/task-detail-page.dependencies.issue398.test.tsx`

### Docs / status

- Modify: `docs/plans/PLAN-ui-ux-unification.md`
- Modify: `docs/plans/2026-04-02-ui-system-epic-phase-map.md`

---

## Task 1: Build a Phase 2 Regression Matrix

**Files:**
- Create: `tests/unit/ui/ordinary-pages.phase2-regression.test.tsx`
- Modify: `tests/unit/ui/now-page.tab-routing.test.tsx`
- Modify: `tests/unit/ui/tasks-page-today-view.test.tsx`
- Modify: `tests/unit/ui/me-pages.issue215.test.tsx`
- Modify or Create: `tests/unit/ui/reminders-page.phase2.test.tsx`
- Modify: `tests/unit/settings/settings-page-layout-dispatch.test.tsx`

- [ ] 增加一个统一回归测试文件，覆盖普通页面的共同约束：
  - 标题层级一致
  - headerBottom / top tabs 存在且位置正确
  - 内容区是 `min-h-0 flex-1` 体系
  - 输入区 / 底部安全区不被页面滚动挤掉
- [ ] 扩展 `NowPage` 测试，保留路由驱动导航与 Tauri 相关滚动约束。
- [ ] 扩展 `TasksPage` 测试，锁住任务域 tabs 与 quick-add 输入区共存。
- [ ] 扩展 `MePage` 测试，锁住页头与 tabs 风格。
- [ ] 为 `RemindersPage` 增加最小头部/滚动结构回归测试。
- [ ] 为 `SettingsPage` 补一个最小页面壳层回归测试，确认桌面/移动布局切换不破坏 `PageShell` 语义。
- [ ] 运行：
  - `bunx tsc --noEmit`
  - `npx vitest run tests/unit/ui/ordinary-pages.phase2-regression.test.tsx tests/unit/ui/now-page.tab-routing.test.tsx tests/unit/ui/tasks-page-today-view.test.tsx tests/unit/ui/me-pages.issue215.test.tsx`

## Task 2: Finish Ordinary Header Consistency

**Files:**
- Modify: `src/ui/app/pages/NowPage.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Modify: `src/ui/app/pages/proposals/ProposalInboxPage.tsx`
- Modify: `src/ui/app/pages/MePage.tsx`
- Modify: `src/ui/app/pages/RemindersPage.tsx`
- Modify: `src/ui/app/pages/SettingsPage.tsx`
- Modify: `src/ui/app/components/PageShell.tsx`

- [ ] 检查 `Now / Tasks / Proposal Inbox / Me / Reminders / Settings` 是否都走统一的页面头部结构。
- [ ] 把仍然手写的普通页头部收回 `PageShell` 能力内，不再出现额外的手写 `header` 骨架。
- [ ] 统一标题字号、上下边距、headerBottom 间距、内容区顶部留白。
- [ ] 保持 `AgentsPage` 的 header 作为风格基线，但不要把它的复杂动作区强行带入普通页面。
- [ ] 运行：
  - `bunx tsc --noEmit`
  - `npx vitest run tests/unit/ui/page-shell-page-tabs.phase1.test.tsx tests/unit/ui/ordinary-pages.phase2-regression.test.tsx`

## Task 3: Close Task Domain Navigation as a Product Surface

**Files:**
- Modify: `src/ui/app/components/TaskDomainTabs.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Modify: `src/ui/app/pages/proposals/ProposalInboxPage.tsx`
- Modify: `src/ui/app/pages/TaskTimelinePage.tsx`
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: `src/routes.tsx`
- Modify: `tests/unit/ui/task-domain-tabs.phase1.test.tsx`
- Modify: `tests/unit/ui/tasks-page-today-view.test.tsx`

- [ ] 明确“请求箱属于任务域视图”的产品语义，保留 `/proposals` 路由，但在普通用户视角中把它视为任务域顶部视图之一。
- [ ] 锁住 `Tasks / Timeline / DAG / Proposal Inbox` 的顶部导航一致性，不允许再出现某个子页失去域内切换条。
- [ ] 检查任务域返回路径与 `TASKS_LAST_PATH_KEY` 行为，确保不会把用户从任务域导航踢回错误页面。
- [ ] 统一任务域子视图的返回设计：
  - `TaskTimelinePage`
  - `TaskDagPage`
  - `TaskDetailPage`
  - `TimeBlockDetailPage`（任务域入口场景）
  要求返回入口、面包屑、顶部 tabs、最近子路径恢复逻辑彼此一致，不再出现“有的页回任务主列表，有的页回旧子页，有的页只靠浏览器返回”的混乱行为。
- [ ] 运行：
  - `npx vitest run tests/unit/ui/task-domain-tabs.phase1.test.tsx tests/unit/ui/tasks-page-today-view.test.tsx`

## Task 4: Cautious TaskDetailPage Consistency Pass

**Files:**
- Modify: `src/ui/app/pages/TaskDetailPage.tsx`
- Modify: `tests/unit/ui/task-detail-page.timeblock-detail.test.tsx`
- Modify: `tests/unit/ui/task-detail-page.dependencies.issue398.test.tsx`

- [ ] 不重做 `TaskDetailPage` 骨架，只补普通页面一致性必要部分：
  - 回到当下 / 回到任务域的导航契约
  - 子 tab / 子视图返回入口统一（返回任务域主入口、返回来源子页、面包屑表现）
  - section 标题层级与表单控件风格
  - 依赖区 / 计时区继续走共享组件
- [ ] 保留它作为 B 类复杂业务页的特性，不强套普通页面壳层。
- [ ] 运行：
  - `npx vitest run tests/unit/ui/task-detail-page.timeblock-detail.test.tsx tests/unit/ui/task-detail-page.dependencies.issue398.test.tsx`

## Task 5: Real Running Regression and Phase Review

**Files:**
- Modify: `docs/plans/PLAN-ui-ux-unification.md`
- Modify: `docs/plans/2026-04-02-ui-system-epic-phase-map.md`

- [ ] 在运行中的 dev 实例上回归以下页面：
  - `/eventlog`
  - `/eventlog/record`
  - `/tasks`
  - `/tasks/timeline`
  - `/tasks/dag`
  - `/proposals`
  - `/me`
  - `/reminders`
  - `/settings`
- [ ] 记录哪些属于普通页面一致性问题，哪些属于特殊 surface，避免把 Workbench / Agents / Goals 混入普通页面结论。
- [ ] 更新文档中的阶段判断：
  - Phase 1 正式完成
  - Phase 2 进入执行中 / 或完成度百分比
  - Phase 2.5 作为下一批入口

---

## Review Checklist

- [ ] 普通页面头部是否已经能看出同一套组件骨架？
- [ ] 任务域顶部导航是否已经构成单独的 domain navigation（领域导航）？
- [ ] 是否仍然残留高频普通页的野生原生 `<select>`？
- [ ] 是否把 `Workbench / Agents / Goals` 误当成普通页面去强套？
- [ ] 是否已经能把 Phase 1 与 Phase 2 的边界讲清楚？
