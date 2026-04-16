# ExoMind Runtime Agents API（运行时 Agent 接口）

> 适用范围（Scope，范围）: `crates/exomind-runtime`
>  
> 目标（Goal，目标）: 基于当前代码，给出可直接联调的接口说明。
>
> 边界：非 `/agents/*` 的 raw RT 端点，请看 [`../../skills/exomind-rt-agent-access/SKILL.md`](../../skills/exomind-rt-agent-access/SKILL.md)。

---

## 1. 基础信息（Basics，基础）

- Base URL（基础地址）: `http://127.0.0.1:<EXOMIND_RT_PORT>`
- 默认路由（Routes，路由）:
  - `GET /agents`
  - `POST /agents/:id/chat`
  - `GET /agents/:id/sessions`
  - `GET /agents/:id/sessions/:sid`
  - `DELETE /agents/:id/sessions/:sid`
- 当前内置 Agent（Built-in Agents，内置 Agent）:
  - `claude`
  - `echo`
- CORS（跨域）: 允许任意来源（`*`）、`GET/POST/DELETE/OPTIONS`

---

## 2. `GET /agents`

### 2.1 作用（Purpose，用途）

返回当前可用 Agent 列表（包含 `id/name/description/status`）。

### 2.2 响应示例（Response Example，响应示例）

```json
[
  {
    "id": "claude",
    "name": "Claude Agent",
    "description": "通过 Claude Code CLI 提供流式对话",
    "status": "available"
  },
  {
    "id": "echo",
    "name": "Echo Agent",
    "description": "回显输入内容",
    "status": "available"
  }
]
```

---

## 3. `POST /agents/:id/chat`

### 3.1 请求体（Request Body，请求体）

`Content-Type: application/json`

```json
{
  "message": "你好",
  "session_id": "optional-session-id"
}
```

字段说明（Field Notes，字段说明）:

- `message`（必填）: 用户输入文本
- `session_id`（可选）: 会话复用 ID（前后空格会被 `trim`）

### 3.2 响应类型（Response Type，响应类型）

`text/event-stream`（SSE，服务端事件流）

服务端按事件推送（每条 `data:` 一行），最后固定输出:

```text
data: [DONE]
```

### 3.3 数据片段结构（ChatChunk，聊天分片）

每个 `data:` 行的 JSON 结构：

```json
{
  "content": "分片文本",
  "session_id": "optional-on-first-turn"
}
```

注意（Notes，注意）:

- `session_id` 仅在“新建会话”的首轮返回（可能在首个文本分片里出现）。
- 复用会话时，后续分片通常不再带 `session_id`。
- `session_id` 为 `Option` 字段，为空时不会出现在 JSON 中。

---

## 4. Claude 会话语义（Claude Session Semantics，会话语义）

以下行为仅针对 `id=claude`:

1. 不传 `session_id`:
   - 新建 Claude 子进程会话（Persistent Process，持久进程）
   - 返回新的 ExoMind `session_id`
2. 传入存在的 `session_id`:
   - 复用同一个 Claude 子进程
   - 保持多轮上下文
3. 传入不存在/已失效 `session_id`:
   - 流中返回错误文本分片：`Claude 会话不存在: <id>`
4. 并发同会话请求:
   - 若会话在 `Processing`，返回：`Claude 会话正在处理中，请稍后重试`
5. 资源上限:
   - 最多 64 个 Claude 会话（`MAX_CLAUDE_SESSIONS = 64`）
6. 结束标志:
   - 每一轮都以 `data: [DONE]` 结束

---

## 5. `GET /agents/:id/sessions`

### 5.1 作用（Purpose，用途）

返回指定 Agent 的所有活跃会话列表。

### 5.2 响应示例（Response Example，响应示例）

```json
[
  {
    "session_id": "a1b2c3d4-...",
    "status": "idle",
    "created_at": "2026-02-28T10:30:00Z",
    "last_active": "2026-02-28T10:35:00Z",
    "message_count": 3,
    "uptime_secs": 300
  }
]
```

### 5.3 状态码（Status Codes，状态码）

- `200 OK`: 返回 JSON 数组（可能为空 `[]`）
- `404 Not Found`: Agent 不存在

---

## 6. `GET /agents/:id/sessions/:sid`

### 6.1 作用（Purpose，用途）

返回指定会话的详细信息。

### 6.2 响应示例（Response Example，响应示例）

```json
{
  "session_id": "a1b2c3d4-...",
  "status": "idle",
  "created_at": "2026-02-28T10:30:00Z",
  "last_active": "2026-02-28T10:35:00Z",
  "message_count": 3,
  "uptime_secs": 300
}
```

### 6.3 状态码（Status Codes，状态码）

- `200 OK`: 返回 JSON 对象
- `404 Not Found`: Agent 或 Session 不存在

---

## 7. `DELETE /agents/:id/sessions/:sid`

### 7.1 作用（Purpose，用途）

关闭指定会话，终止 Claude 子进程并清理资源。

### 7.2 响应示例（Response Example，响应示例）

```json
{
  "status": "closed",
  "session_id": "a1b2c3d4-..."
}
```

### 7.3 状态码（Status Codes，状态码）

- `200 OK`: 会话已关闭
- `404 Not Found`: Agent 或 Session 不存在

---

## 8. 状态码与错误（Status Codes & Errors，状态码与错误）

- `200 OK`:
  - `GET /agents`
  - `POST /agents/:id/chat`（成功建立 SSE 流）
  - `GET /agents/:id/sessions`
  - `GET /agents/:id/sessions/:sid`
  - `DELETE /agents/:id/sessions/:sid`
- `404 Not Found`:
  - `:id` 对应 Agent 不存在
  - `:sid` 对应 Session 不存在（`GET/DELETE /agents/:id/sessions/:sid`）
- `400 Bad Request`: 请求 JSON 非法（例如格式错误）

说明:

- `claude` 的多数运行时错误（如会话不存在、进程退出）通过 SSE `content` 分片返回，而不是切换 HTTP 状态码。

---

## 9. 联调示例（Examples，示例）

### 9.1 cURL（PowerShell）首轮创建会话

```powershell
$enc = New-Object System.Text.UTF8Encoding($false)
$tmp1 = Join-Path $env:TEMP "exo-chat-1.json"
[System.IO.File]::WriteAllText($tmp1, '{"message":"你好，我叫小明"}', $enc)

curl.exe -N -X POST "http://127.0.0.1:1919/agents/claude/chat" `
  -H "content-type: application/json" `
  --data-binary "@$tmp1"
```

预期会出现（示意）:

```text
data: {"content":"...","session_id":"<uuid>"}
data: [DONE]
```

### 9.2 cURL（PowerShell）复用同一会话

```powershell
$sid = "<首轮返回的 session_id>"
$enc = New-Object System.Text.UTF8Encoding($false)
$tmp2 = Join-Path $env:TEMP "exo-chat-2.json"
[System.IO.File]::WriteAllText($tmp2, ('{"message":"我叫什么名字？","session_id":"' + $sid + '"}'), $enc)

curl.exe -N -X POST "http://127.0.0.1:1919/agents/claude/chat" `
  -H "content-type: application/json" `
  --data-binary "@$tmp2"
```

---

## 10. Reqable 使用要点（Reqable Tips，Reqable 要点）

1. Method（方法）: `POST`
2. URL: `http://127.0.0.1:<port>/agents/claude/chat`
3. Header（请求头）: `content-type: application/json`
4. Body（JSON）:
   - 首轮: `{"message":"你好，我叫小明"}`
   - 次轮: `{"message":"我叫什么名字？","session_id":"<首轮session_id>"}`
5. 响应查看（Response，响应）:
   - 以 SSE 文本形式查看 `data:` 行
   - 确认最后有 `data: [DONE]`

---

## 11. 代码对应（Source Mapping，代码映射）

- 路由与 SSE 封装: `crates/exomind-runtime/src/routes/agents.rs`
- `ChatChunk` / `ChatRequest` / `SessionInfo` 结构: `crates/exomind-runtime/src/agent/mod.rs`
- Claude 会话管理与复用逻辑: `crates/exomind-runtime/src/agent/claude.rs`
- CORS 方法配置（含 `DELETE`）: `crates/exomind-runtime/src/lib.rs`

---

## 12. `GET /eventlog/watch`（Raw Event Watch，原始事件监听）

### 12.1 作用（Purpose，用途）

对指定事件流做长轮询监听。

默认语义不是“补发全部历史事件”，而是：

- 未提供 `since_id` / `since_timestamp`：以调用时刻的当前尾事件为基线，只等待之后的新事件
- 提供了 `since_id` 或 `since_timestamp`：允许先返回 cursor 之后已存在的 backlog；若没有，再继续等新事件

这使得两类用法可以明确分离：

- `GET /eventlog`：查历史
- `GET /eventlog/watch`：默认看未来变化

### 12.2 查询参数（Query Parameters，查询参数）

- `user_id`（建议显式传入）: 指定档案作用域，例如 `profile-argon`
- `since_id`（可选）: 只关心该事件 ID 之后的事件
- `since_timestamp`（可选）: 只关心该时间戳之后的事件
- `until_timestamp`（可选）: 上界过滤
- `tags`（可选）: 逗号分隔标签过滤
- `timeout`（可选）: 超时时间，单位秒，默认 `60`，最大 `300`

### 12.3 响应语义（Response Semantics，响应语义）

- 有匹配的新事件时：立即返回 JSON 数组
- 在 `timeout` 内没有匹配事件时：返回空数组 `[]`
- 返回数组中的事件 `id` 可直接作为下次 `since_id`

### 12.4 cURL 验证（Examples，示例）

终端 A：

```bash
curl -sS "http://127.0.0.1:9124/eventlog/watch?user_id=profile-argon&timeout=30"
```

终端 B：

```bash
curl -sS -X POST "http://127.0.0.1:9124/eventlog?user_id=profile-argon" \
  -H "Content-Type: application/json" \
  -d '{"timestamp": 1774334181683, "content": "watch test", "tags": ["note"]}'
```

预期：

- 终端 A 在 POST 之前不应提前返回
- POST 之后终端 A 应立即返回包含新事件的数组
- 若本次 watch 未提供 cursor，返回结果应只包含这条刚写入的新事件
- 返回事件的 `id` 应与 POST 响应中的 `id` 一致

### 12.5 使用建议（Usage Notes，使用建议）

- 需要历史上下文时，先调 `GET /eventlog`
- 需要“从现在开始等变化”时，直接调 `GET /eventlog/watch`
- 需要“从某个已知位置补齐并继续等”时，给 `watch` 传 `since_id` 或 `since_timestamp`
