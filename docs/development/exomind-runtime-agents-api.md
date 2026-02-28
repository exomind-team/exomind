# ExoMind Runtime Agents API（运行时 Agent 接口）

> 适用范围（Scope，范围）: `crates/exomind-runtime`
>  
> 目标（Goal，目标）: 基于当前代码，给出可直接联调的接口说明。

---

## 1. 基础信息（Basics，基础）

- Base URL（基础地址）: `http://127.0.0.1:<EXOMIND_RT_PORT>`
- 默认路由（Routes，路由）:
  - `GET /agents`
  - `POST /agents/:id/chat`
- 当前内置 Agent（Built-in Agents，内置 Agent）:
  - `claude`
  - `echo`
- CORS（跨域）: 允许任意来源（`*`）、`GET/POST/OPTIONS`

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

## 5. 状态码与错误（Status Codes & Errors，状态码与错误）

- `200 OK`: 成功建立 SSE 流
- `404 Not Found`: `:id` 对应 Agent 不存在
- `400 Bad Request`: 请求 JSON 非法（例如格式错误）

说明:

- `claude` 的多数运行时错误（如会话不存在、进程退出）通过 SSE `content` 分片返回，而不是切换 HTTP 状态码。

---

## 6. 联调示例（Examples，示例）

### 6.1 cURL（PowerShell）首轮创建会话

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

### 6.2 cURL（PowerShell）复用同一会话

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

## 7. Reqable 使用要点（Reqable Tips，Reqable 要点）

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

## 8. 代码对应（Source Mapping，代码映射）

- 路由与 SSE 封装: `crates/exomind-runtime/src/routes/agents.rs`
- `ChatChunk` / `ChatRequest` 结构: `crates/exomind-runtime/src/agent/mod.rs`
- Claude 会话管理与复用逻辑: `crates/exomind-runtime/src/agent/claude.rs`

