# 2026-04-18：任务状态变化节点的数据权威源分析

## 任务目标

回答一个更窄但关键的架构问题：

1. `任务状态变化节点` 现在是不是仍然主要靠 `EventLog` 检索出来。
2. 如果我们已经决定删除任务时间线里的兼容性回退，这条链路还应不应该继续存在。
3. 更合理的权威数据源应是什么，以及应该怎样迁移。

## 任务清单

- [x] 复核任务模型，确认是否已有独立状态历史结构
- [x] 复核 runtime / store / sqlite 写入链路
- [x] 复核任务时间线读取链路
- [x] 对照时间块域的 `transitions` 方案
- [x] 给出架构判断与迁移计划
- [x] Markdown 落盘

## 结论先行

结论很直接：

- **不应该继续把 `EventLog` 作为“任务状态变化节点”的权威查询源。**
- **应该在任务域内新增一套独立的状态历史结构**，像时间块的 `transitions` 一样，直接记录“何时从什么状态变化到什么状态”。
- `EventLog` 仍然有价值，但它更适合作为：
  - 审计痕迹
  - 人类可读叙事
  - 跨域可观察性事件
  - 下游投影

而不是任务时间线页面的 canonical read model。

## 一、当前现状：任务状态历史并不存在于任务域内

### 1. 前端任务模型只有当前状态，没有状态历史

[src/lib/types/task.ts](../../src/lib/types/task.ts) 当前只有：

- `status`
- `createdAt`
- `updatedAt`
- `completedAt`
- `timeBlockIds`

没有类似：

- `statusTransitions`
- `statusHistory`
- `transitionLog`

这种字段。

这意味着前端任务对象本身只表达“现在是什么状态”，不表达“是怎么走到这里的”。

### 2. Rust runtime 任务模型同样只有当前状态，没有历史结构

[crates/exomind-runtime/src/task/types.rs](../../crates/exomind-runtime/src/task/types.rs) 里的 `Task` 也只有：

- `status`
- `created_at`
- `updated_at`
- `completed_at`
- `time_block_ids`

没有任何任务状态历史数组或单独对象。

因此，这不是“前端漏接字段”，而是**任务域从类型层就还没有建出状态历史 primitive**。

### 3. TaskStore / SQLite 只会原地覆盖状态，不会追加历史

[crates/exomind-runtime/src/task/store.rs](../../crates/exomind-runtime/src/task/store.rs) 的 `transition_scoped()` 做的事情是：

- 检查合法状态转换
- 读取旧状态
- 把 `task.status` 改成 `new_status`
- 更新 `updated_at`
- 若终态则写 `completed_at`

随后返回 `(old_status, task)`。

[crates/exomind-runtime/src/task/sqlite_store.rs](../../crates/exomind-runtime/src/task/sqlite_store.rs) 的 `transition_scoped()` 也是同样语义：

- 读出当前任务
- 改 `status`
- 改 `updated_at`
- 终态时写 `completed_at`
- `persist_task()`

SQLite `tasks` 表结构也只有：

- `status`
- `created_at`
- `updated_at`
- `completed_at`

没有 `status_transitions_json`，也没有 `task_status_history` 子表。

因此当前事实非常明确：**任务状态变化不会在任务域内被 append-only 持久化，只会覆盖当前快照。**

## 二、当前任务时间线为什么会去读 EventLog

### 1. 任务时间线页面当前就是在读 `tasks + events + timeBlocks`

[src/ui/app/pages/TaskTimelinePage.tsx](../../src/ui/app/pages/TaskTimelinePage.tsx) 的加载链路会同时加载：

- `taskService.listTasks(true)`
- `eventLogService.loadEvents()`
- `timeBlockService.loadTimeBlocks()`

然后交给 `buildTaskTimelineModel(tasks, events, timeBlocks, ...)`。

这说明当前页面不是从“任务域内历史结构”构图，而是在做跨域拼装。

### 2. timeline model 现在优先读 EventLog，没有事件才回退时间块

[src/ui/app/pages/task-timeline-model.ts](../../src/ui/app/pages/task-timeline-model.ts) 里的核心逻辑是：

- 若该任务存在 task events，就 `buildSegmentsFromEvents(...)`
- 否则就 `buildSegmentsFromTimeBlocks(...)`

也就是说，当前的任务时间线主路径实际上是：

1. 先把 `EventLog` 当任务状态历史
2. 没有事件再退回旧的时间块范式

这正是我们前一轮已经确认需要删除的旧回退逻辑。

### 3. EventLog 读取合同本身现在就已经不稳

[src/ui/app/pages/task-timeline-model.ts](../../src/ui/app/pages/task-timeline-model.ts) 当前读取的是：

- `metadata.taskId`
- `metadata.toStatus`

但 runtime [crates/exomind-runtime/src/routes/tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs) 写入 EventLog 时写的是：

- `task_id`
- `old_status`
- `new_status`

也就是说：

- 页面读 camelCase
- runtime 写 snake_case

这不是一个抽象上的小瑕疵，而是在提醒我们：**EventLog metadata 从来不是任务时间线的强类型领域合同。**

它更像“附带说明的日志载荷”。

## 三、为什么 EventLog 不适合做任务状态节点的权威源

### 1. 领域归属错了

任务状态变化首先是 **Task domain fact**，不是 EventLog fact。

如果任务时间线要回答的是：

- 这个任务什么时候开始
- 什么时候挂起
- 什么时候恢复
- 什么时候完成 / 取消

那这些信息应该由任务系统自己给出，而不是去另一个 append-only 日志域里反查。

### 2. EventLog 天然是叙事层，不是强约束读模型

EventLog 的职责更接近：

- 记录发生过什么
- 给人看
- 给跨域观察 / Agent / 回顾用

它不是为“给任务域提供强一致历史查询”而设计的。

一旦把它当权威读模型，就会出现几个问题：

- metadata schema 漂移会直接打穿时间线
- EventLog 写入失败虽然不该阻塞主流程，但会让历史查询不完整
- 任务域与日志域的演化节奏被硬绑定

这和我们现在要做的“删兼容回退、收敛到最新结构”方向是相反的。

### 3. UI 查询成本和语义成本都更高

如果页面每次都要：

- 拉全量任务
- 拉全量 EventLog
- 过滤 task 相关事件
- 再拼时间段

那它本质上是在用日志重建状态机。

这在概念上不干净，在实现上也脆弱。

### 4. 这不符合当前时间块域已经建立的更好模式

时间块域现在已经有了清晰的域内历史结构：

- `transitions`
- `task_association_log`
- `task_status_outcomes`

并且这些结构直接存入 runtime 类型和 SQLite：

- [crates/exomind-runtime/src/timeblock.rs](../../crates/exomind-runtime/src/timeblock.rs)
- [crates/exomind-runtime/src/timeblock_sqlite.rs](../../crates/exomind-runtime/src/timeblock_sqlite.rs)

换句话说，时间块已经证明了：

- “历史语义”应该做成 domain-native data structure
- 而不是让 consumer 去外部日志里猜

任务域现在只是还没完成这一刀。

## 四、我建议的正确收口方向

### 1. 在任务域新增 canonical primitive

建议新增：

- `TaskStatusTransition`

最小字段建议：

- `at`
- `fromStatus`
- `toStatus`
- `trigger`
- `source`
- `actorId`
- `blockStartId` 或 `relatedBlockId`（可选，用于把任务状态变化和时间块上下文挂钩）

示意：

```ts
type TaskStatusTransition = {
  at: number
  fromStatus: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled' | null
  toStatus: 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
  trigger?: 'task.create' | 'task.transition' | 'task.cancel' | 'timeblock.end'
  source?: string
  actorId?: string
  blockStartId?: string
}
```

### 2. 第一版建议直接走“像时间块一样的内嵌历史数组”

第一版不必一上来建独立表。更顺手的做法是：

- `Task.status` 继续保留，作为当前快照
- 新增 `Task.statusTransitions`
- SQLite `tasks` 表新增 `status_transitions_json`

这样做的理由很简单：

- 和时间块 `transitions` 方案一致
- API 面改动最小
- 读任务详情 / 任务时间线都更直接
- 大多数任务的状态变化次数不会多到需要单独拆表

后面若真有全局分析 / 聚合扫描压力，再把它投影到单独索引表，不必一开始就把 canonical model 设计成索引结构。

## 五、删掉兼容回退后，正确的迁移顺序

### Phase 1：给任务域补历史结构

- TS / Rust `Task` 类型新增 `statusTransitions`
- SQLite `tasks` 表新增 `status_transitions_json`
- 创建任务时写入第一条初始记录：
  - `null -> pending`
  - `at = created_at`

### Phase 2：把所有任务状态写路径改成“先写任务域历史，再派生副作用”

任务状态变化时，runtime 应该在同一事务里：

1. 更新 `status`
2. 更新 `updated_at`
3. 追加一条 `statusTransitions`

之后再做派生副作用：

1. 发 `task.transitioned` signal
2. 写 EventLog

这样 EventLog 就降级为 derived side-effect，而不是 canonical source。

### Phase 3：任务时间线页面只读任务域历史

`TaskTimelinePage` 应改为直接读取：

- 任务列表
- 每个任务的 `statusTransitions`

然后：

- 用 `statusTransitions` 生成状态变化节点
- 用当前 `status` / `completedAt` 做末端校验
- 如需补充时间块上下文，再把时间块当“关联证据层”而不是状态权威源

到这一步，可以删除：

- `buildSegmentsFromTimeBlocks(...)`
- “没有事件就回退时间块”的逻辑
- 任务时间线对 EventLog 的依赖

### Phase 4：EventLog 退回到审计层

此时 EventLog 仍可继续保留：

- 人类可读记录
- Agent / review / narrative timeline
- 诊断 / 审计 / 追责

但任务时间线视图不再直接依赖它。

## 六、关于旧数据：删兼容回退，不等于不能做一次性迁移

如果我们要彻底删掉运行期回退，我建议区分两件事：

### 1. 不要保留运行期向后兼容读取

也就是不要让最终页面继续：

- 读 EventLog 补任务状态历史
- 读旧 timeblock 关系补任务状态历史

这条应该删。

### 2. 可以做一次性数据迁移 / 回填

如果我们希望旧任务的历史不要完全丢失，可以在 schema migration 时一次性做：

- 从现有 EventLog 提取可信的 task transition 事件
- 回填进 `status_transitions_json`
- 迁移完成后，页面和运行时再也不直接依赖 EventLog 做任务历史查询

这和“保留 runtime fallback”不是一回事。

我认为这是更合理的折中：

- **运行期只认新结构**
- **迁移期允许做一次性历史灌入**

如果团队决定连这一步也不要，那也可以更激进：

- 只从 `created_at / status / updated_at / completed_at` 生成最小初始历史
- 接受旧任务的中间状态历史不完整

但这属于产品/数据保真取舍，不属于架构正确性。

## 七、与当前 timeblock closeout 的关系

这件事和 `#780 / #759` 的关系是：

- 我们前面已经决定：任务时间线不该继续依赖“旧时间块范式 fallback”
- 现在进一步收口后的答案是：它也不该长期依赖 `EventLog`

也就是说，任务时间线最终应当从：

- `EventLog 主读 + TimeBlock fallback`

变成：

- `Task statusTransitions 主读 + TimeBlock 关联上下文`

这才是和“统一时间块类型”“间隙时间块类型”收口之后一致的架构落点。

## 最终判断

你的判断是对的。

`任务状态变化节点` 不应该继续通过检索 `EventLog` 来做；更合理的方向是，在任务系统内建立一套像时间块 `transitions` 那样的**独立状态历史结构**，让任务时间线直接读取任务域数据本身。EventLog 保留，但只作为派生审计层，不再作为权威查询源。
