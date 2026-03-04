# Agent Hub Signal Routes / Topology Follow-up Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 Agent Hub 在纯 Web 开发场景下的“拓扑空白 + 路由空白 + 暗色适配 + MiniMap 遮挡”问题，确保 `localhost:1422` 可稳定展示信号路由与拓扑。

**Architecture:** 保持 M2 已完成的 `signal-routes + React Flow` 主链路不变，在 `AgentsPage` 上增加两层回退：`runtime 直连回退（1950/1949）` 与 `mock 回退`。拓扑渲染层改为主题感知样式，并默认不渲染 MiniMap。通过 Playwright 先写失败测试锁定问题，再做最小实现。

**Tech Stack:** React 18 + TypeScript, @xyflow/react, Vitest, Playwright

---

### Task 1: 写失败测试（E2E）

**Files:**
- Modify: `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`

**Step 1: 增加 MiniMap 断言（默认隐藏）**
- 在拓扑视图断言 `.react-flow__minimap` 数量为 `0`。

**Step 2: 增加暗色可见性断言**
- 设置 `localStorage.exomind:themePreference = dark`。
- 断言画布暗色背景生效、节点可见且数量大于 0。

**Step 3: 增加无 host 回退断言**
- 场景 A：`useMockData=true` 且无 runtime host，断言仍有拓扑节点。
- 场景 B：`useMockData=false` 且无 runtime host，断言可自动连本地 runtime（1950/1949）并显示路由。

**Step 4: 运行并确认失败（RED）**
- Run: `bun run test:e2e:issue245f`
- Expected: FAIL（当前实现不满足上述新断言）

**Step 5: Commit**
- `git commit -m "test(e2e): add follow-up regressions for dark mode, minimap, and runtime fallback"`

### Task 2: 最小实现修复（GREEN）

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents-signal-topology.ts`（如需补辅助函数）

**Step 1: 关闭 MiniMap**
- 默认不渲染 `<MiniMap />`，消除右下角遮挡。

**Step 2: 暗色/浅色主题适配**
- React Flow 边、标签、背景网格按主题切换 token（颜色变量）。
- 保证暗色下画布和节点文本对比度可读。

**Step 3: runtime 直连回退**
- 当 runtime host 列表为空时，自动尝试 `127.0.0.1:1950 -> 127.0.0.1:1949`。
- 成功后直接拉取 `/signal-routes`（必要时拉 `/agents`）并渲染，不强依赖“管理主机”手动配置。

**Step 4: mock 回退**
- `useMockData=true` 且 runtime 路由为空时，使用 mock 路由/拓扑回退，避免空白画布。

**Step 5: Commit**
- `git commit -m "fix(agent-hub): add runtime/mock fallback and improve flow canvas in dark mode"`

### Task 3: 全量验证与 PR 评论更新

**Files:**
- Modify: `docs/pr/issue-245f-m2-plan-comment.md`
- Modify: `docs/pr/issue-245f-m2-progress-comment.md`
- Modify: `docs/pr/issue-245f-m2-review-comment.md`

**Step 1: 运行验证（必须带证据）**
- `bun run test:e2e:issue245f`
- `bunx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`
- `bunx tsc --noEmit --pretty false`
- `bun run build`

**Step 2: 回写 PR 评论 markdown**
- 计划评论：补充本次 follow-up 修复范围与验收命令。
- 进展评论：贴命令 + 通过结果 + commit 列表。
- 评审评论：记录 findings（如有）与最终评审结论。

**Step 3: 发布 PR 评论并保持 Draft**
- 使用 `gh pr comment` 上传 markdown 文件内容到 PR #327。
- 维持 Draft，不执行 Ready for review。

**Step 4: Commit**
- `git commit -m "docs(pr): update follow-up fix plan, progress, and review evidence"`

### 验收映射

- [ ] 拓扑图暗色/浅色均可见节点与边
- [ ] 右下角 MiniMap 默认关闭
- [ ] 无 runtime host 时不再出现“空白无节点”
- [ ] runtime 在 1950 时可在前端显示真实路由与拓扑
- [ ] 提供可复现验收命令（含你本地运行方式）

