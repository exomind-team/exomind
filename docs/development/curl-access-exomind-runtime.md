# ExoMind Runtime curl 接入手册

> 状态：Active
>
> 最后核对：`2026-04-14`
>
> 核对基线：`a83404ad`
>
> 真相源：
> - `crates/exomind-runtime/src/lib.rs`
> - `crates/exomind-runtime/src/routes/eventlog.rs`
> - `crates/exomind-runtime/src/routes/tasks.rs`
> - `crates/exomind-runtime/src/routes/timeblocks.rs`
> - `crates/exomind-runtime/src/routes/profiles.rs`
> - `crates/exomind-runtime/src/routes/signals.rs`
> - `crates/exomind-runtime/src/routes/topology.rs`

本文档用于：

- 人工用 `curl` / `curl.exe` 直接探活、排障、回读 RT 真相源
- Agent / 脚本在不经过 UI 的情况下直接联调 raw HTTP 端点
- 给外部接入、跨设备验证、同步排障提供统一的最小真值

本文档不负责完整覆盖：

- `POST /agents/:id/chat` 这类 Agent SSE 接口
- `/act/today-planner/*` 这类 feature API 的完整行为细节
- mesh peer token / grant 的完整运维流程

对应文档：

- CLI 外壳：[`exomind-cli.md`](./exomind-cli.md)
- Agent 会话 / SSE：[`exomind-runtime-agents-api.md`](./exomind-runtime-agents-api.md)
- 外部接入契约草案：[`runtime-external-access-contract.md`](./runtime-external-access-contract.md)
- Today Planner `/act/*`：[`today-planner-api.md`](./today-planner-api.md)

## 1. 先记住这几个差异

如果你看过更早的 skill / 手册，先用这组差异校正心智：

1. `GET /health` 现在只返回 `{"status":"ok"}`，版本信息已经拆到 `GET /version`。
2. 清空事件日志的真端点是 `DELETE /eventlog`，不是 `/eventlog/clear`。
3. `eventlog` 的档案作用域参数是 `user_id`；`tasks` / `timeblocks` 现在接受 `profile_id` 或 `user_id`，如果两者同时传入则 `profile_id` 优先，本文统一用 `user_id` 示例。
4. `GET /eventlog/watch` 默认是 watch from now；只有显式给 `since_id` 或 `since_timestamp` 才会先补 backlog。
5. 时间块的结束流程不是单步“直接结束”，而是 `start -> stop -> end`。
6. raw RT 目前仍然是主调试面；feature API 里已经上线的是 `/act/today-planner/*`，但时间块等主要工作流仍以 raw 路由为主。

## 2. 标识与作用域

当前最容易混淆的是“显示名”和“RT 作用域键”。

| 概念 | 示例 | 含义 |
|------|------|------|
| `displayName` | `Argon` | UI 显示名 |
| `slug` | `argon` | 归一化标识 |
| `profileId` | `profile-argon` | 存储键 |
| `scopeKey` / `user_id` | `profile-argon` | 当前 raw RT 查询参数 |

当前 `profileId` 与 `user_id` 在实现里恰好相同，但这是当前实现，不应当把它当成永远不会变的契约。

`eventlog` 还有两个 scope 细节容易被忽略：

- `user_id` 省略或空串时会落到 `anonymous`
- 非字母数字、`-`、`_` 的字符会被替换成 `_`

本地 profile ID 生成规则在 [`src/lib/profile/profile-storage.ts`](../../src/lib/profile/profile-storage.ts)：

```ts
function createProfileIdBase(slug: string): string {
  const normalized = normalizeProfileSlug(slug);
  return `profile-${normalized || 'default'}`;
}
```

## 3. 路由可达性与鉴权边界

这份手册里的 raw 路由，大部分都挂在 protected route tree 上，不在 `public_router()`。

- 顶层公开探活只有 `/health` 与 `/version`
- `eventlog` / `tasks` / `timeblocks` / `profiles` / `signals` / `topology` 都在 protected tree
- 如果 `AppState.auth_secret` 是 `None`，本地开发模式会直接放行
- 非 loopback 绑定若未显式配置 `EXOMIND_RT_SECRET`，RT 会自动生成临时 admin secret
- 开了 `allow_lan_without_auth` 时，私网请求可免 token

鉴权开启时，可用：

- `Authorization: Bearer <token>`
- `?token=<token>`

mesh 的少数公开配对端点不在本文覆盖范围内；它们属于 `routes::public_router()` 的另一层。

## 4. PowerShell 与 curl.exe 约定

在 Windows PowerShell 下：

- 优先用 `curl.exe`，不要依赖 `curl` 别名
- JSON body 尽量写临时文件，再 `--data-binary "@file.json"`
- 如果只是 GET，可以直接内联 URL

示例：

```powershell
$enc = New-Object System.Text.UTF8Encoding($false)
$tmp = Join-Path $env:TEMP "exo-sample.json"
[System.IO.File]::WriteAllText($tmp, '{"title":"示例任务"}', $enc)

curl.exe -sS -X POST "http://127.0.0.1:9124/tasks?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "@$tmp"
```

## 5. 最小探活链路

### 5.1 基础可用性

```bash
curl -sS http://127.0.0.1:9124/health
curl -sS http://127.0.0.1:9124/version
curl -sS http://127.0.0.1:9124/topology
curl -sS http://127.0.0.1:9124/profiles
```

当前 live 返回形态示例：

```json
{"status":"ok"}
```

```json
{"version":"0.3.0","git_hash":"2e0b1e2","build_time":"2026-04-14T09:05:27Z"}
```

### 5.2 选定档案

如果你知道显示名是 `Argon`，通常会先回读：

```bash
curl -sS http://127.0.0.1:9124/profiles
```

然后确认有：

```json
{"id":"profile-argon","slug":"argon","displayName":"Argon"}
```

之后统一使用：

```text
user_id=profile-argon
```

## 6. 诊断 / 发现类端点

| 端点 | 方法 | 作用 | 备注 |
|------|------|------|------|
| `/health` | GET | 基础健康检查 | 只返回 `status` |
| `/version` | GET | 版本 / git hash / build time | 用于确认真版本 |
| `/topology` | GET | RuntimeHost / Device / DeviceComponent / DeviceLink 视图 | 当前节点拓扑真值 |
| `/profiles` | GET | 已知档案列表 | 从 eventlog scope 推导 |
| `/signals/history` | GET | 全局信号历史 | 无档案隔离 |

### 6.1 `/topology`

```bash
curl -sS http://127.0.0.1:9124/topology
```

当前返回既包含 legacy flat fields，也包含 nested foundation fields，例如：

- `host_id`
- `hostname`
- `capabilities`
- `runtime_host`
- `device`
- `device_components`
- `device_links`

### 6.2 `/signals/history`

```bash
curl -sS "http://127.0.0.1:9124/signals/history?limit=20"
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&topic_prefix=task."
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&exclude_topic_prefix=system.link_proof."
curl -sS "http://127.0.0.1:9124/signals/history?limit=20&after_event_id=<signal-id>"
```

查询参数：

- `limit`，默认 `50`
- `topic_prefix`
- `exclude_topic_prefix`
- `after_event_id`

注意：`/signals/history` 是全局窗口，不是档案级真值。涉及具体档案时，回到 `/eventlog?user_id=...` 复核。

## 7. EventLog raw 路由

### 7.1 查询参数与请求体

`GET /eventlog` 查询参数：

- `user_id`
- `limit`
- `since_id`
- `since_timestamp`
- `until_timestamp`
- `tags`，逗号分隔

`DELETE /eventlog` 查询参数：

- `user_id`

`GET /eventlog/watch` 查询参数：

- `user_id`
- `since_id`
- `since_timestamp`
- `until_timestamp`
- `tags`
- `timeout`

`POST /eventlog` 请求体：

```json
{
  "id": "optional-uuid",
  "timestamp": 1776164207776,
  "content": "消息内容",
  "tags": ["note"],
  "refs": [],
  "metadata": {
    "source": {
      "app": "Codex CLI",
      "deviceName": "Codex curl"
    }
  }
}
```

要点：

- `id` 可省略；省略时 RT 自动生成 UUID
- `timestamp` 必填，毫秒时间戳
- body 字段是 `snake_case`
- 相同 `id` 会走 upsert，不是严格 append-only

### 7.2 常用读取

```bash
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&limit=20"
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&since_timestamp=1776157200000"
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&since_timestamp=1776157200000&until_timestamp=1776165543333"
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&tags=note,task_completed"
curl -sS "http://127.0.0.1:9124/eventlog/<event-id>?user_id=profile-argon"
```

说明：

- `since_id + limit` 可做增量追踪
- `since_timestamp + until_timestamp` 适合按时间窗排障
- `tags` 过滤走逗号分隔字符串
- 响应头会带 `x-exomind-eventlog-revision`
- 响应头 `x-exomind-eventlog-list-semantics` 可能是 `full_snapshot` 或 `incremental_batch`
- 如果你传了 `since_id` 但 cursor 不存在，结果仍会返回数据，但语义会退回 `full_snapshot`

### 7.3 watch 语义

```bash
# 从现在开始等未来新事件
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&timeout=30"

# 从某个事件之后 catch up
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&since_id=<event-id>&timeout=30"

# 从某个时间戳之后 catch up
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&since_timestamp=1776157200000&timeout=30"
```

当前代码语义：

- 不给 `since_id / since_timestamp`：只等未来，不回放历史 backlog
- 给了 cursor：先补 cursor 之后已有事件，没有再继续等
- `timeout` 默认 `60` 秒，最大 `300` 秒

### 7.4 追加事件

```bash
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"timestamp":1776164207776,"content":"hello from curl","tags":["note"]}'
```

建议写入后立刻回读：

```bash
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&limit=1"
```

### 7.5 清空事件日志

```bash
curl -sS -X DELETE "http://127.0.0.1:9124/eventlog?user_id=profile-argon"
```

这是危险操作。当前真端点是 `DELETE /eventlog`，不是旧文档里曾出现过的 `/eventlog/clear`。

### 7.6 后端状态与备份

```bash
curl -sS "http://127.0.0.1:9124/eventlog/backend/status"
curl -sS "http://127.0.0.1:9124/eventlog/backup/json?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/eventlog/backup/sqlite?user_id=profile-argon"
```

当前 backend status 形态：

```json
{"backend":"rt-sqlite","supports_json_backup":true,"supports_sqlite_snapshot":true}
```

`/eventlog/backup/sqlite` 返回的是 JSON 包装体，不是直接下载二进制 SQLite 文件；真正的快照字节在 `content_base64`。

### 7.7 导入

支持两种导入策略：

- `strategy=merge`
- `strategy=overwrite`

JSON 导入：

```bash
curl -sS -X POST "http://127.0.0.1:9124/eventlog/import/json?user_id=profile-argon&strategy=merge" \
  -H "Content-Type: application/json" \
  --data-binary "@eventlog-backup.json"
```

SQLite 导入：

```bash
curl -sS -X POST "http://127.0.0.1:9124/eventlog/import/sqlite?user_id=profile-argon&strategy=overwrite" \
  -H "Content-Type: application/json" \
  --data-binary "@eventlog-sqlite-import.json"
```

其中 SQLite 导入 body 形态是：

```json
{
  "content_base64": "<sqlite-bytes-base64>"
}
```

注意：`eventlog` 导入当前把非法 `strategy` 和坏 SQLite base64 都映射到内部错误路径，排障时不要先入为主地等 `400`。

## 8. Tasks raw 路由

### 8.1 查询参数与状态机

`/tasks` 相关路由接受：

- `profile_id`
- `user_id`

如果两者同时传入，`profile_id` 优先。本文统一使用 `user_id`。

`GET /tasks` 还支持：

- `status`
- `tag`
- `parent_id`

状态机：

```text
pending -> in_progress <-> suspended -> completed / cancelled
```

当前实现不允许 `pending -> cancelled` 直跳；需要 shortcut 或中间过渡。

### 8.2 列表 / 详情

```bash
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&status=in_progress"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&tag=work"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&parent_id=<task-id>"
curl -sS "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon"
```

注意：`status` / `tag` / `parent_id` 是叠加过滤，不是互斥过滤。

### 8.3 创建任务

`POST /tasks` body 使用 `snake_case`：

```json
{
  "title": "厨房",
  "description": "2026-04-14，主要是帮厨",
  "priority": "medium",
  "tags": [],
  "depends_on": [],
  "time_block_ids": []
}
```

完整可选字段来自 `CreateTaskInput`：

- `title`
- `description`
- `done_condition`
- `priority`
- `tags`
- `source`
- `parent_id`
- `depends_on`
- `due_at`
- `estimated_minutes`
- `time_block_ids`

注意：

- `CreateTaskInput` 开了 `deny_unknown_fields`
- 创建时不能直接指定 `status`

示例：

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"title":"厨房","description":"2026-04-14，主要是帮厨","priority":"medium","depends_on":[],"time_block_ids":[]}'
```

### 8.4 更新任务

```bash
curl -sS -X PUT "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"description":"补充说明","tags":["home"]}'
```

注意：

- 更新 body 也是 `snake_case`
- `estimated_minutes` 支持传 `null` 来清空
- `DELETE /tasks/:id` 不是硬删除，而是兼容别名，语义等同于取消任务

### 8.5 状态迁移

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/<task-id>/transition?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

如果要让 RT 自动走合法中间路径，可以加 `shortcut=true`：

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/<task-id>/transition?user_id=profile-argon&shortcut=true" \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled"}'
```

### 8.6 批量迁移

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/batch-transition?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"id":"task-a","status":"completed"},{"id":"task-b","status":"suspended"}],"shortcut":true}'
```

注意：这是部分成功接口，不是事务式 all-or-nothing。要看返回里的 `results / succeeded / failed`。

### 8.7 取消任务

显式取消：

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/<task-id>/cancel?user_id=profile-argon"
```

兼容别名：

```bash
curl -sS -X DELETE "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon"
```

再次强调：这里不是硬删除，而是把任务迁移到 `cancelled`。

### 8.8 后端状态、备份、导入

```bash
curl -sS "http://127.0.0.1:9124/tasks/backend/status"
curl -sS "http://127.0.0.1:9124/tasks/backup/json?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/tasks/backup/sqlite?user_id=profile-argon"
```

导入：

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/import/json?user_id=profile-argon&strategy=merge" \
  -H "Content-Type: application/json" \
  --data-binary "@tasks-backup.json"
```

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/import/sqlite?user_id=profile-argon&strategy=overwrite" \
  -H "Content-Type: application/json" \
  --data-binary "@tasks-sqlite-import.json"
```

`/tasks/backup/sqlite` 同样返回 JSON 包装体，SQLite 字节在 `content_base64`。

### 8.9 同步 / 复制相关高级端点

这些端点主要给 RT 间同步与排障使用，不是普通外部客户端的首选：

- `GET /tasks/replication/summary`
- `GET /tasks/replication/pull`
- `POST /tasks/replication/upsert`
- `GET /mesh/tasks/summary`
- `GET /mesh/tasks/pull`
- `GET /mesh/tasks/snapshot/sqlite`
- `GET /mesh/peers/:peer_id/tasks/*`

## 9. TimeBlocks raw 路由

### 9.1 作用域与字段风格

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

### 9.2 读取历史与当前活动块

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

### 9.3 开始时间块

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

### 9.4 stop / end 两阶段结束

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

### 9.5 暂停与恢复

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/pause?user_id=profile-argon"
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/resume?user_id=profile-argon"
```

### 9.6 修改当前活动块的任务关联

```bash
curl -sS -X PATCH "http://127.0.0.1:9124/timeblocks/active/tasks?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"taskIds":["task-a","task-b"],"taskAssociationLog":[{"blockId":"tb-1","taskId":"task-a","action":"associated","timestamp":1776164213973,"source":"manual"}]}'
```

注意：

- body 是 `camelCase`
- 这里是整体替换，不是增量 merge
- `taskAssociationLog` 是历史关联语义基础，不只是装饰字段
- 任务与时间块关联语义见 [`../specs/timeblock-task-association-semantics.md`](../specs/timeblock-task-association-semantics.md)

### 9.7 描述时间块

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

### 9.8 `/timeblocks/new`

这是低层原语接口，适合脚本或测试，普通调用优先用 `start / stop / end / pause / resume`。

```bash
curl -sS -X POST "http://127.0.0.1:9124/timeblocks/new?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"blockType":"active","name":"低层原语示例","mode":"countup","taskIds":[]}'
```

注意：这个 body 也走 `camelCase`。同时它是低层原语，源码明确标注了 `No state validation`，不要把它当成带 guard 的业务入口。

### 9.9 后端状态、备份、导入

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

### 9.10 高级同步端点

主要用于多端复制与 mesh，对普通手工 curl 不作为首选：

- `POST /timeblocks/replication/completed`
- `POST /timeblocks/backfill-gaps`
- `POST /mesh/timeblocks/grants/reconcile`
- `GET /mesh/timeblocks/snapshot/sqlite`
- `GET /mesh/peers/:peer_id/timeblocks/snapshot/sqlite`

## 10. 当前已上线的 feature API

raw API 之外，当前仓库里已经注册了：

- `GET /act/today-planner`
- `POST /act/today-planner/windows`
- `POST /act/today-planner/windows/:window_id/reflow`
- `PATCH /act/today-planner/segments/:segment_id`
- `POST /act/today-planner/segments/:segment_id/start`

完整示例请看 [`today-planner-api.md`](./today-planner-api.md)。

时间块等其它工作流的长期方向见 [`runtime-external-access-contract.md`](./runtime-external-access-contract.md)，但截至当前代码，主联调面仍是 raw 路由。

## 11. `/agents/*` 与本手册的边界

如果你要调的是：

- `GET /agents`
- `POST /agents/:id/chat`
- `GET /agents/:id/sessions`
- `DELETE /agents/:id/sessions/:sid`

请直接看 [`exomind-runtime-agents-api.md`](./exomind-runtime-agents-api.md)。

本手册只负责 raw RT 联调面，不重复铺开 SSE 会话文档。

## 12. 复核清单

更新或使用本手册时，至少复核这几项：

- `GET /health` 与 `GET /version` 是否仍然分离
- `DELETE /eventlog` 是否仍为清空端点
- `eventlog` 是否仍以 `user_id` 为主作用域参数
- `tasks` / `timeblocks` 是否仍接受 `profile_id` 与 `user_id` 双别名
- `timeblocks/end` 是否仍要求先 `stop`
- `/act/*` 是否新增了新的对外默认入口，导致 raw 手册需要降级为“调试层”说明
