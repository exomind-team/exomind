# Review Agent Prompts And Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为审阅 Agent 补齐可直接循环输入的 prompt 文档，并把 discovery/review 两段循环的协议与最小实现对齐。

**Architecture:** 文档层新增两份独立 prompt 文件，作为“给 Agent 的输入文本”；协议层统一状态名和发现规则；代码层先补 discovery 的 `review thread reply` 检测与失败状态，再新增一个最小 `review-loop` 入口负责拉取 PR 上下文和生成审阅草稿摘要。这样 prompt、协议、脚本三层保持单一真相源。

**Tech Stack:** Markdown、TypeScript、Node.js、`gh` CLI、Vitest

---

### Task 1: 补齐循环 prompt 文档并核对协议一致性

**Files:**
- Create: `docs/agents/review-agent/prompts/discovery.prompt.md`
- Create: `docs/agents/review-agent/prompts/review.prompt.md`
- Modify: `docs/agents/review-agent/index.md`
- Modify: `docs/agents/review-agent/common-contract.md`
- Modify: `docs/agents/review-agent/discovery-loop.md`
- Modify: `docs/agents/review-agent/review-loop.md`

**Step 1: Write the prompt documents**

将“发现循环”和“审阅循环”分别固化成可直接循环输入 Agent 的 prompt 文本，要求：
- 明确输入、输出、错误处理和边界
- 与公共契约中的状态名一致
- 与 `temp/` 状态结构一致

**Step 2: Review docs for consistency**

人工比对：
- 状态名是否统一
- 目录路径是否统一
- `🙋needs-human-test` 和 `[Codex Reviewer]` 前缀是否统一
- discovery / review 阶段边界是否一致

### Task 2: 为 review thread reply 检测补失败测试

**Files:**
- Modify: `tests/unit/review-agent/discovery.test.ts`
- Create: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: Write the failing tests**

新增 discovery 场景：
- 最后一条 reviewer 评论之后仅出现 review thread reply，也应视为 actionable

新增 review-loop 场景：
- 能解析 PR body 中的 `refs/closes/fixes #xxx`
- 能对 issue id 去重
- 能根据 diff 规模选择 `full-review` 或 `priority-review`

**Step 2: Run tests to verify they fail**

Run:
- `npx vitest run tests/unit/review-agent/discovery.test.ts`
- `npx vitest run tests/unit/review-agent/review-loop.test.ts`

Expected:
- discovery 因缺少 thread reply 逻辑失败
- review-loop 因实现文件不存在或缺少导出失败

### Task 3: 实现 discovery 协议对齐

**Files:**
- Modify: `Scripts/review-agent/discovery-lib.ts`
- Modify: `Scripts/review-agent/discovery.ts`

**Step 1: Write minimal implementation**

补齐：
- `review thread reply` 活动检测
- `FAILED_RETRYABLE` 状态名
- 发现阶段输出与文档 prompt 一致

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/review-agent/discovery.test.ts`

Expected: PASS

### Task 4: 实现最小 review-loop 入口

**Files:**
- Create: `Scripts/review-agent/review-loop-lib.ts`
- Create: `Scripts/review-agent/review-loop.ts`
- Test: `tests/unit/review-agent/review-loop.test.ts`

**Step 1: Write minimal implementation**

补齐：
- PR body 里的 issue id 解析
- issue id 去重
- diff 规模分类（`full-review` / `priority-review`）
- 输出 review 摘要 JSON，包含：
  - `selectedPr`
  - `linkedIssues`
  - `reviewMode`
  - `needsWorktree`

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/review-agent/review-loop.test.ts`

Expected: PASS

### Task 5: 联合验证

**Files:**
- Verify: `Scripts/review-agent/discovery.ts`
- Verify: `Scripts/review-agent/review-loop.ts`
- Verify: `docs/agents/review-agent/prompts/discovery.prompt.md`
- Verify: `docs/agents/review-agent/prompts/review.prompt.md`

**Step 1: Run targeted verification**

Run:
- `npx vitest run tests/unit/review-agent/discovery.test.ts tests/unit/review-agent/review-loop.test.ts`
- `npx tsx Scripts/review-agent/discovery.ts --limit 5`

Expected:
- 单测通过
- discovery 输出当前轮次状态

**Step 2: Runtime smoke check**

若 `temp/pr-monitor/queue.json` 中存在 `selectedPr`，再运行：
- `npx tsx Scripts/review-agent/review-loop.ts --pr <number>`

Expected:
- 输出 review-loop 摘要 JSON
