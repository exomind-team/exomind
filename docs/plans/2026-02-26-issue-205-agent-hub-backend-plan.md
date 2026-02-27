# GH#205 Agent Hub Backend Implementation Plan（已被 P0 方案替代）

> 状态说明：本文件为 2026-02-26 旧方案（后端模型优先）。  
> 最新执行基线请改用：`docs/plans/2026-02-27-issue-205-p0-runtimehost-acceptance-plan.md`  
> 替代原因：验收标准升级为“真实信号读写 + 真实 Agent 对话 + 真实在线状态”可观察现象。

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Agent Hub 落地后端领域模型、服务层与 Claude LLM 适配器，并提供可被 #204 前端直接消费的“可持续追加信号输入/输出节点”能力。

**Architecture:** 采用 `Type(领域类型) -> Service(业务编排) -> Adapter(外部LLM)` 三层结构。`agent.service.ts` 负责 Agent/Actor/Signal Pool CRUD 与持久化，`chat.service.ts` 负责对话历史与模型调用编排，`claude-adapter.ts` 作为 `ILLMPort` 的 Claude Messages API 实现。UI 仅调用 Service，不直接依赖 Adapter。  
额外按“分层演进”实现：第一层先支持信号节点连续新增（输入/输出），第二层再连接 Agent/Actor 的运行链路。

**Tech Stack:** TypeScript + WebStorageAdapter(IStoragePort) + Vitest + Playwright + Bun + Claude Messages API(SSE)。

---

## 方案比较（Brainstorming）

### 方案 A：只做 Issue 原文最小实现（Agent/Actor/Chat + Claude）
- 优点：实现快，改动小。
- 缺点：无法满足“/agents 页连续新增信号输入/输出节点”的验收目标。

### 方案 B（推荐）：Issue 原文 + 信号池（Signal Pool）最小闭环
- 优点：覆盖 #205 核心与你新增验收标准；为下一步“连线 Agent 处理信号”留好数据结构。
- 缺点：会增加少量 #204 页面联调改动与测试成本。

### 方案 C：一步到位做全运行时引擎（调度 + 连线执行）
- 优点：功能最完整。
- 缺点：超出 #205 范围，风险高，难在当前迭代稳定交付。

结论：按**方案 B**执行。

---

## Task 1: 定义 Agent Domain Types（领域模型类型）

**Files:**
- Create: `src/lib/types/agent.ts`
- Modify: `src/lib/types/index.ts`
- Test: `tests/unit/agent-hub/agent-domain-types.issue205.test.ts`

**Step 1: Write failing test（先写失败测试）**
- 验证 `Agent / Actor / ChatMessage / SignalNode` 基础字段与状态枚举契约。

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/agent-hub/agent-domain-types.issue205.test.ts`
- Expected: FAIL（类型/导出缺失）

**Step 3: Write minimal implementation（最小实现）**
- 增加 `Agent`、`Actor`、`ChatMessage`，并补充 `SignalNode`（`input|output`）与 `SignalTag`。
- 为后续扩展连线准备 `SignalRoute` 类型（只定义，不实现执行）。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/agent-hub/agent-domain-types.issue205.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/types/agent.ts src/lib/types/index.ts tests/unit/agent-hub/agent-domain-types.issue205.test.ts`
- `git commit -m "feat(agent-hub): add agent domain types for issue-205"`

---

## Task 2: 实现 agent.service.ts（CRUD + Signal Pool）

**Files:**
- Create: `src/lib/services/agent.service.ts`
- Modify: `src/lib/services/index.ts`
- Test: `tests/unit/services/agent.service.issue205.test.ts`

**Step 1: Write failing test**
- 覆盖：
  - `create/list/get/update/delete Agent`
  - `create/list/get/update/delete Actor`
  - `add/list/remove SignalNode(input|output)`
  - 连续新增信号节点 ID 唯一与顺序稳定
  - 持久化重载后可恢复

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/services/agent.service.issue205.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 基于 `IStoragePort` 封装仓储键：
  - `agent_hub_agents_v1`
  - `agent_hub_actors_v1`
  - `agent_hub_signals_v1`
- 在 Service 内实现内存快照 + 持久化同步。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/services/agent.service.issue205.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/agent.service.ts src/lib/services/index.ts tests/unit/services/agent.service.issue205.test.ts`
- `git commit -m "feat(agent-hub): add agent service CRUD and signal pool for issue-205"`

---

## Task 3: 实现 chat.service.ts（对话管理）

**Files:**
- Create: `src/lib/services/chat.service.ts`
- Modify: `src/lib/services/index.ts`
- Test: `tests/unit/services/chat.service.issue205.test.ts`

**Step 1: Write failing test**
- 覆盖：
  - `sendMessage`：保存 user 消息 -> 调用 `ILLMPort.complete` -> 保存 assistant 消息
  - `streamMessage`：流式增量拼接 + 持久化最终 assistant 内容
  - `getChatHistory(agentId)`：按时间升序返回

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/services/chat.service.issue205.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 统一存储键 `agent_hub_chat_history_v1`（按 `agentId` 分组）。
- 适配 `LLMRequest.messages`，支持 system prompt 注入。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/services/chat.service.issue205.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/chat.service.ts src/lib/services/index.ts tests/unit/services/chat.service.issue205.test.ts`
- `git commit -m "feat(agent-hub): add chat service with llm orchestration for issue-205"`

---

## Task 4: 实现 Claude Adapter（ILLMPort complete + stream）

**Files:**
- Create: `src/lib/adapters/llm/claude-adapter.ts`
- Test: `tests/unit/adapters/llm/claude-adapter.issue205.test.ts`

**Step 1: Write failing test**
- 覆盖：
  - `complete`：请求格式、响应 `content/usage/model` 映射正确
  - `stream`：SSE 解析 `content_block_delta`，按 chunk 输出，最终 `done=true`
  - API 错误码透传（4xx/5xx）

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/adapters/llm/claude-adapter.issue205.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 构造参数：
  - `apiKey`
  - `baseURL`（默认 `https://api.anthropic.com`）
  - `model`（可被 request 覆盖）
  - `fetchImpl`（便于测试注入）
- `complete` 调用 Claude Messages API（非流式）。
- `stream` 调用同 API 的 SSE 流式分支并转换为 `LLMChunk`。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/adapters/llm/claude-adapter.issue205.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/adapters/llm/claude-adapter.ts tests/unit/adapters/llm/claude-adapter.issue205.test.ts`
- `git commit -m "feat(agent-hub): implement claude adapter for ILLMPort issue-205"`

---

## Task 5: 生成前端可用测试数据工具（供 #204 联调）

**Files:**
- Create: `src/lib/adapters/mock/fixtures/agent-hub-seed.issue205.ts`
- Modify: `src/lib/adapters/mock/fixtures/agent-hub.ts`
- Test: `tests/unit/adapters/agent-hub-seed.issue205.test.ts`

**Step 1: Write failing test**
- 验证能从 `Agent/Actor/SignalNode` 生成 `AgentHubTopologyData` 与 `listSections`。

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/adapters/agent-hub-seed.issue205.test.ts`
- Expected: FAIL

**Step 3: Write minimal implementation**
- `buildAgentHubFixtureFromDomain()`：将领域模型转换为 #204 视图模型。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/adapters/agent-hub-seed.issue205.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/adapters/mock/fixtures/agent-hub-seed.issue205.ts src/lib/adapters/mock/fixtures/agent-hub.ts tests/unit/adapters/agent-hub-seed.issue205.test.ts`
- `git commit -m "feat(agent-hub): add fixture seed builder for issue-204 dependency"`

---

## Task 6: 最小联调（/agents 连续新增输入/输出节点）

**Files:**
- Modify: `src/lib/services/agent-hub.service.ts`
- Modify: `src/ui/new/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-add-node.issue205.test.tsx`
- Test: `tests/e2e/agent-hub.issue205.test.ts`
- Create: `tests/e2e/playwright.issue205.config.ts`
- Modify: `package.json`

**Step 1: Write failing tests**
- 单测：连续点击“添加信号输入/添加输出节点”后，拓扑节点数量递增。
- E2E：在 `/agents` 连续添加 2 个输入 + 2 个输出并可见。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-add-node.issue205.test.tsx`
- Run: `bun run test:e2e:issue205`
- Expected: FAIL

**Step 3: Write minimal implementation**
- `AgentHubService` 新增 `addSignalNode`，内部调用 `AgentService`。
- `AgentsPage` 中 AddNodeSheet 的 input/output 选项点击后执行新增并刷新视图。

**Step 4: Run tests to verify they pass**
- Run: `bun vitest tests/unit/ui/agent-hub/agent-add-node.issue205.test.tsx`
- Run: `bun run test:e2e:issue205`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/agent-hub.service.ts src/ui/new/pages/AgentsPage.tsx tests/unit/ui/agent-hub/agent-add-node.issue205.test.tsx tests/e2e/agent-hub.issue205.test.ts tests/e2e/playwright.issue205.config.ts package.json`
- `git commit -m "feat(agent-hub): support continuous signal node creation on /agents"`

---

## Task 7: 全量验证 + PR 文档 + 评审结论

**Files:**
- Create: `docs/pr/issue-205-progress-comment.md`
- Create: `docs/pr/issue-205-review-comment.md`
- Create: `docs/pr/issue-205-pr-body.md`

**Step 1: Run verification**
- `bun vitest tests/unit/agent-hub/agent-domain-types.issue205.test.ts tests/unit/services/agent.service.issue205.test.ts tests/unit/services/chat.service.issue205.test.ts tests/unit/adapters/llm/claude-adapter.issue205.test.ts tests/unit/adapters/agent-hub-seed.issue205.test.ts tests/unit/ui/agent-hub/agent-add-node.issue205.test.tsx`
- `bun run test:e2e:issue205`
- `bun run build`

**Step 2: Update PR/Issue comments**
- 计划评论：`docs/pr/issue-205-plan-comment.md`
- 进度评论：`docs/pr/issue-205-progress-comment.md`
- 评审评论：`docs/pr/issue-205-review-comment.md`

**Step 3: Request and perform review（请求并执行评审）**
- 使用 `superpowers:requesting-code-review` 进行评审。
- 若有问题，修复后重跑验证并更新评审评论。

**Step 4: Commit**
- `git add docs/pr/issue-205-progress-comment.md docs/pr/issue-205-review-comment.md docs/pr/issue-205-pr-body.md`
- `git commit -m "docs(agent-hub): add issue-205 pr evidence and review comments"`

---

## GitHub 评论发布流程

1. 计划评论先发 Issue：
   - `bun run gh:comment -- --type issue --number 205 --file docs/pr/issue-205-plan-comment.md`
2. 创建或更新 PR（base `dev`，head `vk/02ad-gh-205-feat-agen`）。
3. 将同一计划评论同步到 PR：
   - `bun run gh:comment -- --type pr --number <PR_NUMBER> --file docs/pr/issue-205-plan-comment.md`
4. 每完成一个 Task，更新 `issue-205-progress-comment.md` 并发 PR 评论。
5. 结束前发布 `issue-205-review-comment.md`（含 findings 与结论）。

---

## Definition of Done

- `Agent/Actor/ChatMessage` 类型与服务层通过单测。
- Claude Adapter 的 `complete + stream` 行为通过单测。
- `/agents` 页面可连续添加“信号输入/输出”节点并有自动化测试证据。
- `vitest + playwright + build` 全通过。
- PR 内有：计划评论、进度评论、最终评审评论；且每个阶段有独立 commit。
