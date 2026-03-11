# Review-Agent Phase B1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 review-agent 在阶段 B1 中把“主评论真相”切回 GitHub 远端，并把本地选中 PR / 评论缓存降级为 continuity hint。

**Architecture:** 在 `review-loop` 动作入口增加远端主评论识别层，统一用“显式 `--comment-id` > GitHub 远端当前主评论 > 无则创建新评论”的优先级决定评论目标；同时收紧 `router` 的 `HAS_TARGET` 恢复逻辑，避免仅凭 stale 的 `selectedPrNumber` 直接续跑 review。`state.json` 继续保留 `activeReviewCommentId` 作为恢复 hint，但删除 `activeReviewCommentUrl`，并在文档中明确它不再是真相缓存。

**Tech Stack:** TypeScript, `tsx`, `vitest`, GitHub CLI (`gh`)

---

### Task 1: 收紧 review state 数据模型

**Files:**
- Modify: `Scripts/review-agent/state-lib.ts`
- Modify: `Scripts/review-agent/review-loop-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: 写失败测试**
- 断言 `buildCompletedReviewState()` 与 `buildRetryableReviewFailureState()` 不再携带 `activeReviewCommentUrl`
- 断言仍可保留 `activeReviewCommentId` 作为 hint

**Step 2: 跑红测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts -t "maps review actions|maps review fetch failures"`

**Step 3: 最小实现**
- 从 `PersistedState` 删除 `activeReviewCommentUrl`
- 调整 state builder 与相关 helper

**Step 4: 跑绿测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`

### Task 2: 让 review action 先远端识别主评论

**Files:**
- Modify: `Scripts/review-agent/review-loop-lib.ts`
- Modify: `Scripts/review-agent/review-loop.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: 写失败测试**
- 远端已有新的 `[Codex Reviewer]` 主评论时，应优先编辑远端评论而不是本地 hint
- 远端没有主评论时，应创建新评论
- 显式 `--comment-id` 仍高于远端自动识别
- 远端主评论读取失败时，应进入 `FAILED_RETRYABLE`，而不是盲用本地 id

**Step 2: 跑红测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts -t "remote main comment|explicit --comment-id|comment lookup failure"`

**Step 3: 最小实现**
- 增加“主评论协议识别”纯函数
- `review-loop.ts` 在 action path 中先拉取 issue comments，再决定 `commentId`
- 删除 `resolveRetryCommentId()` 的真相源角色，仅作 hint 校验或兜底

**Step 4: 跑绿测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`

### Task 3: 修正 action context 拉取与 router 的 stale target 恢复

**Files:**
- Modify: `Scripts/review-agent/review-loop.ts`
- Modify: `Scripts/review-agent/router.ts`
- Modify: `Scripts/review-agent/router-lib.ts`
- Modify: `Scripts/review-agent/state-lib.ts`
- Test: `tests/unit/review-agent/router.test.ts`

**Step 1: 写失败测试**
- `HAS_TARGET` 但 queue 里的 selected PR 已经不再 remotely actionable 时，应回退到 `discovery`
- `HAS_TARGET` 且 selected PR 仍 remotely actionable 时，仍可进入 `review`
- action context 不再依赖非法的 `viewerCanMerge` JSON 字段才能完成普通评论路径

**Step 2: 跑红测试**
Run: `npx vitest run tests/unit/review-agent/router.test.ts tests/unit/review-agent/review-loop.test.ts`

**Step 3: 最小实现**
- 扩展 router 输入，使其能判断 selected PR 是否仍与 queue 当前事实一致
- `router.ts` 读取 queue 的 freshness 信息，而不是只读 open PR number
- `review-loop.ts` 把 merge 所需上下文与普通 comment/action 上下文拆开，避免 comment 路径先被 `viewerCanMerge` 字段炸掉

**Step 4: 跑绿测试**
Run: `npx vitest run tests/unit/review-agent/router.test.ts tests/unit/review-agent/review-loop.test.ts`

### Task 4: 同步 B1 文档口径

**Files:**
- Modify: `docs/agents/review-agent/review-loop.md`
- Modify: `docs/agents/review-agent/router-and-recovery.md`
- Modify: `docs/agents/review-agent/state-files-and-worktrees.md`
- Modify: `docs/agents/review-agent/review-agent.prompt.md`
- Modify: `docs/agents/review-agent/comment-policy-and-templates.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/index.md`

**Step 1: 文档改动**
- 明确“当前主评论 = GitHub 远端最新协议顶层评论”
- 明确 `activeReviewCommentId` 是 optional hint
- 删除 `activeReviewCommentUrl` 相关表述
- 明确 `HAS_TARGET` 不得仅因 PR 仍 open 就直接续接 review

**Step 2: 文档自查**
Run: `rg -n "activeReviewCommentUrl|viewerCanMerge|主评论|selectedPrNumber" docs/agents/review-agent`

### Task 5: 全量验证

**Files:**
- Test: `tests/unit/review-agent/router.test.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`
- Test: `tests/unit/review-agent/discovery.test.ts`

**Step 1: 运行相关单测**
Run: `npx vitest run tests/unit/review-agent/router.test.ts tests/unit/review-agent/review-loop.test.ts tests/unit/review-agent/discovery.test.ts`

**Step 2: 运行脚本烟测**
Run:
- `npx tsx Scripts/review-agent/router.ts`
- `npx tsx Scripts/review-agent/review-loop.ts --pr 465`

**Step 3: 类型检查（如受仓库既有错误影响则据实记录）**
Run: `npx tsc --noEmit --pretty false`
