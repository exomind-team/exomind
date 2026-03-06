# Agent Hub Voice Signal Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `voice.input.transcript`（语音转写信号）接入 Agent Hub 的 signal network（信号网络），让语音输入既能发布为真实 signal，也能在拓扑图中显示为 input node（输入节点）。

**Architecture:** 新增一个轻量 `voice-signal service（语音信号服务）`，把 ASR 识别结果发布到 runtime 的 `/signals/publish`。Agent Hub 侧扩展 `SignalGraph`，对 `voice.input.transcript` 生成 `input -> topic -> target` 的可视化链路，并在路由编辑可选 topic 中显式暴露该主题。

**Tech Stack:** React 18 + TypeScript, Vitest, Playwright, `@xyflow/react`, existing `SignalStreamService`.

---

### Task 1: 定义语音信号常量

**Files:**
- Create: `src/lib/constants/signal-topics.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents-signal-topology.ts`

**Step 1: Write the failing test**
- 在 `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts` 断言 `voice.input.transcript` 会生成 `input:voice` 节点与上游边。

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- Expected: FAIL，提示没有 `input` 节点类型或缺少语音输入节点。

**Step 3: Write minimal implementation**
- 新建共享常量，扩展 `SignalGraphNodeType` 为 `input | topic | agent | actor | frontend`。
- 对 `voice.input.transcript` 注入 `input:voice` 节点与 `input -> topic` 边。

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- Expected: PASS

### Task 2: 发布语音信号到 runtime

**Files:**
- Create: `src/lib/services/voice-signal.service.ts`
- Modify: `src/components/VoiceInputButton.tsx`
- Test: `tests/unit/services/voice-signal.service.test.ts`

**Step 1: Write the failing test**
- 为 `publishVoiceTranscriptSignal()` 写测试，断言会发布 `voice.input.transcript` 与兼容主题 `user.input.text`。

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/unit/services/voice-signal.service.test.ts`
- Expected: FAIL，函数不存在或未发布双主题。

**Step 3: Write minimal implementation**
- 基于 `getSelectedRuntimeTarget()` + `SignalStreamService.publish()` 发布信号。
- 在 `VoiceInputButton` 识别成功后异步调用该服务，不阻塞原有 `onResult` 行为。

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/unit/services/voice-signal.service.test.ts`
- Expected: PASS

### Task 3: 更新 Agent Hub 页面与验收测试

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/components/RouteEditPanel.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Modify: `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`

**Step 1: Write the failing test**
- 让页面测试和 E2E fixture 含 `voice.input.transcript`，断言拓扑中可见语音输入节点。

**Step 2: Run test to verify it fails**
- Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Expected: FAIL，页面尚未渲染 `input` 节点。

**Step 3: Write minimal implementation**
- 扩展节点颜色/样式与右侧详情 badge。
- 在 `availableTopics` 中加入已知语音主题，并更新 route editor 提示。

**Step 4: Run test to verify it passes**
- Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Expected: PASS

### Task 4: 验证与收尾

**Files:**
- Modify: `tests/e2e/agent-hub.signal-routes.issue245f.test.ts`

**Step 1: Run focused test set**
- Run: `npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/services/voice-signal.service.test.ts`

**Step 2: Run type check for touched surface**
- Run: `npx tsc --noEmit`

**Step 3: Optional E2E verification**
- Run: `node Scripts/test/playwright-runner.cjs test tests/e2e/agent-hub.signal-routes.issue245f.test.ts --config tests/e2e/playwright.issue245f.config.ts`

**Step 4: Summarize evidence**
- 记录变更文件、测试命令、结果与剩余限制（例如 runtime 需实际创建 voice route 才能在真实环境看到完整链路）。
