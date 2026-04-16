> 最后更新：`2026-04-16` | 更新者：`Codex` | 更新内容概要：`拆分 timeblocks 生命周期、guard、导入导出与复制端点细节。`

# TimeBlocks

## 作用域与字段风格

`/timeblocks` 相关查询参数支持：

- `profile_id`
- `user_id`
- `block_type`，可选值目前是 `active` / `gap`

如果两者同时传入，`profile_id` 优先。

和 tasks 不同，时间块多个请求体用了 `camelCase`。

最常见的坑：

- `new` 用 `blockType / targetMinutes / taskIds / sourcePlannedBlockId`
- `start` 用 `targetMinutes / taskIds / sourcePlannedBlockId`
- `active/tasks` 用 `taskIds / taskAssociationLog`
- `end` 用 `taskStatusOutcomes`
- 但列表过滤 query 仍是 `block_type=active|gap`

## 读取历史与当前活动块

```bash
curl -sS "http://127.0.0.1:9124/timeblocks?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/timeblocks?user_id=profile-argon&block_type=active"
curl -sS "http://127.0.0.1:9124/timeblocks?user_id=profile-argon&block_type=gap"
curl -sS "http://127.0.0.1:9124/timeblocks/active?user_id=profile-argon"
```

注意：`GET /timeblocks` 只返回 completed blocks；当前 active block 必须走 `/timeblocks/active`。

`GET /timeblocks/active` 当前 live 形态示例：

```json
{
  "startId":"tb-866c96a4-b8bc-4053-b76e-c35dd710cbbf",
  "name":"吃饭",
  "mode":"countdown",
  "targetMinutes":25,
  "blockType":"active",
  "taskIds":[],
  "sourcePlannedBlockId":null
}
```

## 开始时间块

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/start?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"name":"厨房","mode":"countdown","targetMinutes":25,"taskIds":["09c9057a-013f-4776-b50d-2ead4b7d4842"]}'
```

请求体字段：

- `name`
- `mode`，默认 `countup`
- `targetMinutes`
- `taskIds`
- `sourcePlannedBlockId`

当前 guard：

- 当前块若仍是未结束的 active block，会返回 `409 cannot start: active block in progress`

## stop / end 两阶段结束

第一步：进入反馈阶段

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/stop?user_id=profile-argon"
```

第二步：提交反馈并真正结束，RT 会创建后续 gap block

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/end?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"feedback":"手机点反馈，电脑提交反馈","taskStatusOutcomes":{"09c9057a-013f-4776-b50d-2ead4b7d4842":"suspended"}}'
```

当前 guard：

- 没有 active block：`409 cannot end: no active block`
- 当前是 gap：`409 cannot end: current block is a gap`
- 还没 `stop`：`409 cannot end: must stop first (use POST /timeblocks/stop)`

## 暂停与恢复

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/pause?user_id=profile-argon"
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/resume?user_id=profile-argon"
```

## 修改当前活动块的任务关联

```bash
curl -sS -X PATCH "http://127.0.0.1:9124/timeblocks/active/tasks?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"taskIds":["task-a","task-b"],"taskAssociationLog":[{"blockId":"tb-1","taskId":"task-a","action":"associated","timestamp":1776164213973,"source":"manual"}]}'
```

注意：

- body 是 `camelCase`
- 这里是整体替换，不是增量 merge
- `taskAssociationLog` 是历史关联语义基础，不只是装饰字段
- 任务与时间块关联语义见 [`../../../docs/specs/timeblock-task-association-semantics.md`](../../../docs/specs/timeblock-task-association-semantics.md)

## 描述时间块

修改当前活动块名称：

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/describe?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"name":"新的时间块名称"}'
```

修改指定块：

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/<block-id>/describe?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"name":"新名称","note":"补充备注"}'
```

当前规则：

- 当前 active block：允许，但只会应用 `name`
- 已完成 gap block：允许
- 已完成 active block：禁止 retroactive 修改，返回冲突

## `/timeblocks/new`

这是低层原语接口，适合脚本或测试，普通调用优先用 `start / stop / end / pause / resume`。

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/new?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"blockType":"active","name":"低层原语示例","mode":"countup","taskIds":[]}'
```

注意：这个 body 也走 `camelCase`。同时它是低层原语，源码明确标注了 `No state validation`，不要把它当成带 guard 的业务入口。

## 后端状态、备份、导入

```bash
curl -sS "http://127.0.0.1:9124/timeblocks/backend/status"
curl -sS "http://127.0.0.1:9124/timeblocks/backup/json?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/timeblocks/backup/sqlite?user_id=profile-argon"
```

导入：

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/import/json?user_id=profile-argon&strategy=merge" \
  -H "Content-Type: application/json" \
  --data-binary "@timeblocks-backup.json"
```

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/import/sqlite?user_id=profile-argon&strategy=overwrite" \
  -H "Content-Type: application/json" \
  --data-binary "@timeblocks-sqlite-import.json"
```

注意：

- `/timeblocks/backup/json` 会同时带 `time_blocks` 与 `active_block`
- `/timeblocks/backup/sqlite` 返回 JSON 包装体，包含 `content_base64` 与 `active_block_present`
- 导入结果里有 `active_block_updated`，意味着导入不只补历史，也可能替换当前 active block

## 高级同步端点

主要用于多端复制与 mesh，对普通手工 curl 不作为首选：

- `POST /timeblocks/replication/completed`
- `POST /timeblocks/backfill-gaps`
- `POST /mesh/timeblocks/grants/reconcile`
- `GET /mesh/timeblocks/snapshot/sqlite`
- `GET /mesh/peers/:peer_id/timeblocks/snapshot/sqlite`
