# Issue 198 Desktop Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `new UI` 下实现 `Desktop` 与 `Mobile` 双响应式壳层（responsive shell，响应式壳层），并仅对 `Settings` 页面落地桌面化设计（desktopized settings，设置页桌面化）。

**Architecture:** 保留现有移动端底部导航（bottom tab bar，底部标签栏）与页面路由；新增桌面壳层（desktop shell，桌面外壳）与侧边导航（sidebar，侧边栏），仅当 `>= md` 且路由为 `/settings` 时启用桌面布局。其余路由在桌面宽度仍使用现有移动壳层展示，避免一次性改动过大。

**Tech Stack:** React 18 + TypeScript + TanStack Router + Tailwind CSS + Vitest + Playwright

---

### Task 1: PR 初始化与执行基线

**Files:**
- Create: `docs/plans/2026-02-26-issue-198-desktop-settings-plan.md`
- Create: `docs/pr/issue-198-plan-comment.md`
- Create: `docs/pr/issue-198-pr-body.md`

**Step 1: Prepare PR docs**

- 写入计划、验收链路、测试链路与风险边界。

**Step 2: Commit and create draft PR**

Run:
```bash
git add docs/plans/2026-02-26-issue-198-desktop-settings-plan.md docs/pr/issue-198-plan-comment.md docs/pr/issue-198-pr-body.md
git commit -m "docs(issue-198): add desktop settings implementation plan and pr docs"
git push -u origin vk/0d72-gh-198-feat-ui
gh pr create --base dev --head vk/0d72-gh-198-feat-ui --title "feat(issue-198): responsive desktop shell with settings desktopization" --body-file docs/pr/issue-198-pr-body.md --draft
```

### Task 2: RED - 先写失败测试（单测）

**Files:**
- Create: `tests/unit/ui/new-desktop-settings-shell.issue198.test.ts`

**Step 1: Write failing tests**

- 断言 `routes-new.tsx` 中存在：
  - `DesktopLayout（桌面布局）`
  - `DesktopSidebar（桌面侧栏）`
  - `isDesktopSettingsRoute（设置页桌面路由开关）`
- 断言仅 `/settings` 进入桌面壳层逻辑。

**Step 2: Run to verify RED**

Run:
```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
```
Expected: FAIL（实现尚未存在）

**Step 3: Commit RED**

```bash
git add tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
git commit -m "test(issue-198): add failing tests for desktop settings shell routing"
```

### Task 3: GREEN - 实现响应式壳层与桌面 Sidebar

**Files:**
- Modify: `src/routes-new.tsx`
- Modify: `src/index.css`

**Step 1: Minimal implementation**

- 在 `routes-new.tsx` 新增：
  - `DesktopSidebar`（桌面侧边栏）
  - `DesktopLayout`（桌面布局容器）
  - `MobileShell`（移动壳层抽离）
  - `isDesktopSettingsRoute`（仅设置页桌面化）
- 在 `index.css` 增加 `sidebar tokens（侧栏语义变量）`，如：
  - `--sidebar`
  - `--sidebar-foreground`
  - `--sidebar-border`
  - `--sidebar-accent`

**Step 2: Run targeted tests to verify GREEN**

Run:
```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
```
Expected: PASS

**Step 3: Commit GREEN**

```bash
git add src/routes-new.tsx src/index.css
git commit -m "feat(issue-198): add desktop shell and sidebar for settings route"
```

### Task 4: Playwright 自动化（桌面/移动双视口）

**Files:**
- Create: `tests/e2e/playwright.issue198.config.ts`
- Create: `tests/e2e/settings-desktop.issue198.test.ts`
- Modify: `package.json`

**Step 1: Write failing e2e tests**

- Desktop（桌面）断言：
  - `/settings` 展示 `desktop sidebar（桌面侧栏）`
  - 展示 `settings desktop nav（设置桌面分段导航）`
- Mobile（移动）断言：
  - `/settings` 保留底部导航（bottom tab bar）

**Step 2: Run to verify RED**

Run:
```bash
bun run test:e2e:issue198
```
Expected: FAIL（脚本或实现未完成）

**Step 3: Complete config and pass**

Run:
```bash
bun run test:e2e:issue198
```
Expected: PASS

**Step 4: Commit**

```bash
git add tests/e2e/playwright.issue198.config.ts tests/e2e/settings-desktop.issue198.test.ts package.json
git commit -m "test(issue-198): add desktop settings playwright coverage"
```

### Task 5: 全量验证、PR 进展评论、评审评论

**Files:**
- Create: `docs/pr/issue-198-progress-comment.md`
- Create: `docs/pr/issue-198-review-comment.md`

**Step 1: Verification commands**

Run:
```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
bun run test:e2e:issue198
bun run build
```

**Step 2: Publish progress comment to PR**

Run:
```bash
bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-198-progress-comment.md
```

**Step 3: Self review and publish review comment**

- 进行代码审查（review，评审）并记录 findings（问题项）。
- 若有问题，修复并提交；复测后再发布评审结论。

Run:
```bash
bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-198-review-comment.md
```

**Step 4: Final sync back to issue (after PR near done)**

Run:
```bash
bun run gh:comment -- --type issue --number 198 --file docs/pr/issue-198-progress-comment.md
```
