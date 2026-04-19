> 最后更新：`2026-04-19` | 更新者：`Codex` | 更新内容概要：`补充 tasks raw fallback 语义，并明确等待类 task 条件默认走 /act/await。`

# Tasks

## `/act/*` 与 raw `/tasks*` 的分层

先记住当前边界：

- 目前没有已注册的通用 `/act/tasks/*` 外部动作族，因此任务列表、创建、更新、迁移等操作仍经常需要回退到 raw `/tasks*`
- 但这不代表 raw `/tasks*` 是一切 task 相关动作的默认入口；如果某个 feature 已有 `/act/*` 契约，就先走 `/act/*`
- 如果 Agent 要等待任务被创建、状态变化或完成，默认优先 `POST /act/await` 的 `task_created` / `task_status_changed` / `task_completed`
- 本文只描述 task 的 raw fallback / debug 路径

## 查询参数与状态机

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

## 列表 / 详情

```bash
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&status=in_progress"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&tag=work"
curl -sS "http://127.0.0.1:9124/tasks?user_id=profile-argon&parent_id=<task-id>"
curl -sS "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon"
```

注意：`status` / `tag` / `parent_id` 是叠加过滤，不是互斥过滤。

## 创建任务

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

## 更新任务

```bash
curl -sS -X PUT "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"description":"补充说明","tags":["home"]}'
```

注意：

- 更新 body 也是 `snake_case`
- `estimated_minutes` 支持传 `null` 来清空
- `DELETE /tasks/:id` 不是硬删除，而是兼容别名，语义等同于取消任务

## 状态迁移

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

## 批量迁移

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/batch-transition?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"id":"task-a","status":"completed"},{"id":"task-b","status":"suspended"}],"shortcut":true}'
```

注意：这是部分成功接口，不是事务式 all-or-nothing。要看返回里的 `results / succeeded / failed`。

## 取消任务

显式取消：

```bash
curl -sS -X POST "http://127.0.0.1:9124/tasks/<task-id>/cancel?user_id=profile-argon"
```

兼容别名：

```bash
curl -sS -X DELETE "http://127.0.0.1:9124/tasks/<task-id>?user_id=profile-argon"
```

再次强调：这里不是硬删除，而是把任务迁移到 `cancelled`。

## 后端状态、备份、导入

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

## 同步 / 复制相关高级端点

这些端点主要给 RT 间同步与排障使用，不是普通外部客户端的首选：

- `GET /tasks/replication/summary`
- `GET /tasks/replication/pull`
- `POST /tasks/replication/upsert`
- `GET /mesh/tasks/summary`
- `GET /mesh/tasks/pull`
- `GET /mesh/tasks/snapshot/sqlite`
- `GET /mesh/peers/:peer_id/tasks/*`
