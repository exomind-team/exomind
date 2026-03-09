# Review Agent Bootstrap Recovery Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 review-agent 在任意会话中断后，能基于本地状态和当前 GitHub 事实自判阶段，并路由到正确的循环 prompt。

**Architecture:** 增加一个统一的 bootstrap/router 层，专门负责读取 `temp/pr-monitor/` 状态、校验 `selected_pr` 是否仍然有效，并输出下一步应进入 `discovery`、`review` 或 `idle-wait`。同时扩展 discovery/review-loop 的状态落盘字段，使恢复判断不依赖外部记忆。

**Tech Stack:** Markdown、TypeScript、Node.js、Vitest、`gh` CLI

---

### Task 1: 补 bootstrap 协议和 prompt

**Files:**
- Create: `docs/agents/review-agent/bootstrap-and-recovery.md`
- Create: `docs/agents/review-agent/prompts/bootstrap.prompt.md`
- Modify: `docs/agents/review-agent/index.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/state-files-and-worktrees.md`

**Step 1: Write the protocol**

明确：
- 重启后第一入口是 bootstrap prompt
- bootstrap 必须读取 `state.json`、`queue.json`、`backoff.json`
- bootstrap 必须验证 `selected_pr` 是否仍 open
- bootstrap 输出下一步 `next_prompt`

### Task 2: 为 bootstrap 路由补失败测试

**Files:**
- Create: `tests/unit/review-agent/bootstrap.test.ts`
- Create: `Scripts/review-agent/bootstrap-lib.ts`

**Step 1: Write the failing tests**

覆盖：
- 无状态时进入 `discovery`
- `HAS_TARGET + selected_pr 有效` 时进入 `review`
- `HAS_TARGET + selected_pr 无效` 时回退到 `discovery`
- `NO_TARGET` 时进入 `idle-wait`
- `FAILED_RETRYABLE` 时按 `lastPhase` 决定重试方向

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/review-agent/bootstrap.test.ts`

Expected: FAIL

### Task 3: 实现 bootstrap 脚本与状态扩展

**Files:**
- Create: `Scripts/review-agent/bootstrap.ts`
- Modify: `Scripts/review-agent/discovery.ts`
- Modify: `Scripts/review-agent/review-loop.ts`

**Step 1: Write minimal implementation**

补齐：
- `state.json` 增加 `phase`、`nextPrompt`、`selectedPrNumber`
- review-loop 执行后也写入恢复所需状态
- bootstrap 输出建议进入哪个 prompt

**Step 2: Run tests to verify they pass**

Run:
- `npx vitest run tests/unit/review-agent/bootstrap.test.ts`

Expected: PASS

### Task 4: 联合验证

**Files:**
- Verify: `Scripts/review-agent/bootstrap.ts`
- Verify: `Scripts/review-agent/discovery.ts`
- Verify: `Scripts/review-agent/review-loop.ts`

**Step 1: Run targeted verification**

Run:
- `npx vitest run tests/unit/review-agent/bootstrap.test.ts tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts`

Expected: PASS
