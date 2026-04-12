# 2026-04-13：EDS/CRDT 与当前 RT-only 同步主链路的结构冲突调查

## 问题定义

仓库里同时存在两套叙事：

- 架构层叙事把系统定义为 `ECS（通信栈） + EDS（数据栈）` 双栈，明确说 `ECS` 管实时信号，`EDS` 管持久数据；其中 `EDS-2` 的职责是 `CRDT / 文件同步 + 冲突解决`，但当前状态仍是“未实现”。`ECS` 与 `EDS` 共享 RT 运行时，但不是同一层职责。见 `docs/architecture/overview.md:102-131`、`docs/architecture/overview.md:332-338`。
- 现行同步主链路则把跨设备同步定义为 `device pairing + RT net / mesh relay + signal SSE + domain projector + RT SQLite`，并要求“同步成功”必须落到本地 RT SQLite，页面只负责展示最终结果。见 `docs/specs/sync.md:7-20`、`docs/specs/sync.md:45-51`。
- 当前实施计划更直接：它要求先把 `RT-only` 主链路做稳，并把 `CRDT` 明确列为本轮 `Out of Scope`。见 `docs/plans/PLAN-cross-device-incremental-sync.md:52-58`。

所以真正要回答的不是“以后要不要上 CRDT”，而是“`EDS/CRDT` 和当前 `RT-only` 主链路是不是同一插槽”。结论先写在前面：**不是。当前 RT-only 主链路是“基于 ECS topic 的领域复制/投影链”，而 EDS/CRDT 设计的是“位于持久层与同步层之间的耐久收敛引擎”。二者最多共享传输与通知基础设施，不能直接视为同一个模块的不同实现。**

## 已探索出的新成果

### 1. `Reminder` 现在仍然依赖 UI 参与复制落地，和规范里的“页面只展示结果”不一致

- `useSignalStream` 收到 `reminder.replication.upserted` 后，会调用 `projectReminderReplicationUpsert()`，然后再触发 UI 刷新。见 `src/ui/hooks/useSignalStream.ts:248-252`。
- 这个 projector 本身不是在前端直接合并数据，而是通过 `ReminderRtAdapter.applyReplicationSnapshot()` 再次 `POST /reminders/replication/upsert` 写回本地 RT。见 `src/lib/services/ecs-reminder-replication.service.ts:23-33`、`src/lib/adapters/reminder-rt-adapter.ts:144-174`。
- RT 端确实提供了 `/reminders/replication/upsert`，也会在 reminder 写入后发布 `reminder.replication.upserted` topic。见 `crates/exomind-runtime/src/routes/reminders.rs:44-53`、`crates/exomind-runtime/src/routes/reminders.rs:126-214`。
- 但 RT 的 `replication_actor` 只消费 `eventlog/task/timeblock/proposal` 复制 topic，没有 `reminder.replication.upserted`。见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:13-17`、`crates/exomind-runtime/src/signal/actors/replication_actor.rs:75-130`。

这意味着：**在 reminder 域里，远端复制 topic 到达本机后，并没有一个纯 RT 的 headless apply 通路；UI SSE 订阅者本身仍是复制闭环的一部分。** 这和 `docs/specs/sync.md:45-51` 写的验收口径不是一回事。

### 2. `backfill` 已经落地，但实现形状不是计划里的“按 cursor 增量补拉”，而是“整库 SQLite 快照导出/导入”

- 计划要求每个域定义 cursor，并提供 `GET /eventlog|tasks|timeblocks/replication/pull?...` 之类的 pull 接口，语义是“先补拉，再订阅增量”。见 `docs/plans/PLAN-cross-device-incremental-sync.md:74-85`、`docs/plans/PLAN-cross-device-incremental-sync.md:271-305`。
- 但实际 `RtDomainBackfillService` 只做三件事：对 confirmed peer 导出 `eventlog/tasks/timeblocks` 的 SQLite snapshot，然后在本地做 `import...SqliteSnapshot(..., 'merge')`。见 `src/lib/services/rt-domain-backfill.service.ts:1-47`、`src/lib/services/rt-domain-backfill.service.ts:89-147`。
- 对应的前端 backup service 调用的也是 `/eventlog/backup/sqlite`、`/tasks/backup/sqlite`、`/timeblocks/backup/sqlite` 与 import sqlite API。见 `src/lib/services/eventlog-backup.service.ts:116-148`、`src/lib/services/task-backup.service.ts:114-141`、`src/lib/services/timeblock-backup.service.ts:121-174`。
- `RtDomainBackfillCoordinator` 会在登录后立即跑一次，然后每 15 秒、窗口 focus、浏览器 online 时继续跑。见 `src/ui/app/components/RtDomainBackfillCoordinator.tsx:13-39`。

所以当前 backfill 的真实形状不是“增量 pull”，而是**周期性整库 repair**。这对稳定 RT-only 链路有用，但它和未来 EDS/CRDT 的 slot 也不是一回事。

### 3. 现在已经存在“双重 apply 面”：RT actor 一份，UI projector 一份

- RT 侧 `replication_actor` 会直接把远端 `eventlog/task/timeblock` 复制 topic 应用到本地 store。见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:75-130`、`crates/exomind-runtime/src/signal/actors/replication_actor.rs:148-255`。
- 同时，前端 `useSignalStream` 也会对 `task.replication.upserted`、`eventlog.replication.appended`、`timeblock.replication.completed` 执行 projector。见 `src/ui/hooks/useSignalStream.ts:233-246`、`src/ui/hooks/useSignalStream.ts:300-356`。

这说明当前“同步内核”并不在一个单独模块里，而是已经分裂成：

1. RT 内部 actor apply
2. UI 订阅后再调用本地 RT apply
3. 周期性 SQLite snapshot repair

如果未来再把 EDS/CRDT 当成“同一插槽”的替换件塞进来，只会出现第四条并行通路。

### 4. `EventLog` 仍然跨着 `RT SQLite` 和 `PouchDB` 两条持久化路径

- `appendEventWithEcsReplication()` 在 `rt-sqlite` 模式下直接走 `EventLogService`，否则还是写 `EventStorage`，写完后再发 `eventlog.replication.appended` topic。见 `src/lib/services/ecs-eventlog-replication.service.ts:116-142`。
- `projectEventLogReplicationAppend()` 同样分支：`rt-sqlite` 走 RT 环境，其他情况走 `EventStorage.projectReplicatedEvent()`。见 `src/lib/services/ecs-eventlog-replication.service.ts:144-162`。
- 而 `EventStorage` 本体仍然是 PouchDB，本地类注释和构造器都是 Pouch，且还保留了 `syncToRemote()`。见 `src/lib/storage/event-storage.ts:1-16`、`src/lib/storage/event-storage.ts:160-181`、`src/lib/storage/event-storage.ts:417-620`。
- 架构总览也承认 `EDS-1` 目前“部分实现”的例子里还包括 `PouchDB, 前端 EventStorage`。见 `docs/architecture/overview.md:332-338`。

这不是说 EventLog 当前默认主链路一定还在用 Pouch；更准确的说法是：**仓库内的持久化边界还没有完全收口到 RT SQLite 一处。** 这会直接抬高任何 EDS/CRDT 迁移的复杂度。

## 当前实现形状

### 1. 现行主链路本质上是“领域复制 topic + projector/upsert + RT SQLite”

同步规格已经把当前主路径写得很直白：`RT net / mesh relay + signal SSE + domain projector + RT SQLite`，业务域以 RT SQLite 为准。见 `docs/specs/sync.md:7-20`。

任务域的实际代码也符合这个定义：

- RT 写任务时，不只发 `task.created/updated` 生命周期 topic，还会同时发 `task.replication.upserted`。见 `crates/exomind-runtime/src/routes/tasks.rs:148-181`、`crates/exomind-runtime/src/routes/tasks.rs:476-514`。
- 远端快照到本机后，会走 `/tasks/replication/upsert`，本地按 `updated_at`、终态优先、`completed_at`、`source_host_id` 做接受/忽略判断。见 `crates/exomind-runtime/src/routes/tasks.rs:531-595`。
- 前端 projector 只是把 topic 再投影进本地 RT 接口。见 `src/lib/services/ecs-task-replication.service.ts:69-82`、`src/lib/adapters/task-rt-adapter.ts:214-254`。

时间块域也是同样结构：

- RT 端发 `timeblock.replication.completed` 和 `timeblock.replication.active_upserted`。见 `crates/exomind-runtime/src/routes/timeblocks.rs:115-157`。
- `completed` 复制接口只是按 `start_id` 去重后写入 completed list。见 `crates/exomind-runtime/src/routes/timeblocks.rs:629-653`。
- backfill/import 仍然是 completed list + active block 的 merge/overwrite 逻辑，不是 CRDT 文档收敛。见 `crates/exomind-runtime/src/routes/timeblocks.rs:1285-1363`。
- 前端 projector 最终也是调用本地 RT endpoint。见 `src/lib/services/ecs-timeblock-completed-replication.service.ts:23-33`、`src/lib/adapters/timeblock-rt-adapter.ts:109-125`。

Reminder 域则更“前端化”：topic 仍由 RT 发布，但 apply 主要靠 UI projector 回灌 RT。见 `src/ui/hooks/useSignalStream.ts:248-252`、`crates/exomind-runtime/src/routes/reminders.rs:126-214`。

### 2. 底层 transport 仍然是 ECS，而不是独立的数据同步协议

- 架构总览明确写了当前 RT 的对外通道只有两条：下行 SSE `GET /signals/stream`，上行 HTTP `POST /signals/publish`。见 `docs/architecture/overview.md:293-300`、`docs/architecture/overview.md:302-315`。
- `SignalPool` 的 Window/Journal 仍是 ring buffer，而且投递语义决策冻结为 `at-most-once`。见 `docs/architecture/overview.md:253-260`、`docs/architecture/overview.md:452-457`。

也就是说，当前 RT-only 同步主链路并没有另起一个“耐久复制协议层”；它还是把领域快照挂在 ECS signal topic 上跑。

### 3. 当前冲突解决是“每个域各写一套规则”，不是统一复制数据类型

- Task：`updated_at` 优先，终态优先，`completed_at` 再比，最后 `source_host_id` tie-break。见 `crates/exomind-runtime/src/routes/tasks.rs:531-559`。
- Reminder：`updated_at` 优先，平手时用 `source_host_id` 和本机 `host_id` 比较。见 `crates/exomind-runtime/src/routes/reminders.rs:135-147`。
- TimeBlock active：先比是不是同一个 `start_id`，再比 phase、version、last_transition_at、host。见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:325-397`。
- TimeBlock completed：几乎只是按 `start_id` 做幂等去重。见 `crates/exomind-runtime/src/routes/timeblocks.rs:640-653`、`crates/exomind-runtime/src/signal/actors/replication_actor.rs:233-255`。

推断：**这些规则已经是“领域定制的半格/优先序”雏形，但它们被写在 route handler、actor 和 projector 周边，而不是被建模成一个统一的复制数据类型层。**

## 为什么两者不是同一插槽

### 1. EDS/CRDT 的位置在持久层下面，当前 RT-only 主链路的位置在领域投影层上面

EDS 讨论稿写得很清楚：不要在 ECS 中间插层，而是新建 EDS；ECS 与 EDS 共享 ECS-3 组网和传输通道，EDS-2 的同步事件只是“通过 ECS-5 发布信号通知（如 `file.synced`）”。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:270-332`。

这和当前 RT-only 主链路正好相反。当前主链路不是“数据已在 EDS 层收敛，再发通知”，而是“**signal topic 本身就是领域状态传播载体**，topic 到达后再由 projector/upsert 把状态写进 RT SQLite”。见 `docs/specs/sync.md:7-20`、`docs/specs/sync.md:24-35`、`src/ui/hooks/useSignalStream.ts:233-252`、`src/ui/hooks/useSignalStream.ts:300-356`。

所以二者的 slot 不同：

- 当前主链路 slot：`domain projector -> RT route upsert/import -> RT SQLite`
- EDS/CRDT slot：`storage/doc/file state -> sync engine/CRDT merge -> durable convergence -> optional ECS notification`

### 2. 当前链路的语义单位是“领域快照”，EDS/CRDT 的语义单位是“持久对象/文件/文档状态”

- 架构总览对双栈的区分是：ECS 数据即时、瞬态、小且可丢；EDS 数据持久、有版本、不可丢。见 `docs/architecture/overview.md:126-131`。
- 讨论稿把 EDS-2 定义成 `CRDT / 文件同步`，并给出 `SyncStrategy`、`NodeStorage`、`/shared`、`/agents/{agent}/memory` 这些明显更偏文件/文档/持久对象的形状。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:298-336`、`docs/architecture/ECS-EDS-discussion-2026-03-04.md:340-356`。

但当前 RT-only 主链路传播的是 Task/Reminder/TimeBlock/EventLog 的领域快照，且每个域都自己决定 merge 规则。它解决的是“怎么把 RT SQLite 的领域表在多设备之间补齐/覆盖”，不是“怎么让一类可复制对象天然收敛”。

### 3. 当前 transport 的容错模型和 CRDT 期望的 durability 模型不一样

- 当前 ECS 明确接受 `at-most-once`，Window/Journal 都是有上限的 ring buffer。见 `docs/architecture/overview.md:253-260`、`docs/architecture/overview.md:452-457`。
- EDS 则被定义为“不可容忍丢失”的持久数据栈。见 `docs/architecture/overview.md:126-131`。

这意味着：**ECS signal 可以继续作为 EDS 的通知面，但不能天然承担 EDS/CRDT 的耐久复制面。** 如果把 CRDT 硬塞到当前 `SSE + at-most-once + limited window` 这一层，得到的不是 EDS，只是更复杂的 topic payload。

### 4. 当前主链路的 merge 是领域规则，EDS/CRDT 要求的是统一的收敛代数

讨论稿把 CRDT 放在 `Agent 状态/记忆`、`用户数据/文件`、`配置/设置` 这些层次上，而不是直接说“Task/Reminder/TimeBlock 就按现在的 route 规则换成 CRDT 库”。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:198-206`。

当前代码里的 `terminal precedence`、`feedback phase monotonicity`、`version/host tie-break` 都是领域语义硬约束。Task 的终态优先见 `crates/exomind-runtime/src/routes/tasks.rs:544-555`，TimeBlock active 的 phase/version 优先见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:357-397`。这些规则当然可以被重新表达成 CRDT 或半格，但那已经是**重新建模领域状态**，不是“把现有 RT-only 主链路底层库替换一下”。

### 5. 当前实现自己都还没有统一到“单一同步插槽”

- `replication_actor` 在 RT 内直接 apply 一份。见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:75-255`。
- `useSignalStream` 在 UI 侧再 projector 一份。见 `src/ui/hooks/useSignalStream.ts:233-252`、`src/ui/hooks/useSignalStream.ts:300-356`。
- `RtDomainBackfillService` 再做 snapshot repair 一份。见 `src/lib/services/rt-domain-backfill.service.ts:89-147`。

在这种情况下，谈“EDS/CRDT 和当前主链路是不是同一插槽”，答案只能是否定的。**当前连 RT-only 自己都还没有完全收口成一个插槽。**

## 共同结构特征

虽然不是同一插槽，但两者并非毫无连续性。仓库里已经出现了几个可以继承的共同结构。

### 1. 都需要“增量 + 补拉/快照”双轨

- 当前计划写的是 `bootstrap/reconnect pull + incremental signal replication`。见 `docs/plans/PLAN-cross-device-incremental-sync.md:72-86`。
- EDS 讨论稿写的是“文件同步协议：信号通知 + 按需拉取”。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:321-332`。

这两者在结构上是同类问题：冷启动/离线恢复靠补拉，在线低延迟靠增量通知。区别只在补拉的对象现在是领域表 snapshot，将来可能是文档状态、文件 blob 或 CRDT state/vector。

### 2. 都打算复用 ECS-3/5，而不是另起一套完全独立网络

- EDS 讨论稿已经说了，ECS 和 EDS 共享 ECS-3 的 PeerRegistry/传输通道，EDS-2 的事件经 ECS-5 通知。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:289-290`。
- 当前主链路也就是走 `RT net / mesh relay + signal SSE`。见 `docs/specs/sync.md:7-13`。

这说明未来 EDS/CRDT 不一定要推翻 mesh/SignalPool/host identity；它更可能复用 transport，但替换 durable sync 的那一层。

### 3. 都依赖可追踪的来源与因果元数据

- 当前 task/reminder/timeblock replication payload 都带 `scopeKey` 和 `originHostId`。见 `crates/exomind-runtime/src/routes/tasks.rs:481-490`、`crates/exomind-runtime/src/routes/reminders.rs:173-181`、`crates/exomind-runtime/src/routes/timeblocks.rs:120-129`。
- EventLog 当前也已经有 `replicationSeq` cursor。见 `src/lib/services/ecs-eventlog-replication.service.ts:17-28`。
- 讨论稿里的 `SourceChain` 直接把 `seq`、`author`、hash chain 当成持久层骨架，并且明确把 `author` 映射到 ExoMind 的 `origin_host_id`。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:466-537`。

这些都说明仓库已经接受“复制必须带来源与顺序元数据”这个前提。可继承，但还没抽象成统一层。

### 4. `Journal/SourceChain` 是两条路线之间最真实的桥

- 当前架构里已有 `Journal`、`WindowCache`、`EventLog Actor` 这些雏形。见 `docs/architecture/overview.md:253-260`、`docs/architecture/ECS-EDS-discussion-2026-03-04.md:385-394`。
- 讨论稿则明确说 `Journal ring buffer` 可以扩展成 `SourceChain`，并把它视为中期新增模块之一。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:654-674`。

也就是说，**真正可能从 RT-only 过渡到 EDS 的桥，不是把 topic 名换成 CRDT，而是先把“可补拉、可验证、可持久化的行为链”做出来。**

## 迁移阻力

### 1. 现在没有可直接替换的 EDS-2 插口

官方架构文档已经把 `EDS-2` 标成“未实现”，计划又把 CRDT 排除在当前主线之外。见 `docs/architecture/overview.md:332-338`、`docs/plans/PLAN-cross-device-incremental-sync.md:52-58`。

讨论稿也明确说未来要新增的是 `SourceChain`、`SyncEngine`、`OverlayRouter`、`PeerRegistry` 这类新模块，而不是“修改现有 SignalPool 一点点就行”。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:662-674`。

### 2. 先得把“谁负责最终 apply”收口

只要 `replication_actor`、UI projector、snapshot repair 同时存在，任何新 EDS/CRDT 原型都会遇到“双写”和“谁才是最终真相”的问题。见 `crates/exomind-runtime/src/signal/actors/replication_actor.rs:75-255`、`src/ui/hooks/useSignalStream.ts:233-252`、`src/ui/hooks/useSignalStream.ts:300-356`、`src/lib/services/rt-domain-backfill.service.ts:89-147`。

### 3. Reminder 现在是异形域

它有 RT route 和 replication topic，但没有 RT actor apply，也没有 backfill snapshot/export/import 接口，更没有进入 `RtDomainBackfillService` 的摘要类型。见 `crates/exomind-runtime/src/routes/reminders.rs:44-53`、`crates/exomind-runtime/src/signal/actors/replication_actor.rs:13-17`、`src/lib/services/rt-domain-backfill.service.ts:31-46`。

在这个不对称还没补齐之前，谈“统一迁移到 EDS/CRDT”会直接撞墙。

### 4. EventLog 的历史包袱还在

`EventStorage` 仍然是 PouchDB，并带着 remote sync 代码；而架构文档又把它记在 EDS-1 的“部分实现”里。见 `src/lib/storage/event-storage.ts:1-16`、`src/lib/storage/event-storage.ts:160-181`、`src/lib/storage/event-storage.ts:417-620`、`docs/architecture/overview.md:332-338`。

如果未来 EDS/CRDT 要进入 EventLog，而 Pouch fallback 还在，那么仓库里会同时存在三种持久化/复制心智：RT SQLite、Pouch sync、EDS/CRDT。

### 5. 当前 backfill 还是“全量 repair”，不是“同一对象空间里的 delta convergence”

这条阻力不是性能细节，而是结构问题。只要 backfill 还是整库 SQLite snapshot merge，任何 CRDT 方案都会面临一个问题：**repair 到底以 snapshot merge 为准，还是以 CRDT state merge 为准？** 当前计划本来想把这一步收口成 cursor pull，但实现还没到那里。见 `docs/plans/PLAN-cross-device-incremental-sync.md:271-305`、`src/lib/services/rt-domain-backfill.service.ts:89-147`。

## 建议的后续验证问题

1. **先定一个 apply 权威面。** 远端复制到本机后，最终写 RT SQLite 的权威应该是 `replication_actor`，还是 UI projector 回灌的 `/replication/upsert` route？不先定这个，EDS/CRDT 没有落点。
2. **Reminder 要不要补成 headless RT 路径。** 是否需要给 reminder 加 RT actor apply 和 backfill/export/import 接口，使它满足 `docs/specs/sync.md:45-51` 的验收口径？
3. **Backfill 要不要收口到计划中的 cursor pull。** 当前 snapshot repair 能工作，但它和未来 EDS/CRDT 的 repair 机制不兼容。要不要先把 `GET /.../replication/pull` 补出来，再谈 CRDT？
4. **EventLog 是否先彻底去掉 Pouch fallback。** 如果 EventLog 还双栈并存，未来 EDS/CRDT 会被迫同时兼容 `PouchDB` 和 `RT SQLite` 的历史路径。
5. **哪些域真的需要 CRDT，哪些只需要 RT-only projector。** 讨论稿把 `Agent 状态/记忆`、`用户数据/文件`、`配置/设置` 才列为 CRDT 优先区，当前计划则把 `Task/TimeBlock/Reminder/EventLog` 视为先做 RT-only 的领域。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:198-206`、`docs/plans/PLAN-cross-device-incremental-sync.md:52-58`。
6. **如果 Task/TimeBlock 将来真要进入 CRDT，领域半格是什么。** 现在代码里已有 `terminal precedence`、`phase monotonicity`、`version`、`host tie-break` 等硬规则。它们要么被正式提升为 CRDT/lattice 设计，要么继续留在 EDS 之上的领域层，不能含糊。
7. **SourceChain 是否应该先于通用 CRDT 落地。** 讨论稿已经把 `SourceChain` 定义成当前代码可承接的新模块，而且它直接桥接了现有 `Journal` 和未来持久同步。见 `docs/architecture/ECS-EDS-discussion-2026-03-04.md:466-537`、`docs/architecture/ECS-EDS-discussion-2026-03-04.md:654-674`。

## 结论

当前仓库里的结构冲突，不是“RT-only 和 EDS/CRDT 二选一”，而是**很多人容易把它们误认为同一层的不同实现**。事实并非如此：

- `RT-only` 当前做的是：把领域快照通过 ECS topic、mesh relay、projector 和 upsert/import 写入本地 RT SQLite。
- `EDS/CRDT` 设计要做的是：在持久对象/文件/文档这一层提供耐久的同步与收敛，然后只把结果或通知暴露给 ECS。

如果不先把当前主链路的 apply 权威、backfill 形状、Reminder 异形路径、EventLog 历史包袱收口，直接谈“把 CRDT 引进来”，最终只会得到更多并行同步路径，而不会得到更清晰的架构。
