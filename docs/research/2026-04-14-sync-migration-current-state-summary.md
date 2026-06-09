# 同步搬迁现况汇总

> 日期：2026-04-14
> 范围：基于当前仓库代码、当前文档、当前 issue 的同步 / 搬迁现状汇总

## 1. 当前主链路

当前现行同步规范仍以 `RT-only` 为准：

- `device pairing`
- `RT net / mesh relay`
- `signal SSE`
- `domain projector`
- `RT SQLite`

业务域口径上统一视为 RT SQLite 真相源：

- EventLog
- Task
- TimeBlock
- Reminder

主规范文件：

- [sync.md](../specs/sync.md)

## 2. 当前最重要的四个现状

### 2.1 多 Domain Reconciliation 已成形，但只在 Task 域完整落地

当前已经不再是“完全没有 reconciliation”。

Task 域已经具备：

- `summary`
- `compare`
- `pull`
- `snapshot fallback`
- `unresolved drift`

对应实现：

- [task-reconciliation.service.ts](../../src/lib/services/task-reconciliation.service.ts)
- [task-backup.service.ts](../../src/lib/services/task-backup.service.ts)
- [tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs)

但 EventLog / TimeBlock 仍主要停留在：

- live replication topic 已有
- peer-auth scoped snapshot 已有
- recovery 仍以 blind snapshot merge 为主

对应实现：

- [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)
- [eventlog.rs](../../crates/exomind-runtime/src/routes/eventlog.rs)
- [timeblocks.rs](../../crates/exomind-runtime/src/routes/timeblocks.rs)

这意味着当前真实状态是：

- 新骨架已经出现
- Task 已迁入新骨架
- EventLog / TimeBlock 仍滞留在旧 backfill 骨架

### 2.2 对象级冲突 contract 仍未显式化

当前对象冲突处理，本质上还是各域各自隐藏在比较函数里的裁决规则。

典型表现：

- Task：`updated_at`、终态优先、`completed_at`、`host_id` 决胜
- Active TimeBlock：`start_id`、开始时间、phase、version、transition 时间、`host_id`
- Proposal：`updated_at` + `host_id`

对应实现：

- [replication_actor.rs](../../crates/exomind-runtime/src/signal/actors/replication_actor.rs)

当前仍缺：

- conflict object 持久化 schema
- losing branch 证据保留
- validator / audit trail
- 跨域统一的冲突表达

Task 虽然已经能标记 `unresolvedDrift`，但这仍属于 repair 结果，不是完整的冲突实体。

### 2.3 peer-auth / scope-grant / recovery 壳层已半落地，但仍是过渡态

新数据面已经成立：

- peer secret 在 runtime mesh 内部持有
- `PeerScopeGrant` 已持久化
- peer-auth route 已按 `peer_id -> grant -> scope_key` 工作
- Task 已通过 peer-auth 跑通完整 reconciliation

对应实现：

- [mesh/mod.rs](../../crates/exomind-runtime/src/mesh/mod.rs)
- [auth.rs](../../crates/exomind-runtime/src/auth.rs)
- [tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs)

但 durable recovery 仍未统一，当前仍存在：

- `meshPeers` 新路径
- `legacySnapshotPeers` 旧路径

并且三域不对称：

- Task：完整 adapter
- EventLog / TimeBlock：只有 peer-auth snapshot fallback

协调壳层仍横跨：

- runtime mesh state
- host record
- UI backfill coordinator

对应实现：

- [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)
- [runtime-mesh-host-sync.service.ts](../../src/lib/services/runtime-mesh-host-sync.service.ts)

### 2.4 Reminder 是最典型的半迁移域

Reminder 已不再是纯旧域。

已经完成的部分：

- RT CRUD 已存在
- RT SQLite 真相源已存在
- live replication topic 已存在
- 默认前端 service 已改走 RT adapter

对应实现：

- [reminders.rs](../../crates/exomind-runtime/src/routes/reminders.rs)
- [reminder.service.ts](../../src/lib/services/reminder.service.ts)
- [reminder_runtime_sqlite_persistence.rs](../../crates/exomind-runtime/tests/reminder_runtime_sqlite_persistence.rs)

但 Reminder 仍是异形域：

- 到期推进权威仍在前端 scheduler
- 未纳入统一 reconciliation 第一批
- recovery / backfill 主壳不含 Reminder
- 旧 sync 接口壳仍在
- Pouch adapter / storage 残留仍在

对应实现：

- [reminder-scheduler.service.ts](../../src/lib/services/reminder-scheduler.service.ts)
- [ReminderNotifier.tsx](../../src/ui/app/components/ReminderNotifier.tsx)
- [reminder.port.ts](../../src/lib/environment/interfaces/reminder.port.ts)
- [reminder-pouch-adapter.ts](../../src/lib/adapters/reminder-pouch-adapter.ts)
- [reminder-storage.ts](../../src/lib/storage/reminder-storage.ts)

## 3. 当前最值得看的现况文件

### 3.1 现行规范

- [sync.md](../specs/sync.md)

### 3.2 当前总设计

- [2026-04-13-multi-domain-reconciliation-design.md](../plans/2026-04-13-multi-domain-reconciliation-design.md)

### 3.3 当前分域样板

- [task-reconciliation.service.ts](../../src/lib/services/task-reconciliation.service.ts)
- [task-backup.service.ts](../../src/lib/services/task-backup.service.ts)
- [tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs)

### 3.4 当前恢复壳层

- [rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)
- [runtime-mesh-host-sync.service.ts](../../src/lib/services/runtime-mesh-host-sync.service.ts)
- [mesh/mod.rs](../../crates/exomind-runtime/src/mesh/mod.rs)
- [auth.rs](../../crates/exomind-runtime/src/auth.rs)

### 3.5 当前评估文件

- [EDS架构成型性评估报告-2026-04-14.md](./EDS架构成型性评估报告-2026-04-14.md)

## 4. 当前 issue 映射

- `#906`
  - 当前最合适继续作为“搬迁式重构” umbrella issue
  - 它对应的是旧骨架迁出、新骨架明确化
- `#910`
  - 当前最适合作为“EDS 成型性现况”追踪入口
  - 但其中部分表述已落后于最新代码，需要回写更新
- `#868`
  - 仍然有效
  - 它对应 durable recovery / sync contract 压力
- `#869`
  - 仍然有效
  - 它对应对象级冲突 contract 的缺口
- `#893`
  - 仍然有效
  - 它对应 Reminder headless/runtime authority 缺口

## 5. 当前总判断

现在最准确的判断不是“外心还没探索出新架构”，而是：

- 新架构已经探索出来了
- Task 域已经证明新骨架能工作
- 系统剩余问题主要集中在“迁移未完成”

更具体地说，当前卡点是：

- EventLog / TimeBlock 还没迁入完整 reconciliation 骨架
- 冲突仍是隐式规则，不是显式 contract
- recovery 仍有新旧双路径并存
- Reminder 仍是“数据已迁、运行时主权未迁”的半迁移域

因此，当前同步问题的性质更接近：

- 不是继续打零散补丁
- 而是围绕新骨架完成一次明确的搬迁

## 6. 当前 issue 差异与最小改写建议

### 6.1 调整原则

- 只修改已经被当前代码 / 文档现状证伪的表述
- 不改 issue 的角色、边界、验收口径、关联关系
- 不因为现状推进，就把仍有效的问题改写成“已解决”

### 6.2 `#906`

- 处理方式：只改一处过时表述，其余不动
- 当前过时点：
  - `第一条对象同步闭环优先选择 EventLog / TimeBlock`
- 为什么过时：
  - 当前真正已经跑通完整 `summary -> compare -> pull -> snapshot fallback -> unresolved drift` 样板的是 `Task`
  - `EventLog / TimeBlock` 仍主要停留在 live replication + peer-auth snapshot fallback + blind merge
- 最小改写建议：
  - 将上述句子改成“`Task` 已先行证明对象同步骨架可工作；`EventLog / TimeBlock` 是下一批需要迁入完整 reconciliation 骨架的主域”

### 6.3 `#910`

- 处理方式：保留 issue 定位，只回写两处已落后于代码的描述
- 当前过时点 1：
  - `EventLog/TimeBlock peer-auth 路由未实现`
- 为什么过时：
  - 当前 `eventlog.rs` / `timeblocks.rs` 已有 peer-auth scoped snapshot / proxy / grant 路由
  - 真正未完成的是 `summary / compare / pull / 统一 adapter`
- 最小改写建议：
  - 改为“`EventLog / TimeBlock` 已有 peer-auth 数据面，但仍缺 `summary / compare / pull` 与统一 reconciliation adapter”
- 当前过时点 2：
  - `Reminder 域仍是 Pouch 残留`
- 为什么过时：
  - Reminder 已有 RT CRUD、RT SQLite 真相源、live replication topic，默认前端 service 也已走 RT adapter
  - 当前真实缺口是 due-trigger authority 仍在前端、未纳入统一 reconciliation / recovery 主壳
- 最小改写建议：
  - 改为“Reminder 已进入 RT 半迁移态，但到期推进主权仍在前端，且尚未纳入统一 reconciliation 第一批”

### 6.4 `#868`

- 处理方式：保留 issue 边界与完成条件，只把“恢复完全缺失”改成“恢复已部分落地但仍处于过渡态”
- 当前过时点：
  - 标题和正文开头容易给出“配对 RT 还没有恢复性同步”的印象
- 为什么过时：
  - Task 域已经具备完整 reconciliation
  - `peer-auth / scope-grant / recovery shell` 已半落地
  - 当前主要问题不是“完全没有恢复”，而是 `meshPeers` 与 `legacySnapshotPeers` 双路径并存，且 `Task` 与 `EventLog / TimeBlock` 的恢复能力明显不对称
- 最小改写建议：
  - 若改标题，则改成“配对 RT 恢复性同步仍处于双路径过渡态，跨域补齐契约不对称”
  - 若不改标题，至少在正文开头补一句“当前恢复性同步并非空白，而是已部分落地但仍处于跨域不对称 / 双路径过渡态”

### 6.5 `#869`

- 处理方式：不动
- 原因：
  - 当前正文已经准确承认“冲突处理并非不存在，而是分散、隐式、按域各自实现”
  - 它与当前现况高度一致，最多只存在快照时间旧的问题，不构成方向性失真

### 6.6 `#893`

- 处理方式：不动
- 原因：
  - 当前正文与现况基本一致：Reminder 已有 RT CRUD / replication 基础，但 due-trigger authority 仍在前端 scheduler
  - 该 issue 追踪的正是“数据已迁、运行时主权未迁”的缺口
