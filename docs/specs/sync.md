# 多设备同步规格（RT-only）

> 说明：本文件已从旧的 `PouchDB Server + PouchSyncAdapter` 设计切换为当前主路径。旧方案仅保留为历史背景，不再代表现行实现。
>
> **Reticulum/ENS 注意**：本文件描述的是 RT-only / mesh relay 历史规格，不是 `exomind-reticulum` 分支的当前跨 RT 网络权威。当前目标是让 Reticulum 成为唯一跨 RT gateway，并在已授权设备之间同步 EventLog、Task、TimeBlock 与 Proposal；冷启动 Agent 应先读 `docs/plans/2026-06-08-reticulum-next-agent-handoff.md`。

## 1. 当前主路径

ExoMind 的多设备同步当前统一基于：

- `device pairing（设备配对）`
- `RT net / mesh relay（运行时网络 / 网格中继）`
- `signal SSE（信号流）`
- `domain projector（领域投影器）`
- `RT SQLite（本地真相源）`

业务域以 RT SQLite 为准：

- EventLog
- Task
- TimeBlock
- Reminder

## 2. 同步模型

### 2.1 增量复制

在线期间通过 signal topic 做低延迟复制，例如：

- `eventlog.replication.appended`
- `task.replication.upserted`
- `timeblock.replication.completed`
- `reminder.replication.upserted`

### 2.2 补拉

设备重连、重新配对或 UI 重新接流后，通过 backfill 补齐离线期间遗漏的数据。

## 3. 作用域策略

- 同一 `profile scope` 同步
- 不同 `profile scope` 隔离
- 设备本地配置默认不同步

## 4. 验收口径

真正的“同步成功”必须满足：

1. 远端 signal 到达
2. 本地 RT SQLite 写入成功
3. 页面只负责展示最终结果

不能再把“UI 收到 topic”误判为同步完成。

## 5. 历史说明

以下对象已退出主链路：

- `PouchSyncAdapter`
- `pouchdb-server.js`
- `6984` 作为默认同步端口
- `VITE_SYNC_SERVER_URL / EXOMIND_POUCHDB_*` 作为现行同步配置

如果需要追溯历史实现，请查阅旧版归档或 Git 历史，而不要把历史 Pouch 文档继续当成当前规范。
