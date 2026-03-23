# Issue 511 Voice Input Normalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将所有语音输入入口统一到同一条 normalized input（归一化输入）链路，并补齐上下文元数据与 EventLog 持久化能力，为后续 `#326 / #480 / #502` 提供稳定基础层。

**Architecture:** 采用“raw topic（原始主题）保留 + normalized topic（归一化主题）统一消费”的双层模型。前端所有语音入口都先产出统一的 `NormalizedInputEnvelope`，再进入 `voice.input.transcript -> user.input.normalized -> eventlog.appended -> input.classified` 路径；同时补上 EventLog metadata 端到端持久化，以及 ExoMind 内部 Agent context / 外部窗口 context 的采集与表达。

**Tech Stack:** React 18 + TypeScript, Tauri v2, Rust (`exomind-runtime`), Vitest, Cargo test

---

### Task 1: 定义统一语音输入 envelope 与前端发布契约

**Files:**
- Create: `src/lib/types/normalized-input.ts`
- Modify: `src/lib/constants/signal-topics.ts`
- Modify: `src/lib/services/voice-signal.service.ts`
- Test: `tests/unit/services/voice-signal.service.test.ts`

**Step 1: Write the failing test**

在 `tests/unit/services/voice-signal.service.test.ts` 先增加断言：
- 语音发布除 `voice.input.transcript` 外，还会发布 `user.input.normalized`
- normalized payload 含 `inputMode`、`captureSource`、`traceId`
- 支持可选 `window` / `agentContext` 字段

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/voice-signal.service.test.ts`

Expected:
- FAIL，提示只发布了单一 topic 或 payload 缺少 normalized 字段

**Step 3: Write minimal implementation**

- 在 `src/lib/types/normalized-input.ts` 定义：
  - `InputMode`
  - `TargetScope`
  - `WindowContext`
  - `AgentInteractionContext`
  - `NormalizedInputEnvelope`
- 在 `src/lib/constants/signal-topics.ts` 新增：
  - `USER_INPUT_NORMALIZED_TOPIC`
- 在 `src/lib/services/voice-signal.service.ts`：
  - 扩展 options，允许传入 `captureSource / window / agentContext / targetScope`
  - 先发布 `voice.input.transcript`
  - 再发布 `user.input.normalized`
  - 两个 topic 共享同一个 `traceId`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/voice-signal.service.test.ts`

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/lib/types/normalized-input.ts src/lib/constants/signal-topics.ts src/lib/services/voice-signal.service.ts tests/unit/services/voice-signal.service.test.ts
git commit -m "feat(voice): add normalized input envelope"
```

### Task 2: 在 RT 中引入 normalized input 路径并切换 EventLog-first 消费

**Files:**
- Create: `crates/exomind-runtime/src/signal/actors/input_ingest_actor.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/eventlog_actor.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/tests/signal_actors_integration.rs`

**Step 1: Write the failing test**

在 `crates/exomind-runtime/tests/signal_actors_integration.rs` 增加断言：
- `voice.input.transcript -> user.input.normalized`
- `user.input.text -> user.input.normalized`
- `user.input.normalized -> eventlog.appended`
- `trace_id / source / input_mode` 保持可追踪

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind-runtime signal_actors_integration -- --nocapture`

Expected:
- FAIL，提示不存在 normalized event，或 `eventlog_actor` 仍只消费 `user.input.text`

**Step 3: Write minimal implementation**

- 新增 `input_ingest_actor.rs`
  - 订阅 `voice.input.transcript` 与 `user.input.text`
  - 统一发布 `user.input.normalized`
- 修改 `eventlog_actor.rs`
  - 改为消费 `user.input.normalized`
  - 在 `eventlog.appended` payload 中保留必要 provenance（来源）字段
- 修改默认路由
  - 下游优先依赖 `user.input.normalized`

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind-runtime signal_actors_integration -- --nocapture`

Expected:
- PASS

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/signal/actors/input_ingest_actor.rs crates/exomind-runtime/src/signal/actors/mod.rs crates/exomind-runtime/src/lib.rs crates/exomind-runtime/src/signal/actors/eventlog_actor.rs config/signal-routes.default.json crates/exomind-runtime/tests/signal_actors_integration.rs
git commit -m "feat(rt): normalize input before eventlog consumption"
```

### Task 3: 打通 EventLog metadata 端到端持久化

**Files:**
- Modify: `src/lib/types/event.ts`
- Modify: `src/lib/services/eventlog.service.ts`
- Modify: `src/lib/adapters/web-eventlog-storage.ts`
- Modify: `src/lib/adapters/tauri-eventlog-storage.ts`
- Modify: `src-tauri/src/commands/eventlog_commands.rs`
- Test: `tests/unit/eventlog/tauri-eventlog-invoke.test.ts`
- Test: `tests/unit/eventlog/eventlog-port-contract.test.ts`

**Step 1: Write the failing test**

增加断言：
- append 一个带 `metadata.voiceContext` 的事件后，Tauri adapter 读取回来仍有 metadata
- `windowTitle / processName / agentId / sessionId / traceId` 不在落库时丢失

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/eventlog/tauri-eventlog-invoke.test.ts tests/unit/eventlog/eventlog-port-contract.test.ts`

Expected:
- FAIL，提示 Tauri EventLog 结构未保存 metadata

**Step 3: Write minimal implementation**

- 在 `src/lib/types/event.ts` 扩展 metadata 类型，加入语音上下文字段
- 在 `src-tauri/src/commands/eventlog_commands.rs` 的 `EventRecord` 中补 `metadata`
- 同步更新 list/get/append/clear 的 serde（序列化 / 反序列化）结构
- 保证 Web / Tauri 两条存储适配器都不丢 metadata

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/eventlog/tauri-eventlog-invoke.test.ts tests/unit/eventlog/eventlog-port-contract.test.ts`

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/lib/types/event.ts src/lib/services/eventlog.service.ts src/lib/adapters/web-eventlog-storage.ts src/lib/adapters/tauri-eventlog-storage.ts src-tauri/src/commands/eventlog_commands.rs tests/unit/eventlog/tauri-eventlog-invoke.test.ts tests/unit/eventlog/eventlog-port-contract.test.ts
git commit -m "feat(eventlog): persist normalized voice metadata"
```

### Task 4: 建立 active interaction context 与前台窗口上下文采集

**Files:**
- Create: `src/lib/services/active-interaction-context.service.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/AgentConversationPage.tsx`
- Modify: `src-tauri/src/commands/shortcut_commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/unit/services/active-interaction-context.service.test.ts`
- Test: `tests/unit/services/voice-shortcut.service.test.ts`

**Step 1: Write the failing test**

增加断言：
- 打开 Agent Chat 时，可写入当前 `agentId / sessionId / targetScope`
- 全局语音完成时，会尝试读取当前交互上下文
- 在无内部 Agent 上下文时，会回退到外部窗口上下文

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/active-interaction-context.service.test.ts tests/unit/services/voice-shortcut.service.test.ts`

Expected:
- FAIL，提示不存在 interaction context service，或语音快捷键未读取上下文

**Step 3: Write minimal implementation**

- 新建 `active-interaction-context.service.ts`
  - 负责保存当前内部交互目标
- 在 `AgentsPage.tsx` / `AgentConversationPage.tsx`
  - 进入 Agent Chat 时写入 `agentId / sessionId`
  - 关闭时清空
- 在 Tauri `shortcut_commands.rs`
  - 新增获取 foreground window title / process name 的 command
- 在语音服务中读取：
  - 先读内部 `active interaction context`
  - 读不到时再读原生窗口上下文

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/active-interaction-context.service.test.ts tests/unit/services/voice-shortcut.service.test.ts`

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/lib/services/active-interaction-context.service.ts src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/agents/AgentConversationPage.tsx src-tauri/src/commands/shortcut_commands.rs src-tauri/src/lib.rs tests/unit/services/active-interaction-context.service.test.ts tests/unit/services/voice-shortcut.service.test.ts
git commit -m "feat(context): capture agent and window context for voice input"
```

### Task 5: 统一所有语音入口到 normalized chain，并补回归验证

**Files:**
- Modify: `src/services/voice-shortcut.service.ts`
- Modify: `src/components/VoiceMessageInput.tsx`
- Modify: `src/components/VoiceInputButton.tsx`
- Modify: `tests/unit/services/voice-shortcut.service.test.ts`
- Modify: `tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx`
- Modify: `tests/unit/services/voice-signal.service.test.ts`

**Step 1: Write the failing test**

增加断言：
- 全局语音快捷键完成后不再只写 EventLog，而是进入 normalized chain
- 应用内语音输入与全局语音快捷键共享同样的 envelope 结构
- Agent Hub 现有语音节点 / 主题视图不回退

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts tests/unit/services/voice-signal.service.test.ts tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx`

Expected:
- FAIL，提示全局快捷键仍为旧链路，或 normalized context 未被透传

**Step 3: Write minimal implementation**

- 修改 `voice-shortcut.service.ts`
  - 在识别成功后构造 normalized envelope
  - 发布到统一链路
  - EventLog 直写改为写带完整 metadata 的事件，且不与 signal 语义冲突
- 修改 `VoiceMessageInput.tsx` / `VoiceInputButton.tsx`
  - 统一调用新的发布接口

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/voice-shortcut.service.test.ts tests/unit/services/voice-signal.service.test.ts tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx`

Expected:
- PASS

**Step 5: Commit**

```bash
git add src/services/voice-shortcut.service.ts src/components/VoiceMessageInput.tsx src/components/VoiceInputButton.tsx tests/unit/services/voice-shortcut.service.test.ts tests/unit/services/voice-signal.service.test.ts tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx
git commit -m "feat(voice): unify shortcut and in-app voice pipelines"
```

### Task 6: 总体验证、Issue/PR 同步与收尾

**Files:**
- Modify: `docs/plans/2026-03-13-issue-511-voice-input-normalization-plan.md`

**Step 1: Run focused validation**

Run:

```bash
npx vitest run tests/unit/services/voice-signal.service.test.ts tests/unit/services/voice-shortcut.service.test.ts tests/unit/services/active-interaction-context.service.test.ts tests/unit/eventlog/tauri-eventlog-invoke.test.ts tests/unit/eventlog/eventlog-port-contract.test.ts tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx
```

Expected:
- PASS

**Step 2: Run type check**

Run:

```bash
bunx tsc --noEmit
```

Expected:
- PASS

**Step 3: Run runtime-side verification**

Run:

```bash
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

Expected:
- PASS

**Step 4: Optional web-first live check**

Run:

```bash
npx vite --host 0.0.0.0 --port 5175
```

Expected:
- Web app starts on isolated worktree port without disturbing `dev`

**Step 5: Update issue and prepare PR**

- 在 `#511` 评论同步：
  - 变更摘要
  - 测试命令
  - 结果证据
  - 剩余限制
- 发起单一 PR 指向 `dev`

**Step 6: Commit**

```bash
git add docs/plans/2026-03-13-issue-511-voice-input-normalization-plan.md
git commit -m "docs: add issue 511 implementation plan"
```
