# Issue #807 UI Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立 ExoMind 可持续执行的前端统一化体系，先落规范、再落共享层、最后迁移高频页面，而不是一次性“全站推平”。

**Architecture:** 本次以“规范先行 + 分层收口 + 有例外边界”为核心。先把 `docs/development/ui-spec.md` 变成权威规范，再把 `Page shell（页面壳层）`、`Tabs / Select / Dialog` 的共享边界厘清，最后按页面类型分批迁移，避免误伤 graph / overlay / topology 等特殊表面。

**Tech Stack:** React 18 + TypeScript、Tailwind CSS、shadcn/ui（Radix primitives，基础组件）、TanStack Router、Tauri v2、Vitest

---

## 0. 先说结论：旧计划里有哪些高风险问题

### P0 问题（必须修）

1. **把“所有 tab-like UI（像 tab 的 UI）都改成 `Tabs`”写成统一规则是错误的。**
   `GoalsPage` 的浏览/编辑更像模式切换，`TaskDetailPage` 的移动端分区更像锚点导航，不应该机械改成 `Tabs`。

2. **把“所有页面都必须使用 `PageShell`”写成统一规则是错误的。**
   `GoalsPage`、`AgentsPage` 主拓扑、overlay 页面、全屏浮层都不是普通内容页，强套统一壳层会破坏交互。

3. **把“硬编码颜色归零”写成单个 issue 的绝对目标过于激进。**
   graph、topology、overlay 氛围背景、品牌渐变、可视化状态色都存在合理例外，应该做“有治理的例外”，不是“一刀切清零”。

### P1 问题（会让计划难落地）

1. 旧计划没有先落项目级 spec（规范），容易变成“边做边定标准”。
2. 验证命令偏 Unix 风格，不适合当前 Windows + PowerShell 环境。
3. 旧计划没有把 `CLAUDE.md / AGENTS.md` 纳入执行入口，Agent 后续容易继续绕开规范。
4. 旧计划没有给特殊页面定义例外策略。
5. 旧计划没有分出“共享层先收口”与“高风险页面后迁移”的阶段。

本计划已经把这些问题修掉，下面的任务按修正后的策略执行。

---

## 1. 交付物（Deliverables，交付物）

本 issue 完成后，应至少产生以下交付物：

1. `docs/development/ui-spec.md`
   项目前端设计规范，给人和 Agent 共用。
2. `docs/plans/PLAN-ui-ux-unification.md`
   Issue #807 的总览入口与评审摘要。
3. `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`
   可执行实施计划。
4. `CLAUDE.md`
   增加对 UI 规范与计划的引用。
5. `AGENTS.md`
   增加对 UI 规范与计划的引用。

---

## 2. 范围定义（Scope，范围）

### In Scope（本次纳入）

- 统一文档规范入口
- 颜色 token 治理策略
- `PageShell` 的适用边界定义
- `Tabs / Select / Dialog / Drawer` 的统一使用规则
- 高价值普通页面的统一化迁移
- Settings 作为统一基线的制度化沉淀

### Out of Scope（本次不纳入）

- 对所有历史页面做一次性全量视觉重做
- graph / topology / overlay 的美术风格统一
- 重新设计品牌体系
- 一次性消灭所有硬编码颜色

---

## 3. 页面分类法（这是实施前提）

迁移前先把页面分型，不允许再把所有页面一锅炖。

### A 类：普通内容页（优先使用 PageShell）

示例：

- `NowPage`
- `TasksPage`
- `MePage`
- `RemindersPage`
- `SettingsPage`

### B 类：复杂业务页（可有 Feature shell，功能壳层）

示例：

- `TaskDetailPage`
- `TaskTimelinePage`
- `TaskDagPage`

### C 类：特殊表面（保留例外）

示例：

- `GoalsPage`
- `AgentsPage` 主拓扑视图
- `NowWorkbenchOverlayPage`

规则：

- A 类优先统一
- B 类谨慎统一
- C 类只治理基础设施，不强改页面骨架

---

## 4. 任务拆分

### Task 1: 固化规范入口与文档关系

**Files:**
- Modify: `docs/plans/PLAN-ui-ux-unification.md`
- Create: `docs/development/ui-spec.md`
- Modify: `docs/README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Step 1: 写 Issue #807 总览入口**

把 `docs/plans/PLAN-ui-ux-unification.md` 改为“总览 + 风险评审 + 文档跳转”页面，避免它继续承担过长的执行细节。

**Step 2: 写正式 UI 规范**

创建 `docs/development/ui-spec.md`，必须包含：

- 给非前端读者的解释
- 页面分类法
- token 使用规则
- `PageShell` 适用边界
- `Tabs / Select / Dialog / Drawer` 统一规则
- 例外清单
- 评审 checklist（检查清单）

**Step 3: 把入口挂进导航与 Agent 提示词**

在 `docs/README.md`、`CLAUDE.md`、`AGENTS.md` 中都加入指向 `docs/development/ui-spec.md` 与本计划的链接。

**Step 4: 自检**

检查这 5 份文档之间没有互相矛盾的描述。

**Step 5: 提交**

```bash
git add docs/development/ui-spec.md docs/plans/PLAN-ui-ux-unification.md docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md docs/README.md CLAUDE.md AGENTS.md
git commit -m "docs: establish UI spec and issue 807 plan entry"
```

---

### Task 2: 清理 token 策略，不先追求“归零”，先追求“可治理”

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`
- Create: `docs/development/ui-token-allowlist.md`（如需要）

**Step 1: 审计现有 token**

核对 `src/index.css` 和 `tailwind.config.js` 中已存在的语义 token，列出：

- 已可直接复用的 token
- 缺失但高频出现的 token
- 合理保留的例外颜色类别

**Step 2: 只补高频且稳定的页面级 token**

新增用于普通页面的稳定 token，例如：

- `page`
- `inactive`
- `active`
- `border-page`

不要一开始就为所有特殊场景发明 token。

**Step 3: 建立例外白名单规则**

把“允许硬编码颜色的场景”文档化，例如：

- graph node（图节点）
- overlay atmosphere（浮层氛围背景）
- brand gradient（品牌渐变）

**Step 4: 验证**

Run:

```powershell
bunx tsc --noEmit
```

Expected:

- TypeScript 通过
- 未出现 token 命名冲突

**Step 5: 提交**

```bash
git add src/index.css tailwind.config.js docs/development/ui-spec.md
git commit -m "refactor: document and extend UI token strategy"
```

---

### Task 3: 先收共享层，不直接横扫页面

**Files:**
- Create: `src/ui/app/components/PageShell.tsx`
- Create: `src/ui/app/components/PageTabs.tsx`
- Create or Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/index.ts`（如需要）

**Step 1: 定义 PageShell 适用范围**

`PageShell` 只服务 A 类普通内容页。

必须支持：

- `title`
- `subtitle`
- `headerAction`
- `hideHeader`
- `contentClassName`

**Step 2: 定义 PageTabs**

`PageTabs` 只处理真正的 tab panel（标签页面板），不承担模式切换和锚点导航。

支持：

- `grid`
- `scroll`
- token 化 active / hover / focus

**Step 3: 引入 Select 统一实现**

新增或完善 `src/components/ui/select.tsx`，并约定：

- 普通下拉一律走这个组件
- 页面内不再自行手写 native select 外观

**Step 4: 写最小测试或 smoke check（冒烟检查）**

至少验证：

- 组件能正常导出
- 常见 props（属性）不报类型错误

Run:

```powershell
bunx tsc --noEmit
```

**Step 5: 提交**

```bash
git add src/ui/app/components/PageShell.tsx src/ui/app/components/PageTabs.tsx src/components/ui/select.tsx
git commit -m "feat: add shared page shell and tab primitives"
```

---

### Task 4: 先迁移 A 类普通内容页

**Files:**
- Modify: `src/ui/app/pages/NowPage.tsx`
- Modify: `src/ui/app/pages/TasksPage.tsx`
- Modify: `src/ui/app/pages/MePage.tsx`
- Modify: `src/ui/app/pages/RemindersPage.tsx`
- Modify: `src/ui/app/pages/SettingsPage.tsx`

**Step 1: 迁移 `NowPage`**

目标：

- 套入 `PageShell`
- 保留 `Tabs`
- 样式对齐共享层

**Step 2: 迁移 `MePage`**

目标：

- 手搓 tab 改成 `PageTabs`
- 统一 header / scroll / section spacing（间距）

**Step 3: 迁移 `RemindersPage`**

目标：

- 手搓 tab 改成 `PageTabs`
- 表单、按钮、空状态对齐 token

**Step 4: 迁移 `TasksPage`**

目标：

- 至少统一 header 与页面外壳
- 不强行把导航入口改成 tab

**Step 5: 迁移 `SettingsPage`**

目标：

- 使用统一页面壳层思路
- 不破坏现有 registry-driven（注册表驱动）结构

**Step 6: 每迁移一个页面都跑类型检查**

Run:

```powershell
bunx tsc --noEmit
```

**Step 7: 页面级验证**

手工检查：

- 标题区是否统一
- 滚动区是否稳定
- 底部安全区是否正常
- tab 是否仍然表达正确语义

**Step 8: 提交**

建议按页面分批 commit，不要一次性混成大提交。

---

### Task 5: 迁移 B 类复杂业务页，但只改“该统一的层”

**Files:**
- Modify: `src/ui/app/pages/TaskDetailPage.tsx`
- Modify: `src/ui/app/pages/TaskTimelinePage.tsx`
- Modify: `src/ui/app/pages/TaskDagPage.tsx`
- Modify: 相关局部组件

**Step 1: 识别哪些是 tab，哪些不是**

重点检查 `TaskDetailPage`：

- 移动端分区导航是锚点导航，不应强改为 `Tabs`
- 表单区里的 select 应迁移到统一 `Select`

**Step 2: 统一外层结构与表单层**

统一：

- header
- section card
- input/select/dialog

保留：

- 任务详情内部的信息架构
- 锚点导航语义

**Step 3: 验证**

Run:

```powershell
bunx tsc --noEmit
npx vitest run tests/unit/ui
```

Expected:

- 相关 UI 单测通过
- 不引入明显的交互回归

**Step 4: 提交**

```bash
git add src/ui/app/pages/TaskDetailPage.tsx
git commit -m "refactor: align task detail page with shared UI primitives"
```

---

### Task 6: C 类特殊表面只治理基础设施，不强改骨架

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/WorkspaceTabs.tsx`
- Modify: `src/ui/app/pages/goals/GoalsPage.tsx`
- Modify: overlay 相关文件（按需）

**Step 1: 网络页**

目标：

- 子 tab 对齐共享标准
- 表单、dialog、select、card token 尽量统一
- 不强拆主拓扑视图骨架

**Step 2: 目标图**

目标：

- 保留 graph/canvas 特殊交互
- 不强制改成普通页面布局
- 只收口 detail panel、dialog、form control

**Step 3: overlay**

目标：

- 保留氛围视觉
- 收口交互基础设施

**Step 4: 验证**

Run:

```powershell
bunx tsc --noEmit
npx vitest run tests/unit/ui tests/unit/settings
```

**Step 5: 提交**

按功能面分批提交，不要把 `Goals / Agents / Overlay` 混到一个提交里。

---

### Task 7: Select 迁移专项

**Files:**
- Modify: `src/components/RouteEditPanel.tsx`
- Modify: `src/components/TimeBlockWidget.tsx`
- Modify: `src/ui/app/components/BlockTaskAssociationList.tsx`
- Modify: `src/ui/app/components/NowTodayPlannerTimeline.tsx`
- Modify: `src/ui/app/components/prestart-task-selection.tsx`
- Modify: `src/ui/app/components/PtySpawnDialog.tsx`
- Modify: `src/ui/app/pages/agents/agents-sheets.tsx`
- Modify: `src/ui/app/components/UpdateSettingsCard.tsx`
- Modify: `src/ui/app/components/settings/ai-registry-settings-card.tsx`
- Modify: `src/ui/app/components/settings/settings-renderers.tsx`
- Modify: `src/ui/app/pages/goals/components/SplitEdgeDialog.tsx`
- Modify: `src/ui/app/pages/TaskDetailPage.tsx`

**Step 1: 先替换普通表单场景**

优先迁移：

- 设置页
- 任务详情页
- 路由编辑
- Agent 配置 sheet

**Step 2: 再替换特殊场景**

如时间块、Goal split dialog（目标拆边弹窗）等。

**Step 3: 验证“真正归零”**

Run:

```powershell
$matches = rg -n --glob "src/**/*.tsx" "<select"
$matches.Count
$matches
```

Expected:

- 结果为 `0`

**Step 4: 提交**

```bash
git add src
git commit -m "refactor: replace native selects with shared select component"
```

---

### Task 8: 建立审查与回归防线

**Files:**
- Modify: `docs/development/pr-review-evidence-template.md`（如需要）
- Create or Modify: lint / script / checklist files（按需）

**Step 1: 建立 PowerShell 版检查命令**

不要再在计划里使用当前环境不友好的 `grep | wc -l | head` 风格。

推荐检查：

```powershell
$nativeSelects = rg -n --glob "src/**/*.tsx" "<select"
$hardcodedBg = rg -n -F "bg-[#" src
$hardcodedText = rg -n -F "text-[#" src
$hardcodedBorder = rg -n -F "border-[#" src
```

**Step 2: 定义“例外不报错”的原则**

审查时对 graph / overlay / branded surface（品牌化表面）的硬编码颜色走白名单，而不是误判为失败。

**Step 3: 最终验证**

Run:

```powershell
bunx tsc --noEmit
npx vitest run
bun run build
```

**Step 4: 视觉检查**

重点检查：

- `NowPage`
- `TasksPage`
- `MePage`
- `RemindersPage`
- `SettingsPage`
- `TaskDetailPage`
- `AgentsPage`
- `GoalsPage`

**Step 5: 提交**

```bash
git add docs
git commit -m "docs: add UI unification review and verification rules"
```

---

## 5. 执行顺序建议

按下面顺序执行，风险最低：

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 7
6. Task 5
7. Task 6
8. Task 8

原因：

- 先把规范与入口定住
- 再收共享层
- 再迁普通页
- 再迁复杂页
- 最后处理特殊表面与回归防线

---

## 6. 人类评审重点

请人类评审时，不要只看“代码是不是能跑”，而要重点看：

1. 规范有没有把例外边界讲清楚？
2. 是否避免了“所有页面都一样”的错误目标？
3. 是否避免了“所有像 tab 的东西都叫 tab”的语义错误？
4. 是否把 Settings 的成功经验沉淀成了项目级规则？
5. 对一个不懂前端的人来说，这份 spec 和计划是否真的读得懂？

---

## 7. 计划完成后的执行选择

**Plan complete and saved to `docs/plans/2026-04-02-issue-807-ui-unification-implementation-plan.md`. Two execution options:**

**1. Subagent-Driven（本会话内分任务推进）** - 逐任务执行、逐阶段评审，适合边做边看结果

**2. Parallel Session（新会话执行）** - 新开会话按计划批次执行，适合较长周期推进

当前这次先停在“规范 + 计划 + 评审修订”阶段，等你确认后再进入代码实施。
