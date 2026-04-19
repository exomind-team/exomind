# 2026-04-19 外部 Agent Await API 计划

> **状态**：Draft
> **目标层级**：RT feature API
> **默认入口**：`POST /act/await`
> **相关文档**：
> - [docs/development/runtime-external-access-contract.md](../development/runtime-external-access-contract.md)
> - [docs/development/exomind-runtime-agents-api.md](../development/exomind-runtime-agents-api.md)
> - [skills/exomind-rt-agent-access/SKILL.md](../../skills/exomind-rt-agent-access/SKILL.md)

---

## Goal

为外部 Agent 提供一个统一的 `await` 能力面，让它可以像等待 Promise 一样等待外心中的未来条件成立，并在条件命中后拿到结构化结果。

本轮要解决的三个典型等待动作：

1. 等待下一条 EventLog 事件
2. 等待某个任务完成
3. 等待某个时间块进入指定结束阶段

本轮不把等待能力散落到 raw 路由里，而是明确收敛为 `/act/await` 这一条 feature API。

---

## Architecture

### 核心定位

`/act/await` 是 **外部 Agent 默认入口**，不是 raw debug route 的别名。

它的职责是：

- 把现有 RT 内部的多种等待原语收敛成一条统一合同
- 用 SSE 维持长等待连接和保活
- 在命中条件时返回一次结果并关闭连接
- 把内部 `eventlog watch`、`SignalPool`、资源回读等细节藏在服务端内

### Rust 内部边界

本轮对 `/act/await` 增加一个硬约束：

- `crates/exomind-runtime/src/routes/agent_await.rs` 只能充当 **HTTP / SSE 适配层**
- 真正的 await 业务逻辑必须下沉到 **非 route 的 Rust 通用 API 模块**

推荐形态：

```text
HTTP request
  -> routes/agent_await.rs 解析 query/body
  -> 调用 crate::agent_await::* 通用函数
  -> Rust 通用 await API 完成条件检查 / 唤醒 / 真相回读
  -> routes/agent_await.rs 仅把内部结果编码成 SSE
```

其中 `routes/agent_await.rs` 只负责：

- 解析 HTTP query / body
- 建立 SSE stream
- 映射 `ready / heartbeat / fulfilled / timeout / error`
- 映射 `400 / 404 / 200` 等 HTTP 状态码

其中 Rust 通用 await API 负责：

- condition 的即时检查
- signal / event 唤醒
- 真相源回读复核
- timeout / heartbeat 驱动
- fulfill / timeout / error 的内部结果构造

这条边界的目的不是“多包一层”，而是明确：

1. transport 层不承载业务逻辑
2. 后续 CLI / MCP / 其他非 HTTP 入口可以复用同一套 Rust await 能力
3. route handler 保持薄壳，测试和演进成本更低

### 统一等待模型

本轮等待模型固定为：

```text
客户端发起 await 请求
  -> 服务端先做一次即时真相检查
  -> 若已满足，则立即 fulfilled
  -> 若未满足，则进入内部订阅/等待
  -> 周期性 heartbeat 保活
  -> 被唤醒后重新回读真相源复核
  -> fulfilled / timeout / error 后关闭连接
```

### 非阻塞原则

`await` 请求必须是 **被动观察者**，不能变成正常外心使用的阻塞门。

硬约束：

- 正常 UI 使用不应被 await 阻塞
- RT 内部状态推进不应被 await 阻塞
- 一个 await 请求不能为了“等结果”长期持有 store lock / 写事务 / 独占 lease
- `await` 只能订阅、短读、复核，不能反向接管任务完成、时间块 stop/end、EventLog 写入这些正常业务路径

本轮期望的单向时序是：

```text
RT 正常运行
  -> 内部状态推进 / 事件写入 / signal 发布
  -> Rust await API 被动收到唤醒
  -> 重新回读真相源
  -> HTTP SSE 回传 fulfilled / timeout / error
  -> await 连接结束
```

也就是说，`await` 的存在不应改变“正常业务动作如何发生”，它只是旁路观察并在条件成立后回传一次结果。

### 本轮 condition 类型

统一通过 `condition.type` 区分，v1 只支持：

- `next_event`
- `task_completed`
- `timeblock_stopped`
- `timeblock_ended`

其中时间块语义明确拆分：

- `timeblock_stopped` = **专注结束**
  - 对应 active block 进入 `feedback_in_progress`
  - 若该块已经进一步 `end`，也视为条件已满足
- `timeblock_ended` = **时间块完成**
  - 对应 completed block 已落库
  - 不把 `stop` 视为完成

### 事件层选择

“等待下一个事件”在 v1 中明确指 **EventLog 事件**，不是 Signal 事件。

理由：

1. EventLog 已经是用户/外部 Agent 最稳定的可见真相源
2. 现有 `GET /eventlog/watch` 语义已经成熟
3. 不把 `SignalPool` 的 `topic / route table / agent_id` 过滤规则暴露给外部客户端

### 完成形态

v1 采用 **single-shot await**：

- 一次连接只等待一个条件成立
- 命中后发一次 `fulfilled` 并关闭
- 不做持续订阅流
- 断线后由客户端重发，不做服务端 waiter 恢复

### 未来扩展命名

本轮只实现 `await`，语义固定为：

- **等待一个条件成立一次**
- **命中后返回一次结果并关闭**

如果未来需要“持续订阅 / 持久监听”，可以另开 `watch` 能力，但它不属于本轮实现，也不能混入当前 `/act/await` 合同。

---

## Current Truth

### 已有可复用原语

1. `GET /eventlog/watch`
   - 已实现 scoped long-poll
   - 默认 `watch from now`
   - 显式 `since_id / since_timestamp` 时允许 catch-up

2. `SignalPool`
   - 已支持 `publish + subscribe + replay window`
   - 已有 `task.replication.upserted`
   - 已有 `timeblock.replication.active_upserted`
   - 已有 `timeblock.replication.completed`
   - 已有 `eventlog.replication.appended`

3. 资源真相回读
   - `GET /tasks/:id`
   - `GET /timeblocks/active`
   - `GET /timeblocks`
   - EventLog store scoped list/filter

### 当前缺口

1. 没有统一 await 入口
2. `tasks` / `timeblocks` 没有专用 wait/watch 端点
3. `/signals/stream` 是通用 SSE，但其过滤语义依赖 route table，不适合作为外部 await 合同
4. 现有 API 没有把“等待结果”收敛成单次 fulfill 的 SSE 合同

---

## Public Contract

### 请求入口

```text
POST /act/await?user_id=<profile-id>
Content-Type: application/json
Accept: text/event-stream
```

### 请求体

body 统一使用 `camelCase`：

```json
{
  "condition": {
    "type": "task_completed",
    "taskId": "task-123"
  },
  "timeoutSecs": 1800,
  "heartbeatSecs": 15
}
```

### 参数约束

- `timeoutSecs`
  - 默认 `1800`
  - 最小 `1`
  - 最大 `21600`
  - 超过上限时 clamp，不报错
- `heartbeatSecs`
  - 默认 `15`
  - clamp 到 `5..60`

### condition 详细合同

#### 1. `next_event`

```json
{
  "condition": {
    "type": "next_event",
    "sinceId": "optional-event-id",
    "sinceTimestamp": 1776157200000,
    "tags": ["note", "agent_feedback"]
  }
}
```

规则：

- 未提供 `sinceId` / `sinceTimestamp` 时，沿用当前 `watch from now`
- 提供 cursor 时，允许先补 cursor 之后已存在的 backlog
- `tags` 语义与当前 EventLog 过滤保持一致，为 AND 语义
- fulfill 结果只返回 **一条最早命中的事件**，不返回批量数组

#### 2. `task_completed`

```json
{
  "condition": {
    "type": "task_completed",
    "taskId": "task-123"
  }
}
```

规则：

- 只认 `Task.status == completed`
- 不把 `cancelled` 视为满足
- 真相判断以资源状态为准，不以 eventlog tag 为准

#### 3. `timeblock_stopped`

```json
{
  "condition": {
    "type": "timeblock_stopped",
    "startId": "tb-123"
  }
}
```

规则：

- 对应“专注结束”
- 当 active block 已进入 `feedback_in_progress` 时满足
- 若同一 `startId` 的块已经进入 completed history，也视为满足
- fulfill 结果必须显式带 `state`
  - `stopped`
  - `ended`

#### 4. `timeblock_ended`

```json
{
  "condition": {
    "type": "timeblock_ended",
    "startId": "tb-123"
  }
}
```

规则：

- 对应“时间块完成”
- 只有 completed block 落入历史后才满足
- 不把 `stop` 视为满足

### SSE 事件合同

本轮统一发送 5 类事件：

1. `ready`
2. `heartbeat`
3. `fulfilled`
4. `timeout`
5. `error`

#### `ready`

连接建立后立即发送，表示服务端已接受该等待请求：

```text
event: ready
data: {"condition":{"type":"task_completed","taskId":"task-123"},"timeoutSecs":1800,"heartbeatSecs":15}
```

#### `heartbeat`

仅用于保活：

```text
event: heartbeat
data: {"ts":1777000000000}
```

#### `fulfilled`

命中条件后发送一次，并关闭连接。

`task_completed` 示例：

```text
event: fulfilled
data: {"type":"task_completed","matchedAt":1777000000000,"task":{"id":"task-123","status":"completed"}}
```

`next_event` 示例：

```text
event: fulfilled
data: {"type":"next_event","matchedAt":1777000000000,"event":{"id":"evt-1","tags":["note"]}}
```

`timeblock_stopped` 示例：

```text
event: fulfilled
data: {"type":"timeblock_stopped","matchedAt":1777000000000,"state":"stopped","activeBlock":{"startId":"tb-123","phase":"feedback_in_progress"}}
```

`timeblock_ended` 示例：

```text
event: fulfilled
data: {"type":"timeblock_ended","matchedAt":1777000000000,"completedBlock":{"startId":"tb-123","endTime":1777000000000}}
```

#### `timeout`

```text
event: timeout
data: {"condition":{"type":"task_completed","taskId":"task-123"},"timeoutSecs":1800}
```

#### `error`

```text
event: error
data: {"code":"task_not_found","message":"task not found: task-123","retryable":false}
```

### HTTP 状态码规则

- `400 Bad Request`
  - `condition.type` 不支持
  - body 非法
  - 必填字段缺失
- `404 Not Found`
  - `task_completed.taskId` 对应任务不存在
  - `timeblock_* .startId` 对应时间块在当前 scope 内不存在
- `200 OK`
  - SSE 正常建立
  - 包括“条件已满足后立即 fulfilled 并关闭”的情况

---

## Implementation Plan

## Task 0：代码探索与基线锁定

**文件：**

- 读取：`crates/exomind-runtime/src/routes/eventlog.rs`
- 读取：`crates/exomind-runtime/src/routes/tasks.rs`
- 读取：`crates/exomind-runtime/src/routes/timeblocks.rs`
- 读取：`crates/exomind-runtime/src/routes/signals.rs`
- 读取：`crates/exomind-runtime/src/eventlog.rs`

**目标：**

- 锁定 `eventlog/watch` 的当前 cursor 语义
- 锁定任务完成的真相字段
- 锁定时间块 `stop/end` 的现有状态推进
- 锁定可复用的 signal topics

**完成标准：**

- 形成等待条件到内部唤醒原语的映射表

---

## Task 1：新增 `/act/await` 路由壳层与共享类型

**文件：**

- Create：`crates/exomind-runtime/src/agent_await.rs`
- Create：`crates/exomind-runtime/src/routes/agent_await.rs`
- Modify：`crates/exomind-runtime/src/routes/mod.rs`
- Modify：`crates/exomind-runtime/src/lib.rs`

**实现：**

1. 新建 `crates/exomind-runtime/src/agent_await.rs`
   - 承载通用 Rust await API
   - 不感知 HTTP route / axum extractor
2. 新建 `crates/exomind-runtime/src/routes/agent_await.rs`
   - 只承载 HTTP / SSE 适配壳层
   - 调用 `crate::agent_await::*`
3. 定义：
   - `AwaitRequest`
   - `AwaitCondition`
   - `AwaitReadyPayload`
   - `AwaitFulfilledPayload`
   - `AwaitErrorPayload`
4. 在 route 模块提供统一 `router()`：

```text
POST /act/await
```

5. 使用 `axum::response::sse::Sse`
6. 固定输出 `ready/heartbeat/fulfilled/timeout/error`

**约束：**

- 模块名不用 `await.rs`，避免与 Rust 关键字冲突
- body 用 `camelCase`
- 不引入服务端 waiter 恢复 ID
- 不把 condition 判断、唤醒循环、真相回读写进 HTTP handler
- route handler 只做代理，不承载业务逻辑

---

## Task 2：实现 `next_event`

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/eventlog.rs`
- Reuse：`crates/exomind-runtime/src/eventlog.rs`

**实现：**

1. 先做一次即时检查：
   - 若给了 `sinceId / sinceTimestamp`，先加载匹配 backlog
   - 命中则直接 `fulfilled`
2. 若未命中：
   - 复用 EventLogStore 现有 scope watch 通知
   - 按 `user_id` 订阅内部广播
   - 被唤醒后重新筛选事件
3. 命中结果只取最早一条匹配事件

**关键决策：**

- 不从路由内部“调 HTTP 自己的 `/eventlog/watch`”
- 直接复用现有 store/broadcast/filter 原语
- 这部分逻辑放在 Rust 通用 await API，不放在 route handler
- 结果返回单条 `EventRecord`

---

## Task 3：实现 `task_completed`

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/tasks.rs`

**实现：**

1. 开流前先回读 `task_store.get_scoped(scope_key, task_id)`
   - 不存在则 `404`
   - 已 completed 则立即 `fulfilled`
2. 若未完成：
   - 订阅 `SignalPool`
   - 仅把以下 topic 视为唤醒候选：
     - `task.replication.upserted`
     - `task.transitioned`
   - 每次被唤醒后重新回读 task 真相
3. 只有 `status == completed` 时 fulfill

**关键决策：**

- `task.transitioned` 只做唤醒线索，不直接做 fulfill 真相
- 真相始终回到 task store
- route handler 不直接做 task store 轮询 / 唤醒循环

---

## Task 4：实现 `timeblock_stopped` 与 `timeblock_ended`

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/timeblocks.rs`

**实现：**

### 4.1 `timeblock_stopped`

1. 开流前先查：
   - 当前 active block 是否就是该 `startId`
   - completed history 中是否已有该 `startId`
2. 满足规则：
   - active block `phase == feedback_in_progress`
   - 或 completed history 已有该块
3. 等待时使用 signal 唤醒：
   - `timeblock.replication.active_upserted`
   - `timeblock.replication.completed`

### 4.2 `timeblock_ended`

1. 开流前先查 completed history
2. 若不存在，则订阅：
   - `timeblock.replication.completed`
3. 每次被唤醒后回读 completed history 复核

**关键决策：**

- 不依赖 `block_end` / `block_feedback` eventlog 作为主真相
- 时间块 eventlog 仅作次级痕迹，不作 await fulfill 依据
- await 逻辑不能阻塞正常 `stop / end` 路径

---

## Task 5：保活、超时与失败语义

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Modify：`crates/exomind-runtime/src/routes/agent_await.rs`

**实现：**

1. 心跳间隔按 `heartbeatSecs` 发送 `heartbeat`
2. 达到 `timeoutSecs` 后发送 `timeout` 并关闭
3. 错误分类至少覆盖：
   - `invalid_condition`
   - `task_not_found`
   - `timeblock_not_found`
   - `internal_error`

**错误策略：**

- 能在开流前发现的错误，直接 HTTP `400/404`
- 等待过程中的异常，用 SSE `error` 表达
- `error.message` 必须写成外部 Agent 可理解的文本，不只给内部枚举名
- 等待过程不得长时间占用共享锁或阻塞正常 RT 写路径

---

## Task 6：文档与 skill 同步

**文件：**

- Create：`docs/development/external-agent-await-api.md`
- Modify：`docs/development/runtime-external-access-contract.md`
- Modify：`skills/exomind-rt-agent-access/SKILL.md`

**同步内容：**

1. 新增 await API 文档
2. 在外部接入契约里把 `/act/await` 列为新的 feature API 样板
3. 在新 await API 文档中补最小 curl 示例
4. 在 `skills/exomind-rt-agent-access/SKILL.md` 中补最小术语映射与新文档跳转：
   - `专注结束 = timeblock_stopped`
   - `时间块完成 = timeblock_ended`
   - 指向 `docs/development/external-agent-await-api.md`
   - 保持该 skill 仍以 raw RT curl/HTTP 接入为主，不把 `/act/*` feature API 全量细节并入主入口

---

## Do Not Do

- 不新增 `/signals/await`
- 不新增 `/eventlog/await`
- 不把 `/signals/stream` 暴露成外部默认 await 合同
- 不把 await 业务逻辑直接写进 `routes/agent_await.rs`
- 不把未来的持久监听 `watch` 混入当前 `await`
- 不做持续订阅流
- 不做 topology wait
- 不做服务端 waiter 恢复
- 不把 `cancelled` 视为 `task_completed`
- 不把 `stop` 混写成“时间块完成”
- 不让 await 请求阻塞 UI 正常使用或 RT 正常推进

---

## Verification Plan

### Rust 自动化测试

**建议新增：**

- `next_event_without_cursor_waits_from_now`
- `next_event_with_since_id_returns_first_matching_backlog_event`
- `task_completed_fulfills_immediately_when_task_already_completed`
- `task_completed_waits_until_transition_to_completed`
- `timeblock_stopped_fulfills_on_feedback_phase`
- `timeblock_stopped_fulfills_when_block_already_completed`
- `timeblock_ended_waits_until_completed_block_exists`
- `await_returns_timeout_event_after_timeout_secs`
- `await_returns_404_for_missing_task`
- `await_returns_404_for_missing_timeblock`

### 手工 curl 验证

#### 1. 等下一条事件

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"next_event\"},\"timeoutSecs\":30,\"heartbeatSecs\":10}"
```

预期：

- 先收到 `ready`
- 期间收到 `heartbeat`
- 新事件写入后收到 `fulfilled`
- 连接关闭

#### 2. 等任务完成

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"task_completed\",\"taskId\":\"task-123\"},\"timeoutSecs\":300}"
```

预期：

- 任务完成后返回最终 task 快照

#### 3. 等专注结束

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"timeblock_stopped\",\"startId\":\"tb-123\"},\"timeoutSecs\":1800}"
```

预期：

- `POST /timeblocks/stop` 后 fulfill
- 若等待期间该块直接进入 completed，也应 fulfill，且 `state=ended`

#### 4. 等时间块完成

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"timeblock_ended\",\"startId\":\"tb-123\"},\"timeoutSecs\":1800}"
```

预期：

- 只有 `POST /timeblocks/end` 完成并落成 completed block 后才 fulfill

---

## Risks And Mitigations

### 风险 1：长连接占用

`/act/await` 会引入比 `/eventlog/watch` 更长的等待周期。

**对策：**

- 通过 `timeoutSecs` 上限限制单连接寿命
- v1 默认 single-shot，不做无限订阅

### 风险 2：内部 signal 与真相短暂不一致

Signal 到达时，资源状态可能还未完成最终可见更新。

**对策：**

- 所有 fulfill 都必须重新回读真相源
- Signal 只做唤醒，不做最终裁决

### 风险 3：时间块 stop/end 混淆

如果中文文案和 API type 不一致，Agent 很容易误用。

**对策：**

- 文档、skill、接口 type 同步采用：
  - `timeblock_stopped = 专注结束`
  - `timeblock_ended = 时间块完成`

### 风险 4：客户端断线

v1 不做 waiter 恢复，断线时可能丢失一次等待上下文。

**对策：**

- 服务端给出可理解错误文本
- 让客户端按原条件重发
- 对 `next_event` 鼓励使用 `sinceId` 做续接

---

## Acceptance

当以下条件同时满足时，本计划视为完成：

1. 外部 Agent 可通过 `POST /act/await` 等待 `next_event / task_completed / timeblock_stopped / timeblock_ended`
2. SSE 具备 `ready + heartbeat + fulfilled|timeout|error` 基本合同
3. fulfill 结果来自资源真相，而不是仅来自内部 signal/eventlog 痕迹
4. 中文术语“专注结束 / 时间块完成”在接口文档与 skill 中同步固定
5. `/act/await` 不要求外部 Agent 理解 route table、`agent_id=ui`、Signal topic 订阅细节
6. HTTP route 只作 transport adapter，通用 await 逻辑位于非 route Rust 模块
7. await 请求不会阻塞正常 UI 使用或 RT 正常状态推进
