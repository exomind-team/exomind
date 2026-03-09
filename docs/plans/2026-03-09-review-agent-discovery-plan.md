# Review Agent Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 issue-450 实现基于本地 `gh` 的 PR 发现脚本，稳定产出待审阅队列与本地退避状态。

**Architecture:** 将纯判定逻辑放在 `Scripts/review-agent/discovery-lib.ts`，使其可由 Vitest 直接覆盖；将 GitHub 查询、失败处理与 `temp/pr-monitor/` 状态持久化放在 `Scripts/review-agent/discovery.ts`。这样 discovery 阶段可先独立闭环，不影响后续 review-loop 扩展。

**Tech Stack:** TypeScript、Node.js、`gh` CLI、Vitest

---

### Task 1: 固化 discovery 红灯测试目标

**Files:**
- Test: `tests/unit/review-agent/discovery.test.ts`

**Step 1: Write the failing test**

测试已存在，覆盖以下行为：
- 无 `[Codex Reviewer]` 评论时应入队
- reviewer 评论后出现新评论或新提交时应入队
- reviewer 评论后无新增活动时应跳过
- 队列按 `updatedAt` 倒序选择
- 无变化时按规则退避

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/review-agent/discovery.test.ts`

Expected: FAIL，原因是 `Scripts/review-agent/discovery-lib.ts` 尚不存在。

### Task 2: 实现纯 discovery 判定库

**Files:**
- Create: `Scripts/review-agent/discovery-lib.ts`
- Test: `tests/unit/review-agent/discovery.test.ts`

**Step 1: Write minimal implementation**

补齐以下导出：
- `REVIEWER_PREFIX`
- `type PullRequestSnapshot`
- `classifyPullRequest()`
- `buildDiscoveryRound()`
- `computeNextBackoff()`

**Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/review-agent/discovery.test.ts`

Expected: PASS

### Task 3: 实现 `gh` 驱动的 discovery 入口

**Files:**
- Create: `Scripts/review-agent/discovery.ts`

**Step 1: Write minimal implementation**

实现以下职责：
- `gh pr list --state open --json ...` 拉取 open PR
- 逐个用 `gh pr view` 拉取评论、review、提交
- 单个 PR 失败时跳过
- 整轮发现成功时写入 `temp/pr-monitor/state.json`、`queue.json`、`backoff.json`
- 整轮连续失败时累计 `failure_streak`，达到 3 时返回 sleep 300 秒

**Step 2: Run script to verify it works**

Run: `npx tsx Scripts/review-agent/discovery.ts`

Expected: 输出当前轮次状态 JSON，并在 `temp/pr-monitor/` 下生成状态文件。

### Task 4: 回归验证

**Files:**
- Verify: `Scripts/review-agent/discovery-lib.ts`
- Verify: `Scripts/review-agent/discovery.ts`
- Verify: `tests/unit/review-agent/discovery.test.ts`

**Step 1: Run targeted verification**

Run: `npx vitest run tests/unit/review-agent/discovery.test.ts`

Expected: PASS

**Step 2: Optional runtime verification**

Run: `npx tsx Scripts/review-agent/discovery.ts`

Expected: 成功读取当前仓库 PR 信息；若没有 open PR，也应输出 `NO_TARGET` 而非报错。
