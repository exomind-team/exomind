# Issue 527 Cross-Device Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在当前 `node-first（节点优先）` + `embedded RT（内嵌运行时）` 架构下，打通手机↔电脑之间 `EventLog（事件日志）`、`TimeBlock（时间块）`、`Task（任务）` 三域的多设备同步，并补齐端到端验证链路。

**Architecture:** 保持“每台设备运行自己的 RT SQLite（运行时 SQLite）”不变，继续复用 `mesh relay（网格中继） + signal SSE（信号流） + per-domain projector（按领域投影器）` 的同步模式。不要回退到 `PouchDB replicate（PouchDB 复制）`；前端只负责发布/消费复制信号，真正的数据真相源仍是各设备本地 RT SQLite。

**Tech Stack:** React 18 + TypeScript, Zustand, Tauri v2, Rust runtime, RT SQLite, Signal SSE, mesh relay, Vitest, Playwright

---

### Task 1: 固化验收基线与链路观测

**Files:**
- Modify: `docs/plans/2026-04-01-issue-527-cross-device-sync-plan.md`
- Verify: `docs/development/lan-single-rt-guide.md`
- Verify: `src/ui/app/components/PeerPairingDialog.tsx`
- Verify: `src/lib/services/runtime-mesh-sync.service.ts`

**Step 1: 先确认当前主路径不是 external RT，而是 node-first**

Run: `rg -n "node-first|设备配对|listDiscoveredPeers|listMeshPeers|confirmed_peer" docs src -S`
Expected: 看到设备发现 / 配对 / confirmed peer（已确认节点）已成为当前主路径。

**Step 2: 记录配对成功的最小验收证据**

Run: `gh issue view 527 --repo exomind-team/exomind --comments`
Expected: 确认 `#527` 仍聚焦“手机↔电脑 RT SQLite 互通”，没有被别的场景替代。

**Step 3: 约定调试观测点**

需要能同时观测：
- `/mesh/discovered`
- `/mesh/peers`
- `/signals/history`
- `/eventlog`
- `/tasks`
- `/timeblocks`

**Step 4: 结论**

只有当“已发现节点 → 已确认节点 → 双端都能收到对方信号”这条链路确认无误后，才进入三域复制排查；否则先处理配对 / mDNS / reachable address（可达地址）问题。

### Task 2: EventLog 复制闭环验证

**Files:**
- Verify: `src/lib/services/ecs-eventlog-replication.service.ts`
- Verify: `src/ui/hooks/useSignalStream.ts`
- Verify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Test: `tests/unit/services/ecs-eventlog-replication.service.test.ts`

**Step 1: 确认写入端走的是复制入口**

Current path:
- `appendEventWithEcsReplication()` 负责本地写入
- 非 `rt-sqlite` 时会显式发布 `eventlog.replication.appended`
- `rt-sqlite` 时依赖 RT `/eventlog` 路由本身发布复制信号

**Step 2: 确认接收端真的会投影到本地真相源**

Current path:
- `useSignalStream.ts`
- `onEventLogReplicationAppended`
- `projectEventLogReplicationAppend()`

Expected behavior:
- 信号到达后，远端设备应把事件写入本地 RT EventLog，而不是只刷新 UI。

**Step 3: 增补端到端验证**

Create/Modify:
- `tests/e2e/eventlog-rt-multi-device.issue527.test.ts`

验证：
1. 桌面写事件，手机 5 秒内看到
2. 手机写事件，桌面 5 秒内看到
3. 同一事件不会重复出现
4. 断线重连后可补拉缺失事件

**Step 4: 若失败，优先排查**

- RT `/eventlog` 是否发布了 `eventlog.replication.appended`
- mesh relay 是否把 topic 转发给 peer
- `useSignalStream` 是否连的是本机 embedded RT 而不是错误 target

### Task 3: TimeBlock 同步从“活跃块”扩展到“完整生命周期”

**Files:**
- Verify: `src/lib/services/ecs-active-block-replication.service.ts`
- Verify: `src/lib/services/timeblock.service.ts`
- Verify: `src/lib/adapters/timeblock-rt-adapter.ts`
- Verify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Test: `tests/e2e/active-block-ecs-multi-device.issue381.test.ts`
- Create: `tests/e2e/timeblock-rt-multi-device.issue527.test.ts`

**Step 1: 承认当前已完成的只有 active block snapshot（活跃块快照）**

当前已有：
- `active_block.replication.snapshot`
- `projectActiveBlockReplicationSnapshot()`

当前未被证明的点：
- completed timeblock（已完成时间块）是否真正落到对端本地 SQLite

**Step 2: 检查 completed block 是否能由现有 active snapshot 推导**

Current behavior:
- `applyReplicatedActiveBlock()` 只 `putActiveBlock()`
- 对 `feedbackSubmittedAt` 终态只会 `notifyChange(null)`

Risk:
- 对端 UI 可能只能看到“当前块消失”，但本地 `/timeblocks` 列表未新增 completed block。

**Step 3: 推荐实现**

新增独立复制主题：
- `timeblock.replication.completed`

Create:
- `src/lib/services/ecs-timeblock-replication.service.ts`

Modify:
- `src/lib/services/timeblock.service.ts`
- `src/ui/hooks/useSignalStream.ts`
- `src/lib/services/signal-handlers.ts`
- `crates/exomind-runtime/src/routes/timeblocks.rs`

Payload 最少包含：
- `schemaVersion`
- `cursor`
- `completed block`
- 可选 `terminal active block / gap block`

**Step 4: 冲突策略**

按以下优先级裁决：
1. 同 `startId` 先比 phase（阶段）
2. 再比 `version`
3. 再比 `lastTransitionAt`
4. 最后比 `actorId`

**Step 5: 端到端验收**

验证：
1. A 端开始块，B 端看到 running
2. A 端暂停 / 恢复，B 端状态变化
3. A 端结束后，B 端不仅回到 idle，还能在 completed 列表 / detail 页面看到该块
4. B 端反向同理

### Task 4: 为 Task 补齐真正的复制投影

**Files:**
- Create: `src/lib/services/ecs-task-replication.service.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`
- Verify: `crates/exomind-runtime/src/task/store.rs`
- Verify: `crates/exomind-runtime/src/task/sqlite_store.rs`
- Verify: `src/lib/adapters/task-rt-adapter.ts`
- Test: `tests/unit/services/task-replication.service.test.ts`
- Test: `tests/unit/ui/use-signal-stream.m4.test.tsx`
- Create: `tests/e2e/task-rt-multi-device.issue527.test.ts`

**Step 1: 明确当前缺口**

当前只有：
- `task.created / updated / transitioned / cancelled` 信号
- `useSignalStream.ts` 收到后只 `notifyTaskDataChanged()`

这只能刷新远端页面，不能把远端任务写进本地 RT SQLite。

**Step 2: 复用 RT 已有 upsert 能力，不要走全量 import**

Verified:
- `TaskStore::upsert_scoped()`
- `SqliteTaskStore::upsert_scoped()`

因此推荐新增轻量复制路由，而不是滥用 `/tasks/import/json?strategy=merge`。

**Step 3: 新增 RT 复制 API**

建议新增：
- `POST /tasks/replication/upsert`

payload:
- 完整 `Task`
- `cursor`
- `origin_host_id`

行为：
- 本地 RT 对该任务执行 `upsert_scoped`
- 若本地已存在同 ID 任务，则按 `updated_at` 优先；如相同再按终态 / 非终态、最后 `id` 兜底

**Step 4: 新增前端投影服务**

Create:
- `ecs-task-replication.service.ts`

职责：
- 发布 `task.replication.upserted`
- 接收并投影 `task.replication.upserted`
- 对创建、编辑、状态迁移、取消统一走一个 upsert 入口

**Step 5: 修改 `useSignalStream`**

从：
- 收到 `task.created` 只刷新 UI

改为：
- 对原生本地 task lifecycle signal 仍刷新 UI
- 对跨设备复制 topic 调用 `projectTaskReplicationUpsert()`
- 投影成功后再 `notifyTaskDataChanged()`

**Step 6: 端到端验收**

验证：
1. 桌面创建任务，手机任务列表出现
2. 桌面更新标题 / 描述 / 标签，手机同步
3. 桌面迁移状态，手机同步
4. 手机创建 / 更新 / 取消，桌面同步
5. 同 ID 任务重复投影不产生副本

### Task 5: 统一“谁发布复制信号”的边界

**Files:**
- Verify: `src/lib/services/ecs-eventlog-replication.service.ts`
- Verify: `src/lib/services/task-event-emitter.ts`
- Verify: `src/lib/services/timeblock.service.ts`
- Verify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Verify: `crates/exomind-runtime/src/routes/tasks.rs`
- Verify: `crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 1: 统一原则**

- domain write（领域写入）发生在 RT 路由层时，由 RT 发布复制信号
- 仅当前端直接操作 legacy / web fallback 时，才由 TS service 显式发布复制信号

**Step 2: 避免双发**

特别检查：
- `task-event-emitter.ts`
- `timeblock.service.ts`

目标：
- 不让一条本地动作同时产生“生命周期事件”和“复制事件”的重复写入
- 生命周期 EventLog 可保留；复制信号必须单独有稳定 cursor

### Task 6: 补齐真机 / 模拟器双端验证脚本

**Files:**
- Create: `tests/e2e/playwright.issue527.config.ts`
- Create: `tests/e2e/helpers/issue527-fake-or-real-runtime.ts`
- Modify: `package.json`
- Optional: `docs/testing/issue-527-acceptance.md`

**Step 1: 先做 fake runtime 回归**

目的：
- 快速验证 topic、projector、去重、冲突策略

**Step 2: 再做真机 / 模拟器链路**

验证维度：
- desktop embedded RT
- android embedded RT
- mDNS 发现
- PIN pairing
- mesh peer 建立
- SSE 收到远端 topic
- 本地 SQLite 真正写入

**Step 3: 输出证据**

至少记录：
- `/mesh/discovered`
- `/mesh/peers`
- `/signals/history`
- `/eventlog`
- `/tasks`
- `/timeblocks`

### Task 7: 收口旧 PouchDB 残留与文档

**Files:**
- Verify: `src/ui/stores/sync-store.ts`
- Verify: `src/lib/storage/active-block-storage.ts`
- Verify: `package.json`
- Verify: `docs/development/lan-single-rt-guide.md`
- Verify: `CHANGELOG.md`

**Step 1: 明确这轮不再让新链路依赖 `sync-store`**

现状：
- `sync-store.ts` 仍保留旧 Pouch 登录 / 连接语义

要求：
- `#527` 的三域同步验证不应依赖 `PouchSyncAdapter`

**Step 2: 文档同步**

在相关文档里明确：
- EventLog：已闭环
- TimeBlock：active + completed 都闭环后才算完成
- Task：改为 RT upsert replication，不再只靠 UI 刷新

### Task 8: 最终验收顺序

**Files:**
- Verify: `tests/e2e/eventlog-rt-multi-device.issue527.test.ts`
- Verify: `tests/e2e/timeblock-rt-multi-device.issue527.test.ts`
- Verify: `tests/e2e/task-rt-multi-device.issue527.test.ts`

**Step 1: 先 EventLog**

原因：
- 链路最成熟，最适合作为 mesh + SSE + projector 基线

**Step 2: 再 TimeBlock**

原因：
- 已有 active snapshot，可快速暴露 completed 落库问题

**Step 3: 最后 Task**

原因：
- 需要新增复制路由和 projector，是唯一明显缺失的领域

**Step 4: Definition of Done**

满足以下才关闭 `#527`：
1. 配对与 mDNS 在手机↔电脑双向可用
2. EventLog 双向同步稳定，且可补拉
3. TimeBlock 的 running / paused / completed 都能跨设备看到
4. Task 创建 / 编辑 / 状态迁移 / 取消都能跨设备落库
5. 全程零 `PouchDB.replicate`
