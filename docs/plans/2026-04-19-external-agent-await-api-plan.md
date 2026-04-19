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

本轮要解决的几类典型等待动作：

1. 等待下一条 EventLog 事件
2. 等待任务的新增、状态变化或完成
3. 等待时间块的新增、状态变化、专注结束或时间块完成
4. 等待提案的新增、修订、状态变化、评论新增或执行失败

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

统一通过 `condition.type` 区分，本轮建议至少覆盖：

- `next_event`
- `task_created`
- `task_status_changed`
- `task_completed`
- `timeblock_created`
- `timeblock_state_changed`
- `timeblock_stopped`
- `timeblock_ended`
- `proposal_created`
- `proposal_revised`
- `proposal_status_changed`
- `proposal_comment_added`
- `proposal_execution_failed`

其中有三类 condition 需要特别说明：

- `task_completed` 是对 `task_status_changed(toStatus=completed)` 的语义化特化，保留为外部友好别名
- `timeblock_state_changed` / `timeblock_stopped` / `timeblock_ended` 使用的是 **外部派生状态语义**，由 Rust await API 基于 active block + completed history 复核得出，而不是要求内部必须先存在同名 signal topic
- `proposal_revised` / `proposal_comment_added` 是 **外部 await 语义名**；当前仓库内部并没有同名 lifecycle topic，第一版应由 `proposal.replication.upserted` + snapshot diff / comment diff 派生

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
   - 已有 `task.auto-created`
   - 已有 `task.created`
   - 已有 `task.updated`
   - 已有 `task.cancelled`
   - 已有 `task.transitioned`
   - 已有 `task.replication.upserted`
   - 已有 `timeblock.replication.active_upserted`
   - 已有 `timeblock.replication.completed`
   - 已有 `proposal.created`
   - 已有 `proposal.status_changed`
   - 已有 `proposal.execution_failed`
   - 已有 `proposal.replication.upserted`
   - 已有 `eventlog.replication.appended`

3. 资源真相回读
   - `GET /tasks/:id`
   - `GET /timeblocks/active`
   - `GET /timeblocks`
   - `GET /proposals/:id`
   - `POST /proposals/:id/comments`
   - EventLog store scoped list/filter

### 当前真相约束

- `task.auto-created` 是上游意图/分类器请求，不是 task 落库真相；`/act/await` 不应把它当成 fulfill 依据
- task 完成必须以 `Task.status == completed` 判断，不能偷换成 `completed_at != null`，因为 `cancelled` 同样会写入 `completed_at`
- timeblock 目前没有 `timeblock_stopped` / `timeblock_ended` / `timeblock_created` 这样的专用 topic；`await` 必须基于 `timeblock.replication.active_upserted`、`timeblock.replication.completed` 与 active/completed 真相回读派生外部语义
- `block_end` 当前对应“stop / 进入反馈阶段”，不是最终 completed；`block_feedback` 才更接近 completed history 写入痕迹
- proposal 当前真正独立的 lifecycle topic 只有 `proposal.created`、`proposal.status_changed`、`proposal.execution_failed`
- `proposal_revised` 与 `proposal_comment_added` 若纳入 `/act/await`，必须明确为 **feature 层派生条件**，而不是假装仓库内部已经存在同名原语

### 当前缺口

1. 没有统一 await 入口
2. `tasks` / `timeblocks` 没有专用 wait/watch 端点
3. `proposals` 目前只有 resource route，没有统一外部 await 合同
4. `/signals/stream` 是通用 SSE，但其过滤语义依赖 route table，不适合作为外部 await 合同
5. 现有 API 没有把“等待结果”收敛成单次 fulfill 的 SSE 合同

---

## Public Contract

### 请求入口

```text
POST /act/await?user_id=<profile-id>
Content-Type: application/json
Accept: text/event-stream
```

### 文档表达约定

本计划对 JSON 类结构采用统一的双重表达：

- **TypeScript 类型**：负责表达字段结构、判别联合与可选字段
- **JSON 样例**：负责表达真实请求/响应实例

后续同类文档也建议沿用这套写法，而不是主要依赖 prose 逐条解释“哪些字段可选”。

### 请求体

body 统一使用 `camelCase`：

```ts
type AwaitTimeblockState = 'running' | 'paused' | 'stopped' | 'ended';

type AwaitRequest = {
  condition: AwaitCondition;
  timeoutSecs?: number;
  heartbeatSecs?: number;
};

type AwaitCondition =
  | {
      type: 'next_event';
      sinceId?: string;
      sinceTimestamp?: number;
      tags?: string[];
    }
  | {
      type: 'task_created';
      taskId?: string;
    }
  | {
      type: 'task_status_changed';
      taskId?: string;
      fromStatus?: string;
      toStatus?: string;
    }
  | {
      type: 'task_completed';
      taskId?: string;
    }
  | {
      type: 'timeblock_created';
      startId?: string;
    }
  | {
      type: 'timeblock_state_changed';
      startId?: string;
      fromState?: AwaitTimeblockState;
      toState?: AwaitTimeblockState;
    }
  | {
      type: 'timeblock_stopped';
      startId?: string;
    }
  | {
      type: 'timeblock_ended';
      startId?: string;
    }
  | {
      type: 'proposal_created';
      proposalId?: string;
    }
  | {
      type: 'proposal_revised';
      proposalId?: string;
    }
  | {
      type: 'proposal_status_changed';
      proposalId?: string;
      fromStatus?: string;
      toStatus?: string;
    }
  | {
      type: 'proposal_comment_added';
      proposalId?: string;
    }
  | {
      type: 'proposal_execution_failed';
      proposalId?: string;
    };
```

JSON 样例：

等待任意任务完成：

```json
{
  "condition": {
    "type": "task_completed"
  },
  "timeoutSecs": 1800,
  "heartbeatSecs": 15
}
```

等待指定任务状态变化：

```json
{
  "condition": {
    "type": "task_status_changed",
    "taskId": "task-123",
    "toStatus": "completed"
  },
  "timeoutSecs": 300
}
```

等待任意时间块状态变化：

```json
{
  "condition": {
    "type": "timeblock_state_changed",
    "toState": "stopped"
  },
  "timeoutSecs": 1800
}
```

等待任意提案新增评论：

```json
{
  "condition": {
    "type": "proposal_comment_added"
  },
  "timeoutSecs": 1800
}
```

等待指定提案修订：

```json
{
  "condition": {
    "type": "proposal_revised",
    "proposalId": "proposal-77"
  },
  "timeoutSecs": 1800
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

### 通用匹配语义

- 资源型 condition 中的 `taskId` / `startId` / `proposalId` 都是 **过滤字段**
- 省略这些 id 时，默认语义固定为 **wait any from now**
- `wait any from now` 不回扫历史 backlog；fulfilled 必须返回实际命中的资源标识
- condition 可分为两类：
  - **lifecycle 型**：`next_event`、`*_created`、`*_status_changed`、`timeblock_state_changed`、`proposal_revised`、`proposal_comment_added`、`proposal_execution_failed`
    - 一律等待请求建立后的下一次新命中
    - 即使显式提供具体 id，也只是“等待未来命中该过滤器”，不是读取历史或立即看当前状态
  - **state 型**：`task_completed`、`timeblock_stopped`、`timeblock_ended`
    - 显式提供具体 id 时，允许先做一次即时真相检查
    - 若已满足，则立即 fulfilled
    - 省略具体 id 时，退化为 `wait any from now`

#### 1. `next_event`

- 真相源：EventLog store
- 唤醒线索：`eventlog.replication.appended`
- 未提供 `sinceId` / `sinceTimestamp` 时，沿用当前 `watch from now`
- 提供 cursor 时，允许先补 cursor 之后已存在的 backlog
- `tags` 语义与当前 EventLog 过滤保持一致，为 AND 语义
- fulfill 结果只返回 **一条最早命中的事件**，不返回批量数组

#### 2. task 条件

- `task_created`
  - 语义：等待任务新增
  - 真相源：Task store
  - 唤醒线索：`task.created`、`task.replication.upserted`
- `task_status_changed`
  - 语义：等待任务状态变化
  - 真相源：Task store
  - 唤醒线索：`task.transitioned`、`task.replication.upserted`
  - `fromStatus` / `toStatus` 作为可选过滤器
- `task_completed`
  - 语义：等待任务进入 `completed`
  - 真相源：Task store
  - 唤醒线索：`task.transitioned`、`task.replication.upserted`
  - 不把 `cancelled` 视为满足
  - 这是 `task_status_changed(toStatus=completed)` 的语义化别名，但保留独立 type 以减少外部 Agent 心智负担
- 所有 task 条件 fulfilled 都必须返回实际命中的 `task.id`

#### 3. timeblock 条件

- `timeblock_created`
  - 语义：等待一个新的 `startId` 在 active block 或 completed history 中首次可见
  - 真相源：active block / completed history
  - 唤醒线索：`timeblock.replication.active_upserted`、`timeblock.replication.completed`
  - 第一版不区分它来自显式 start、new block 还是 gap block；只要新的 `startId` 首次出现就算命中
- `timeblock_state_changed`
  - 语义：等待时间块的**外部派生状态**变化
  - 真相源：active block / completed history
  - 唤醒线索：`timeblock.replication.active_upserted`、`timeblock.replication.completed`
  - `fromState` / `toState` 采用外部状态语义：`running | paused | stopped | ended`
  - 其中：
    - `stopped` 对应 active block `phase == feedback_in_progress`
    - `ended` 对应该 `startId` 已进入 completed history
- `timeblock_stopped`
  - 语义：等待“专注结束”
  - 真相源：active block / completed history
  - 当 active block 进入 `feedback_in_progress` 时满足
  - 若同一 `startId` 的块已进入 completed history，也视为满足，且 `state=ended`
  - 可视为 `timeblock_state_changed(toState=stopped)` 的语义化特化
- `timeblock_ended`
  - 语义：等待“时间块完成”
  - 真相源：completed history
  - 只有 completed block 落入历史后才满足
  - 不把 `stop` 视为满足
  - 可视为 `timeblock_state_changed(toState=ended)` 的语义化特化
- 所有 timeblock 条件 fulfilled 都必须返回实际命中的 `startId`

#### 4. proposal 条件

- `proposal_created`
  - 语义：等待提案新增
  - 真相源：Proposal store
  - 唤醒线索：`proposal.created`、`proposal.replication.upserted`
- `proposal_revised`
  - 语义：等待提案修订
  - 第一版精确定义应收敛为：等待 proposal snapshot 的**非状态、非评论**修订；当前仓库里的典型来源是 `action_params` 更新
  - 真相源：Proposal store
  - 唤醒线索：第一版可复用 `proposal.replication.upserted` + snapshot diff
- `proposal_status_changed`
  - 语义：等待提案状态变化
  - 真相源：Proposal store
  - 唤醒线索：`proposal.status_changed`、`proposal.replication.upserted`
  - `fromStatus` / `toStatus` 作为可选过滤器
- `proposal_comment_added`
  - 语义：等待提案新增评论
  - 真相源：Proposal store comments
  - 唤醒线索：第一版可复用 `proposal.replication.upserted` + comment diff
  - 它是外部 await 派生条件，不要求仓库内部必须先有同名 lifecycle topic
- `proposal_execution_failed`
  - 语义：等待提案批准后执行失败
  - 真相源：Proposal store comments + execution failure signal
  - 唤醒线索：`proposal.execution_failed`
- `proposal_execution_failed` 与 `proposal_comment_added` 可能由同一次 proposal 更新共同满足，但每个 await 请求只针对自己声明的 condition 进行判定
- 所有 proposal 条件 fulfilled 都必须返回实际命中的 `proposal.id`
- `proposal_execution_failed` fulfilled 必须返回 failure comment / failure message

### SSE 事件合同

本轮统一发送 5 类事件：

1. `ready`
2. `heartbeat`
3. `fulfilled`
4. `timeout`
5. `error`

```ts
type EventRecord = Record<string, unknown>;
type TaskSnapshot = Record<string, unknown>;
type TimeBlockSnapshot = Record<string, unknown>;
type ProposalSnapshot = Record<string, unknown>;
type ProposalCommentSnapshot = Record<string, unknown>;

type AwaitReadyPayload = {
  condition: AwaitCondition;
  timeoutSecs: number;
  heartbeatSecs: number;
};

type AwaitHeartbeatPayload = {
  ts: number;
};

type AwaitFulfilledPayload =
  | {
      type: 'next_event';
      matchedAt: number;
      eventId: string;
      event: EventRecord;
    }
  | {
      type: 'task_created' | 'task_status_changed' | 'task_completed';
      matchedAt: number;
      taskId: string;
      task: TaskSnapshot;
      transition?: {
        fromStatus?: string;
        toStatus?: string;
      };
    }
  | {
      type:
        | 'timeblock_created'
        | 'timeblock_state_changed'
        | 'timeblock_stopped'
        | 'timeblock_ended';
      matchedAt: number;
      startId: string;
      state?: AwaitTimeblockState;
      transition?: {
        fromState?: AwaitTimeblockState;
        toState?: AwaitTimeblockState;
      };
      activeBlock?: TimeBlockSnapshot;
      completedBlock?: TimeBlockSnapshot;
    }
  | {
      type:
        | 'proposal_created'
        | 'proposal_revised'
        | 'proposal_status_changed'
        | 'proposal_comment_added'
        | 'proposal_execution_failed';
      matchedAt: number;
      proposalId: string;
      proposal: ProposalSnapshot;
      transition?: {
        fromStatus?: string;
        toStatus?: string;
      };
      comment?: ProposalCommentSnapshot;
      execution?: {
        failureMessage: string;
      };
    };

type AwaitTimeoutPayload = {
  condition: AwaitCondition;
  timeoutSecs: number;
};

type AwaitErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
};

type AwaitSseEvent =
  | { event: 'ready'; data: AwaitReadyPayload }
  | { event: 'heartbeat'; data: AwaitHeartbeatPayload }
  | { event: 'fulfilled'; data: AwaitFulfilledPayload }
  | { event: 'timeout'; data: AwaitTimeoutPayload }
  | { event: 'error'; data: AwaitErrorPayload };
```

实际 SSE wire format 仍然是：

```text
event: <event-name>
data: <json>
```

下面的样例统一只展示 `data` 的 JSON 载荷。

#### `ready`

连接建立后立即发送，表示服务端已接受该等待请求：

```json
{
  "condition": {
    "type": "proposal_comment_added"
  },
  "timeoutSecs": 1800,
  "heartbeatSecs": 15
}
```

#### `heartbeat`

仅用于保活：

```json
{
  "ts": 1777000000000
}
```

#### `fulfilled`

命中条件后发送一次，并关闭连接。

`task_completed` 示例：

```json
{
  "type": "task_completed",
  "matchedAt": 1777000000000,
  "taskId": "task-123",
  "task": {
    "id": "task-123",
    "status": "completed"
  }
}
```

`next_event` 示例：

```json
{
  "type": "next_event",
  "matchedAt": 1777000000000,
  "eventId": "evt-1",
  "event": {
    "id": "evt-1",
    "tags": ["note"]
  }
}
```

`timeblock_state_changed` 示例：

```json
{
  "type": "timeblock_state_changed",
  "matchedAt": 1777000000000,
  "startId": "tb-123",
  "state": "stopped",
  "transition": {
    "fromState": "running",
    "toState": "stopped"
  },
  "activeBlock": {
    "startId": "tb-123",
    "phase": "feedback_in_progress"
  }
}
```

`proposal_comment_added` 示例：

```json
{
  "type": "proposal_comment_added",
  "matchedAt": 1777000000000,
  "proposalId": "proposal-77",
  "proposal": {
    "id": "proposal-77",
    "status": "approved"
  },
  "comment": {
    "author": {
      "name": "Runtime Executor"
    },
    "content": "批准后执行失败：network timeout"
  }
}
```

#### `timeout`

```json
{
  "condition": {
    "type": "task_created"
  },
  "timeoutSecs": 1800
}
```

#### `error`

```json
{
  "code": "task_not_found",
  "message": "task not found: task-123",
  "retryable": false
}
```

### HTTP 状态码规则

- `400 Bad Request`
  - `condition.type` 不支持
  - body 非法
  - 必填的 `condition.type` 缺失
- `404 Not Found`
  - 显式提供 `task_completed.taskId` 且对应任务不存在
  - 显式提供 `timeblock_stopped.startId` / `timeblock_ended.startId` 且对应时间块在当前 scope 内不存在
  - `task_created` / `task_status_changed` / `timeblock_created` / `timeblock_state_changed` / `proposal_*` 在显式提供具体 id 时，默认视为**未来过滤器**，而不是“请求建立时必须已存在”的断言，因此不因当前缺失直接 `404`
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
- 读取：`crates/exomind-runtime/src/routes/proposals.rs`
- 读取：`crates/exomind-runtime/src/routes/signals.rs`
- 读取：`crates/exomind-runtime/src/task/store.rs`
- 读取：`crates/exomind-runtime/src/timeblock.rs`
- 读取：`crates/exomind-runtime/src/timeblock_sqlite.rs`
- 读取：`crates/exomind-runtime/src/proposal/store.rs`
- 读取：`crates/exomind-runtime/src/eventlog.rs`

**目标：**

- 锁定 `eventlog/watch` 的当前 cursor 语义
- 锁定 task 真相字段必须以 `status + status_transitions` 为准，而不是 EventLog tag 或 `completed_at`
- 锁定 timeblock active/completed 双真相源、`stop/end` 的现有状态推进与外部派生状态映射
- 锁定 proposal 的真实 lifecycle topics，以及 `revised/comment_added` 需通过 diff 派生这一点
- 锁定每个 condition 对应的可复用唤醒 topic

**完成标准：**

- 形成 `condition -> wake-up topics -> truth read -> fulfilled payload` 的映射表
- 明确哪些 condition 是“直接 topic + 真相复核”，哪些是“replication 唤醒 + diff 派生”

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
   - `AwaitTimeblockState`
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

## Task 3：实现 task 条件族

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/tasks.rs`
- Reuse：`crates/exomind-runtime/src/task/store.rs`

**实现：**

### 3.1 `task_created`

1. 建立请求时记录当前可见 task 基线
2. 唤醒候选：
   - `task.created`
   - `task.replication.upserted`
3. 被唤醒后回读 task store，判断：
   - 显式 `taskId` 时，该 task 是否在请求建立后首次出现
   - 未显式 `taskId` 时，是否有新的 task 落入当前 scope
4. fulfilled 必须返回实际命中的 `taskId`

### 3.2 `task_status_changed`

1. 建立请求时记录显式目标 task 或当前可见 task 集合的基线状态
2. 唤醒候选：
   - `task.transitioned`
   - `task.replication.upserted`
3. 被唤醒后回读 task 真相，按 `status` 判断是否发生匹配的状态变化
4. `fromStatus` / `toStatus` 作为可选过滤器
5. 显式 `taskId` 时不因“当前还不存在”直接 `404`，因为它属于 future filter

### 3.3 `task_completed`

1. 这是 `task_status_changed(toStatus=completed)` 的特化
2. 若显式提供 `taskId`：
   - 开流前先回读 `task_store.get_scoped(scope_key, task_id)`
   - 不存在则 `404`
   - 已 `completed` 则立即 `fulfilled`
3. 若未显式提供 `taskId`：
   - 不回扫已有 completed backlog
   - 建立“wait any from now”的等待基线，只接受请求建立后首次新进入 `completed` 的任务
4. 被唤醒后重新回读 task 真相
5. fulfill 必须只认 `status == completed`

**关键决策：**

- `task.auto-created` 只作为上游意图痕迹，不作为 fulfill 真相
- `task_created` / `task_status_changed` / `task_completed` 一律回到 task store 复核，不以 EventLog tag 直接裁决
- `task_completed` 不能用 `completed_at` 判定，因为 `cancelled` 也会写入该字段
- `task.transitioned` 只做唤醒线索，不直接做 fulfill 真相
- 真相始终回到 task store
- route handler 不直接做 task store 轮询 / 唤醒循环
- 省略 `taskId` 时，固定采用“wait any from now”

---

## Task 4：实现 timeblock 条件族

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/timeblocks.rs`
- Reuse：`crates/exomind-runtime/src/timeblock.rs`
- Reuse：`crates/exomind-runtime/src/timeblock_sqlite.rs`

**实现：**

### 4.1 外部派生状态约定

- `running`
- `paused`
- `stopped`
  - 对应 active block `resolve_phase() == feedback_in_progress`
- `ended`
  - 对应该 `startId` 已进入 completed history

### 4.2 `timeblock_created`

1. 建立请求时记录当前可见 `startId` 基线
2. 唤醒候选：
   - `timeblock.replication.active_upserted`
   - `timeblock.replication.completed`
3. 被唤醒后回读 active block + completed history
4. 若出现新的 `startId`，则 fulfilled，并返回该 `startId`
5. 显式 `startId` 时，它表示“等待未来该块出现”，不是当前存在断言

### 4.3 `timeblock_state_changed`

1. 建立请求时记录目标块或当前可见块的外部派生状态基线
2. 唤醒候选：
   - `timeblock.replication.active_upserted`
   - `timeblock.replication.completed`
3. 被唤醒后重新回读并派生 `running | paused | stopped | ended`
4. `fromState` / `toState` 作为可选过滤器
5. fulfilled 必须返回实际命中的 `startId`

### 4.4 `timeblock_stopped`

1. 若显式提供 `startId`，开流前先查：
   - 当前 active block 是否就是该 `startId`
   - completed history 中是否已有该 `startId`
2. 若未显式提供 `startId`：
   - 不回扫已有 feedback/completed backlog
   - 建立“wait any from now”的等待基线，只接受请求建立后首次新进入 stopped/ended 的时间块
3. 满足规则：
   - active block `phase == feedback_in_progress`
   - 或 completed history 已有该块
4. 等待时使用 signal 唤醒：
   - `timeblock.replication.active_upserted`
   - `timeblock.replication.completed`
5. 若是 wait-any 模式，fulfilled 必须返回实际命中的 `startId`

### 4.5 `timeblock_ended`

1. 若显式提供 `startId`，开流前先查 completed history
2. 若未显式提供 `startId`：
   - 不回扫已有 completed backlog
   - 建立“wait any from now”的等待基线，只接受请求建立后首次新进入 completed history 的时间块
3. 若未满足，则订阅：
   - `timeblock.replication.completed`
4. 每次被唤醒后回读 completed history 复核
5. 若是 wait-any 模式，fulfilled 必须返回实际命中的 `startId`

**关键决策：**

- `timeblock_created` / `timeblock_state_changed` 属于 feature 层派生条件，真相来自 active block + completed history，而不是要求底层先有同名 topic
- `block_end` 不表示最终 completed，只表示 stop / 进入反馈阶段
- 不依赖 `block_end` / `block_feedback` EventLog 作为主真相
- 时间块 eventlog 仅作次级痕迹，不作 await fulfill 依据
- await 逻辑不能阻塞正常 `stop / end` 路径

---

## Task 5：实现 proposal 条件族

**文件：**

- Modify：`crates/exomind-runtime/src/agent_await.rs`
- Reuse：`crates/exomind-runtime/src/routes/proposals.rs`
- Reuse：`crates/exomind-runtime/src/proposal/store.rs`

**实现：**

### 5.1 `proposal_created`

1. 建立请求时记录当前 proposal 基线
2. 唤醒候选：
   - `proposal.created`
   - `proposal.replication.upserted`
3. 被唤醒后回读 Proposal store
4. fulfilled 返回实际命中的 `proposalId`

### 5.2 `proposal_revised`

1. 建立请求时记录目标 proposal 的基线 snapshot
2. 唤醒候选：
   - `proposal.replication.upserted`
3. 被唤醒后回读 Proposal store
4. 只有出现“非状态、非评论”的 snapshot 修订时才 fulfill
5. 第一版具体应至少覆盖当前仓库里真实存在的 `action_params` 更新路径

### 5.3 `proposal_status_changed`

1. 建立请求时记录 proposal 状态基线
2. 唤醒候选：
   - `proposal.status_changed`
   - `proposal.replication.upserted`
3. 被唤醒后回读 Proposal store，按最终状态复核
4. `fromStatus` / `toStatus` 作为可选过滤器

### 5.4 `proposal_comment_added`

1. 建立请求时记录 proposal comment 基线
2. 唤醒候选：
   - `proposal.replication.upserted`
3. 被唤醒后回读 Proposal store
4. 通过 comments diff 判断是否新增评论
5. fulfilled 必须返回新增 comment 与实际命中的 `proposalId`

### 5.5 `proposal_execution_failed`

1. 唤醒候选：
   - `proposal.execution_failed`
   - `proposal.replication.upserted`
2. 被唤醒后回读 Proposal store，确保返回的是包含失败评论的最终 snapshot
3. fulfilled 必须返回：
   - `proposalId`
   - 最终 proposal snapshot
   - `execution.failureMessage`
   - 对应 failure comment（若已写回）

**关键决策：**

- `proposal_revised` / `proposal_comment_added` 是外部 await 派生条件，不要求内部先有同名 lifecycle topic
- `proposal.execution_failed` 仍是独立高优先级条件，不和普通 `proposal_comment_added` 混写成一个语义
- 显式 `proposalId` 在 proposal lifecycle 条件中默认是 future filter，不因当前不存在直接 `404`

---

## Task 6：保活、超时、失败语义与非阻塞保障

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
4. await 过程中只允许：
   - 订阅 signal / watch
   - 轻量基线记录
   - 被唤醒后短读真相源复核
5. 禁止：
   - 长时间持有 store lock
   - 在正常写路径上等待 await 消费者
   - 在 route handler 里手写业务轮询逻辑

**错误策略：**

- 能在开流前发现的错误，直接 HTTP `400/404`
- 等待过程中的异常，用 SSE `error` 表达
- `error.message` 必须写成外部 Agent 可理解的文本，不只给内部枚举名
- 等待过程不得长时间占用共享锁或阻塞正常 RT 写路径

---

## Task 7：文档、issue 与 skill 同步

**文件：**

- Create：`docs/development/external-agent-await-api.md`
- Modify：`docs/development/runtime-external-access-contract.md`
- Modify：`docs/plans/2026-04-19-external-agent-await-api-plan.md`
- Modify：`skills/exomind-rt-agent-access/SKILL.md`
- Modify：GitHub issue `#930`
- Reuse：GitHub issue `#931`

**同步内容：**

1. 新增 await API 文档
2. 在外部接入契约里把 `/act/await` 列为新的 feature API 样板
3. 对请求体、SSE payload、示例事件统一采用“TypeScript 类型 + JSON 样例”表达
4. 在新 await API 文档中补最小 curl 示例
5. 在 `#930` / `#931` 中同步约束边界、非阻塞原则、route-thin-adapter 规则与未来 `watch` 边界
6. 在 await 功能验证完成、curl / 测试证据齐备之后，再回写 `skills/exomind-rt-agent-access/SKILL.md`，补最小术语映射与新文档跳转：
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
- 不把 EventLog tag 直接当作 task / timeblock / proposal fulfill 真相
- 不把 `task.auto-created` 当成 task await 的 fulfill 真相
- 不把所有 proposal 变更都强行升级成独立内部 lifecycle topic
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
- `task_created_waits_for_any_future_task`
- `task_created_with_task_id_waits_for_that_task_to_appear`
- `task_status_changed_waits_for_matching_transition`
- `task_status_changed_without_task_id_returns_first_matching_task`
- `task_completed_fulfills_immediately_when_task_already_completed`
- `task_completed_waits_until_transition_to_completed`
- `task_completed_without_task_id_waits_for_any_future_completed_task`
- `task_completed_uses_status_not_completed_at`
- `timeblock_created_waits_for_new_start_id`
- `timeblock_state_changed_derives_external_transition`
- `timeblock_stopped_fulfills_on_feedback_phase`
- `timeblock_stopped_fulfills_when_block_already_completed`
- `timeblock_stopped_without_start_id_waits_for_any_future_stopped_or_ended_block`
- `timeblock_ended_waits_until_completed_block_exists`
- `timeblock_ended_without_start_id_waits_for_any_future_completed_block`
- `proposal_created_waits_for_any_future_proposal`
- `proposal_revised_waits_for_non_status_non_comment_diff`
- `proposal_status_changed_waits_for_matching_transition`
- `proposal_comment_added_waits_for_comment_delta`
- `proposal_execution_failed_returns_failure_message_and_final_snapshot`
- `await_returns_timeout_event_after_timeout_secs`
- `await_returns_404_for_missing_task`
- `await_returns_404_for_missing_timeblock`
- `await_does_not_block_normal_timeblock_end_path`
- `await_does_not_block_normal_task_transition_path`

### 代表性手工 curl 验证

除 `next_event` 外，其余条件都应同时验证两种模式：

- 显式资源 ID 的 future filter / state wait
- 省略资源 ID 的 `wait any from now`

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

#### 2. 等任意任务新增

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"task_created\"},\"timeoutSecs\":300}"
```

预期：

- 任意任务在等待建立后新增时返回最终 task 快照
- 响应里必须带实际命中的 `task.id`

#### 3. 等指定任务状态变化

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"task_status_changed\",\"taskId\":\"task-123\",\"toStatus\":\"completed\"},\"timeoutSecs\":300}"
```

预期：

- 仅当 `task-123` 在等待建立后发生匹配状态变化时 fulfill
- fulfilled payload 同时带 `taskId`、最终 task snapshot、必要时带 `transition`

#### 4. 等任意任务完成

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"task_completed\"},\"timeoutSecs\":300}"
```

预期：

- 任意任务在等待建立后完成时返回最终 task 快照
- 响应里必须带实际命中的 `task.id`

#### 5. 等任意时间块状态变化

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"timeblock_state_changed\",\"toState\":\"stopped\"},\"timeoutSecs\":1800}"
```

预期：

- 任意时间块在等待建立后发生匹配的外部派生状态变化时 fulfill
- 响应里必须带实际命中的 `startId`
- `state` / `transition` 必须使用外部状态语义，而不是直接泄露内部 phase 枚举

#### 6. 等专注结束

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"timeblock_stopped\"},\"timeoutSecs\":1800}"
```

预期：

- 任意时间块在等待建立后 stop 时 fulfill
- 若等待期间该块直接进入 completed，也应 fulfill，且 `state=ended`
- 响应里必须带实际命中的 `startId`

#### 7. 等时间块完成

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"timeblock_ended\"},\"timeoutSecs\":1800}"
```

预期：

- 任意时间块在等待建立后完成并落成 completed block 时 fulfill
- 响应里必须带实际命中的 `startId`

#### 8. 等任意提案新增评论

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"proposal_comment_added\"},\"timeoutSecs\":1800}"
```

预期：

- 任意提案在等待建立后新增评论时 fulfill
- 响应里必须带实际命中的 `proposalId` 与新增 comment

#### 9. 等指定提案修订

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"proposal_revised\",\"proposalId\":\"proposal-77\"},\"timeoutSecs\":1800}"
```

预期：

- 仅当 `proposal-77` 在等待建立后发生非状态、非评论修订时 fulfill
- fulfilled payload 返回最终 proposal snapshot 与 `proposalId`

#### 10. 等提案执行失败

```powershell
curl.exe -N -X POST "http://127.0.0.1:9124/act/await?user_id=profile-argon" `
  -H "Content-Type: application/json" `
  --data-binary "{\"condition\":{\"type\":\"proposal_execution_failed\"},\"timeoutSecs\":1800}"
```

预期：

- 任意提案在等待建立后发生执行失败时 fulfill
- 响应里必须带实际命中的 `proposalId`、`execution.failureMessage`，以及已写回时的 failure comment

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

### 风险 3：timeblock 派生状态语义过宽

如果 `created / state_changed / stopped / ended` 的外部语义没有收紧，Agent 容易把 active/completed 两套真相源混成一个模糊状态机。

**对策：**

- 文档里显式声明外部派生状态
- `timeblock_stopped` / `timeblock_ended` 继续保留独立语义化别名
- 文档、skill、接口 type 同步采用：
  - `timeblock_stopped = 专注结束`
  - `timeblock_ended = 时间块完成`

### 风险 4：proposal 修订 / 评论 diff 误判

`proposal_revised` 与 `proposal_comment_added` 不是现成 lifecycle topic，若 diff 规则写得宽，容易误报。

**对策：**

- 把 `proposal_revised` 第一版精确定义为“非状态、非评论”修订
- 单测分别覆盖：
  - `action_params` 更新
  - `status` 更新不应误触发 `proposal_revised`
  - comment 追加不应误触发 `proposal_revised`
- fulfilled 前始终回读最终 proposal snapshot

### 风险 5：客户端断线

v1 不做 waiter 恢复，断线时可能丢失一次等待上下文。

**对策：**

- 服务端给出可理解错误文本
- 让客户端按原条件重发
- 对 `next_event` 鼓励使用 `sinceId` 做续接

---

## Acceptance

当以下条件同时满足时，本计划视为完成：

1. 外部 Agent 可通过 `POST /act/await` 等待 `next_event`、task 条件族、timeblock 条件族、proposal 条件族
2. SSE 具备 `ready + heartbeat + fulfilled|timeout|error` 基本合同
3. 请求体与 SSE `data` 载荷在文档中统一采用“TypeScript 类型 + JSON 样例”表达
4. 资源型 condition 在省略具体 ID 时可等待任意未来命中的对象，且 fulfilled 必须返回实际命中的资源标识
5. fulfill 结果来自资源真相，而不是仅来自内部 signal/eventlog 痕迹
6. 中文术语“专注结束 / 时间块完成”在接口文档与 skill 中同步固定
7. `/act/await` 不要求外部 Agent 理解 route table、`agent_id=ui`、Signal topic 订阅细节
8. HTTP route 只作 transport adapter，通用 await 逻辑位于非 route Rust 模块
9. await 请求不会阻塞正常 UI 使用或 RT 正常状态推进
10. 未来若扩展持久监听能力，应另以 `watch` 命名追踪，而不是回灌到当前 `await`
11. `exomind-rt-agent-access` skill 只在 `/act/await` 功能验证完成后再同步更新，避免把未验收合同提前固化进 skill
