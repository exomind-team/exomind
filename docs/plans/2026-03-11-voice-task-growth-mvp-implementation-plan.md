# Voice Task Growth MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个“用户只管说，系统先接住并整理，再转成当下可执行任务，并在时间块结束后复盘”的最小闭环版本。

**Architecture:** 复用现有 `SignalPool + TaskStore + TimeBlock + Review` 基础设施，不重做整套任务系统。核心做法是新增一个统一输入归一化层，把语音与手动文本收束成统一事件，再用稳定分类协议驱动“任务创建/任务更新/复盘线索”分流，最后把建议与时间块闭环串起来。

**Tech Stack:** Rust (`exomind-runtime`), TypeScript services, SignalPool, TaskStore, PouchDB, React, Tauri.

---

## Product Scope

### In Scope

- 语音输入进入统一后端链路
- 所有输入先落 EventLog
- 输入自动分类为任务/日志/复盘线索/任务补充
- 任务可被创建或动态更新
- 系统给出“现在能做的事项建议”
- 用户从建议中选择任务进入时间块
- 时间块结束后产生复盘结果并回流

### Out of Scope

- 时间块悬浮窗 / 倒计时悬浮体验
- 复杂多 Agent 自治
- 通用看板
- 复杂优先级算法
- 完整知识系统

---

## Minimal Event Model

本次 MVP 建议只收束为以下事件：

1. `voice.input.transcript`
2. `user.input.text`
3. `user.input.normalized`
4. `eventlog.appended`
5. `input.classified`
6. `task.auto-created`
7. `task.updated`
8. `task.created`
9. `timeblock.completed`
10. `review.completed`
11. `focus.suggestions.updated`

### Event Semantics

- `voice.input.transcript`
  - 原始语音转写输入
- `user.input.text`
  - 原始文本输入
- `user.input.normalized`
  - 统一输入入口，供后续 actor 可靠消费
- `eventlog.appended`
  - 已记录进事件日志
- `input.classified`
  - 分类结果，至少包括：
    - `task`
    - `task_update`
    - `log`
    - `review_cue`
- `task.auto-created`
  - 下游任务 actor 的标准输入
- `task.updated`
  - 任务被补充或更新
- `task.created`
  - 新任务落库成功
- `focus.suggestions.updated`
  - 当前时刻可执行建议
- `timeblock.completed`
  - 时间块结束
- `review.completed`
  - 复盘结果已生成

---

## Minimal Task Model

不要把“人的任务系统”和“Agent 的任务系统”完全分开。  
建议用**统一任务池 + 责任 / 阶段字段**表示差异。

### Required Fields

- `id`
- `title`
- `description`
- `status`
- `priority`
- `createdAt`
- `updatedAt`
- `timeBlockIds`
- `source`
- `evidenceRefs`
  - 指向原始 EventLog / Signal
- `ownerMode`
  - `human-owned`
  - `agent-owned`
  - `shared`
- `workMode`
  - `needs-human`
  - `agent-can-prepare`
  - `agent-can-run`
  - `waiting-review`
  - `done`

### Required Behaviours

- 同一输入不要机械地产生新任务
- 如果输入是在补充已有任务，则应追加描述 / 证据
- 任务要能记录“什么时候又被提到”
- Agent 后台执行结果回流后，进入 `waiting-review`

---

## Target Flow

```text
语音输入
  -> 语音信号
  -> 统一输入
  -> EventLog 落库
  -> 分类
  -> 任务创建/更新
  -> 现在能做的事项建议
  -> 用户选任务进入时间块
  -> 时间块完成
  -> review.completed
  -> 回写任务状态 / 下一步建议
```

---

### Task 1: Unified Input Ingest Actor

**Files:**
- Create: `crates/exomind-runtime/src/signal/actors/input_ingest_actor.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/tests/signal_actors_integration.rs`

**Step 1: Write failing tests for unified input ingestion**

Add tests covering:
- `voice.input.transcript -> user.input.normalized`
- `user.input.text -> user.input.normalized`
- trace/id/source preservation

**Step 2: Run the tests to verify they fail**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

Expected:
- no normalized event is produced yet

**Step 3: Implement `input_ingest_actor.rs`**

Behaviour:
- subscribe to bus
- accept `voice.input.transcript` and `user.input.text`
- normalize to `user.input.normalized`
- preserve provenance fields

**Step 4: Register the actor in runtime startup**

Modify:
- `crates/exomind-runtime/src/lib.rs`
- `crates/exomind-runtime/src/signal/actors/mod.rs`

**Step 5: Update default routes**

Change:
- downstream consumers should depend on `user.input.normalized`
- avoid diverging voice/text chains

**Step 6: Re-run tests**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

Expected:
- normalized input tests pass

---

### Task 2: EventLog First, Then Classification

**Files:**
- Modify: `crates/exomind-runtime/src/signal/actors/eventlog_actor.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/src/signal/actors/eventlog_actor.rs`

**Step 1: Write failing tests**

Cover:
- `user.input.normalized -> eventlog.appended`
- `voice.input.transcript` no longer bypasses EventLog-first path

**Step 2: Run tests to verify failure**

Run:

```powershell
cargo test -p exomind-runtime eventlog_actor -- --nocapture
```

**Step 3: Modify `eventlog_actor.rs`**

Change it to consume:
- `user.input.normalized`

Payload expectation:
- normalized text
- input mode
- source

**Step 4: Re-run tests**

Run:

```powershell
cargo test -p exomind-runtime eventlog_actor -- --nocapture
```

Expected:
- EventLog-first chain passes

---

### Task 3: Stable Classification Protocol

**Files:**
- Create: `crates/exomind-runtime/src/signal/actors/classifier_actor.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/tests/signal_actors_integration.rs`

**Step 1: Write failing tests for classification schema**

Cover:
- normalized input classified as `task`
- normalized input classified as `task_update`
- normalized input classified as `log`
- normalized input classified as `review_cue`

**Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

**Step 3: Implement minimal classifier**

Do not build a full LLM classifier yet.

Minimal heuristic rules:
- explicit action / deliverable -> `task`
- mention existing task keywords / update cues -> `task_update`
- reflection / state / narration -> `log`
- “收工 / 总结 / 复盘 / 卡点” -> `review_cue`

**Step 4: Produce stable payload schema**

At minimum:

```json
{
  "type": "task|task_update|log|review_cue",
  "source_text": "...",
  "items": [...]
}
```

**Step 5: Re-run tests**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

Expected:
- classification protocol tests pass

---

### Task 4: Dynamic Task Create / Update Loop

**Files:**
- Modify: `crates/exomind-runtime/src/task/actor.rs`
- Modify: `crates/exomind-runtime/src/task/types.rs`
- Modify: `crates/exomind-runtime/src/task/store.rs`
- Test: `crates/exomind-runtime/src/task/actor.rs`

**Step 1: Write failing tests**

Cover:
- `task` classification creates new task
- `task_update` classification updates existing task
- task stores evidence references
- repeated mention updates description rather than duplicating blindly

**Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test -p exomind-runtime task -- --nocapture
```

**Step 3: Add minimal new fields**

Suggested additions:
- `evidence_refs`
- `last_mentioned_at`
- `owner_mode`
- `work_mode`

Keep it minimal and serializable.

**Step 4: Implement create/update logic**

Minimal policy:
- if payload type is `task` -> create
- if payload type is `task_update` -> update best-matched existing task

**Step 5: Re-run tests**

Run:

```powershell
cargo test -p exomind-runtime task -- --nocapture
```

Expected:
- dynamic task behaviour passes

---

### Task 5: Current Actionable Suggestions

**Files:**
- Create: `crates/exomind-runtime/src/signal/actors/focus_suggestion_actor.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `config/signal-routes.default.json`
- Test: `crates/exomind-runtime/tests/signal_actors_integration.rs`
- Modify: `src/lib/services/signal-handlers.ts`

**Step 1: Write failing tests**

Cover:
- `task.created` / `task.updated` can produce `focus.suggestions.updated`
- suggestion output is scoped to “now”, not “today”

**Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

**Step 3: Implement minimal suggestion actor**

Heuristics can be simple:
- exclude done / abandoned
- prefer in-progress or small, ready tasks
- keep list short
- no complex prioritization engine yet

**Step 4: Surface suggestions to frontend signal handlers**

Extend:
- `src/lib/services/signal-handlers.ts`

**Step 5: Re-run tests**

Run:

```powershell
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

---

### Task 6: TimeBlock Completion -> Review -> Task Update

**Files:**
- Modify: `config/signal-routes.default.json`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `src/lib/services/task-timer.service.ts`
- Modify: `src/lib/services/timeblock.service.ts`
- Test: `tests` or `crates/exomind-runtime/tests` depending on current coverage seam

**Step 1: Write failing tests / verification notes**

Cover:
- task enters timeblock
- `timeblock.completed` triggers review chain
- `review.completed` updates user-facing state

**Step 2: Confirm existing hooks**

Reuse:
- `task-timer.service.ts`
- `timeblock.service.ts`
- `review.completed` signal handler

**Step 3: Add minimal task state handoff**

When review completes:
- update task state or append review result
- generate next-step guidance

**Step 4: Re-run verification**

Run:

```powershell
npx vitest run <relevant tests>
cargo test -p exomind-runtime signal_actors_integration -- --nocapture
```

---

### Task 7: End-to-End Smoke Verification

**Files:**
- Verify only

**Step 1: Run backend verification**

```powershell
cargo test -p exomind-runtime -- --nocapture
```

**Step 2: Run frontend/unit verification relevant to task/timeblock flow**

```powershell
npx vitest run tests/components/VoiceMessageInput.test.tsx
npx vitest run <relevant task/timeblock tests>
```

**Step 3: Manual smoke flow**

Manual scenario:
- speak a task
- confirm eventlog entry
- confirm task create/update
- pick current actionable task
- start timeblock
- end timeblock
- observe review result

**Step 4: Commit**

```powershell
git add crates/exomind-runtime/src/signal/actors/input_ingest_actor.rs crates/exomind-runtime/src/signal/actors/classifier_actor.rs crates/exomind-runtime/src/signal/actors/focus_suggestion_actor.rs crates/exomind-runtime/src/signal/actors/mod.rs crates/exomind-runtime/src/lib.rs crates/exomind-runtime/src/task/actor.rs crates/exomind-runtime/src/task/store.rs crates/exomind-runtime/src/task/types.rs crates/exomind-runtime/src/signal/actors/eventlog_actor.rs config/signal-routes.default.json src/lib/services/signal-handlers.ts src/lib/services/task-timer.service.ts src/lib/services/timeblock.service.ts docs/plans/2026-03-11-voice-task-growth-mvp-implementation-plan.md
git commit -m "feat: build voice-to-task growth MVP loop"
```

