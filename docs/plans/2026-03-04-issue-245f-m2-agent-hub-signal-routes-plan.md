# Agent Hub Signal Routes + React Flow Topology Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Agent Hub 页面接入 RT `GET /signal-routes` 真数据，新增“信号路由”列表展示，并用 React Flow 渲染可拖拽/可缩放的信号流拓扑。

**Architecture:** 以现有 `AgentsPage` 为入口，新增一条“路由数据拉取链”（`RuntimeHostSnapshot` -> `SignalRouteService` -> `routeRows` state）。拓扑视图改为 `@xyflow/react`，通过纯函数把 `/signal-routes` 与 `/agents` 聚合成 `nodes + edges`，视图层只负责渲染。为降低回归风险，列表视图保留当前 Agent 列表块，仅追加“信号路由”Section。

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, Playwright, @xyflow/react

---

## Scope / Non-goals

- In scope:
  - M2.1: 列表展示真实路由（topic -> target，active/inactive）
  - M2.2: React Flow 渲染路由拓扑（Topic/Agent/Actor/Frontend 四类节点）
  - 单测 + Playwright E2E 验证
  - PR 计划评论、进展评论、评审评论自动发布
- Out of scope:
  - 编辑/增删路由（CRUD UI）
  - 拓扑自动布局算法优化（先用分层网格布局）

## Task 0: Plan + PR bootstrap（计划与 PR 启动）

**Files:**
- Create: `docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md`
- Create: `docs/pr/issue-245f-m2-plan-comment.md`
- Create: `docs/pr/issue-245f-m2-pr-body.md`

**Step 1: Write plan markdown**

Run:
```bash
# 本文件与 PR 评论草稿写入仓库
```

**Step 2: Commit docs-only bootstrap**

Run:
```bash
git add docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md docs/pr/issue-245f-m2-plan-comment.md docs/pr/issue-245f-m2-pr-body.md
git commit -m "docs(plan): define m2 signal-routes + react-flow implementation flow"
```

**Step 3: Create/update PR and post plan comment**

Run:
```bash
git push -u origin vk/245f-m2-agent-hub-rea
gh pr create --base dev --head vk/245f-m2-agent-hub-rea --title "feat(agent-hub): signal routes list + react flow topology" --body-file docs/pr/issue-245f-m2-pr-body.md
bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-245f-m2-plan-comment.md
```

**Step 4: Wait user approval**

Expected:
- 用户在 PR 或会话内明确“批准计划”后，进入 Task 1。

**Step 5: Commit (if PR metadata changed in files)**

Run:
```bash
git add docs/pr/issue-245f-m2-*.md
git commit -m "docs(pr): publish m2 plan and execution checklist"
```

## Task 1: TDD - 数据建模与图构建纯函数

**Files:**
- Create: `src/ui/app/pages/agents-signal-topology.ts`
- Create: `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- Modify: `src/lib/types/signal-pool.ts`（若需补充 UI 辅助类型）

**Step 1: Write the failing test**

Coverage target:
- 输入 6 条默认路由 + `/agents` 数据，输出：
  - 至少含 `topic:user.input.text`、`agent:classifier`、`actor:eventlog`、`agent:reviewer`
  - 边存在 `user.input.text -> classifier/eventlog`
  - `session.end -> reviewer`
  - disabled route 被标记为 inactive 边样式

**Step 2: Run test to verify it fails**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
```

Expected: FAIL（函数未实现或断言不通过）

**Step 3: Write minimal implementation**

实现内容:
- `buildSignalGraph(routes, agents)`:
  - 生成 Topic/Agent/Actor/Frontend 节点
  - 生成带方向关系的边
  - 输出给 React Flow 的 `nodes/edges`
- `buildSignalRouteRows(routes, hostMeta)`:
  - 输出列表展示需要的行数据（含 active/inactive）

**Step 4: Run test to verify it passes**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
```

Expected: PASS

**Step 5: Commit**

Run:
```bash
git add src/ui/app/pages/agents-signal-topology.ts tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts src/lib/types/signal-pool.ts
git commit -m "test+feat(agent-hub): add signal graph builders from routes and agents"
```

## Task 2: TDD - AgentsPage 列表视图接入 /signal-routes

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`

**Step 1: Write the failing test**

新增断言：
- 列表视图出现“信号路由”Section
- 至少渲染 5+ 条 route row
- 行内显示 `topic -> target_type target_ref`
- 显示 `active/inactive`

**Step 2: Run test to verify it fails**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
```

Expected: FAIL（UI 尚未渲染 route rows）

**Step 3: Write minimal implementation**

实现内容:
- `AgentsPage` 新增 `signalRoutes` state
- 在 runtime snapshot 刷新后，按在线 host 拉取 `GET /signal-routes`
- `ListView` 增加“信号路由”卡片列表
- 为 route rows 增加稳定 `data-testid`

**Step 4: Run test to verify it passes**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
```

Expected: PASS

**Step 5: Commit**

Run:
```bash
git add src/ui/app/pages/AgentsPage.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
git commit -m "test+feat(agent-hub): show real signal routes in list view"
```

## Task 3: TDD - React Flow 拓扑视图替换

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`

**Step 1: Write the failing test**

新增断言：
- 拓扑视图包含 React Flow 容器
- 节点覆盖 Topic/Agent/Actor/Frontend
- 可见关键边：`user.input.text -> classifier/eventlog`、`session.end -> reviewer`

**Step 2: Run test to verify it fails**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
```

Expected: FAIL（仍是旧 SVG 拓扑）

**Step 3: Write minimal implementation**

实现内容:
- 安装并引入 `@xyflow/react`
- 用 `ReactFlow + Background + Controls + MiniMap` 替换旧 SVG
- 自定义四类节点样式：
  - Topic: 椭圆（ellipse）
  - Agent: 矩形（rectangle）
  - Actor: 圆角矩形（rounded rectangle）
  - Frontend: 菱形（diamond）
- 边配置箭头 marker，支持拖拽与缩放

**Step 4: Run test to verify it passes**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
```

Expected: PASS

**Step 5: Commit**

Run:
```bash
git add package.json bun.lock src/ui/app/pages/AgentsPage.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
git commit -m "test+feat(agent-hub): render signal topology with react flow"
```

## Task 4: Playwright 自动化验收

**Files:**
- Create: `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`
- Create: `tests/e2e/playwright.issue245f.config.ts`
- Modify: `package.json`（新增脚本 `test:e2e:issue245f`）

**Step 1: Write e2e test**

覆盖验收标准:
- 列表视图显示 5+ 路由
- 拓扑显示关键流向：
  - `user.input.text -> classifier`
  - `user.input.text -> eventlog`
  - `session.end -> reviewer`
- 画布可缩放（点击 Controls zoom in/out 后 viewport 变化）
- 移动端可查看（使用 Playwright mobile project 或缩小 viewport）

**Step 2: Run e2e to verify behavior**

Run:
```bash
bun run test:e2e:issue245f
```

Expected: PASS（含桌面与移动端场景）

**Step 3: Commit**

Run:
```bash
git add tests/e2e/agent-hub.signal-routes.issue245f.test.ts tests/e2e/playwright.issue245f.config.ts package.json
git commit -m "test(e2e): validate signal routes list and react-flow topology"
```

## Task 5: Full verification + PR 描述/评审评论回写

**Files:**
- Create: `docs/pr/issue-245f-m2-progress-comment.md`
- Create: `docs/pr/issue-245f-m2-review-comment.md`
- Modify: `docs/pr/issue-245f-m2-pr-body.md`

**Step 1: Run verification suite**

Run:
```bash
bun vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
bun run test:e2e:issue245f
bun run build
```

Expected: all PASS

**Step 2: Prepare PR status comments from markdown files**

Run:
```bash
bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-245f-m2-progress-comment.md
```

**Step 3: Request review and post review-result comment**

Run:
```bash
# 代码评审（本地+必要时 AI review）
git show --stat --name-only

bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-245f-m2-review-comment.md
```

**Step 4: Commit PR docs updates**

Run:
```bash
git add docs/pr/issue-245f-m2-progress-comment.md docs/pr/issue-245f-m2-review-comment.md docs/pr/issue-245f-m2-pr-body.md
git commit -m "docs(pr): update m2 progress and review evidence"
```

## Acceptance Checklist Mapping

- [ ] 列表视图展示 5+ 条真实路由（`/signal-routes`）
- [ ] 拓扑图正确展示关键信号流向
- [ ] 节点可拖拽，画布可缩放
- [ ] 桌面端与移动端可查看
- [ ] PR 中包含：计划评论、进展评论、评审评论

## Risks & Mitigations

- Risk: `@xyflow/react` 引入后样式与当前 Tailwind 容器冲突
  - Mitigation: 拓扑容器限定作用域，保留 `data-testid` 与暗色类回归断言
- Risk: 多 host 下路由重复导致节点/边重复
  - Mitigation: 构建图时按 `topic + target_type + target_ref` 去重
- Risk: RT 未启动时列表空白
  - Mitigation: 提示“未连接 runtime 或路由为空”，不阻塞页面其余视图

## Execution Gate

- Gate A（必须）: 计划已在 PR 评论发布并获得用户“批准”
- Gate B（必须）: 每个任务完成后提交单独 commit
- Gate C（必须）: Playwright 通过并把结果写入 PR 评论
- Gate D（必须）: 完成代码评审并把结论写入 PR 评论
