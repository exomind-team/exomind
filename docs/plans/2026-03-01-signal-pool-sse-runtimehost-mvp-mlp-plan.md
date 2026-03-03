# SignalPool SSE RuntimeHost Relay MVP/MLP Implementation Plan

> **执行提示词（Prompt，给执行 Agent）**
>
> 你是 ExoMind 的执行 Agent（Execution Agent，执行代理）。请严格按本计划逐任务推进，遵循 `TDD (Test-Driven Development，测试驱动开发)` 和 `Small Commits（小步提交）`。
>
> 执行约束：
> 1. 先写失败测试，再写最小实现，再跑通过测试。
> 2. 每个 Task 完成后都要输出证据：`命令（command，命令）+ 结果（result，结果）+ 风险（risk，风险）`。
> 3. 不做计划外功能（YAGNI，避免过度设计）。
> 4. 所有 `Signal` 语义使用 `at-most-once（最多一次投递）`。
> 5. 失败投递必须写入 `SignalJournal（信号日志）`，并反映到节点状态。
> 6. MVP 安全边界仅本机/LAN；默认 `127.0.0.1`，可通过参数切 `0.0.0.0`。
>
> 输出要求：
> - 任何接口字段必须保持中英注释（English key + 中文释义）。
> - 每个阶段结束都给可验收清单（Acceptance Checklist，验收清单）。
>
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 1 周内落地 `SignalPool（信号池）` 的可运行 MVP：支持本地发布订阅、SSE 实时订阅、RuntimeHost Relay（中继）、Agent Hub 在线改路由、录音→ASR→交互→EventLog→任务/时间块反思的可观察闭环；并保留向 MLP 扩展的接口边界。

**Architecture:** 采用 `SignalPool = SignalBus + SignalRouteTable + SignalJournal + SignalWindowCache` 四件套架构。`SignalBus` 负责 `publish/subscribe` 分发；`SignalRouteTable` 负责可视化路由配置；`SignalJournal` 负责投递审计（成功/失败/跳过）；`SignalWindowCache` 负责 1000 条内存环形缓存。后端核心放在 Rust Runtime（RT，运行时），前端 TypeScript 仅做 SDK 与可视化控制台。

**Tech Stack:** Rust (Axum + Tokio + SSE) + Tauri v2 + React 18 + TypeScript + `@xyflow/react`（React Flow）+ Vitest + Playwright。

---

## 0. 决策冻结（Decision Freeze，冻结项）

1. 投递语义：`at-most-once（最多一次）`。
2. 记忆模型：`Agent 私有记忆 + 共享知识空间 + EventLog 投影` 多层记忆。
3. 并发策略：不做业务并发上限；保留工程保护（timeout/cancel/queue health）。
4. 失败策略：失败写 `SignalJournal`，并在 Hub 标注节点 `warning/offline`。
5. 网络边界：MVP 仅本机/LAN，默认 `127.0.0.1`，可配置 `0.0.0.0`。
6. Hub 画布：使用 `@xyflow/react`。
7. 缓存窗口：`SignalWindowCache` 固定容量 `1000` 条（Ring Buffer，环形队列）。
8. SSE 形态：`GET /signals/stream` 下行 + `POST /signals/publish` 上行。

---

## 1. 术语与职责边界（Concept Boundary，概念边界）

### 1.1 SignalPool（信号池）组成

1. `SignalBus（信号总线）`
- 职责：发布订阅与 fanout（扇出）分发。
- 不负责：持久化、可视化、业务解释。

2. `SignalRouteTable（信号路由表）`
- 职责：topic 到 target（目标）的映射；支持在线增删改。
- target 类型：`agent-local | agent-remote | actor-local | port`。

3. `SignalJournal（信号日志）`
- 职责：记录每条信号的投递轨迹（delivery attempts，投递尝试）。
- 用途：故障排查、Hub 状态可视化、验收证据。

4. `SignalWindowCache（信号窗口缓存）`
- 职责：保留最近 1000 条信号用于 SSE 重放与热点读取。
- 结构：内存环形队列（in-memory ring buffer）。

### 1.2 与 EventLog 的关系

1. `EventLog` 是用户事实流（what happened）。
2. `SignalJournal` 是系统传输流（how delivered）。
3. 白名单主题投影到 EventLog（projection，投影），避免日志噪声。

---

## 2. 目标事件链路（Target Flow，目标流）

1. `audio.recording.completed`（录音结束）
- 同时触发 `RecorderSaveActor` 与 `ASRRouterPort`。

2. `audio.saved`（录音已保存）
- 可供审计与回放。

3. `asr.transcript.completed`（转写完成）
- 触发 `InteractionAgent`（人机交互代理，带 TTS 能力）。

4. `interaction.reply.ready`（交互初稿）
- 触发润色校对 Agent。

5. `interaction.reply.polished`（润色结果 a）
- 触发 EventLog 卡片更新；同时触发任务拆分/目标/心理理解 Agent。

6. `task.decompose.completed`（任务拆分完成）
- 触发任务系统更新。

7. `task.completed`（任务完成）
- 触发 `timeblock.reflect.requested`（时间块反思请求）。

8. `timeblock.reflect.completed`（时间块反思完成）
- 回写 EventLog 与 Agent Hub 状态。

9. `eventlog.explore.tick`（主动探索定时信号）
- 触发 Explorer Agent 主动检索 EventLog。

---

## 3. 数据契约（Contracts，字段契约）

### 3.1 SignalEvent

```ts
export interface SignalEvent<T = unknown> {
  schemaVersion: 1; // 协议版本（schema version）
  id: string; // 信号ID（event id）
  topic: string; // 主题（topic）
  ts: number; // 事件时间戳（timestamp ms）
  source: string; // 来源（ui/asr/agent-x）
  originHostId: string; // 源主机ID（origin host）
  hop: number; // 中继跳数（hop count）
  traceId?: string; // 追踪ID（trace id）
  payload: T; // 负载（payload）
}
```

### 3.2 SignalRoute

```ts
export interface SignalRoute {
  id: string; // 路由ID
  enabled: boolean; // 是否启用
  topic: string; // 匹配主题（首版精确匹配）
  targetType: 'agent-local' | 'agent-remote' | 'actor-local' | 'port';
  targetRef: string; // 目标引用（如 agentId / hostId:agentId）
  createdAt: string; // 创建时间 ISO
  updatedAt: string; // 更新时间 ISO
}
```

### 3.3 DeliveryRecord

```ts
export interface DeliveryRecord {
  eventId: string; // 对应 SignalEvent.id
  routeId: string; // 命中路由ID
  targetRef: string; // 投递目标
  status: 'sent' | 'failed' | 'skipped'; // 投递状态
  reason?: string; // 失败/跳过原因
  startedAt: string; // 投递开始时间
  finishedAt: string; // 投递结束时间
}
```

### 3.4 节点状态映射（Node Status Mapping）

1. `running`：最近窗口内投递成功且健康。
2. `idle`：无新投递。
3. `warning`：存在失败但系统仍可用。
4. `offline`：目标不可达或持续失败。

---

## 4. API 设计（SSE + Publish，接口设计）

### 4.1 Runtime APIs

1. `POST /signals/publish`
- 输入：`SignalEvent`。
- 行为：写入 `SignalWindowCache` -> 查 `SignalRouteTable` -> fanout -> 写 `SignalJournal`。
- 返回：`{ accepted: true, eventId }`。

2. `GET /signals/stream?topics=...`
- 类型：`text/event-stream`。
- 支持：`Last-Event-ID` 重放（最多 1000 条窗口内）。
- SSE event 类型：`signal`, `delivery`, `heartbeat`。

3. `GET /signals/history?limit=...`
- 返回最近日志，支持前端审计面板。

4. `GET /signal-routes`
5. `POST /signal-routes`
6. `PUT /signal-routes/:id`
7. `DELETE /signal-routes/:id`

### 4.2.1 安全头（MVP 可选）

1. 支持可选请求头：`X-Exomind-Token`（共享令牌，shared token）。
2. 默认本机开发可关闭；LAN 联调建议开启。
3. token 校验失败写入 `SignalJournal`，状态记为 `failed`。

### 4.3 Relay 规则

1. `hopLimit = 2`（超过跳数标记 `skipped`）。
2. `seenCache` 去重：按 `event.id` 做短期去重。
3. 无重试（符合 at-most-once）。

---

## 5. 存储分层（Storage Scope，存储范围）

1. 持久化：`SignalRouteTable`、`SignalJournal`。
2. 非持久化：`SignalWindowCache`（内存 1000 条）。
3. EventLog 仅接收白名单投影主题。

建议存储键：
- `signal_routes_v1`
- `signal_journal_v1`

---

## 6. 内嵌 RT 设计（Embedded Runtime，内嵌运行时）

### 6.1 两种模式

1. `remote mode（远端模式）`
- 手机/桌面前端连接独立 RT Host（优先用于 MVP）。

2. `embedded mode（内嵌模式）`
- 在 Tauri Rust 后端内 `spawn` RT 服务任务。

### 6.2 一周内策略

1. 先完成 `remote mode` 全链路。
2. `embedded mode` 先保留接口与开关，不承诺后台长驻。

---

## 7. Agent Hub 可视化（@xyflow/react）

### 7.1 节点类型

1. `source`（GitHub/RSS/API/Recorder）
2. `port`（ASR/TTS/Task/EventLog/Storage）
3. `agent`（Interaction/Polish/Task/Psych/Explorer）
4. `actor`（SaveAudio/TimeblockReflect）
5. `output`（EventLogCard/Telegram/WeChat）
6. `bridge`（Browser Extension — 双向信号桥接，既是 source 也是 output）

### 7.2 在线改路由能力（第一周）

1. 创建/删除节点。
2. 连线创建 route。
3. 编辑 topic 与 targetRef。
4. 启用/停用 route。
5. 查看每条 route 的最近失败原因。

---

## 8. 一周实施计划（2026-03-01 ~ 2026-03-07）

### Task 1: 契约与测试骨架

**Files:**
- Create: `src/lib/types/signal-pool.ts`
- Create: `tests/unit/signal-pool/contracts.signal-pool.test.ts`

**验收:**
- 字段契约固定（schemaVersion/hop/traceId/status）。

### Task 2: Rust RT 增加 SignalPool 核心

**Files:**
- Create: `crates/exomind-runtime/src/signal/mod.rs`
- Create: `crates/exomind-runtime/src/signal/bus.rs`
- Create: `crates/exomind-runtime/src/signal/journal.rs`
- Create: `crates/exomind-runtime/src/signal/routes.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`

**验收:**
- 本地 publish/subscribe 可工作。
- 1000 条 ring buffer 生效。

### Task 3: RT 增加 SSE + Publish API

**Files:**
- Create: `crates/exomind-runtime/src/routes/signals.rs`
- Modify: `crates/exomind-runtime/src/routes/mod.rs`

**验收:**
- `POST /signals/publish` 可写入。
- `GET /signals/stream` 可实时推送 + Last-Event-ID 重放。

### Task 4: Relay 中继与防环

**Files:**
- Create: `crates/exomind-runtime/src/signal/relay.rs`
- Test: `crates/exomind-runtime/tests/signal_relay.rs`

**验收:**
- hop 限制生效。
- 去重有效。
- at-most-once 语义成立（无自动重试）。

### Task 5: 前端 Signal SDK

**Files:**
- Create: `src/lib/services/signal-stream.service.ts`
- Create: `src/lib/services/signal-route.service.ts`
- Modify: `src/lib/services/index.ts`

**验收:**
- 前端可发布信号、订阅流、管理路由。

### Task 6: 录音链路接入 SignalPool

**Files:**
- Modify: `src/ui/app/components/NowInputRow.tsx`
- Create: `src/lib/services/audio-signal.service.ts`

**验收:**
- 录音结束触发至少两条并行路径（保存 + ASR）。

### Task 7: Interaction + Polish + EventLog 投影

**Files:**
- Create: `src/lib/services/interaction-agent.service.ts`
- Create: `src/lib/services/polish-agent.service.ts`
- Create: `src/lib/services/eventlog-projection.service.ts`
- Modify: `src/lib/services/index.ts`

**验收:**
- `interaction.reply.polished` 能更新 EventLog 卡片。

### Task 8: 任务拆分与时间块反思链路

**Files:**
- Create: `src/lib/services/task-decompose-agent.service.ts`
- Create: `src/lib/services/timeblock-reflect-agent.service.ts`

**验收:**
- 任务完成事件触发时间块反思。

### Task 9: Agent Hub 画布接入 @xyflow/react

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Create: `src/ui/app/pages/agents/SignalCanvas.tsx`
- Modify: `package.json`

**验收:**
- 在线改路由可用，节点状态可见。

### Task 10: E2E 验收与可宣传证据

**Files:**
- Create: `tests/e2e/signal-pool-mvp.e2e.test.ts`
- Create: `tests/e2e/playwright.signal-pool.config.ts`
- Create: `docs/pr/signal-pool-mvp-progress-comment.md`

**验收:**
- 全链路可演示：录音→ASR→交互→润色→EventLog→任务→反思。

### Task 11: 浏览器扩展信号节点（ExoBrowser）

> **前置条件**：Task 3（SSE + Publish API）完成后即可并行开发。Task 10 全链路验收后正式接入。

**定位**：SignalPool 上的第一个外部 Agent 节点——双向信号参与者（Source + Sink），验证 SignalPool 对浏览器环境的适配能力。

**Files:**
- Create: `packages/exo-browser/manifest.json`（Manifest V3）
- Create: `packages/exo-browser/src/background.ts`（Service Worker：SSE 订阅 + HTTP POST 发布）
- Create: `packages/exo-browser/src/popup.tsx`（React popup：标签概览 + 手动触发）
- Create: `packages/exo-browser/src/lib/signal-client.ts`（SignalPool SSE/HTTP 客户端）
- Create: `packages/exo-browser/src/lib/tab-manager.ts`（chrome.tabs API 封装）

**信号契约（上行，浏览器 → RT）：**
```ts
// 标签快照：用户点击"整理标签"时发布
{ topic: "browser.tabs.snapshot", payload: { tabs: Array<{ url, title, groupId }> } }

// 页面采集：用户在某页面点"收藏到 ExoMind"
{ topic: "browser.page.captured", payload: { url, title, content_md, captured_at } }
```

**信号契约（下行，RT → 浏览器）：**
```ts
// 标签整理指令：Scout 评分完成后下发
{ topic: "browser.tabs.organize", payload: { actions: Array<{ tabId, action: "close" | "group" | "pin", groupName? }> } }

// 通知推送：ExoMind 系统通知
{ topic: "browser.notify", payload: { title, body, level: "info" | "warning" } }
```

**验收:**
- 扩展可连接本地 RT 的 SSE 流（`/signals/stream?topics=browser.*`）。
- 点击 popup 按钮可发布 `browser.tabs.snapshot` 信号，RT SignalJournal 可查到记录。
- RT 发布 `browser.tabs.organize` 后，扩展可执行 `chrome.tabs` 操作（分组/关闭）。
- Agent Hub 画布上可看到浏览器扩展节点及其连接状态。

---

## 9. MVP / MLP 宣传口径

### 9.1 MVP（证明路走通）

可宣传：
1. Agent 支持对话记忆（会话 + 事件）与语音交互（ASR/TTS）。
2. Agent 可自动驱动任务与时间块反思。
3. Agent Hub 可展示能力网络并在线改路由。

### 9.2 MLP（证明有人付费）

可验证指标：
1. 每日活跃对话链路成功率。
2. 自动任务拆分后的执行转化率。
3. 时间块反思使用留存与复盘完成率。

---

## 10. 风险与缓解（Risks & Mitigations）

1. SSE 连接不稳定
- 缓解：heartbeat + Last-Event-ID 重连重放。

2. 多 Agent 并发导致资源波动
- 缓解：timeout/cancel + 失败审计 + 状态可视化。

3. 移动端后台保活限制
- 缓解：MVP 优先前台可靠性；后台长驻放 MLP。

4. 路由错误导致风暴
- 缓解：hopLimit、去重、路由禁用开关、失败报警。

---

## 11. 完成定义（Definition of Done）

1. `SignalPool` 四件套完整可运行。
2. 1000 条 Ring Buffer 生效，SSE 重放有效。
3. 录音链路到 EventLog/任务/反思闭环跑通。
4. Agent Hub 使用 `@xyflow/react` 支持在线改路由。
5. 有 E2E 证据可复现演示。
