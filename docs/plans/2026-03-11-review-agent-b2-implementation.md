# Review-Agent Phase B2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 review-agent 在阶段 B2 中彻底删除本地主评论 id 持久化字段，使主评论续写与重试完全依赖 GitHub 远端重新识别。

**Architecture:** 在 B1 的“远端主评论优先”基础上，删除 `state.json` 中残留的 `activeReviewCommentId` 与所有相关恢复语义。`review-loop` 动作路径保留 `--comment-id` 显式覆盖能力，但默认只允许走“远端主评论识别 > 无则创建”，失败恢复则仅保留 PR 上下文与错误信息，不再保留任何主评论身份缓存。

**Tech Stack:** TypeScript, `tsx`, `vitest`, GitHub CLI (`gh`)

---

### Task 1: 删除持久化状态中的主评论 id 字段

**Files:**
- Modify: `Scripts/review-agent/state-lib.ts`
- Modify: `Scripts/review-agent/review-loop-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: 写失败测试**
- 断言 `buildCompletedReviewState()` 不再产出 `activeReviewCommentId`
- 断言 `buildRetryableReviewFailureState()` 不再产出 `activeReviewCommentId`

**Step 2: 跑红测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts -t "persisted terminal state|retryable review state"`

**Step 3: 最小实现**
- 从 `PersistedState` 删除 `activeReviewCommentId`
- 删除 state builder 的相关输入与写入

**Step 4: 跑绿测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`

### Task 2: 删除 review-loop 的本地主评论恢复链路

**Files:**
- Modify: `Scripts/review-agent/review-loop.ts`
- Modify: `Scripts/review-agent/review-loop-runtime-lib.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: 写失败测试**
- `resolveReviewCommentTarget()` 不再接受 `persistedCommentId`
- 远端主评论 lookup 失败时，系统不会再有任何本地 comment id 兜底语义
- `persistActiveReviewState()` / action 完成与失败路径不再写入主评论 id

**Step 2: 跑红测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts -t "remote comment discovery|lookup fails|persisted"`

**Step 3: 最小实现**
- 删除 `ResolveReviewCommentTargetInput.persistedCommentId`
- 删除 `ReviewCommentContext` 与 `toReviewCommentContext()`
- 删除 `persistActiveReviewState()` 中的 retry comment context 保留逻辑
- 删除 action success/failure 状态落盘中的 comment id 传播

**Step 4: 跑绿测试**
Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`

### Task 3: 同步 B2 文档口径

**Files:**
- Modify: `docs/agents/review-agent/state-files-and-worktrees.md`
- Modify: `docs/agents/review-agent/review-loop.md`
- Modify: `docs/agents/review-agent/review-agent.prompt.md`
- Modify: `docs/agents/review-agent/comment-policy-and-templates.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/index.md`

**Step 1: 文档改动**
- 删除“本地主评论 id hint”表述
- 改为“主评论身份完全依赖 GitHub 远端重新识别”
- 明确失败恢复只保留 PR 上下文，不保留主评论身份缓存

**Step 2: 文档自查**
Run: `rg -n "activeReviewCommentId|comment id hint|主评论 id" docs/agents/review-agent`

### Task 4: 全量验证

**Files:**
- Test: `tests/unit/review-agent/review-loop.test.ts`
- Test: `tests/unit/review-agent/router.test.ts`
- Test: `tests/unit/review-agent/discovery.test.ts`
- Test: `tests/unit/review-agent/review-comment-lib.test.ts`

**Step 1: 运行 review-agent 单测**
Run: `npx vitest run tests/unit/review-agent`

**Step 2: 运行脚本烟测**
Run:
- `npx tsx Scripts/review-agent/router.ts`
- `npx tsx Scripts/review-agent/review-loop.ts --pr 465`

**Step 3: 类型检查（如仍受仓库既有错误影响则据实记录）**
Run: `npx tsc --noEmit --pretty false`
