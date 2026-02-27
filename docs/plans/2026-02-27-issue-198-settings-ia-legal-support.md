# Issue #198 Settings IA Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将设置页信息架构调整为“一级关于轻入口 + 二级法律与支持（仅法务三项）”，并保持桌面/移动内容一致、仅布局形态不同。  

**Architecture:** 保持 `NewSettingsPage` 作为一级设置主页，新增 `LegalSupportPage` 二级路由承载低频法务项。一级仅保留高频入口（官网、赞助、法律与支持入口）与版本信息；`帮助中心/反馈建议` 不进入法务页。桌面端继续保留 Sidebar 与顶部分段 Tab 跳转。  

**Tech Stack:** React 18 + TypeScript + TanStack Router + Vitest + Playwright + Pencil MCP

---

### Task 1: 固化信息架构与计划文件

**Files:**
- Create: `docs/plans/2026-02-27-issue-198-settings-ia-legal-support.md`

**Step 1: 记录最终 IA 规则**

- 一级 `关于`：官网、赞助、法律与支持入口、版本信息。
- 二级 `法律与支持`：仅保留 `用户协议` / `隐私政策` / `开源声明`。
- `帮助中心` / `反馈建议`：回归 `更多` 或一级，不放法务页。

**Step 2: Commit**

```bash
git add docs/plans/2026-02-27-issue-198-settings-ia-legal-support.md
git commit -m "docs: add issue198 settings IA refinement plan"
```

### Task 2: 先写失败测试（TDD RED）

**Files:**
- Modify: `tests/unit/components/settings/LegalSection.test.tsx`
- Modify: `tests/unit/components/settings/MoreSection.test.tsx`
- Modify: `tests/unit/settings/new-settings-desktop-vc-tabs.issue198.test.tsx`
- Modify: `tests/e2e/settings-desktop.issue198.test.ts`

**Step 1: 写失败单测（一级/二级边界）**

- 断言一级页存在“法律与支持”入口。
- 断言一级页不再直出“隐私政策/用户协议/开源声明”。
- 断言 `LegalSection` 不包含“官网/赞助/帮助中心/反馈建议”。

**Step 2: 写失败 E2E**

- 桌面与移动均可从一级进入法律与支持页。
- 法务页仅有三项法务内容。

**Step 3: 运行并确认失败**

```bash
bun run test:unit tests/unit/components/settings/LegalSection.test.tsx
bun run test:unit tests/unit/components/settings/MoreSection.test.tsx
bun run test:unit tests/unit/settings/new-settings-desktop-vc-tabs.issue198.test.tsx
bun run test:e2e:issue198
```

**Expected:** 至少一条断言因“当前实现未完成 IA 迁移”而失败。

**Step 4: Commit**

```bash
git add tests/unit/components/settings/LegalSection.test.tsx tests/unit/components/settings/MoreSection.test.tsx tests/unit/settings/new-settings-desktop-vc-tabs.issue198.test.tsx tests/e2e/settings-desktop.issue198.test.ts
git commit -m "test: add failing tests for settings legal-support IA"
```

### Task 3: 最小实现（TDD GREEN）

**Files:**
- Modify: `src/ui/new/components/LegalSection.tsx`
- Modify: `src/ui/new/components/MoreSection.tsx`
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Modify: `src/routes-new.tsx`
- Create: `src/ui/new/pages/LegalSupportPage.tsx`

**Step 1: 一级关于重排**

- 在 `NewSettingsPage` 中将“关于”区改为轻入口。
- 迁移法务项出一级页面。

**Step 2: 新增二级页**

- 新建 `LegalSupportPage`，渲染三项法务条目（用户协议/隐私政策/开源声明）。
- 提供返回设置主页入口。

**Step 3: 路由接入**

- 注册 `/settings/legal-support` 路由并接入 `LazyPage`。

**Step 4: 更新组件契约**

- `LegalSection` 仅渲染法务三项。
- `MoreSection` 保持“更新 + 其他低频入口（非法务）”。

**Step 5: 运行测试至通过**

```bash
bun run test:unit tests/unit/components/settings/LegalSection.test.tsx
bun run test:unit tests/unit/components/settings/MoreSection.test.tsx
bun run test:unit tests/unit/settings/new-settings-desktop-vc-tabs.issue198.test.tsx
bun run test:e2e:issue198
```

**Step 6: Commit**

```bash
git add src/ui/new/components/LegalSection.tsx src/ui/new/components/MoreSection.tsx src/ui/new/pages/NewSettingsPage.tsx src/routes-new.tsx src/ui/new/pages/LegalSupportPage.tsx
git commit -m "feat: add legal-support subpage and refine settings IA"
```

### Task 4: 同步 Pencil 设计稿

**Files:**
- Modify: `pencil/eventlog-ui-design.pen`

**Step 1: 调整设计稿结构**

- About 一级卡片保留官网/赞助/法律与支持入口。
- 法律与支持区域仅留三项法务条目。
- 移除法务页中的帮助中心/反馈建议。

**Step 2: 截图核验关键节点**

- 验证设置页关于分段与法务分组层级一致。

**Step 3: Commit**

```bash
git add pencil/eventlog-ui-design.pen
git commit -m "chore: sync pencil settings IA with legal-support split"
```

### Task 5: 最终验证与 PR 同步

**Files:**
- Create: `docs/plans/2026-02-27-issue-198-settings-ia-legal-support-pr-comment.md` (PR 评论草稿)

**Step 1: 全量验证**

```bash
bun run test:unit
bun run test:e2e:issue198
bun run build
```

**Step 2: 生成 PR 评论 Markdown**

- 记录：变更摘要、测试命令、通过结果、评审结论、风险与回滚点。

**Step 3: 发布 PR 评论**

```bash
gh pr comment 252 --body-file docs/plans/2026-02-27-issue-198-settings-ia-legal-support-pr-comment.md
```

**Step 4: Commit**

```bash
git add docs/plans/2026-02-27-issue-198-settings-ia-legal-support-pr-comment.md
git commit -m "docs: add issue198 legal-support PR evidence note"
```
