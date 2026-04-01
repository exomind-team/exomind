# RT Mesh + RT SQLite Cross-Device Sync Replacement Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `device pairing（设备配对）`、`RT net（运行时网络）`、`RT SQLite（运行时 SQLite）` 基础上，移除 `PouchDB` 主链路，并用 RT-to-RT 的增量同步 + 补拉机制替代旧的 `PouchDB.replicate()`。

**Architecture:** 每台设备继续运行自己的 `embedded RT（内嵌运行时）`，本地数据真相源统一为 RT SQLite。跨设备同步统一走 `mesh relay（网格中继） + signal SSE（信号流） + domain projector（领域投影器） + reconnect backfill（重连补拉）`，不再让业务域依赖 `PouchDB`、`sync server（同步服务器）` 或 `remote DB URL（远端数据库地址）`。

**Tech Stack:** React 18 + TypeScript, Zustand, Tauri v2, Rust runtime, RT SQLite, mesh relay, SSE, Vitest, Playwright

---

## 0. Review Summary（评审摘要）

这份计划整合并替换了此前的草案。旧草案里有 4 个核心问题，必须先纠正：

1. 它只覆盖了 `Task / completed TimeBlock` 新复制 topic，没有把 `Pouch` 的残留主路径一起迁出。
   当前仓库里仍有：
   - [sync-store.ts](D:/project/exomind/src/ui/stores/sync-store.ts)
   - [TaskSyncCoordinator.tsx](D:/project/exomind/src/ui/app/components/TaskSyncCoordinator.tsx)
   - [ReminderSyncCoordinator.tsx](D:/project/exomind/src/ui/app/components/ReminderSyncCoordinator.tsx)
   - [event-storage.ts](D:/project/exomind/src/lib/storage/event-storage.ts)
   - [reminder-storage.ts](D:/project/exomind/src/lib/storage/reminder-storage.ts)

2. 它把“signal topic 到达 UI”误当成“数据同步完成”。
   真正完成标准必须是：
   - 远端信号到达
   - 本地 RT SQLite 写入成功
   - UI 只是结果呈现，不是同步本身

3. 它假设 `Task` 应先新增 `version` 列，再做复制。
   这不是当前最小可行路径。现有 RT `TaskStore` 已有：
   - [upsert_scoped() in store.rs](D:/project/exomind/crates/exomind-runtime/src/task/store.rs#L501)
   - [upsert_scoped() in sqlite_store.rs](D:/project/exomind/crates/exomind-runtime/src/task/sqlite_store.rs#L294)
   因此首选应该是复用 `updated_at + terminal precedence（终态优先） + origin_host_id` 做第一版冲突裁决，而不是先扩数据库 schema。

4. 它把“离线补偿”降成了 P1 非目标。
   这在“移除 Pouch 主链路”前提下不成立。没有 `bootstrap/backfill（启动补拉）`，新的同步链路只有 at-most-once（最多一次）特性，设备离线期间的数据会永久丢失。

## 1. Scope（范围）

### In Scope

- `EventLog（事件日志）` 的 RT 主链路收尾
- `Task（任务）` 的 RT-to-RT 复制与投影
- `TimeBlock（时间块）` 的 `active + completed` 双通道复制
- `sync-store` 的 Pouch transport（传输层）职责清除
- `Task/TimeBlock/Reminder` 协调器中的 remote DB URL（远端数据库地址）依赖清除
- `PouchDB` 端口、脚本、适配器、测试、文档清理
- 至少一个可工作的 reconnect backfill（重连补拉）方案

### Out of Scope

- 广域网穿透 / 云中继
- Settings 跨设备同步
- Agent 会话跨设备同步
- CRDT

## 2. Target State（目标状态）

### 2.1 本地真相源

所有核心域以 RT SQLite 为准：

- EventLog
- Task
- TimeBlock
- Reminder

如果某个域还没有 RT backend（例如 Reminder），则“完全移除 Pouch 主链路”不能宣告完成。

### 2.2 跨设备同步模型

所有领域统一采用两段式：

1. `bootstrap / reconnect pull（启动 / 重连补拉）`
   目的：拿到 peer 上自己缺失的数据

2. `incremental signal replication（增量信号复制）`
   目的：在线期间低延迟传播变化

也就是说：
- **不是** “只靠 signal”
- **也不是** “只靠全量导入”
- 而是 “先补拉，再订阅增量”

### 2.3 Scope Policy（作用域策略）

默认策略固定为：

- **同一 profile scope（同一档案作用域）同步**
- **不同 profile scope（不同档案作用域）隔离**
- **设备本地配置默认不同步**

这里的“同配置”不是指 UI 设置、API Key、窗口布局，而是指：
- 相同 `activeProfileId`
- 或相同 `remoteIdentityKey`
- 最终落到同一个 RT `user_id` scope

因此：
- `EventLog / Task / TimeBlock / Reminder` 属于业务数据，同 scope 可同步
- ASR/API Key、窗口状态、快捷键、Android 权限、输入设备状态属于设备本地配置，不进入这轮跨设备同步

### 2.4 路由表策略

当前 [signal-routes.default.json](D:/project/exomind/config/signal-routes.default.json) 已有：

- `* -> frontend:ui`

因此这轮不需要为了新 topic 额外加 UI 路由，除非后续要限制 topic 可见性。新复制 topic 只需要：
- 被 RT publish
- 被 mesh relay 转发
- 被 `useSignalStream` 消费

## 3. Domain Strategy（按领域策略）

### 3.1 EventLog

现状：
- 已有 [ecs-eventlog-replication.service.ts](D:/project/exomind/src/lib/services/ecs-eventlog-replication.service.ts)
- 已有 [useSignalStream.ts](D:/project/exomind/src/ui/hooks/useSignalStream.ts#L244)

结论：
- EventLog 不重做协议
- 保持 `replicationSeq` 作为主 cursor（游标）
- 需要补的是“真机端到端证据”和“重连补拉”

### 3.2 Task

现状：
- RT 路由会 publish `task.created / updated / transitioned / cancelled`
- 前端只 `notifyTaskDataChanged()`
- 本地并不会把远端任务投影进 RT SQLite

策略：
- 新增 `task.replication.upserted`
- 复制 payload 使用完整 `Task` 快照 + cursor
- 本地 RT 用 `upsert_scoped()` 写入

第一版冲突裁决：
1. `updated_at` 更大者优先
2. 若一方为 terminal（`completed/cancelled`）且另一方非 terminal，则 terminal 优先
3. 若仍相同，用 `origin_host_id` 字典序做 tie-break（并把结果写回本地）

### 3.3 TimeBlock

现状：
- 已有 `active_block.replication.snapshot`
- completed block 结束后没有独立复制通道

策略：
- 保留 `active_block.replication.snapshot` 负责“进行中状态”
- 新增 `timeblock.replication.completed` 负责“已结束块”
- completed block 以 `startId` 作为幂等主键

### 3.4 Reminder

现状：
- [reminder.service.ts](D:/project/exomind/src/lib/services/reminder.service.ts) 仍直接使用 `ReminderPouchAdapter`
- [ReminderSyncCoordinator.tsx](D:/project/exomind/src/ui/app/components/ReminderSyncCoordinator.tsx) 仍依赖 remote DB URL

结论：
- 如果本轮目标是“完全去除 Pouch 主链路”，Reminder 不能被跳过
- 至少要做到：
  - 新建 RT Reminder backend 和 adapter
  - 或明确把 Reminder 功能临时降级/关停

默认推荐前者。

## 4. Workstreams（工作流）

### Task 1: 拆出身份层，冻结 Pouch transport 扩散

**Files:**
- Modify: `src/ui/stores/sync-store.ts`
- Modify: `src/lib/eventlog/source-metadata.ts`
- Modify: `src/ui/pages/UserManagePage.tsx`
- Modify: `src/ui/pages/SyncTestPage.tsx`
- Modify: `src/components/Chat/ChatPage.tsx`
- Modify: `src/ui/app/components/DesktopSidebarAccountEntry.tsx`
- Modify: `src/ui/app/components/SwitchAccountSheet.tsx`
- Modify: `src/ui/app/components/UserCard.tsx`

**Step 1: 定义新的职责边界**

`sync-store` 不再表示“同步连接状态”，只保留：
- 本地档案 / 登录态
- identity link（身份链接）
- 远端身份标识

移除或废弃：
- `connect()`
- `disconnect()`
- `syncEvents()`
- `syncConfig()`
- `PouchSyncAdapter` 动态导入

**Step 2: 改掉所有把 `sync-store` 当 transport controller（传输控制器）的调用**

Expected:
- UI 不再通过 `sync-store.status.state` 判断“是否开启同步”
- 设备配对 / runtime peer 状态改由 RT / mesh 真实状态决定

### Task 2: 为 Task 增加 RT 复制投影

**Files:**
- Create: `src/lib/services/ecs-task-replication.service.ts`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`
- Verify: `crates/exomind-runtime/src/task/store.rs`
- Verify: `crates/exomind-runtime/src/task/sqlite_store.rs`
- Test: `tests/unit/services/task-replication.service.test.ts`
- Test: `tests/unit/ui/use-signal-stream.m4.test.tsx`

**Step 1: 新增复制 topic**

```ts
task.replication.upserted
```

**Step 2: RT publish 完整快照**

在任务写入成功后由 RT 发射复制信号，而不是让前端二次发射。

payload 至少包含：
- `task`
- `cursor.updatedAt`
- `cursor.taskId`
- `cursor.originHostId`

**Step 3: 前端 projector**

`projectTaskReplicationUpsert()` 做两件事：
1. 请求本地 RT 的复制写入接口
2. 成功后触发 `notifyTaskDataChanged()`

**Step 4: 本地 RT 复制写入接口**

建议新增：
- `POST /tasks/replication/upsert`

其职责不是“普通用户编辑任务”，而是“应用来自 peer 的复制快照”。

### Task 3: 为 completed TimeBlock 增加复制投影

**Files:**
- Create: `src/lib/services/ecs-timeblock-replication.service.ts`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Test: `tests/unit/services/timeblock-replication.service.test.ts`

**Step 1: 新增复制 topic**

```ts
timeblock.replication.completed
```

**Step 2: RT 在 `end` 成功后发射 completed 快照**

不要只依赖 active snapshot 终态推断，因为那只会导致 UI 回到 idle，不保证 `/timeblocks` 已写入。

**Step 3: 前端 projector**

接收到 completed block 后：
1. 调本地 RT 的复制写入接口
2. 写入 completed 列表
3. 如有必要清理 active block 终态展示

### Task 4: 为 EventLog / Task / TimeBlock 增加 bootstrap/backfill

**Files:**
- Modify: `src/lib/services/runtime-mesh-sync.service.ts`
- Modify: `src/ui/app/components/PeerPairingDialog.tsx`
- Modify: `src/ui/hooks/useSignalStream.ts`
- Modify: `crates/exomind-runtime/src/routes/eventlog.rs`
- Modify: `crates/exomind-runtime/src/routes/tasks.rs`
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`
- Create: `src/lib/services/rt-domain-backfill.service.ts`

**Step 1: 定义每域 cursor**

- EventLog: `replicationSeq`
- Task: `updatedAt + taskId`
- completed TimeBlock: `endTime + startId`

**Step 2: 提供 peer pull 接口**

至少支持：
- `GET /eventlog/replication/pull?after_seq=...`
- `GET /tasks/replication/pull?after_updated_at=...`
- `GET /timeblocks/replication/pull?after_end_time=...`

**Step 3: 触发时机**

以下时机主动触发补拉：
- pairing 成功后
- confirmed peer 重连后
- SSE 连接恢复后

**Step 4: 要求**

没有这一步，移除 Pouch 后就会退化成“在线时才同步，离线期间全丢”。

### Task 5: 去掉业务层里的 Pouch 远端 URL 与 sync server 假设

**Files:**
- Modify: `src/ui/app/components/TaskSyncCoordinator.tsx`
- Modify: `src/ui/app/components/TimeBlockSyncCoordinator.tsx`
- Modify: `src/ui/app/components/ReminderSyncCoordinator.tsx`
- Modify: `src/config/port-env.ts`
- Modify: `src/config/dev-instance-diagnostics.ts`
- Modify: `package.json`
- Delete: `server/pouchdb-server.js`
- Modify: `server/package.json`

**Step 1: 移除 remote DB URL 构造**

删掉：
- `resolveSyncServerUrl()`
- `buildRemoteDbUrl()`
- `EXOMIND_POUCHDB_*`

对于业务域同步，改成：
- runtime peer status（运行时 peer 状态）驱动
- backfill + SSE 驱动

**Step 2: 清理开发命令**

不再提供：
- Pouch sync server 启动脚本

改为：
- embedded RT
- mesh / pairing
- health / topology / peers 调试命令

### Task 6: 删除或替换 Pouch 适配器与 legacy backend

**Files:**
- Delete: `src/adapters/pouch-sync.ts`
- Delete: `src/lib/adapters/task-pouch-adapter.ts`
- Delete: `src/lib/adapters/reminder-pouch-adapter.ts`
- Modify: `src/lib/environment/bootstrap.ts`
- Modify: `src/config/domain-backend-mode.ts`
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: `src/lib/storage/event-storage.ts`
- Modify: `src/lib/storage/task-storage.ts`
- Modify: `src/lib/storage/active-block-storage.ts`
- Modify: `src/lib/storage/reminder-storage.ts`

**Step 1: 明确分两类处理**

1. 已迁到 RT 的域：
   - EventLog
   - Task
   - TimeBlock
   目标：彻底删除 legacy backend 选择器与 Pouch fallback

2. 尚未迁到 RT 的域：
   - Reminder
   目标：先补 RT backend，再删 Pouch

**Step 2: 删除 UI 上的 legacy backend 选项**

如果仍允许切到 `legacy`，那就不算真正完成“移除 Pouch 主链路”。

### Task 7: 测试与回归

**Files:**
- Create: `tests/e2e/task-rt-multi-device.issue794.test.ts`
- Create: `tests/e2e/timeblock-rt-multi-device.issue794.test.ts`
- Create: `tests/e2e/reminder-rt-multi-device.issue794.test.ts`
- Modify: `tests/e2e/eventlog-ecs-multi-device.issue381.test.ts`
- Delete/Modify: `tests/sync/pouch-sync.test.ts`
- Delete/Modify: `tests/adapters/pouch-sync.test.ts`

**Step 1: fake mesh runtime 回归**

先在双 RT 假环境下验证：
- publish
- relay
- projector
- idempotency（幂等）
- reconnect backfill

**Step 2: 真机 / 模拟器验证**

至少覆盖：
- desktop ↔ android
- 配对成功
- peer 建立
- 三域都能落库

**Step 3: 通过条件**

- 不出现 `PouchDB.replicate`
- 不再启动 `6984`
- 断线恢复后数据可补齐

### Task 8: 文档清理与 issue 对齐

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/sync.md`
- Modify: `docs/development/port-env-configuration.md`
- Modify: `docs/development/lan-single-rt-guide.md`
- Modify: `docs/development/termux-environment.md`
- Modify: `docs/memory/project-overview.md`
- Modify: `CHANGELOG.md`

**Step 1: 主叙事改为 RT-only**

所有文档要统一成：
- local source = RT SQLite
- cross-device sync = pairing + RT net + domain replication

**Step 2: issue 关联**

本计划与以下 issue 对齐：
- `#527`
- `#549`
- `#794`

## 5. Execution Order（执行顺序）

### Phase A: 先让“新链路可自洽”

1. Task replication
2. completed TimeBlock replication
3. bootstrap/backfill

### Phase B: 再清掉 Pouch 主路径

1. 拆 `sync-store`
2. 移除 coordinators 的 remote DB URL 逻辑
3. 删 Pouch server / port / adapter / tests

### Phase C: 最后补 Reminder 与文档

1. Reminder RT backend
2. 删除 reminder Pouch path
3. 全量文档更新

## 6. Acceptance（验收）

- [ ] `EventLog / Task / TimeBlock / Reminder` 都以 RT SQLite 为本地真相源
- [ ] `EventLog / Task / TimeBlock` 都能跨设备落库，不是只刷新 UI
- [ ] 至少一条 reconnect backfill 链路可用
- [ ] `sync-store` 不再承载 Pouch transport
- [ ] `PouchSyncAdapter`、`server/pouchdb-server.js`、`EXOMIND_POUCHDB_*` 从主路径移除
- [ ] 设备配对成功后能完成 bootstrap + incremental sync
- [ ] 真机或模拟器链路有证据

## 7. Notes（备注）

- 不要把这轮工作拆成“先删 Pouch，再想同步怎么做”。两者必须同一计划推进。
- 不要把 `task.created` 这类 lifecycle signal 当成 replication signal。
- 不要为了“完整”先做复杂 CRDT；先把 RT-only 单主链路做稳。
