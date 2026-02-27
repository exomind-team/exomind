# Issue-205 P0 RuntimeHost Acceptance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent Hub 在桌面端交付可观察的真实闭环：信号池可真实读写、Agent 节点可进入真实对话、网络可显示真实在线状态。

**Architecture:** 采用 `UI -> AgentHubService -> RuntimeHost/Signal/Chat Adapter -> Storage/Tauri Commands` 分层。P0 阶段优先打通真实链路并固化可验收现象，P1 复杂能力（健康面板/调度策略）拆分到独立 PR。

**Tech Stack:** React + TypeScript + Zustand + Tauri v2 Commands + Bun + Vitest + Playwright + EventLog/PouchDB.

---

### Task 1: 定义 P0 验收契约（Acceptance Contracts）

**Files:**
- Modify: `src/lib/types/agent-hub.ts`
- Create: `tests/unit/agent-hub/issue205-p0-acceptance-contract.test.ts`

**Step 1: Write the failing test**
- 断言必须包含：
  - Signal 读写结果结构（success/error + payload）
  - Agent 实时对话流结构（messageId/delta/done/source）
  - RuntimeHost 在线状态结构（online/offline/warning + updatedAt）

**Step 2: Run test to verify it fails**
- Run: `bun vitest tests/unit/agent-hub/issue205-p0-acceptance-contract.test.ts`
- Expected: FAIL（类型未定义或字段缺失）

**Step 3: Write minimal implementation**
- 在类型层新增/扩展 P0 所需契约。

**Step 4: Run test to verify it passes**
- Run: `bun vitest tests/unit/agent-hub/issue205-p0-acceptance-contract.test.ts`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/types/agent-hub.ts tests/unit/agent-hub/issue205-p0-acceptance-contract.test.ts`
- `git commit -m "test(issue-205): add p0 acceptance contracts for real signal chat and status"`

---

### Task 2: 信号池真实读写闭环（Real Signal Read/Write）

**Files:**
- Create: `src/lib/services/signal.service.ts`
- Modify: `src/lib/services/agent-hub.service.ts`
- Modify: `src/ui/new/pages/AgentsPage.tsx`
- Test: `tests/unit/services/signal.service.issue205.test.ts`
- Test: `tests/unit/ui/agent-hub/signal-pool-read-write.issue205.test.tsx`

**Step 1: Write the failing tests**
- 单测：写入信号后可读回，且持久化后刷新不丢失。
- UI 测试：点击信号节点可触发写入和读取，页面展示回显。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/services/signal.service.issue205.test.ts tests/unit/ui/agent-hub/signal-pool-read-write.issue205.test.tsx`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 先接入真实存储（EventLog/StoragePort），UI 增加最小可见反馈。

**Step 4: Run tests to verify they pass**
- Run: `bun vitest tests/unit/services/signal.service.issue205.test.ts tests/unit/ui/agent-hub/signal-pool-read-write.issue205.test.tsx`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/signal.service.ts src/lib/services/agent-hub.service.ts src/ui/new/pages/AgentsPage.tsx tests/unit/services/signal.service.issue205.test.ts tests/unit/ui/agent-hub/signal-pool-read-write.issue205.test.tsx`
- `git commit -m "feat(agent-hub): implement real signal pool read write flow for p0"`

---

### Task 3: Agent 真实对话链路（Real Agent Chat）

**Files:**
- Create: `src/lib/adapters/agent-runtimehost-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/lib/services/agent-hub.service.ts`
- Modify: `src/ui/new/pages/agents/AgentConversationPage.tsx`
- Test: `tests/unit/adapters/agent-runtimehost-adapter.issue205.test.ts`
- Test: `tests/unit/ui/agent-hub/agent-real-chat.issue205.test.tsx`

**Step 1: Write the failing tests**
- 断言 `streamConversation` 来源为 runtime-host，而非 placeholder。
- 断言对话历史刷新后仍可恢复。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/adapters/agent-runtimehost-adapter.issue205.test.ts tests/unit/ui/agent-hub/agent-real-chat.issue205.test.tsx`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 新增 runtime-host chat adapter，并在环境 bootstrap 中启用。

**Step 4: Run tests to verify they pass**
- Run: `bun vitest tests/unit/adapters/agent-runtimehost-adapter.issue205.test.ts tests/unit/ui/agent-hub/agent-real-chat.issue205.test.tsx`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/adapters/agent-runtimehost-adapter.ts src/lib/environment/bootstrap.ts src/lib/services/agent-hub.service.ts src/ui/new/pages/agents/AgentConversationPage.tsx tests/unit/adapters/agent-runtimehost-adapter.issue205.test.ts tests/unit/ui/agent-hub/agent-real-chat.issue205.test.tsx`
- `git commit -m "feat(agent-hub): wire real runtimehost chat stream for p0"`

---

### Task 4: 在线状态真实化（Real Online Status）

**Files:**
- Create: `src/lib/services/runtime-host-health.service.ts`
- Modify: `src/lib/services/agent-hub.service.ts`
- Modify: `src/ui/new/pages/AgentsPage.tsx`
- Test: `tests/unit/services/runtime-host-health.issue205.test.ts`
- Test: `tests/unit/ui/agent-hub/runtime-status.issue205.test.tsx`

**Step 1: Write the failing tests**
- 心跳 TTL 到期后在线状态应从 online -> offline。
- 页面状态徽标需跟随真实状态变化。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/services/runtime-host-health.issue205.test.ts tests/unit/ui/agent-hub/runtime-status.issue205.test.tsx`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 实现探测 + TTL 状态机，并把状态注入 DeviceView/Topology。

**Step 4: Run tests to verify they pass**
- Run: `bun vitest tests/unit/services/runtime-host-health.issue205.test.ts tests/unit/ui/agent-hub/runtime-status.issue205.test.tsx`
- Expected: PASS

**Step 5: Commit**
- `git add src/lib/services/runtime-host-health.service.ts src/lib/services/agent-hub.service.ts src/ui/new/pages/AgentsPage.tsx tests/unit/services/runtime-host-health.issue205.test.ts tests/unit/ui/agent-hub/runtime-status.issue205.test.tsx`
- `git commit -m "feat(agent-hub): add runtimehost heartbeat ttl online status for p0"`

---

### Task 5: Tauri 托管命令 + 设置页联动

**Files:**
- Create: `src-tauri/src/commands/runtime_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/ui/new/pages/NewSettingsPage.tsx`
- Test: `tests/unit/tauri/runtime-commands.issue205.test.ts`
- Test: `tests/unit/settings/new-settings-runtime-config.issue205.test.tsx`

**Step 1: Write the failing tests**
- 命令注册测试：`runtime_service_start/stop/status` 必须可调用。
- 设置页配置保存后能触发状态刷新。

**Step 2: Run tests to verify they fail**
- Run: `bun vitest tests/unit/tauri/runtime-commands.issue205.test.ts tests/unit/settings/new-settings-runtime-config.issue205.test.tsx`
- Expected: FAIL

**Step 3: Write minimal implementation**
- 落地运行时命令并接入设置页。

**Step 4: Run tests to verify they pass**
- Run: `bun vitest tests/unit/tauri/runtime-commands.issue205.test.ts tests/unit/settings/new-settings-runtime-config.issue205.test.tsx`
- Expected: PASS

**Step 5: Commit**
- `git add src-tauri/src/commands/runtime_commands.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/ui/new/pages/NewSettingsPage.tsx tests/unit/tauri/runtime-commands.issue205.test.ts tests/unit/settings/new-settings-runtime-config.issue205.test.tsx`
- `git commit -m "feat(tauri): add runtime service commands and settings integration for p0"`

---

### Task 6: P0 端到端验收与发布证据

**Files:**
- Create: `tests/e2e/agent-runtimehost-p0.issue205.test.ts`
- Create: `tests/e2e/playwright.issue205.config.ts`
- Create: `docs/pr/issue-205-progress-comment.md`
- Create: `docs/pr/issue-205-review-comment.md`

**Step 1: Write the failing e2e test**
- 场景 1：信号写入并读回。
- 场景 2：点击 Agent 节点进入对话页并收到真实回复。
- 场景 3：模拟主机断连后状态变更。

**Step 2: Run test to verify it fails**
- Run: `bun run test:e2e:issue205`
- Expected: FAIL

**Step 3: Write minimal implementation/fixes**
- 修复 E2E 阻塞点直到通过。

**Step 4: Run full verification**
- Run: `bun vitest`
- Run: `bun run test:e2e:issue205`
- Run: `bun run build`
- Expected: ALL PASS

**Step 5: Commit**
- `git add tests/e2e/agent-runtimehost-p0.issue205.test.ts tests/e2e/playwright.issue205.config.ts docs/pr/issue-205-progress-comment.md docs/pr/issue-205-review-comment.md`
- `git commit -m "test(issue-205): add p0 e2e acceptance and review evidence"`

---

## P1 拆分原则（独立 PR）
以下内容不并入本 PR，另开 PR 跟踪：
1. Agent 级详细健康面板（token/cost/latency）。
2. 多 RuntimeHost 调度与故障转移。
3. 高级信号路由策略（重试、回放、优先级）。
4. 多模型路由与成本优化。
