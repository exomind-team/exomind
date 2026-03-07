# Embedded Runtime Agent Host Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让桌面端已启动的内嵌 Runtime（embedded runtime，内嵌运行时）自动成为 Agent Hub 的可用 Runtime 主机，这样无需手动添加主机也能创建、停止并驱动 Claude/Codex/Echo Agent。

**Architecture:** 当前 `runtime_service_status` 与 `runtimeHostSnapshots` 是两条分离链路。推荐方案是不把“内嵌 Runtime 正在运行”仅仅显示在设备页，而是把它统一映射成一个可解析的 host candidate（主机候选），再复用于创建 Agent、停止 Agent、加载路由、运行时对话等入口。优先使用“运行中的内嵌 Runtime 状态”作为临时 host snapshot（ephemeral host snapshot，临时主机快照），避免强制写入持久 host 存储造成重复或脏数据。

**Tech Stack:** React 18 + TypeScript, Tauri v2 commands, RuntimeControlService, RuntimeManager, Vitest, Playwright

---

### Task 1: 固定问题边界与期望行为

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Reference: `src/services/runtime-manager.ts`
- Reference: `src/lib/services/runtime-host.service.ts`
- Reference: `src-tauri/src/commands/runtime_commands.rs`

**Step 1: 记录当前根因**

确认以下事实：
- `handleCreateManualAgent()` 调用 `resolveActiveRuntimeHost()`
- `resolveActiveRuntimeHost()` 只看 `runtimeHostSnapshots`
- `runtimeHostSnapshots` 只来自 `RuntimeManager.refreshSnapshot()`
- `refreshSnapshot()` 只读取 `RuntimeHostService.listHosts()`
- `handleRuntimeStart()` 只更新 `runtimeServiceStatus`，不会注册 host

**Step 2: 定义正确行为**

补充验收条件：
- 只要内嵌 Runtime 状态为 `running`
- 且当前 target mode（目标模式）是 `embedded`
- Agent Hub 就应存在一个可用于 `/agents` 与 `/agents/:id/chat` 的 host candidate

**Step 3: 明确非目标**

本轮不做：
- mesh 自动发现重构
- host 存储模型大改
- 外部 Runtime 的新发现协议

**Step 4: Commit**

```bash
git add docs/plans/2026-03-07-embedded-runtime-agent-host-sync-plan.md
git commit -m "docs: add embedded runtime host sync plan"
```

### Task 2: 设计统一的 embedded host candidate 生成逻辑

**Files:**
- Create: `src/ui/app/pages/agents/runtime-host-resolver.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/AgentConversationPage.tsx`
- Reference: `src/config/runtime-target.ts`

**Step 1: 写失败测试**

新增一个最小测试，表达下面行为：
- `runtimeServiceStatus.running === true`
- `runtimeHostSnapshots` 为空
- `runtimeTargetMode === 'embedded'`
- 仍然能解析出 `127.0.0.1 / 当前 embedded 端口` 作为 host

**Step 2: 跑测试确认失败**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/agents-page.runtime.embedded-host.test.tsx
```

Expected:
- FAIL，原因是当前代码无法从 embedded runtime 状态导出 host

**Step 3: 提取共享 helper**

在共享 helper 中实现：
- `buildEmbeddedRuntimeHostCandidate(...)`
- `resolveRuntimeActionHost(...)`

要求：
- embedded 模式 + running 时，优先返回 embedded host
- 已持久化且 online 的 host 仍可正常参与优先级排序
- 不要求先写入 `agent_runtime_hosts_v1`

**Step 4: 跑测试确认通过**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/agents-page.runtime.embedded-host.test.tsx
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/agents/runtime-host-resolver.ts tests/unit/ui/agent-hub/agents-page.runtime.embedded-host.test.tsx src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/agents/AgentConversationPage.tsx
git commit -m "feat: resolve embedded runtime host for agent hub actions"
```

### Task 3: 接通创建 / 停止 / 路由加载入口

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/services/runtime-manager.ts`
- Test: `tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx`
- Test: `tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts`

**Step 1: 写失败测试**

覆盖以下行为：
- 无手动 host 配置时，点击 Start 让内嵌 Runtime 变成 `running`
- 点击 Add Node 创建 Echo / Claude / Codex 时，走内嵌 Runtime host
- Stop Agent 时，能命中同一 host

**Step 2: 跑测试确认失败**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts --config tests/e2e/playwright.issue385.config.ts
```

Expected:
- 至少一条 FAIL，说明当前“running 但无 host”仍不可用

**Step 3: 写最小实现**

实现点：
- `handleCreateManualAgent()` 改用统一 host resolver
- `handleStopAgent()` 在 host list 为空时也能 fallback 到 embedded runtime candidate
- `refreshSignalRoutesFromSnapshot()` 也可消费该 candidate，减少“运行中但空白”割裂感

**Step 4: 跑测试确认通过**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx
node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts --config tests/e2e/playwright.issue385.config.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/AgentsPage.tsx src/services/runtime-manager.ts tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts
git commit -m "fix: allow embedded runtime to create and stop agents"
```

### Task 4: 做完整回归并检查文案

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.runtime-chat.issue365.test.tsx`

**Step 1: 校正文案**

如果 host 解析失败，给出更准确的错误：
- 优先区分“内嵌 Runtime 未启动”
- 和“有 host 记录但全部离线”

**Step 2: 跑完整验证**

Run:

```bash
npx tsc --noEmit
npx vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.runtime.issue201.test.tsx tests/unit/ui/agent-hub/agents-page.runtime-chat.issue365.test.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx
node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.runtime-claude-codex.issue385.test.ts --config tests/e2e/playwright.issue385.config.ts
```

Expected:
- 全部 PASS

**Step 3: Commit**

```bash
git add src/ui/app/pages/AgentsPage.tsx tests/unit/ui/agent-hub/agent-conversation.runtime.issue385.test.tsx tests/unit/ui/agent-hub/agents-page.runtime-chat.issue365.test.tsx
git commit -m "test: cover embedded runtime host fallback"
```
