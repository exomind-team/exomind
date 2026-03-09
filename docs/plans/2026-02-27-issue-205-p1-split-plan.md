# Issue-205 P1 Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Issue-205 的非 P0 能力拆分为独立迭代，避免阻塞 P0 可验收闭环交付。

**Architecture:** P1 聚焦在 P0 之上的扩展能力：Agent 级健康指标、多 RuntimeHost 调度与故障切换、信号路由策略、多模型路由。实现保持 `UI -> Service -> Adapter -> RuntimeHost` 分层，不回退到页面内临时代码。

**Tech Stack:** React + TypeScript + Zustand + Tauri v2 + Bun + Vitest + Playwright.

---

### Task 1: Agent 级健康指标（Health Panel）

**Files:**
- Modify: `src/lib/types/agent-hub.ts`
- Modify: `src/ui/new/pages/agents/AgentDetailPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-health-panel.issue205p1.test.tsx`

**Step 1: Write the failing test**
- 断言 Agent 详情页展示 token/cost/latency 与最近心跳时间。

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-health-panel.issue205p1.test.tsx`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 增加 `AgentHealthSnapshot` 结构并完成 UI 渲染。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-health-panel.issue205p1.test.tsx`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/types/agent-hub.ts src/ui/new/pages/agents/AgentDetailPage.tsx tests/unit/ui/agent-hub/agent-health-panel.issue205p1.test.tsx`
- `git commit -m "feat(agent-hub): add agent health panel for issue-205 p1"`

---

### Task 2: 多 RuntimeHost 调度与故障切换（Scheduler + Failover）

**Files:**
- Create: `src/lib/services/runtime-scheduler.service.ts`
- Modify: `src/lib/services/agent-hub.service.ts`
- Test: `tests/unit/services/runtime-scheduler.issue205p1.test.ts`

**Step 1: Write the failing test**
- 断言首选主机不可用时自动切换到候选主机。

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/services/runtime-scheduler.issue205p1.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 最小调度策略：优先级 + 健康度 + 回退。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/services/runtime-scheduler.issue205p1.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/runtime-scheduler.service.ts src/lib/services/agent-hub.service.ts tests/unit/services/runtime-scheduler.issue205p1.test.ts`
- `git commit -m "feat(runtime): add runtimehost failover scheduler for issue-205 p1"`

---

### Task 3: 高级信号路由策略（Retry/Replay/Priority）

**Files:**
- Create: `src/lib/services/signal-routing.service.ts`
- Test: `tests/unit/services/signal-routing.issue205p1.test.ts`
- Test: `tests/e2e/agent-signal-routing.issue205p1.test.ts`

**Step 1: Write the failing tests**
- 断言支持重试次数、重放窗口与优先级顺序。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/services/signal-routing.issue205p1.test.ts`
- Run: `bun playwright test tests/e2e/agent-signal-routing.issue205p1.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 增加路由策略执行器与 UI 最小配置入口。

**Step 4: Run tests to verify they pass**
- Run: same commands above
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/signal-routing.service.ts tests/unit/services/signal-routing.issue205p1.test.ts tests/e2e/agent-signal-routing.issue205p1.test.ts`
- `git commit -m "feat(signal): add retry replay priority routing for issue-205 p1"`

---

### Task 4: 多模型路由与成本策略（Model Routing）

**Files:**
- Create: `src/lib/services/model-routing.service.ts`
- Modify: `src/lib/ports/llm-port.ts`
- Test: `tests/unit/services/model-routing.issue205p1.test.ts`

**Step 1: Write the failing test**
- 断言根据策略在不同模型/供应商间路由并记录成本。

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/services/model-routing.issue205p1.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 增加模型路由策略接口与默认策略。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/services/model-routing.issue205p1.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/model-routing.service.ts src/lib/ports/llm-port.ts tests/unit/services/model-routing.issue205p1.test.ts`
- `git commit -m "feat(llm): add model routing policy for issue-205 p1"`

---

### Task 5: P1 验证与文档证据

**Files:**
- Create: `docs/pr/issue-205-p1-progress-comment.md`
- Create: `docs/pr/issue-205-p1-review-comment.md`

**Step 1: Run verification**
- `bun vitest`
- `bun run build`

**Step 2: Update PR comments**
- 发布进度与评审评论。

**Step 3: Commit**
- `git add docs/pr/issue-205-p1-progress-comment.md docs/pr/issue-205-p1-review-comment.md`
- `git commit -m "docs(issue-205-p1): add progress and review evidence"`
