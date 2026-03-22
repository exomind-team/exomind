# 通过 curl 接入 ExoMind Runtime（外心）的经验总结

## 结论先行

ExoMind 更适合走一条 `RT-first` 路线：

- 领域逻辑、状态机、持久化、同步、身份作用域放在 RT
- UI 主要负责呈现、交互编排、局部体验优化
- 对外统一暴露 HTTP API

这样带来的直接收益是：

- `curl` 能接入，说明外部程序也能接入
- 能走 HTTP API，CLI 和 MCP 就有统一控制面
- UI 不再是唯一真相源，排障时可以直接绕过 UI 看 RT 真值

但这里的“UI 只负责呈现”要收窄理解。更准确地说应当是：

- 业务真相在 RT
- UI 仍然可以拥有临时态、草稿态、选中态、动画态、乐观态

不要把所有东西都塞进 RT。`hover / drawer open / 搜索输入中 / 本地动画过渡` 这类纯表现态不值得上 RT。

## 为什么这条路是对的

结合这次实测，几个判断已经很清楚：

- RT 的 `signals/history` 和 `eventlog` 都可以独立通过 HTTP 读取
- Argon 档案下的真实数据作用域是 `user_id=profile-argon`，不是 UI 上显示的 `Argon`
- 我们可以不经过 UI，直接向 `eventlog` 追加一条 Agent 回复事件
- 这意味着“正常人类使用外心”和“外部程序使用外心”本质上应当共享同一套 RT 契约

也就是说：

- UI 是客户端
- curl 是客户端
- CLI 是客户端
- MCP 也是客户端

只要它们都操作同一份 RT 契约，系统就会稳定得多。

## 一套实用的接入顺序

不要一上来就写数据。顺序固定如下。

### 1. 先确认 RT 地址

先找对 RT 端口，不要先猜 UI 端口。

示例：

```powershell
curl.exe -sS http://192.168.1.204:9124/health
```

如果不确定端口，就对候选端口逐个探测。

### 2. 再确认只读接口可访问

先确认数据面是通的，再谈 SSE、UI、订阅。

示例：

```powershell
curl.exe -sS "http://192.168.1.204:9124/signals/history?limit=5"
curl.exe -sS "http://192.168.1.204:9124/eventlog"
```

这一步非常重要，因为它能快速区分：

- 是整个外部 HTTP 面挂了
- 还是只是前端订阅链路有问题

### 3. 再确认档案作用域

多档案系统里，`用户名` 不一定等于 RT 存储作用域。

这次 Argon 的实际情况是：

- `user_id=Argon` 返回 `0` 条
- `user_id=profile-argon` 才能读到真实档案

示例：

```powershell
curl.exe -sS "http://192.168.1.204:9124/eventlog?user_id=profile-argon"
```

仓库里当前约定也很清楚，RT 作用域统一通过 `user_id` 透传：

- `src/lib/adapters/runtime-profile-scope.ts`

## 任务接口经验

任务系统不能“全靠猜 JSON”。

应当按 RT 的状态机和 wire format 来操作。

### 查询和写入分开看

- 查询：
  - `GET /tasks`
  - `GET /tasks/:id`
- 资料更新：
  - `PUT /tasks/:id`
- 状态迁移：
  - `POST /tasks/:id/transition`
  - `POST /tasks/:id/cancel`

不要把“状态切换”混进 `PUT /tasks/:id`。

### 要尊重状态机

例如之前已经实测过：

- `pending -> cancelled` 不能直跳
- 应先到 `in_progress`

### 要尊重 RT wire format

例如依赖字段不是前端内部名字，而是 RT 契约：

```json
{
  "depends_on": [
    {
      "task_id": "task-123",
      "type": "hard"
    }
  ]
}
```

参考：

- `src/lib/adapters/task-rt-adapter.ts`

## 事件日志经验

`eventlog` 很适合作为一层“面向人类与 Agent 的统一交互记录”。

### 读事件时，优先看结构化字段

- `tags`
- `metadata.source`
- `metadata.inputSource`
- `metadata.replyToEventId`

### 语音消息不要靠文本猜

应按结构化字段判断：

- `tags` 含 `voice`
- `metadata.inputSource === "voice"`
- `metadata.inputMethod === "recognition"`

### 回复事件不需要 UI 先支持

只要往 `eventlog` 追加一条结构化事件，就能表达“线程式回复”。

例如：

```json
{
  "id": "new-event-id",
  "timestamp": 1774139598201,
  "content": "## Agent 回复\n\n内容……",
  "tags": ["agent_feedback", "note"],
  "metadata": {
    "author": "Agent",
    "replyToEventId": "target-event-id",
    "source": {
      "app": "ExoMind",
      "deviceId": "codex-curl",
      "deviceName": "Codex curl",
      "platform": "Windows"
    }
  }
}
```

写入目标：

```powershell
POST /eventlog?user_id=profile-argon
```

这次已经实测成功。

## Windows / PowerShell 下的 curl 经验

复杂 JSON 请求体，最稳妥的方式仍然是：

1. 先写 UTF-8 无 BOM 的临时 JSON 文件
2. 再用 `curl.exe --data-binary @file`

原因：

- PowerShell 引号转义容易把 JSON 搞坏
- BOM 可能污染请求体

如果当前执行环境对 `curl` 包装有限制，也可以退回到等价 HTTP POST，例如 `Invoke-RestMethod`。

重点不是工具名，而是：

- RT 地址对
- `user_id` 对
- JSON 结构对

## 关于“逻辑都写在 RT，UI 只负责呈现”的评价

这个方向是对的，但要避免走极端。

应该坚持：

- 业务真相在 RT
- UI 自己保留纯表现态

真正应该放进 RT 的包括：

- 任务状态机
- 时间块生命周期
- 事件日志持久化
- 多端同步
- 档案/身份作用域
- 授权与会话

不该强行放进 RT 的包括：

- 当前抽屉是否展开
- 当前 hover 状态
- 正在输入但尚未提交的本地草稿
- 动画过程中的中间态

## 关于会话令牌的判断

“状态持久化可以借鉴会话令牌”这个方向是成立的。

更具体地说，建议把下面几层拆开：

- `身份`：你是谁
- `作用域`：你操作哪个 profile / workspace
- `会话`：你当前是否已登录、能否继续访问
- `授权`：你被允许调哪些 RT API

这次 Argon 档案的经验已经说明：

- `用户名展示` 和 `RT 真实作用域键` 不是一回事

所以未来如果做会话令牌，应该让 token 明确携带至少这些信息：

- `subject`
- `profile_scope`
- `issued_at / expires_at`
- `permission scopes`

这样 CLI / MCP / UI / curl 都能共享一套身份模型。

## Agent 接入指南：以自身身份在外心发消息

只要用户给出 RT 地址和档案名，任何会用 curl 的 Agent 都可以接入外心。

### 核心目标

Agent 以**可区分的自身身份**在事件日志里发消息——UI 和其他 Agent 能看到"这条是谁、从哪个平台、用什么模型发的"。

### 最小接入三步

#### Step 1：确认连接

```bash
# 用户给的 RT 地址，先确认能通
curl -sS http://<RT地址>:9124/health
# 返回 {"status":"ok","version":"0.1.0"} 即成功
```

#### Step 2：确认档案作用域

用户给的是档案名（如 `Argon`），实际 RT 作用域键是 `profile-<slug>`：

```bash
# 用户说"档案是 Argon" → 尝试 profile-argon
curl -sS "http://<RT地址>:9124/eventlog?user_id=profile-argon"
# 返回事件数组即成功
```

**常见陷阱**（来自 Termux Agent 和 Codex Agent 的实测经验）：

| 尝试 | 结果 |
|------|------|
| `user_id=Argon` | 0 条（大小写不对） |
| `user_id=argon` | 0 条（缺 `profile-` 前缀） |
| `user_id=profile-argon` | ✅ 读到真实数据 |

slug 格式规则见 `src/lib/profile/profile-storage.ts` 中的 `normalizeProfileSlug`：小写、非字母数字替换为 `-`。

#### Step 3：发送消息

```bash
curl -sS -X POST "http://<RT地址>:9124/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "<uuid>",
    "timestamp": <毫秒时间戳>,
    "content": "消息内容（支持 Markdown）",
    "tags": ["agent_feedback", "note"],
    "metadata": {
      "source": {
        "app": "<工具名>",
        "platform": "<模型/平台>",
        "deviceName": "<Agent 身份标识>"
      }
    }
  }'
```

### 身份字段规范

`metadata.source` 是 Agent 身份的唯一载体。字段含义：

| 字段 | 含义 | 示例 |
|------|------|------|
| `app` | 运行环境/工具 | `"Claude Code"`, `"Codex CLI"`, `"Termux"` |
| `platform` | 模型或平台标识 | `"Opus 4.6"`, `"GPT-4o"`, `"o3"` |
| `deviceName` | 身份名（在事件流中显示） | `"argon"`, `"Codex curl"`, `"Termux Agent"` |
| `deviceId` | 可选，设备唯一 ID | `"codex-curl"`, `"termux-192.168.1.99"` |

**辨识度靠 `deviceName`**。不同 Agent 只要 `deviceName` 不同，在事件日志中就能被区分。已知在线的身份：

```
Windows Device  — 桌面端 UI
Android Device  — 手机端 UI
argon           — Claude Code (Opus)
Codex curl      — Codex CLI
Termux Agent    — 手机端 Termux 里的 Agent
```

### 回复特定消息

通过 `metadata.replyToEventId` 建立回复链：

```json
{
  "id": "<新 uuid>",
  "timestamp": 1774139598201,
  "content": "## Agent 回复\n\n针对你的问题……",
  "tags": ["agent_feedback", "note"],
  "metadata": {
    "replyToEventId": "<目标事件的 id>",
    "source": { "app": "...", "platform": "...", "deviceName": "..." }
  }
}
```

### 读取最近消息（了解上下文）

```bash
# 读最近事件
curl -sS "http://<RT地址>:9124/eventlog?user_id=profile-argon"

# 按结构化字段识别消息来源
# - tags 含 "agent_feedback" → Agent 发的
# - tags 含 "note" → 人类笔记
# - tags 含 "voice" → 语音输入
# - tags 含 "block_start/end/feedback" → 时间块相关
# - metadata.source.deviceName → 谁发的
```

## RT 完整端点速查

实测可用的端点（基于 `crates/exomind-runtime/src/routes/mod.rs`）：

| 端点 | 方法 | 说明 | 需要 user_id |
|------|------|------|-------------|
| `/health` | GET | 健康检查 | 否 |
| `/topology` | GET | 本机信息（hostname, OS, IP） | 否 |
| `/eventlog` | GET | 事件日志列表 | 是 |
| `/eventlog` | POST | 追加事件 | 是 |
| `/eventlog/:id` | GET | 单条事件 | 是 |
| `/eventlog/clear` | POST | 清空事件 | 是 |
| `/eventlog/backup/json` | GET | 导出 JSON 备份 | 是 |
| `/eventlog/backup/sqlite` | GET | 导出 SQLite 快照 | 是 |
| `/tasks` | GET | 任务列表 | 否 |
| `/tasks/:id` | GET/PUT | 任务详情/更新 | 否 |
| `/tasks/:id/transition` | POST | 任务状态迁移 | 否 |
| `/timeblocks` | GET | 时间块列表 | 否 |
| `/signals/history` | GET | 信号历史 | 否 |
| `/agents` | GET | Agent 列表 | 否 |
| `/energy` | GET | 能量池状态 | 否 |
| `/sessions` | GET | 会话列表 | 否 |
| `/mesh/peers` | GET | 组网对等节点 | 否 |

### 环境差异踩坑记录

来自 Termux Agent 的实战经验：

| 环境 | 坑 | 解法 |
|------|-----|------|
| **Termux (Android)** | `ip route` / `ip addr` 因 netlink 权限失败 | 改用 `ifconfig` 从 wlan0 获取 IP |
| **Termux** | RT 端口不能靠猜，1949/6984/5173 都不是 | 固定从 9124 开始探测 |
| **PowerShell** | 引号转义把 JSON 搞坏 | 写临时文件 + `curl.exe --data-binary @file` |
| **PowerShell** | `curl` 是 `Invoke-WebRequest` 别名 | 明确用 `curl.exe` |
| **Cygwin/Git Bash** | `!` 在字符串中被 shell 展开 | 用单引号或转义 |
| **所有环境** | `id` 字段必须是 UUID，`timestamp` 必须是毫秒 | 用语言内置 UUID 库 + `Date.now()` |

## 推荐的最小方法论

- 找 RT：先 `health`
- 验只读：再 `signals/history`、`eventlog`
- 找作用域：确认真实 `user_id`（格式 `profile-<slug>`）
- 做写入：直接走 RT HTTP API
- 做任务：资料更新和状态迁移分接口
- 做回复：用 `eventlog + replyToEventId + source`
- 做身份：`metadata.source.deviceName` 区分不同 Agent

## 相关 Issue

- [#666](https://github.com/exomind-team/exomind/issues/666): RT 外部接入的 identity / profile scope / session / permission scopes 契约
- [#667](https://github.com/exomind-team/exomind/issues/667): 提供本地档案列表接口并明确 UI 的读取路径

## 参考

- `docs/development/signal-pool-timeblock-feedback.md`
- `docs/development/exomind-runtime-agents-api.md`
- `src/lib/adapters/runtime-profile-scope.ts`
- `src/lib/adapters/eventlog-rt-adapter.ts`
- `src/lib/adapters/task-rt-adapter.ts`
- `src/lib/profile/profile-storage.ts` — `normalizeProfileSlug` 档案 slug 规则
- `crates/exomind-runtime/src/routes/mod.rs` — RT 路由注册
- `crates/exomind-runtime/src/routes/eventlog.rs` — 事件日志 HTTP 端点
