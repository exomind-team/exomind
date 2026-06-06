---
name: exomind-rt-agent-access
description: Teach an AI Agent to connect to ExoMind Runtime via HTTP/curl. Prefer `/act/*` feature APIs first, and fall back to raw resource routes only when `/act` has no matching action or when low-level truth/debugging is required. Use when the user mentions ExoMind, `/act`, await, event log, RT access, curl, profiles, tasks, or timeblocks in ExoMind.
---

# ExoMind Runtime Agent / curl 接入指南

> **核心约束**：Agent 接入外心的目标是**辅助人类、引导人类成长**，不是替代人类做决策。
>
> **定位**：
>
> - 本 skill 是 ExoMind Runtime HTTP/curl 接入的唯一真源。
> - Agent 默认优先使用 `/act/*` feature API；只有 `/act/*` 暂无对应动作，才回退 raw RT 资源路由。
> - raw RT 资源路由主要用于真相回读、低层排障、联调和兼容期补能力。
> - 历史上的独立 curl 手册内容已收口到本 skill，不再保留第二份真源。
> - 具体端点细节按渐进披露拆到 `references/`，主 `SKILL.md` 只保留入口层规则、核心流程与风险边界。
> - 若任务是维护本 skill，或刚执行完一次 curl 实测需要回写经验，先读 `references/maintenance.md`，不要只盯主文档。
>
> **渐进披露规则**：
>
> - 不要默认一次性把全部 references 读入上下文。
> - 先用本文件确定任务类型，再按需加载 1-2 份最相关的 reference。
> - 如果任务只涉及 `eventlog`，不要顺手加载 `tasks` 或 `timeblocks` 细节。
>
> **同步维护约束**：
>
> - 若在实际使用 curl 时发现经验与本 skill 内容冲突，不得直接凭印象修改，必须先结合当前 RT live 版本信息、当前工作区代码、GitHub 对应 issue / PR / 文档信息核验该差异是否已证实为“本文过时”。
> - 一旦证实过时，则在完成本次 curl 使用后，必须持续回写本 skill 的对应章节或 reference，不能只把经验留在对话、issue 评论或临时笔记里。
> - 进入维护环节时，必须先反思“本次执行过程相对参考章节出现了哪些新变化或差异”，再定位需要维护的 skill 文档，而不是直接修改主 `SKILL.md`。
> - 每次对本 skill 的主文件或 reference 做增删改，都必须同步更新该文件顶部维护元数据，并在 `references/maintenance.md` 追加维护记录。

## 版本与时效性

- 最后更新日期：`2026-05-18`
- 更新者：`Claude Code`
- 更新内容概要：`去硬编码：将所有`<http://127.0.0.1:9124`> 和 `profile-argon` 替换为 `<RT>` 和 `<PROFILE>` 占位符；新增"设备配置优先"规则，指向 `exomind-monitor` skill 的 `config.json`；禁止凭名字猜测档案`
- 核验依据：
  - `GET /version` 等 live 版本信息
  - 当前工作区代码与相关路由实现
  - GitHub 对应 issue / PR / 文档信息
- 基线提交：`da88bc11`
- 真相源：
  - `../../crates/exomind-runtime/src/lib.rs`
  - `../../crates/exomind-runtime/src/agent_await.rs`
  - `../../crates/exomind-runtime/src/routes/eventlog.rs`
  - `../../crates/exomind-runtime/src/routes/agent_await.rs`
  - `../../crates/exomind-runtime/src/routes/tasks.rs`
  - `../../crates/exomind-runtime/src/routes/timeblocks.rs`
  - `../../crates/exomind-runtime/src/routes/profiles.rs`
  - `../../crates/exomind-runtime/src/routes/signals.rs`
  - `../../crates/exomind-runtime/src/routes/topology.rs`
- 当前覆盖范围：
  - 已覆盖：当前 ExoMind Runtime HTTP/curl 接入分层、`/act/*` 优先规则、raw RT 直读/排障、`profile-<slug>` scope 规则、当前鉴权现状、tasks/timeblocks/eventlog 的排障要点、常见 `/act/await` 自然语言意图映射
  - 不覆盖：`/agents/*` SSE 会话细节、`/act/today-planner/*` 的完整 feature 语义、`/act/await` 全量 condition / fulfilled payload 细节、mesh peer token / grant 的完整运维流程

## 读取顺序

- 运行态：
  - 先读本文件，确认任务域、风险等级与真相源优先级
  - 再读 `references/index.md` 或直接按任务域加载 1-2 份 reference
- 维护态：
  - 如果任务是整理 skill 本身，或你刚执行过一次 raw RT curl 任务准备回写经验，先读 `references/maintenance.md`
  - 维护时先做“执行后差异反思”，再决定更新 `SKILL.md` 还是某个具体 reference

维护记录与维护检查清单统一放在 `references/maintenance.md`，避免主入口重新膨胀。

## 什么时候用这个 skill

以下场景直接触发：

- 用户提到 ExoMind RT、`/act/*`、`await`、eventlog、profiles、tasks、timeblocks、signals、curl、raw HTTP 端点
- 需要绕过 UI，直接对 RT 做联调、排障、回读或实测
- 需要判断某个动作应该走 `/act/*` 还是 raw 资源路由
- 需要判断某个 RT 行为究竟是代码真相、live 真相，还是旧文档残留

以下场景不要把本 skill 当唯一资料：

- `/agents/*` 的 SSE / session 语义
- `/act/today-planner/*` 或 `/act/await` 的完整 feature contract 设计
- mesh peer token / pairing / grant 的完整运维流程

## 先读哪份 reference

按任务类型只读需要的那份：

| 场景 | 读取文件 |
|------|----------|
| 先确认 references 目录地图、关键词和跨域组合方式 | `references/index.md` |
| 健康检查、版本、拓扑、profiles、signals、PowerShell curl 约定、鉴权边界 | `references/discovery-and-diagnostics.md` |
| eventlog 读写、raw watch、备份、导入、清空 | `references/eventlog.md` |
| tasks 列表、创建、更新、迁移、取消、导入导出 | `references/tasks.md` |
| timeblocks 活动块、start/stop/end、pause/resume、describe、import/export | `references/timeblocks.md` |
| 执行后差异反思、维护记录、更新路由 | `references/maintenance.md` |

如果任务跨域：

- `eventlog + tasks`：先读 `eventlog.md`，再读 `tasks.md`
- `timeblocks + tasks`：先读 `timeblocks.md`，再读 `tasks.md`
- 只需要确认档案和端口：只读 `discovery-and-diagnostics.md`

如果任务还没确定该走 `/act/*` 还是 raw 路由：

- 先留在本文件做入口判断，不要一上来就跳到 raw reference

## 先做入口判断

默认按这条优先级执行：

1. 如果 `/act/*` 已有对应动作，默认使用 `/act/*`。
2. 如果任务是“等待一个未来条件成立一次后返回”，默认使用 `POST /act/await`。
3. 只有在 `/act/*` 暂无对应动作，或你需要直接读取资源真相、raw cursor / catch-up 语义、低层排障时，才回退 raw RT 资源路由。
4. 即使走 raw 路由，写入后也必须回读验证，不得把 raw 路由当成隐式成功。

当前已落地、值得优先检查的 `/act/*` 入口至少包括：

- `POST /act/await`
- `/act/today-planner/*`

## 核心流程

执行 ExoMind Runtime HTTP/curl 任务时，默认按这条流程：

1. 先确认目标 RT 可访问：`/health`、`/version`
2. 确认档案 scope：优先回读 `/profiles`
3. 先判断 `/act/*` 是否已有对应动作
4. 若是等待/监听一次结果，优先用 `POST /act/await`
5. 只有在 `/act/*` 不覆盖或需要低层排障时，才识别 raw 任务域：`eventlog`、`tasks`、`timeblocks`、`signals`、`topology`
6. 只加载对应 reference，不要一口气读全套
7. 如涉及写操作，先套用“行为分级”
8. 写入后必须回读验证
9. 如果实测与本文不一致，做 live / 代码 / GitHub 三重核验
10. 若确认本文过时，回写本 skill 或对应 reference，并补维护记录

## 先记住这几个差异

如果你看过更早的 skill / 手册，先用这组差异校正心智：

1. `GET /health` 现在只返回 `{"status":"ok"}`，版本信息已经拆到 `GET /version`。
2. 清空事件日志的真端点是 `DELETE /eventlog`，不是 `/eventlog/clear`。
3. `eventlog` 的档案作用域参数是 `user_id`；`tasks` / `timeblocks` 接受 `profile_id` 或 `user_id`，如果两者同时传入则 `profile_id` 优先。
4. `GET /eventlog/watch` 默认是 watch from now；只有显式给 `since_id` 或 `since_timestamp` 才会先补 backlog。
5. 时间块的结束流程不是单步“直接结束”，而是 `start -> stop -> end`。
6. 对 Agent 的默认入口，先检查 `/act/*`；当前已经落地的等待入口是 `POST /act/await`，不是 raw `GET /eventlog/watch`。
7. `GET /eventlog/watch` 是 raw EventLog watch / cursor / catch-up / debug 工具；如果只是要“等待下一事件”或“等待任务 / 时间块 / 提案条件成立一次”，默认走 `/act/await`。
8. raw RT 仍然是重要调试面，但角色是直读真相、低层排障和兼容期补能力；只有 `/act/*` 没有对应动作时才回退。
9. 目前并非所有能力都已封装到 `/act/*`；例如时间块等多数工作流仍经常需要回退 raw 路由，这正是回退存在的原因。
10. 时间块 await 语义要分清：
    - `timeblock_stopped` = 专注结束 = active block 进入 `feedback_in_progress`
    - raw EventLog 的 `block_end` / 文案“时间块结束”只是 `stop` 痕迹，不表示 feedback 已提交
    - `timeblock_ended` = 时间块完成 = feedback 提交后进入 completed history

## 最小 raw fallback 接入三步

> **设备配置优先**：若本机安装了 `exomind-monitor` skill，先从 `~/.claude/skills/exomind-monitor/references/config.json` 读取 `rt.baseUrl` 和 `rt.profile`，不要凭本文示例值猜测端口和档案。本文示例使用 `<RT>` 和 `<PROFILE>` 占位符。

以下示例只适用于当前没有对应 `/act/*` 动作，或你明确需要 raw 直连时。

用户通常会给你两个信息：**RT 地址**和**档案名**。

### Step 1：确认连接

```bash
curl -sS http://<RT>/health
curl -sS http://<RT>/version
```

### Step 2：确认档案作用域

```bash
curl -sS “http://<RT>/profiles”
```

返回值中的 `id` 即 raw RT 的 `user_id` 参数（格式通常为 `profile-<slug>`）。**禁止凭名字猜测**，必须以 `/profiles` 实际返回或设备配置文件为准。

### Step 3：写入后必须回读

```bash
curl -sS -X POST “http://<RT>/eventlog?user_id=<PROFILE>” \
  -H 'Content-Type: application/json' \
  -d '{“timestamp”:<毫秒时间戳>,”content”:”消息内容”,”tags”:[“agent_feedback”,”note”]}'

curl -sS “http://<RT>/eventlog?user_id=<PROFILE>&limit=1”
```

不要假设写入一定成功。网络中断、格式错误、RT 重启都可能导致丢失。

## 等待/监听默认走 `/act/await`

如果 Agent 的目标是”等未来条件成立一次后返回”，默认先用 `POST /act/await`，而不是 raw `GET /eventlog/watch`。

最小例子：

```bash
curl -N -X POST “http://<RT>/act/await?user_id=<PROFILE>” \
  -H “Content-Type: application/json” \
  --data-binary '{“condition”:{“type”:”next_event”}}'
```

先记住这几点：

- 这是单次 fulfill 的 feature API：通常先收到 `ready`，等待中收到 `heartbeat`，命中后收到 `fulfilled` 并结束连接
- 当前默认 `timeoutSecs=1800`，默认 `heartbeatSecs=15`
- 等待 `task_completed`、`timeblock_stopped`、`timeblock_ended`、`proposal_*` 等 feature 条件时，也优先走 `/act/await`
- 只有在你需要 raw event arrival / cursor / catch-up 语义，或需要排查 `/act/await` 内部到底等到了哪条底层事件时，才回去读 `references/eventlog.md`

### 常见自然语言 -> `/act/await` 参数速记

把用户常说的话直接翻成下面这组参数：

- 等“下一条事件”
  - `{"condition":{"type":"next_event"}}`
- 等“任务完成”
  - 若上下文里已经有明确 `taskId`：`{"condition":{"type":"task_completed","taskId":"<task-id>"}}`
  - 若用户说的是“等任意一个任务完成”：`{"condition":{"type":"task_completed"}}`
- 等“当前时间块完成”
  - 先在同一 scope 读取 `GET /timeblocks/active`
  - 取返回里的 `startId`
  - 再等待：`{"condition":{"type":"timeblock_ended","startId":"<active-start-id>"}}`
- 等“当前时间块专注结束 / 当前时间块结束”
  - 先读当前 active block 的 `startId`
  - 再等待：`{"condition":{"type":"timeblock_stopped","startId":"<active-start-id>"}}`
- 等“任意一个时间块完成”
  - `{"condition":{"type":"timeblock_ended"}}`
- 等“超时 1 小时”
  - 在 body 里显式传：`"timeoutSecs": 3600`

注意两条硬区别：

- “当前时间块” = 指向一个**已经存在的 active block**，不要省略 `startId`
- 省略 `taskId` / `startId` = 等**这个 scope 下从现在开始命中的任意 future 资源**

### 当前块、任意块、匿名域三件事不要混

- 如果监听的是匿名 / 无 scope 事件流：
  - 直接请求 `POST /act/await`
  - **不要传 `user_id`**
- 如果监听的是具体档案：
  - 用 `POST /act/await?user_id=<PROFILE>`（以设备配置或 `/profiles` 返回为准）
- 如果用户说“等待当前时间块完成”：
  - 先读当前 active block，再把它的 `startId` 放进 `timeblock_ended`
  - 不要偷懒写成不带 `startId` 的 `timeblock_ended`，否则语义会变成“等任意未来时间块完成”
- 如果用户说“等待任务完成并告诉我反馈”：
  - 先监听 `task_completed`
  - 命中后回读任务详情
  - 如果需要反馈原文，继续回读关联 completed timeblock、`block_feedback` 与 `note/task_completed`

两个高频例子：

```bash
curl.exe -N -X POST "http://<RT>/act/await" \
  -H "Content-Type: application/json" \
  --data-binary "{\"condition\":{\"type\":\"task_completed\"},\"timeoutSecs\":3600}"
```

```bash
curl.exe -sS "http://<RT>/timeblocks/active?user_id=<PROFILE>"
# 取出 startId 后：
curl.exe -N -X POST "http://<RT>/act/await?user_id=<PROFILE>" \
  -H "Content-Type: application/json" \
  --data-binary "{\"condition\":{\"type\":\"timeblock_ended\",\"startId\":\"<active-start-id>\"},\"timeoutSecs\":3600}"
```

### 时间块 await 语义速记

如果你要监听时间块，不要把 raw EventLog 文案和 feature 条件混在一起：

- `timeblock_stopped`
  - 含义：**专注结束**
  - 真相：当前 active block 进入 `feedback_in_progress`
  - 典型场景：用户刚点了 `stop`，准备填写反馈
- `block_end`
  - 含义：raw EventLog 中的“时间块停止: ...”文案
  - 角色：只是 `POST /timeblocks/stop` 写出的痕迹
  - 关键点：它不是 feedback 完成，不应替代 `timeblock_ended`
- `timeblock_ended`
  - 含义：**时间块完成 / 反馈完成**
  - 真相：该时间块已经进入 completed history
  - 典型场景：用户已提交反馈，`POST /timeblocks/end` 完成

实操时可直接这样记：

- 要等“专注结束” -> 监听 `timeblock_stopped`
- 要等“反馈结束后的时间块完成” -> 监听 `timeblock_ended`
- 如果只是在 EventLog 里看到了 `block_end`，只能说明块已经 stop 并进入反馈阶段，不能据此断言块已 completed

## 身份规范

`metadata.source` 是你在外心中的身份标识：

| 字段 | 含义 | 建议 |
|------|------|------|
| `app` | 运行环境 | 如 `"Claude Code"`、`"Codex CLI"`、`"Termux"` |
| `platform` | 模型/平台 | 如 `"GPT-5"`、`"o3"` |
| `deviceName` | 身份名 | 用于区分不同 Agent / 设备 |
| `deviceId` | 可选设备 ID | 如 `"codex-curl"` |

**辨识度靠 `deviceName`**。选一个能区分你和其他 Agent 的名字。

## 行为分级

| 风险等级 | 操作 | 要求 |
|---------|------|------|
| **低** | 读取事件日志、任务、时间块、signals、topology | 直接执行 |
| **低** | 向事件日志写入消息 | 直接执行 |
| **中** | 创建新任务 | 至少告知人类一轮 |
| **高** | 完成/取消任务（状态迁移） | **必须主动询问人类确认** |
| **高** | 启动/结束时间块 | **必须主动询问人类确认** |
| **高** | 清空事件日志 | **必须主动询问人类确认** |

**核心原则**：你是人类的助手。任何改变人类数据状态的操作，至少要有一轮主动询问。

## 读取上下文与信号归属

如果只是理解上下文，默认先看：

```bash
curl -sS "http://<RT>/eventlog?user_id=<PROFILE>&limit=20"
```

识别消息来源时，优先看结构化字段：

- `tags`
- `metadata.source.deviceName`
- `metadata.replyToEventId`

不要在 `/signals/history` 看到一条消息就假设它属于当前档案。具体归属必须回到 `/eventlog?user_id=...` 复核。

## 快速外部边界

以下内容不在本 skill 详述：

- `/agents/*`：看 [`../../docs/development/exomind-runtime-agents-api.md`](../../docs/development/exomind-runtime-agents-api.md)
  当前典型端点：`GET /agents`、`POST /agents/:id/chat`、`GET /agents/:id/sessions`、`GET /agents/:id/sessions/:sid`、`DELETE /agents/:id/sessions/:sid`
- `/act/await`：本文件只保留默认优先级与最小例子；完整外部契约与边界以 [`../../docs/development/runtime-external-access-contract.md`](../../docs/development/runtime-external-access-contract.md)、[`../../crates/exomind-runtime/src/agent_await.rs`](../../crates/exomind-runtime/src/agent_await.rs) 与 [`../../crates/exomind-runtime/src/routes/agent_await.rs`](../../crates/exomind-runtime/src/routes/agent_await.rs) 为准
- `/act/today-planner/*`：看 [`../../docs/development/today-planner-api.md`](../../docs/development/today-planner-api.md)
  当前已注册端点：`GET /act/today-planner`、`POST /act/today-planner/windows`、`POST /act/today-planner/windows/:window_id/reflow`、`PATCH /act/today-planner/segments/:segment_id`、`POST /act/today-planner/segments/:segment_id/start`
- RT 对外能力长期契约：看 [`../../docs/development/runtime-external-access-contract.md`](../../docs/development/runtime-external-access-contract.md)
- CLI 用法：看 [`../../docs/development/exomind-cli.md`](../../docs/development/exomind-cli.md)

## 环境踩坑

主入口层只保留最常踩的几条：

- PowerShell 下优先用 `curl.exe`，不要依赖 `curl` 别名
- 长 JSON body 优先写临时文件，再 `--data-binary @file.json`
- 调 `/act/await` 这类 SSE 端点时，记得加 `-N` / `--no-buffer`
- `eventlog / tasks` 多数 body 用 `snake_case`，多个 `timeblocks` body 用 `camelCase`
- 涉及具体端点字段时，不要猜；去读对应 reference

更完整的环境与命令细节，读 `references/discovery-and-diagnostics.md`。

## 维护提醒

- 更新或使用本 skill 时，除了核对 RT 行为本身，还要核对 references 分流是否仍然合理。
- 详细维护闭环、差异反思问题单、文件路由表与维护记录，见 `references/maintenance.md`。

## 参考

- [`references/index.md`](references/index.md)
- [`references/maintenance.md`](references/maintenance.md)
- [`references/discovery-and-diagnostics.md`](references/discovery-and-diagnostics.md)
- [`references/eventlog.md`](references/eventlog.md)
- [`references/tasks.md`](references/tasks.md)
- [`references/timeblocks.md`](references/timeblocks.md)
- [#666](https://github.com/exomind-team/exomind/issues/666)
- [#667](https://github.com/exomind-team/exomind/issues/667)
