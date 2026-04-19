> 最后更新：`2026-04-19` | 更新者：`Codex` | 更新内容概要：`补充 /act/await 与 raw eventlog watch 的职责分层，并保留 raw watch 的 cursor / catch-up 语义说明。`

# EventLog

## 与 `/act/await` 的分工

默认边界先记住：

- 如果 Agent 的目标是“等待一个未来条件成立一次后返回”，默认优先用 `POST /act/await`
- `GET /eventlog/watch` 是 raw EventLog long-poll；它保留给底层事件到达观察、cursor / catch-up 语义、排障与低层调试
- 只有在 `/act/*` 没有对应动作，或你明确需要 raw event arrival 细节时，才默认回到本文件的 watch 端点

等待“下一条事件”时，默认最小例子是：

```bash
curl -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  --data-binary '{"condition":{"type":"next_event"}}'
```

当前代码默认值：

- `/act/await` 默认 `timeoutSecs=1800`
- `/act/await` 默认 `heartbeatSecs=15`
- `GET /eventlog/watch` 默认 `timeout=60`，最大 `300`

## 查询参数与请求体

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

## 常用读取

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

## raw watch 语义

```bash
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&timeout=30"
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&since_id=<event-id>&timeout=30"
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&since_timestamp=1776157200000&timeout=30"
```

当前代码语义：

- 不给 `since_id / since_timestamp`：只等未来，不回放历史 backlog
- 给了 cursor：先补 cursor 之后已有事件，没有再继续等
- `timeout` 默认 `60` 秒，最大 `300` 秒

这表示：

- 默认 Agent 等待动作不应先想到这里，而应先想到 `/act/await`
- 这里更适合做 raw cursor 续接、backlog catch-up、底层事件到达排障

## 追加事件

```bash
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"timestamp":1776164207776,"content":"hello from curl","tags":["note"]}'
```

建议写入后立刻回读：

```bash
curl -sS "http://127.0.0.1:9124/eventlog?user_id=profile-argon&limit=1"
```

## 清空事件日志

```bash
curl -sS -X DELETE "http://127.0.0.1:9124/eventlog?user_id=profile-argon"
```

这是危险操作。当前真端点是 `DELETE /eventlog`，不是 `/eventlog/clear`。

## 后端状态与备份

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

## 导入

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
