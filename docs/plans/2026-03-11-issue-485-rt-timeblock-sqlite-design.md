# Issue #485 TimeBlock RT SQLite Design

## Goal

把 `TimeBlock` 的两类真实数据一起迁到 `RT + SQLite`：

- `completed blocks（已完成时间块）`
- `active block（当前进行中的时间块）`

同时补齐：

- Settings 统一入口里的 `TimeBlock JSON / SQLite` 导入导出
- 开发者模式里的 `TimeBlock backend` 状态与切换

## PR Strategy

最终建议仍然是 **两个 PR**：

1. `#484` EventLog -> RT SQLite
2. `#485` TimeBlock -> RT SQLite

当前可继续在同一个 worktree 中连续实现，但 commit 需要按 `#484` / `#485` 保持边界，后续再拆成 stacked PR（堆叠 PR）或独立 PR。

## Current State

当前 `TimeBlock` 不是单一存储：

- `completed blocks` 通过 `TimeBlockService` 写到 `env.storage` 的 `time_blocks`
- `active block` 在正常桌面链路下写到 `active-block-storage`（PouchDB）
- `active_block.replication.snapshot` 信号会被 `useSignalStream` 投影回 `ActiveBlockStorage`

这意味着当前 `TimeBlock` 域仍是半迁移状态，不能满足 “SQLite-first（SQLite 优先真实数据源）”。

## Chosen Architecture

采用“**前端状态机保留，持久化与导入导出切到 RT SQLite**”的方案。

### Backend

新增 `TimeBlockStore`，由 Rust runtime 持有，并暴露新的 `HTTP /timeblocks` 域能力。

建议数据模型分两部分：

1. `completed_timeblocks`
   - 存 `TimeBlockData`
2. `active_timeblock`
   - 存单例 `ActiveBlockData`

为了减少前后端字段转换风险，优先用“typed columns + JSON payload where needed（必要处用 JSON 负载）”的简单实现，而不是一开始过度范式化。

新增环境变量：

- `EXOMIND_RT_TIMEBLOCK_SQLITE_PATH`

桌面端默认路径：

- `timeblocks.sqlite`

### Runtime HTTP API

本轮最小 API：

- `GET /timeblocks`
- `PUT /timeblocks`
- `GET /timeblocks/active`
- `PUT /timeblocks/active`
- `DELETE /timeblocks/active`
- `GET /timeblocks/backend/status`
- `GET /timeblocks/backup/json`
- `GET /timeblocks/backup/sqlite`
- `POST /timeblocks/import/json?strategy=merge|overwrite`
- `POST /timeblocks/import/sqlite?strategy=merge|overwrite`

其中：

- `PUT /timeblocks` 采用“replace all（整体替换）”语义，方便前端沿用当前 `completed list append then save` 的做法
- `active` 子路由负责当前进行中时间块

### Frontend

新增两层：

1. `TimeBlockRtAdapter`
   - 负责 `completed blocks + active block` 的 RT 读写
2. `TimeBlockBackupService`
   - 负责 `JSON / SQLite` 导入导出与 backend status

`TimeBlockService` 保留现有业务状态机：

- `startBlock`
- `pauseBlock`
- `resumeBlock`
- `markEnding`
- `endBlock`

但把底层存储切换为：

- `legacy`
  - 保留当前 `env.storage + active-block-storage`
- `rt-sqlite`
  - `completed blocks` 走 `TimeBlockRtAdapter`
  - `active block` 也走 `TimeBlockRtAdapter`

## Active Block Replication

这是这轮最关键的收口点。

当前链路是：

- 本地变更 -> `publishActiveBlockReplicationSnapshot()`
- 远端信号 -> `projectActiveBlockReplicationSnapshot()` -> `ActiveBlockStorage`

迁移后改为：

- `legacy` 模式：
  - 保持现状，继续投影到 `ActiveBlockStorage`
- `rt-sqlite` 模式：
  - 远端信号直接通过 `TimeBlockService` / `TimeBlockRtAdapter` 写入 RT `active block`
  - 写入成功后通知 `onBlockChange` 订阅者

这样做的原因：

- 否则 `rt-sqlite` 模式下 UI 读 RT、投影写 Pouch，会再次出现真相源分裂

## Migration Strategy

采用“**read-promote（读时提升）**”：

### completed blocks

当 `backend = rt-sqlite` 时：

1. 先读 RT `/timeblocks`
2. 如果 RT 为空，再读 legacy `time_blocks`
3. 若 legacy 有数据，则一次性写入 RT

### active block

当 `backend = rt-sqlite` 时：

1. 先读 RT `/timeblocks/active`
2. 如果 RT 为空，再读 legacy `active_block`
3. 若 legacy 为空，再读 `ActiveBlockStorage`
4. 读到 legacy / Pouch 数据后，提升写入 RT

这样可以保证：

- 不需要一次性破坏旧数据
- 用户现有时间块不会因为切 backend 丢失

## Settings

统一数据入口继续沿用 `#484` 的交互：

- `导出数据`
- `导入数据`

在弹层里补齐 `TimeBlock`：

- 范围：`EventLog / Task / TimeBlock`
- 格式：`JSON / SQLite`

开发者模式补齐：

- `时间块后端：legacy / rt-sqlite`
- `时间块备份：JSON / SQLite`
- 允许切换 backend

## Testing

本轮最低测试要求：

### Rust

- `TimeBlockStore` SQLite 重启持久化
- `/timeblocks` routes
- `JSON / SQLite` import-export

### Frontend

- `TimeBlockRtAdapter` 单测
- `TimeBlockBackupService` 单测
- `SettingsPage` 的 TimeBlock import-export 单测
- `SettingsPage` 的 TimeBlock backend diagnostics 单测
- `TimeBlockService` 在 `rt-sqlite` 模式下的 completed / active 持久化单测

### Manual

- 启动一个时间块后重启，当前块仍存在
- 结束时间块后历史列表仍存在
- `TimeBlock JSON / SQLite` 导入导出可用
- 开发者模式显示 `时间块后端：rt-sqlite`

## Non-Goals

本轮不做：

- 不把 `TimeBlock` 状态机整体搬到 Rust
- 不重做 `TimeBlockWidget / FocusTimerWidget` 视觉交互
- 不重做 `timeblock.completed` reviewer 流程
- 不动 `#484` EventLog 已验收的行为语义，除非为统一入口复用极小接线
