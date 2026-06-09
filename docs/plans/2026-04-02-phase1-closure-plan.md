# Phase 1 Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 UI System Phase 1 的共享层收口，重点收尾页面顶栏统一、任务域导航统一、剩余高频原生 `select` 迁移。

**Architecture:** 这轮不再扩大战线，不重做业务页面骨架。核心做法是增强 `PageShell` 与共享顶部导航组件，让 `Now / Tasks / Proposal Inbox` 走同一类头部模型；任务域内部通过统一 header tabs 连接 `任务 / 时间线 / 依赖图 / 提案箱`。剩余 native select 只处理高频配置入口，不碰 graph / topology / workbench 内核交互。

**Tech Stack:** React 18、TypeScript、TanStack Router、Tailwind CSS、Radix/shadcn Select、Vitest

---

## Task A: 顶栏共享层闭环

**Files:**
- Modify: `src/ui/app/components/PageShell.tsx`
- Create: `src/ui/app/components/TaskDomainTabs.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Modify: `src/ui/app/pages/proposals/ProposalInboxPage.tsx`
- Modify: `src/ui/app/pages/TaskTimelinePage.tsx`
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Test: `tests/unit/ui/page-shell-page-tabs.phase1.test.tsx`
- Test: `tests/unit/ui/now-page.tab-routing.test.tsx`
- Test: `tests/unit/ui/task-domain-tabs.phase1.test.tsx`

- [x] 补一个共享 `TaskDomainTabs`，风格对齐 `AgentsPage` 顶部 tab bar。
- [x] 让 `TasksPage` 顶部出现 `任务 / 时间线 / 依赖图 / 提案箱` 的统一切换。
- [x] 让 `ProposalInboxPage` 作为任务域视图之一，使用相同切换条。
- [x] 给 `TaskTimelinePage` / `TaskDagPage` 补相同任务域切换条，避免进入子视图后丢失域内导航。
- [x] 跑相关 UI 测试与类型检查。

## Task B: 剩余高频原生 Select 清零

**Files:**
- Modify: `src/ui/app/components/PtySpawnDialog.tsx`
- Modify: `src/ui/app/components/settings/ai-registry-settings-card.tsx`
- Test: `tests/unit/ui/agent-hub/*.test.tsx`（按受影响文件补）
- Test: `tests/unit/settings/*.test.tsx`（按受影响文件补）

- [x] 把 `PtySpawnDialog` 的原生 `select` 切到共享 `Select`。
- [x] 把 `ai-registry-settings-card` 的原生 `select` 切到共享 `Select`。
- [x] 保持原有交互语义和测试覆盖，不额外重构业务逻辑。

## Task C: Phase 1 关账核验

**Files:**
- Modify: `docs/plans/PLAN-ui-ux-unification.md`
- Modify: `docs/plans/2026-04-02-ui-system-epic-phase-map.md`

- [ ] 更新 Phase 1 状态：已完成项、剩余例外、Phase 2/2.5 入口。
- [ ] 明确 `Workbench` 仍属于特殊 surface，只纳入头部一致性规划，不在本轮做深层骨架改造。
- [ ] 留下下一阶段入口：Phase 2 普通页面补齐、Phase 2.5 RT 边界清点。
