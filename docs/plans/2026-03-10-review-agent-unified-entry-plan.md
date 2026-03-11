# Review Agent Unified Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把审阅 Agent 改造成“单一入口 prompt + 路由脚本决定下一步”的结构，去掉人类手动选择 bootstrap/discovery/review prompt 的模式。

**Architecture:** 用 `router.ts` 取代对外的 `bootstrap.ts` 入口；统一 prompt 只描述“先跑 router，再执行 router 返回的动作”；discovery/review 文档继续保留为内部协议，不再作为独立 prompt 暴露。

**Tech Stack:** Markdown、TypeScript、Node.js、Vitest、`gh` CLI

---

### Task 1: 为 router 重构补失败测试

**Files:**
- Create: `tests/unit/review-agent/router.test.ts`
- Delete: `tests/unit/review-agent/bootstrap.test.ts`

**Step 1: Write the failing test**

将现有 bootstrap 路由测试迁移到 router 语义，至少覆盖：
- 无状态进入 `discovery`
- 有效 `selected_pr` 进入 `review`
- 失效 `selected_pr` 回退 `discovery`
- `NO_TARGET` 进入 `idle-wait`
- 可重试失败时按 `lastPhase` 路由

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/review-agent/router.test.ts`

Expected: FAIL，因 `router-lib.ts` 尚不存在。

### Task 2: 实现 router 脚本与兼容重命名

**Files:**
- Create: `Scripts/review-agent/router-lib.ts`
- Create: `Scripts/review-agent/router.ts`
- Delete: `Scripts/review-agent/bootstrap-lib.ts`
- Delete: `Scripts/review-agent/bootstrap.ts`

**Step 1: Write minimal implementation**

复用现有 bootstrap 路由逻辑，但输出字段统一为：
- `action`
- `reason`
- `selectedPrNumber`
- `sleepSeconds`

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/review-agent/router.test.ts`

Expected: PASS

### Task 3: 收敛文档到单一 prompt

**Files:**
- Create: `docs/agents/review-agent/review-agent.prompt.md`
- Create: `docs/agents/review-agent/router-and-recovery.md`
- Modify: `docs/agents/review-agent/index.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/state-files-and-worktrees.md`
- Delete: `docs/agents/review-agent/prompts/bootstrap.prompt.md`
- Delete: `docs/agents/review-agent/prompts/discovery.prompt.md`
- Delete: `docs/agents/review-agent/prompts/review.prompt.md`
- Delete: `docs/agents/review-agent/bootstrap-and-recovery.md`

**Step 1: Write minimal documentation**

确保：
- 人类只面对一份 prompt
- router 是脚本，不是人类手动选择的流程
- discovery/review 只是内部执行分支

### Task 4: 回归验证

**Files:**
- Verify: `Scripts/review-agent/router.ts`
- Verify: `Scripts/review-agent/discovery.ts`
- Verify: `Scripts/review-agent/review-loop.ts`

**Step 1: Run targeted verification**

Run:
- `npx vitest run tests/unit/review-agent/router.test.ts tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts`

Expected: PASS

**Step 2: Runtime smoke**

Run:
- `npx tsx Scripts/review-agent/router.ts`

Expected:
- 输出当前该进入 `discovery`、`review` 或 `idle-wait`
