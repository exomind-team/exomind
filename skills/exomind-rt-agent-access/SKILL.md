---
name: exomind-rt-agent-access
description: Teach an AI Agent to connect to ExoMind Runtime via curl, read/write event logs under a user profile, and assist humans with life management. Use when the user mentions ExoMind, event log, RT access, or when you need to interact with the ExoMind system.
---

# ExoMind Runtime Agent 接入指南

> **核心约束**：Agent 接入外心的目标是**辅助人类、引导人类成长**，不是替代人类做决策。

## 版本与时效性

- 最后更新日期：`2026-03-22`
- 基线提交：`0b771fc` `feat(skill): add ExoMind RT Agent access skill (#666)`
- 当前覆盖范围：
  - 已覆盖：当前 raw RT 接入方式、eventlog 写入、`profile-<slug>` scope 规则、现阶段零认证现状
  - 设计前瞻：per-agent token、watch/长轮询、`/act` feature API、bootstrap/discovery
- 相关追踪：
  - `#666` identity / profile scope / session / permission scopes
  - `#676` `/act` feature API 与 bootstrap/discovery
  - `docs/development/curl-access-exomind-runtime.md`

如果你发现下列任一情况，应优先怀疑本 skill 可能已部分过时，并回看相关 issue / 文档，而不是继续机械照抄：

- RT 已引入 `/act/*` 或 `bootstrap`，但本 skill 仍主要在教 raw 路由
- token / session / profile discovery 字段与这里描述不一致
- `eventlog`、`tasks`、`timeblocks` 的写入契约或认证方式发生变化
- 用户明确说明“最新 API”“刚改过契约”“请按最新实现处理”

判断原则：

- 这份 skill 是 Agent-facing 快速上手材料，不是最终真相源
- 真相源优先级应为：最新代码 / 当前 issue 决策 / 开发文档 / 本 skill

## 章节索引

1. [最小接入三步](#最小接入三步) — 连接 RT、确认档案、发送消息
2. [身份规范](#身份规范) — 如何让系统识别你是谁
3. [行为分级](#行为分级) — 哪些操作可直接执行，哪些需要人类确认
4. [读取上下文](#读取上下文) — 如何理解事件日志中的消息
5. [API 速查](#api-速查) — RT 端点列表与稳定性标注
6. [名称概念辨析](#名称概念辨析) — 不要混淆的四个标识符
7. [实时性](#实时性) — 轮询与未来的 watch/SSE
8. [认证现状与方向](#认证现状与方向) — 当前零认证，未来 per-agent token
9. [环境踩坑](#环境踩坑) — 不同终端环境的差异

---

## 最小接入三步

用户会给你两个信息：**RT 地址**和**档案名**。

### Step 1：确认连接

```bash
curl -sS http://<RT地址>:<端口>/health
# 期望返回 {"status":"ok","version":"..."}
```

**端口不固定**，取决于部署方式：

| 场景 | 默认端口 | 配置方式 |
|------|---------|---------|
| Tauri 桌面应用嵌入式 RT | `9124` | `EXOMIND_RT_PORT` 环境变量 |
| 独立运行的 RT 进程 | `1949` | `EXOMIND_RT_PORT` 环境变量 |
| 用户自定义 | 任意 | 用户告知或查看设置页实例诊断 |

如果不确定端口，先问用户，或者对常见候选（9124、1949）逐个探测 `/health`。

### Step 2：确认档案作用域

用户给的是显示名（如 `Argon`），实际 RT 作用域键是 `profile-<slug>`：

```bash
curl -sS "http://<RT地址>:<端口>/eventlog?user_id=profile-argon"
# 返回事件数组即成功
```

**slug 规则**：小写，非字母数字替换为 `-`。
例如：显示名 `My Profile` → slug `my-profile` → scope key `profile-my-profile`

> **红线**：前端页面路由（如 `/profile-argon/...`）**不等于** RT HTTP 资源路由。档案作用域统一通过 `?user_id=profile-argon` 查询参数进入，不要把 profile 路径拼到 RT URL 前缀上。

### Step 3：发送消息

```bash
curl -sS -X POST "http://<RT地址>:<端口>/eventlog?user_id=profile-argon" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "<uuid>",
    "timestamp": <毫秒时间戳>,
    "content": "消息内容（支持 Markdown）",
    "tags": ["agent_feedback", "note"],
    "metadata": {
      "source": {
        "app": "<你的工具名>",
        "platform": "<你的模型/平台>",
        "deviceName": "<你的身份标识>"
      }
    }
  }'
```

> **注意**：`id` 字段当前需要客户端提供 UUID，后续将改为 RT 统一生成。
> `timestamp` 是毫秒级 Unix 时间戳。

### Step 4：回读验证

写入后必须回读确认事件已落库：

```bash
curl -sS "http://<RT地址>:<端口>/eventlog?user_id=profile-argon&limit=1"
# 确认最新事件的 id、deviceName、content 与你刚写入的一致
```

不要假设写入一定成功——网络中断、格式错误、RT 重启都可能导致丢失。

---

## 身份规范

`metadata.source` 是你在外心中的身份标识：

| 字段 | 含义 | 你应该填什么 |
|------|------|-------------|
| `app` | 运行环境 | 如 `"Claude Code"`, `"Codex CLI"`, `"Termux"` |
| `platform` | 模型/平台 | 如 `"Opus 4.6"`, `"GPT-4o"`, `"o3"` |
| `deviceName` | 身份名 | **唯一标识你的名字**，会显示在事件流中 |
| `deviceId` | 可选设备 ID | 如 `"codex-curl"` |

**辨识度靠 `deviceName`**。选一个能区分你和其他 Agent 的名字。

---

## 行为分级

| 风险等级 | 操作 | 要求 |
|---------|------|------|
| **低** | 读取事件日志、任务、时间块 | 直接执行 |
| **低** | 向事件日志写入消息 | 直接执行 |
| **中** | 创建新任务 | 至少告知人类一轮 |
| **高** | 完成/取消任务（状态迁移） | **必须主动询问人类确认** |
| **高** | 启动/结束时间块 | **必须主动询问人类确认** |
| **高** | 清空事件日志 | **必须主动询问人类确认** |

**确认方式**：在你所在的终端（如 Claude Code 会话）中明确询问用户，得到确认后再执行。RT 不会拦截你的操作，但会记录审计日志。

**核心原则**：你是人类的助手。任何改变人类数据状态的操作，至少要有一轮主动询问。

---

## 读取上下文

```bash
# 读取最近事件
curl -sS "http://<RT地址>:<端口>/eventlog?user_id=profile-argon&limit=20"

# 查看其他 Agent 的消息（按 deviceName 识别）
# 已知在线的身份：Windows Device / Android Device / argon / Codex curl / Termux Agent / Claude Planner
# 通过 metadata.source.deviceName 字段区分

# 支持的查询参数
#   user_id=<scope_key>    档案作用域（必须）
#   limit=<数字>           限制返回条数
#   since_id=<event_id>    只返回该 ID 之后的事件
```

### 识别消息来源

按结构化字段判断，不要靠文本猜：

| 条件 | 含义 |
|------|------|
| `tags` 含 `"agent_feedback"` | Agent 发的消息 |
| `tags` 含 `"note"` | 人类笔记 |
| `tags` 含 `"voice"` | 语音输入 |
| `tags` 含 `"block_start"` / `"block_end"` | 时间块开始/结束 |
| `tags` 含 `"block_feedback"` | 时间块结束反馈 |
| `metadata.source.deviceName` | 具体是哪个设备/Agent |

### 回复特定消息

通过 `metadata.replyToEventId` 建立回复链：

```json
{
  "metadata": {
    "replyToEventId": "<目标事件的 id>",
    "source": { ... }
  }
}
```

---

## API 速查

| 端点 | 方法 | 说明 | 稳定性 |
|------|------|------|--------|
| `/health` | GET | 健康检查 | 稳定 |
| `/topology` | GET | 本机信息 | 稳定 |
| `/eventlog` | GET | 事件日志列表 | 稳定 |
| `/eventlog` | POST | 追加事件 | 稳定（ID 字段即将改为 RT 生成） |
| `/eventlog/watch` | GET | 事件长轮询；默认只看调用后的新事件 | 稳定 |
| `/eventlog/:id` | GET | 单条事件 | 稳定 |
| `/eventlog/clear` | POST | 清空事件 | 稳定（高风险操作） |
| `/tasks` | GET | 任务列表 | 稳定 |
| `/tasks/:id` | GET/PUT | 任务详情/更新 | 稳定 |
| `/tasks/:id/transition` | POST | 任务状态迁移 | 稳定 |
| `/timeblocks` | GET | 时间块列表 | 稳定 |
| `/signals/history` | GET | 信号历史 | 稳定 |
| `/agents` | GET | Agent 列表 | 实验性 |
| `/energy` | GET | 能量池状态 | 实验性 |
| `/sessions` | GET | 会话列表 | 实验性 |
| `/mesh/peers` | GET | 组网对等节点 | 实验性 |
| `/eventlog/backup/json` | GET | 导出 JSON 备份 | 稳定 |
| `/eventlog/backup/sqlite` | GET | 导出 SQLite 快照 | 稳定 |

> 标注"实验性"的端点可能在未来版本中变更，使用前请先测试。

### 任务操作注意

- 资料更新用 `PUT /tasks/:id`，状态迁移用 `POST /tasks/:id/transition`，不要混用
- 任务状态机有约束：`pending → cancelled` 不能直跳，需先到 `in_progress`
- 依赖字段格式：`"depends_on": [{"task_id": "...", "type": "hard"}]`

---

## 名称概念辨析

四个标识符不是同一个东西，不要混用：

| 概念 | 示例 | 说明 |
|------|------|------|
| **显示名** (displayName) | `Argon` | UI 展示用，可修改 |
| **slug** | `argon` | 归一化标识 |
| **profileId** | `profile-argon` | 存储键 |
| **RT scope key** (user_id) | `profile-argon` | API 参数，当前等于 profileId |

> 目前 profileId 和 RT scope key 相同，但这是实现巧合，不是契约保证。

---

## 信号与事件日志的归属区别

RT 有两个数据源容易混淆：

| 端点 | 作用域 | 说明 |
|------|--------|------|
| `/signals/history` | **全局**，无档案隔离 | 看"RT 最近发生了什么"，但不区分属于哪个档案 |
| `/eventlog?user_id=...` | **档案级**，按 user_id 隔离 | 看"某个档案下的事件"，这才是你的工作目标 |

> **规则**：在 `signals/history` 看到某条消息后，不要假设它属于你正在操作的档案。必须回到 `/eventlog?user_id=profile-xxx` 复核归属。

---

## 实时性

当前已支持两种方式：

- 轮询：定期 GET `/eventlog` 检查新消息
- 长轮询：GET `/eventlog/watch`

`GET /eventlog/watch` 的默认语义是：

- 未提供 `since_id` / `since_timestamp`：从调用时刻开始观察未来新事件，不回放旧 backlog
- 提供 `since_id` / `since_timestamp`：允许先返回 cursor 之后已存在的 backlog；若没有，再继续等

示例：

```bash
# 默认 watch from now：只等后续新事件
curl -sS "http://<RT地址>:<端口>/eventlog/watch?user_id=profile-argon&timeout=30"

# 从某个已知事件之后 catch up
curl -sS "http://<RT地址>:<端口>/eventlog/watch?user_id=profile-argon&since_id=<event_id>&timeout=30"
```

未来方向：
- SSE 端点：通过后台命令订阅实时事件流

---

## 认证现状与方向

**当前**：零认证。知道 RT 地址即可读写。适用于局域网场景。

**未来方向**（设计中，见 [#666](https://github.com/exomind-team/exomind/issues/666)）：
- Per-agent token：RT 为每个 Agent 签发独立 token
- 类似 GitHub Personal Access Token 的模式
- 结合档案密码签发
- Agent 在 Header 中携带 token：`Authorization: Bearer <token>`

---

## 环境踩坑

| 环境 | 问题 | 解法 |
|------|------|------|
| Termux (Android) | `ip route` 权限受限 | 用 `ifconfig` 获取 IP |
| Termux | 不确定 RT 端口 | 固定从 9124 探测 |
| PowerShell | JSON 引号转义出错 | 写临时文件 + `curl.exe --data-binary @file` |
| PowerShell | `curl` 是 `Invoke-WebRequest` 别名 | 明确用 `curl.exe` |
| Cygwin/Git Bash | `!` 被 shell 展开 | 用单引号包裹 |
| Cygwin/Git Bash | `curl ... \| python -c ...` 管道断流 | 先 `curl -o /tmp/resp.json` 再读文件 |
| Termux | `/tmp` 可能不可写或路径不一致 | 用当前工作目录或 `$TMPDIR` 代替 `/tmp` |
| 所有环境 | `id` 必须是 UUID，`timestamp` 必须是毫秒 | 用语言内置 UUID + 时间戳函数 |
| 所有环境 | 长 JSON body 在 bash 中转义极其痛苦 | **推荐写临时 JSON 文件再 `curl --data-binary @file.json`**，避免内联 `-d` |
| 所有环境 | RT 字段名用 `snake_case`（如 `depends_on`），前端可能用 `camelCase` | **以 RT 返回为准**，不要猜 |

---

## 参考

- [#666](https://github.com/exomind-team/exomind/issues/666) — RT 外部接入的身份/作用域/会话/权限契约
- [#667](https://github.com/exomind-team/exomind/issues/667) — 档案列表接口（#666 子 issue）
- `docs/development/curl-access-exomind-runtime.md` — 完整经验记录（含设计讨论）
- `docs/development/exomind-runtime-agents-api.md` — RT Agent API 说明
- `src/lib/profile/profile-storage.ts` — 档案 slug 规则
- `crates/exomind-runtime/src/routes/` — RT 路由源码
