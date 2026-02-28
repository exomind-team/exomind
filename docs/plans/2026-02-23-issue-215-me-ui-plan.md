# Issue 215 Me UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在新 UI 中落地 `Me` 页面三视图（状态/学习/内隐），并通过 mock 开关注入 `MeMockAdapter`，实现可测试、可演示、可回归的前端链路。

**Architecture:** 延续现有 `Task` 领域分层：`type + port + adapter + service + page + route`。数据层采用 `MeWebAdapter`（本地存储占位）与 `MeMockAdapter`（设计稿数据），在 `bootstrap` 根据 `useMockData` 注入；UI 层采用单页 Tab 切换三视图，按设计稿卡片结构输出语义化 `data-testid` 供单测/E2E 验证。

**Tech Stack:** React 18 + TypeScript + TanStack Router + Tailwind + Vitest + Playwright

---

### Task 1: 建立 Me 领域契约（types + port + fixtures）

**Files:**
- Create: `src/lib/types/me.ts`
- Create: `src/lib/environment/interfaces/me.port.ts`
- Create: `src/lib/adapters/mock/fixtures/me.ts`

**Step 1: Write the failing test**

- Create: `tests/unit/me/me-types-contract.issue215.test.ts`
- 覆盖：`MeViewType`、状态指标结构、学习条目结构、内隐网络结构。

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/me/me-types-contract.issue215.test.ts`  
Expected: FAIL（模块不存在或导出不完整）

**Step 3: Write minimal implementation**

- 定义 `MeDashboardData` 与三视图所需字段。
- 定义 `IMePort` 接口，提供 `getDashboardData()`。
- 增加 `MOCK_ME_DASHBOARD_FIXTURE`（设计稿同款文案与数值）。

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/me/me-types-contract.issue215.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/types/me.ts src/lib/environment/interfaces/me.port.ts src/lib/adapters/mock/fixtures/me.ts tests/unit/me/me-types-contract.issue215.test.ts
git commit -m "feat(issue-215): add me domain contracts and fixtures"
```

### Task 2: 实现 Me Adapter + Bootstrap 注入

**Files:**
- Create: `src/lib/adapters/me-web-adapter.ts`
- Create: `src/lib/adapters/mock/me-mock-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/environment/environment.ts`
- Modify: `tests/unit/environment/bootstrap.test.ts`

**Step 1: Write the failing test**

- 在 `bootstrap.test.ts` 增加断言：
  - 非 mock 时注入 `MeWebAdapter`
  - mock 开启时注入 `MeMockAdapter`

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/environment/bootstrap.test.ts`  
Expected: FAIL（`me` 字段不存在）

**Step 3: Write minimal implementation**

- `RuntimeBootstrapResult` 增加 `me: IMePort`
- `ExoMindEnvironment` 增加 `me`
- `MeWebAdapter` 从 `localStorage` 读取或返回默认结构
- `MeMockAdapter` 返回 fixture 深拷贝

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/environment/bootstrap.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/environment/bootstrap.ts src/lib/environment/environment.ts src/lib/adapters/me-web-adapter.ts src/lib/adapters/mock/me-mock-adapter.ts tests/unit/environment/bootstrap.test.ts
git commit -m "feat(issue-215): wire me adapters into runtime bootstrap"
```

### Task 3: 增加 Me Service

**Files:**
- Create: `src/lib/services/me.service.ts`
- Modify: `src/lib/services/index.ts`
- Create: `tests/unit/services/me.service.issue215.test.ts`

**Step 1: Write the failing test**

- service 应调用 `env.me.getDashboardData()`

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/services/me.service.issue215.test.ts`  
Expected: FAIL（service 不存在）

**Step 3: Write minimal implementation**

- `MeService` 仅暴露 `getDashboardData()`
- `getMeService()` 单例导出

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/services/me.service.issue215.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/services/me.service.ts src/lib/services/index.ts tests/unit/services/me.service.issue215.test.ts
git commit -m "feat(issue-215): add me service layer"
```

### Task 4: 实现 Me 页面三视图（状态/学习/内隐）

**Files:**
- Create: `src/ui/new/pages/NewMePage.tsx`
- Create: `tests/unit/ui/me-pages.issue215.test.tsx`

**Step 1: Write the failing test**

- 断言默认 `状态` 激活
- 切换 `学习`/`内隐` 后出现对应卡片标题
- 断言关键卡片 testid（summary/knowledge/belief）

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/me-pages.issue215.test.tsx`  
Expected: FAIL（页面不存在）

**Step 3: Write minimal implementation**

- 实现页头 `Me`
- 实现三 Tab
- 实现三视图内容块（对齐设计稿文案层级）
- 保留现有风格 token：`#FAF7F5`, `#C75B3A`, `rounded-2xl`, `border-[#E7E5E4]`

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/me-pages.issue215.test.tsx`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/new/pages/NewMePage.tsx tests/unit/ui/me-pages.issue215.test.tsx
git commit -m "feat(issue-215): implement me page with status learn implicit tabs"
```

### Task 5: 路由与底部导航接线

**Files:**
- Modify: `src/routes-new.tsx`
- Create: `tests/unit/ui/me-routing.issue215.test.ts`

**Step 1: Write the failing test**

- 断言存在 `title: 'Me'` 底部项与 `/me` 路由

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/me-routing.issue215.test.ts`  
Expected: FAIL

**Step 3: Write minimal implementation**

- 新增 `NewMePage` 懒加载
- 新增 `/me` route
- 底部导航插入 `Me` 图标项（`UserRound`）

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/me-routing.issue215.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/routes-new.tsx tests/unit/ui/me-routing.issue215.test.ts
git commit -m "feat(issue-215): add me route and bottom navigation entry"
```

### Task 6: E2E 与构建验收

**Files:**
- Create: `tests/e2e/playwright.issue215.config.ts`
- Create: `tests/e2e/me-ui.issue215.test.ts`
- Modify: `package.json`
- Create: `docs/pr/issue-215-progress-comment.md`
- Create: `docs/pr/issue-215-review-comment.md`

**Step 1: Write the failing test**

- E2E 覆盖：打开 `/me`、切换三 tab、校验关键卡片

**Step 2: Run test to verify it fails**

Run: `bun run test:e2e:issue215`  
Expected: FAIL（脚本/配置不存在）

**Step 3: Write minimal implementation**

- 新增 issue215 Playwright 配置（独立端口）
- 增加 npm script `test:e2e:issue215`
- 产出 PR 进展与评审评论草稿文件

**Step 4: Run test to verify it passes**

Run:
- `bunx vitest run tests/unit/environment/bootstrap.test.ts tests/unit/services/me.service.issue215.test.ts tests/unit/ui/me-pages.issue215.test.tsx tests/unit/ui/me-routing.issue215.test.ts`
- `bun run test:e2e:issue215`
- `bun run build`

Expected: 全部 PASS

**Step 5: Commit**

```bash
git add tests/e2e/playwright.issue215.config.ts tests/e2e/me-ui.issue215.test.ts package.json docs/pr/issue-215-progress-comment.md docs/pr/issue-215-review-comment.md
git commit -m "test(issue-215): add e2e coverage and verification artifacts"
```

