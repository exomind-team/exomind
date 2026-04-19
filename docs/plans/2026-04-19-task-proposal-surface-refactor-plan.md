# 2026-04-19 Task Proposal Surface 重构计划

> **状态**：Draft
> **目标层级**：Proposal / RT task action surface
> **相关 issue**：
> - `#921`：短期 task proposal 能力补口
> - `#922`：Proposal 向 RT action gate 演化
> - `#906`：后续 signal-source / signal network 搬迁性重构
> **相关文档**：
> - [2026-04-17-proposal-system-generalization-discussion-notes.md](./2026-04-17-proposal-system-generalization-discussion-notes.md)
> - [2026-04-18-proposal-lifecycle-notification-plan.md](./2026-04-18-proposal-lifecycle-notification-plan.md)
> - [2026-04-01-agent-api-and-proposal-system-design.md](./2026-04-01-agent-api-and-proposal-system-design.md)

---

## Goal

把当前 proposal 中围绕任务的动作面，从“缩水版 `create_task` + 缺失的 `edit_task`”重构为一套清晰的 task action surface：

- 对外 canonical 动作名收口为：
  - `task.create`
  - `task.update`
- “新增任务”和“修改任务”共享一套 task proposal field contract
- proposal 批准执行后，真正落下当前 task 模型已经支持的高价值字段
- 提案箱不再只靠 JSON 文本编辑 task proposal，而是提供结构化编辑 + JSON 双向同步的混合编辑面

本轮不是单独再补一个孤立的 `edit_task` enum，也不是直接把 proposal 改造成 signal-first 写入系统。它是一轮围绕 task proposal surface 的重构。

---

## 核心澄清

### HTTP 与 signal 的关系

本轮必须先钉死一个真相：**proposal 的主写路径仍然是 `UI / Agent -> HTTP -> RT route -> store / executor`。**

当前 proposal 创建、更新、批准执行，真实入口都在 RT HTTP route 中。signal 在现阶段承担的是：

- 写后广播
- 跨端同步
- 前端实时刷新
- lifecycle / toast 派生

因此本轮不会把 proposal 改成“UI 直接向 signal network 发写请求”。需要改的是：

- HTTP 入口接受与返回的 action contract
- RT 内部 executor / store / adapter 的一致语义
- 写成功后发出的 replication / lifecycle payload
- 前端对这些 payload 的实时消费方式

换句话说：

- **HTTP 是写入口**
- **signal 是写后传播层**

### 本轮与 signal network 的关系

本轮对 `#906` 的兼容方式，不是提前把当前 proposal 迁成 signal-source 体系，而是：

- 先在当前 RT action surface 上把 task proposal 的动作名、字段 contract、审批语义收干净
- 让这一层成为未来 signal-source / signal network 重构时可映射的稳定 action 面

因此本轮的“兼容未来”体现在命名和 contract 设计上，而不是 transport 层切换上。

---

## Current Truth

### Proposal 侧现状

- 当前 proposal action type 只有：
  - `create_task`
  - `append_event`
  - `start_timeblock`
  - `approve_agent_access`
- 仓库里还没有真实的 `edit_task` action type、payload、executor 或 tool
- 当前提案箱编辑 task proposal 时，仍是 JSON-first，只对 `create_task` 暂时露了一个任务标题输入

### Task 侧现状

当前 task 模型实际上已经支持比 proposal 更丰富的字段：

- `title`
- `description`
- `doneCondition`
- `priority`
- `tags`
- `parentId`
- `dependsOn`
  - `soft`
  - `hard`
- `dueAt`
- `estimatedMinutes`
- `timeBlockIds`

RT 的 `update task` 路径也已经能处理其中大部分字段，但当前“可清空字段”的三态 patch 语义仍不完整；本轮需要把这部分 contract 补齐，而不是假定现状已经完全可复用。

当前真实情况需要再钉死一层：

- `estimatedMinutes` 在 Rust 侧已经有 `Option<Option<T>>` 的三态表达基础
- `description`
- `doneCondition`
- `dueAt`

这几类字段当前仍不是完整的三态 patch 字段；如果本轮要支持 `task.update` 的 clear/null 语义，必须同步扩展 task update contract，而不是只改 proposal 层。

### 当前结构断层

当前 proposal 的 `create_task` 在执行时只真正吃：

- `title`
- `description`
- `tags`
- `priority`

而会把这些 task 字段直接丢弃：

- `doneCondition`
- `dependsOn`
- `dueAt`
- `estimatedMinutes`

这意味着现在 proposal 侧和 task 真正的数据能力并不对齐。

---

## 本轮已定决策

### 1. 对外 canonical 动作名直接切到 `task.create / task.update`

本轮不再把外部动作面继续维持为旧的 `create_task` / 潜在 `edit_task` 风格。

canonical 新名固定为：

- `task.create`
- `task.update`

原因：

- “创建任务”与“修改任务”本质上属于同一 task action family
- 再继续堆 `create_task / edit_task / ...` 会把短期修补继续固化成 enum 扩洞路线
- 与 `#922` 的 RT action gate 方向更一致

### 2. 保留兼容输入窗，但 canonical 输出统一为新名

虽然 canonical 动作名切到 `task.create / task.update`，本轮仍保留一段兼容输入窗：

- ingress 允许旧名 alias 输入
  - `create_task` -> `task.create`
  - 若兼容历史上新增的 `edit_task` 输入，则归一到 `task.update`
- 新创建、新返回、新展示、新测试，统一输出 canonical 新名

也就是说：

- **允许旧名输入**
- **不再对外回吐旧名**

兼容输入窗还必须覆盖旧 proposal 存量数据：

- 现有 store 中已经持久化的 `create_task` proposal 不要求立即做一轮强制迁移
- 在兼容输入窗内，读路径要把旧名行归一化成 canonical 新名再返回给 UI / adapter
- 过滤路径要把 `task.create` 自动扩展为同时匹配：
  - `task.create`
  - `create_task`
- 若未来引入旧式 `edit_task` 行，也按同样规则归一到 `task.update`

也就是说，本轮的兼容对象不只是 ingress 输入，还包括存量 proposal 行的读取、筛选与展示一致性。

### 3. create / update 共用 task proposal field contract

本轮不允许 `task.create` 和 `task.update` 各写一套分裂的字段模型。

共享字段集第一版固定为高价值字段：

- `title`
- `description`
- `doneCondition`
- `priority`
- `tags`
- `estimatedMinutes`
- `dueAt`
- `dependsOn`

第一版明确不纳入：

- `parentId`
- `source`
- `timeBlockIds`

原因：

- 这些字段当前更偏系统性、结构性或历史绑定属性
- 当前用户的核心诉求集中在描述、依赖、估时/时间预期这些更直接的任务属性

### 4. `task.update` 固定为 partial patch 语义

`task.update` 第一版采用 partial patch，而不是 full snapshot。

语义固定为：

- 字段未出现：保持原值
- 字段出现且带值：更新为该值
- 可清空字段：
  - 外层表示“有没有改”
  - 内层表示“改成什么 / 是否清空”
  - Rust 侧按 `Option<Option<T>>` 等三态方式建模

建议按字段类型区分：

- 标量 nullable 字段
  - `description`
  - `doneCondition`
  - `dueAt`
  - `estimatedMinutes`
- 集合字段
  - `tags`
  - `dependsOn`
  - 显式传空数组表示清空

这也意味着本轮需要同步扩展 task update contract 本身，使 `description / doneCondition / dueAt / estimatedMinutes` 这类字段都能表达“未修改 / 设值 / 清空”三态，而不是只依赖当前的 set-only 语义。

这里的 contract 扩展范围是：

- proposal 的 `task.update.patch`
- task route / task store 的 update input
- adapter / 前端表单 / JSON 编辑器对 `null` 的解释

### 5. `dependsOn` 第一版只接受已有任务 ID

依赖绑定第一版不允许标题模糊匹配，也不允许“等审批时再解析成真实任务”。

唯一合法绑定方式：

- `dependsOn[].taskId` 必须是已有任务 ID
- `dependsOn[].type` 必须是 `soft | hard`

审批 UI 可以额外把这些 ID 实时解析为：

- 任务标题
- 当前状态
- 引用卡片

但存储和执行的锚点始终是 task ID。

### 6. 提案箱采用混合编辑面

`task.create / task.update` 在提案箱里不再只靠裸 JSON 编辑。

第一版采用混合编辑面：

- 结构化 task 表单为主
- 原始 JSON 视图保留
- 两者双向同步

原因：

- 只做 JSON 会把“更细致设置任务属性”的价值埋掉
- 纯表单会切断调试、审查和过渡期兼容能力

### 7. 终态任务约束继续沿用当前 task store 规则

本轮不额外放宽 terminal task 的编辑边界。

也就是说：

- proposal 层可以表达 `task.update`
- 真正执行时仍必须服从当前 task store 对 terminal task 的限制
- 若 proposal 试图修改终态任务的不可变字段，执行失败并保留失败痕迹

---

## Canonical Contract

### `task.create`

`task.create` 的 action params 第一版建议收口为：

```json
{
  "fields": {
    "title": "验收任务依赖图新布局",
    "description": "为任务依赖图新布局安排验收",
    "doneCondition": "完成一轮人工验收并记录结论",
    "priority": "high",
    "tags": ["验收", "task-dag"],
    "estimatedMinutes": 90,
    "dueAt": "2026-04-20T10:00:00.000Z",
    "dependsOn": [
      { "taskId": "task-123", "type": "hard" }
    ]
  }
}
```

硬约束：

- `fields.title` 必填
- `dependsOn[].taskId` 必须存在
- `dependsOn[].type` 只接受 `soft | hard`
- `dueAt` 使用 ISO 8601 字符串，对外保持时间语义清晰

### `task.update`

`task.update` 的 action params 第一版建议收口为：

```json
{
  "taskId": "task-456",
  "patch": {
    "description": "补充更清晰的执行说明",
    "estimatedMinutes": 120,
    "dueAt": null,
    "dependsOn": [
      { "taskId": "task-123", "type": "soft" }
    ]
  }
}
```

硬约束：

- `taskId` 必填
- `patch` 至少包含一个字段
- `patch` 内部按 partial patch 语义解释
- `null` 只用于允许清空的字段

---

## Runtime Changes

### 1. Proposal model / route / adapter

需要统一修改：

- Rust proposal `ActionType`
- TS `ProposalActionType`
- RT route 解析与响应
- 前端 adapter payload 映射
- CLI / Agent tool 对 action name 的认知

要求：

- ingress 支持旧名 alias
- store 持久化 canonical 新名
- list/get/update/create 返回 canonical 新名

实现注意：

- canonical 动作名采用 `task.create / task.update` 这种 dot-style 字符串，不能假定现有 `snake_case` enum rename 足以承载；需要显式设计 action type 的序列化与反序列化合同。
- 兼容输入窗内，proposal store 的 list/get/filter 不能只看“新写入的 canonical 行”，还必须显式处理旧 `create_task` 行的归一化与过滤扩展。

### 2. Proposal executor

`ProposalExecutor` 需要从“按旧三种动作硬编码分支”升级为真正执行 task action family：

- `task.create`
  - 创建任务时真正传下：
    - `title`
    - `description`
    - `doneCondition`
    - `priority`
    - `tags`
    - `dependsOn`
    - `dueAt`
    - `estimatedMinutes`
- `task.update`
  - 调用现有 task update 能力应用 patch
  - 服从 task store 的字段校验、依赖校验、terminal task 限制

### 3. Proposal references

本轮 task proposal 应自动补齐显式 references：

- `task.update`
  - 始终至少写入目标 task 本身的 reference
- `dependsOn`
  - 为每一个 dependency task 写入 reference

reference 的作用不是替代 action params，而是：

- 给 proposal 留下稳定的审计锚点
- 让审批 UI 不必只面对裸 ID

### 4. Proposal lifecycle / replication

本轮不改变“HTTP 写入、signal 写后传播”的总边界，但 action contract 改变后，下列 payload 必须同步收口：

- proposal HTTP 响应
- proposal replication snapshot
- proposal lifecycle event payload
- 前端 signal handler 中的 action type label / parsing

否则会出现：

- HTTP 返回新名
- signal 仍发旧名
- UI label / toast /过滤条件不一致

---

## Agent Tools

### 目标

把当前只会产出缩水版 task proposal 的 tool surface，升级为 task action family。

### 第一版要求

- 新增或重构为两类 task proposal tool：
  - 面向 `task.create`
  - 面向 `task.update`
- 旧 `add_task_proposal` 在兼容输入窗内可保留为 alias
- tool input schema 必须覆盖第一版高价值字段
- tool output 必须统一回传 canonical action name

### 原则

- tool surface 不再把“创建任务”和“编辑任务”混成一个模糊语义
- tool 负责生成结构化 action params
- 审批和执行层负责最终约束校验

---

## Proposal Inbox UI

### 1. 结构化编辑区

`task.create / task.update` 的审批编辑面第一版至少覆盖：

- 标题
- 描述
- 完成条件
- 优先级
- 标签
- 预计时长
- 截止时间
- 依赖列表

### 2. JSON 视图

保留原始 JSON 视图，用于：

- 审查原始 payload
- 调试
- 兼容过渡期 action params

但 JSON 不再是唯一主编辑入口。

同时必须加一条硬约束：

- JSON 视图不是逃逸白名单的后门
- `task.create / task.update` 的 JSON 内容必须经过与结构化表单同一套 schema 校验
- 若 JSON 中出现第一版白名单之外的字段，例如：
  - `parentId`
  - `source`
  - `timeBlockIds`
  - 其他未知键
- 系统应直接阻止保存 / 批准，并给出明确校验错误，而不是静默丢弃或偷偷透传

### 3. 双向同步

无论用户修改：

- 表单
- JSON

另一侧都要同步刷新，避免 proposal 审批页出现“两套内容不一致”的问题。

### 4. 依赖呈现

依赖项在审批页应同时展示：

- 任务标题
- task ID
- 当前状态
- `soft / hard` 类型

如果某个 task ID 当前无法解析：

- 仍保留原始 ID
- 标记为“引用未解析”
- 不自动把它静默吞掉

---

## Compatibility Strategy

### 兼容输入窗规则

本轮采用“兼容输入、统一输出”策略：

- 输入层接受旧名 alias
- 旧 proposal 存量数据在读取与过滤时做归一化
- 存储和输出层统一写 canonical 新名

兼容范围包括：

- HTTP create/list/get/update
- Agent proposal tool 输入
- 前端 adapter
- 旧测试 fixture

### 迁移目标

兼容输入窗结束后，逐步删除：

- `create_task`
- 若存在则包括 `edit_task`

使 task proposal surface 最终只保留：

- `task.create`
- `task.update`

---

## Non-Goals

本轮明确不做：

- 把 proposal 写入入口改成 signal-first
- 把 proposal 全量改造成 workflow / multi-step action
- 把 task proposal 字段一次扩到 near-full Task API
- 放宽 terminal task 的不可变约束
- 把 `parentId / source / timeBlockIds` 卷入第一版审批面
- 引入新的 proposal 生命周期状态来表达 task update 的每类失败

---

## Tests & Verification

### RT / Model

- `task.create / task.update` 可通过 proposal API 创建、读取、过滤
- 旧 action 名 alias 可输入
- 所有响应统一输出 canonical 新名

### Executor

- `task.create` 真正落下：
  - `doneCondition`
  - `dependsOn`
  - `dueAt`
  - `estimatedMinutes`
- `task.update` 只修改 patch 指定字段
- 三态 nullable 字段语义正确
- terminal task 非法修改会失败并留下 proposal failure 痕迹

### Agent Tooling

- task create/update proposal tool 能写出真实 proposal
- 旧 alias tool 若保留，输出仍统一为 canonical action name

### Frontend

- task proposal 有结构化编辑区
- 结构化编辑与 JSON 双向同步
- 依赖选择器最终写入 task ID
- proposal 审批页能实时解析 references，并清楚展示 task title / ID / status / dependency type

### 人工验证

1. 新建 `task.create` proposal，填写描述、依赖、估时、截止时间，批准后确认任务字段真实落库
2. 新建 `task.update` proposal，仅修改一部分字段，批准后确认未出现字段保持原样
3. 对可清空字段提交 `null` 或空数组，确认 patch 语义正确
4. 对终态任务提交不允许的修改，确认 proposal 留下失败评论与相应提醒
5. 在提案箱中切换结构化表单和 JSON，确认两边内容始终一致

---

## 关联与后续

- [2026-04-17-proposal-system-generalization-discussion-notes.md](./2026-04-17-proposal-system-generalization-discussion-notes.md)
  约束了本轮短期交付与长期 action gate 的关系
- [2026-04-18-proposal-lifecycle-notification-plan.md](./2026-04-18-proposal-lifecycle-notification-plan.md)
  约束了 proposal contract 修改后，signal 写后传播层也必须同步收口
- `#921`
  本轮直接承接其 task proposal 能力补口
- `#922`
  本轮通过 canonical task action family，为后续 RT action gate 提供更稳定的动作表面
- `#906`
  本轮不提前切 transport 层，但要求命名与 contract 对未来 signal-source / signal network 保持可映射
