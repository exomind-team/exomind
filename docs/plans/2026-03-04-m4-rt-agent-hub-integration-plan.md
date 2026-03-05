# M4 RT Embedded + Agent Hub Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 M3 构建发版前完成 M1（内嵌 RT）+ M2（Agent Hub）整合，打通 `timeblock.completed -> review.completed -> SSE -> EventStorage -> ChatPage` 全链路，并完成 Agent Hub UI 精调与回归验证。

**Architecture:** 桌面端由 `src-tauri/src/lib.rs` 的 `setup()` 自动启动 embedded runtime（内嵌运行时）并固定监听 `127.0.0.1:4077`；RT 继续复用 `crates/exomind-runtime` 的内建 TS Agent 自动拉起能力（reviewer/classifier）；前端 `AgentsPage` 与 `useSignalStream` 统一以 runtime status（运行状态）/默认端口 `4077` 读取真实数据，移除 mock 依赖路径；通过 Playwright 执行端到端验收。

**Tech Stack:** Rust (Tauri/Axum/Tokio), TypeScript (React/Vitest/Playwright), Bun, GitHub CLI (`gh`)

---

## Scope / Non-Scope（范围 / 非范围）

- Scope（包含）
  - RT 自动启动与健康检查（`/health`、`/signal-routes`）
  - Agent 自动启动与信号订阅链路验证
  - Agent Hub 真实路由/拓扑渲染、桌面+移动端 UI 精调
  - TDD（测试先行）+ Playwright 自动化验证
  - PR 计划评论、进展评论、评审结论评论自动发布
- Non-Scope（不包含）
  - 新增业务功能（仅整合与修复）
  - CI 平台侧改造（由 EXO-70 跟进）

---

### Task 1: Plan + Baseline（计划与基线）

**Files:**
- Create: `docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md`
- Create: `docs/plans/2026-03-04-m4-rt-agent-hub-plan-comment.md`
- Verify: `src-tauri/src/lib.rs`, `src/ui/app/pages/AgentsPage.tsx`, `src/ui/hooks/useSignalStream.ts`, `src/lib/services/timeblock.service.ts`

**Step 1: 写计划评论草稿（Markdown）**

```md
## M4 整合计划（审批版）
- 目标：M1+M2 跑通并可发版
- 关键端口：127.0.0.1:4077
- 执行方式：TDD + Playwright + 分步 commit
```

**Step 2: 记录基线验证命令（仅采样，不宣称通过）**

Run:
```powershell
npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts
npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx
```

Expected:
- 产出当前基线状态，用于后续对比（不作为完成声明）

**Step 3: Commit（计划工件）**

```powershell
git add docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md docs/plans/2026-03-04-m4-rt-agent-hub-plan-comment.md
git commit -m "docs(m4): add integration plan and PR comment draft"
```

---

### Task 2: RT Embedded startup @4077（TDD）

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/runtime_commands.rs`
- Modify: `src/lib/adapters/tauri-runtime-adapter.ts`
- Test: `tests/unit/tauri/runtime-embedded.m1.test.ts`
- Test: `tests/unit/services/runtime-control.service.issue205.test.ts`

**Step 1: 先写失败测试（RED）**
- 新增断言：
  - `setup()` 自动启动调用固定端口 `4077`
  - runtime status 默认端口回退值与 UI 一致（`4077`）

**Step 2: 验证 RED**

Run:
```powershell
npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts
```

Expected:
- FAIL（端口仍为旧值或断言缺失）

**Step 3: 最小实现（GREEN）**
- `setup()` 中 `ensure_runtime_started(..., Some(4077))`
- 前端 runtime adapter 默认端口改为 `4077`

**Step 4: 验证 GREEN**

Run:
```powershell
npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src-tauri/src/lib.rs src-tauri/src/commands/runtime_commands.rs src/lib/adapters/tauri-runtime-adapter.ts tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts
git commit -m "feat(m4): start embedded runtime on port 4077 in tauri setup"
```

---

### Task 3: Signal chain end-to-end wiring（TDD）

**Files:**
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/services/timeblock.service.test.ts`
- Test: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`

**Step 1: 先写失败测试（RED）**
- `timeblock.completed` 发布目标端口改为 `4077`
- `review.completed` SSE 监听端口与 embedded RT 一致
- Agent Hub 启停按钮默认端口与状态卡展示改为 `4077`

**Step 2: 验证 RED**

Run:
```powershell
npx vitest run tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
```

Expected:
- FAIL（旧端口常量导致断言不匹配）

**Step 3: 最小实现（GREEN）**
- 替换硬编码 `1949/1919` 的关键路径为 `4077`（保留必要兼容分支）
- 保证 `review.completed -> EventStorage(type=agent_feedback)` 不变

**Step 4: 验证 GREEN**

Run:
```powershell
npx vitest run tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src/ui/hooks/useSignalStream.ts src/lib/services/timeblock.service.ts src/ui/app/pages/AgentsPage.tsx tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
git commit -m "feat(m4): align signal chain defaults to embedded runtime 4077"
```

---

### Task 4: Agent autostart evidence + health checks（TDD）

**Files:**
- Test/Verify: `crates/exomind-runtime/tests/runtime_ts_agents.rs`
- Create: `tests/e2e/m4-runtime-embedded-health.test.ts`（若现有不足）
- Modify: `tests/e2e/playwright.signal-pool.config.ts`（匹配 M4 验收集）

**Step 1: 先写/补失败测试（RED）**
- 增加 M4 验收脚本：
  - `GET /health` returns `status=ok`
  - `GET /signal-routes` returns route array
  - 发送 `timeblock.completed` 后可观测 `review.completed`（可轮询 history）

**Step 2: 验证 RED**

Run:
```powershell
npx playwright test -c tests/e2e/playwright.signal-pool.config.ts
```

Expected:
- FAIL（当前配置仅覆盖 smoke 或端口不一致）

**Step 3: 最小实现（GREEN）**
- 扩展 Playwright 配置与测试匹配范围
- 若需，补充等待机制（轮询 history/SSE）

**Step 4: 验证 GREEN**

Run:
```powershell
npx playwright test -c tests/e2e/playwright.signal-pool.config.ts
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add tests/e2e/playwright.signal-pool.config.ts tests/e2e/m4-runtime-embedded-health.test.ts
git commit -m "test(e2e): add M4 runtime embedded and signal chain verification"
```

---

### Task 5: UI polish + no console warnings（TDD）

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`
- Modify: `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`

**Step 1: 先写失败测试（RED）**
- 桌面端无溢出/列表对齐断言
- 移动端可用性断言（可滚动、可切视图）
- Console 断言：无 `console.error` / warning（必要时在 E2E 监听）

**Step 2: 验证 RED**

Run:
```powershell
npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
npx playwright test -c tests/e2e/playwright.issue245f.config.ts
```

Expected:
- FAIL（现有样式或 console 噪音未满足）

**Step 3: 最小实现（GREEN）**
- 修正容器高度/溢出/间距
- 调整移动端断点布局
- 清理不必要 console 输出（保留必要错误日志）

**Step 4: 验证 GREEN**

Run:
```powershell
npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
npx playwright test -c tests/e2e/playwright.issue245f.config.ts
```

Expected:
- PASS

**Step 5: Commit**

```powershell
git add src/ui/app/pages/AgentsPage.tsx tests/e2e/agent-hub.signal-routes.issue245f.test.ts tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
git commit -m "style(agent-hub): polish desktop/mobile layout and clean runtime warnings"
```

---

### Task 6: PR comments + review loop + final verification

**Files:**
- Create: `docs/plans/2026-03-04-m4-rt-agent-hub-progress-comment.md`
- Create: `docs/plans/2026-03-04-m4-rt-agent-hub-review-comment.md`
- Create: `docs/plans/2026-03-04-m4-rt-agent-hub-pr-body.md`

**Step 1: 全量验证（verification-before-completion）**

Run:
```powershell
npx tsc --noEmit
npx vitest run tests/unit/tauri/runtime-embedded.m1.test.ts tests/unit/services/runtime-control.service.issue205.test.ts tests/unit/services/timeblock.service.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
npx playwright test -c tests/e2e/playwright.signal-pool.config.ts
npx playwright test -c tests/e2e/playwright.issue245f.config.ts
```

Expected:
- 所有命令 exit code = 0，输出无失败用例

**Step 2: 请求代码评审（requesting-code-review）**
- 记录 `BASE_SHA` / `HEAD_SHA`
- 执行子代理评审或同等流程
- 修复 Critical/Important 后再跑验证

**Step 3: 发布 PR 评论与描述（如已存在 PR）**

```powershell
gh pr comment <PR_NUMBER> --body-file docs/plans/2026-03-04-m4-rt-agent-hub-plan-comment.md
gh pr comment <PR_NUMBER> --body-file docs/plans/2026-03-04-m4-rt-agent-hub-progress-comment.md
gh pr comment <PR_NUMBER> --body-file docs/plans/2026-03-04-m4-rt-agent-hub-review-comment.md
gh pr edit <PR_NUMBER> --body-file docs/plans/2026-03-04-m4-rt-agent-hub-pr-body.md
```

**Step 4: Commit（文档与评审结果）**

```powershell
git add docs/plans/2026-03-04-m4-rt-agent-hub-progress-comment.md docs/plans/2026-03-04-m4-rt-agent-hub-review-comment.md docs/plans/2026-03-04-m4-rt-agent-hub-pr-body.md
git commit -m "docs(m4): add PR progress, review summary, and final description"
```

---

## 执行前审批点（Approval Gate）

- 你确认后才开始 Task 2 及后续代码改动。
- 若当前分支还没有 PR，我会先创建草稿 PR（draft PR，草稿合并请求），再按“每步 commit + 评论同步”执行。

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md`.  
我建议使用 **Subagent-Driven（当前会话分任务执行）**，每个 Task 完成后立即提交 commit、同步 PR 评论并请求评审。  
