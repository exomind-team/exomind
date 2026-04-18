# 2026-04-18：新时间块体系迁移完成度调查

## 问题定义

这次调查连续回答了三个相关问题：

1. 采用新时间块系统后，`任务/时间线` 里有关时间块数据的识别与分析，是否仍在遵循旧版时间块范式。
2. `#780` 的“统一时间块类型 / 统一时间块数据结构”工作，是否也存在类似“没迁移完”的问题。
3. `#759` 的“间隙时间块类型（gap block）”工作，是否同样存在“主链可用，但没有全仓收口”的问题。

为了避免把三件事混成一句“时间块还没迁完”，这份文档把它们拆开分析，并区分：

- 文档目标态已经要求什么
- runtime / service / route 实际已经落地了什么
- 前端消费者、任务分析、Today/Timeline/详情页到底还在按什么语义消费
- 哪些地方是真正的半迁移，哪些地方是主链已通过但边缘层未收口

## 调查范围

这次只做仓库内只读调查，没有改代码，也没有在本轮重新跑桌面实例。

主要查看了以下几类资料：

- 架构/计划/规格文档：
  - [docs/plans/2026-03-19-batch-b-task-timeline-plan.md](../plans/2026-03-19-batch-b-task-timeline-plan.md)
  - [docs/plans/2026-03-31-timeblock-unification-step1.md](../plans/2026-03-31-timeblock-unification-step1.md)
  - [docs/plans/2026-03-31-timeblock-unification-step2.md](../plans/2026-03-31-timeblock-unification-step2.md)
  - [docs/plans/2026-04-09-issue-780-timeblock-unification-tauri-validation-charter.md](../plans/2026-04-09-issue-780-timeblock-unification-tauri-validation-charter.md)
  - [docs/plans/2026-04-14-EDS-architecture-freeze-plan.md](../plans/2026-04-14-EDS-architecture-freeze-plan.md)
  - [docs/plans/2026-04-14-EDS-blueprint-handoff.md](../plans/2026-04-14-EDS-blueprint-handoff.md)
  - [docs/plans/PLAN-timeblock-cleanup-and-bugfix.md](../plans/PLAN-timeblock-cleanup-and-bugfix.md)
  - [docs/development/tauri-mcp-windows-playbook.md](../development/tauri-mcp-windows-playbook.md)
  - [docs/specs/timeblock-task-association-semantics.md](../specs/timeblock-task-association-semantics.md)
- 前端与 service：
  - `src/lib/types/event.ts`
  - `src/lib/timeblock/derive.ts`
  - `src/lib/services/timeblock.service.ts`
  - `src/lib/services/task-timer.service.ts`
  - `src/ui/app/pages/TaskTimelinePage.tsx`
  - `src/ui/app/pages/task-timeline-model.ts`
  - `src/ui/app/pages/TaskDetailPage.tsx`
  - `src/ui/app/pages/task-timeblock-detail-view.ts`
  - `src/ui/app/pages/tasks-today-view.ts`
  - `src/ui/app/pages/now-today-blocks-view.ts`
  - `src/ui/app/pages/timeblock-detail-view.ts`
  - `src/ui/app/components/FocusTimerWidget.tsx`
  - `src/components/TimeBlockWidget.tsx`
- runtime：
  - `crates/exomind-runtime/src/routes/timeblocks.rs`
  - `crates/exomind-runtime/src/routes/tasks.rs`
  - `crates/exomind-runtime/src/routes/today_planner.rs`
  - `crates/exomind-runtime/src/timeblock.rs`
  - `crates/exomind-runtime/src/timeblock_sqlite.rs`
- 测试：
  - `tests/unit/ui/task-timeline-model.test.ts`
  - `tests/unit/ui/task-timeblock-detail-view.test.ts`
  - `tests/unit/ui/tasks-today-timeblock-view.test.ts`
  - `tests/unit/ui/now-today-gap-display.issue759.test.ts`
  - `tests/unit/ui/focus-keep-awake-controller.test.ts`
  - `tests/unit/services/new-block.issue759.test.ts`
  - `tests/unit/services/timeblock.service.rt-sqlite.test.ts`

## 结论摘要

先给结论，不绕。

### 结论 1：`任务/时间线` 仍明显遵循旧版时间块范式

是，而且不是个别残留，而是**消费层逻辑仍然以旧范式为主**。

最典型的表现：

- 继续把时间块拆成 `completed blocks + active block` 两套入口。
- 任务历史仍主要依赖 `task.timeBlockIds` 反查。
- `/tasks/timeline` 在没有识别到 `task.*` 事件时，会回退到“从 completed blocks 推断任务状态段”的旧模型。
- `transitions`、`taskAssociationLog`、`sourcePlannedBlockId` 并没有成为 `任务/时间线` 的主分析依据。

### 结论 2：`#780` 也存在“没迁移完”，但它是“主时间块链已基本可用，跨域消费者未收口”

`#780` 不是“没有做完”，也不是“没落地”。

更准确地说，它已经完成了下面这些：

- `transitions` 进入类型层、runtime、SQLite、RT 路由。
- `pause / resume / stop / end / gap` 的主时间块链已经按新语义运行。
- 文档和桌面叙事实测都把 `transitions` 视为单一语义源。

但它仍没完全收口：

- service / adapter / route / store 对外合同仍然是 `completed + active` 分离。
- 类型层和派生逻辑仍保留大量 legacy fallback。
- `任务/时间线`、任务详情等消费者并没有全面转向统一 block object 的消费方式。

### 结论 3：`#759` 也有未收口，但更像“主链已落地，周边 UI / 同步 / 通用消费者没有全量显式建模”

`gap block` 在 runtime/timeblock 主链上已经不是纸面概念：

- 有 `blockType = gap`
- 有 `end -> gap` 和 `gap -> next active` 的路由守卫与切换
- 有 gap backfill
- Today Planner 也承认 gap 是可被新工作片段替换的合法状态

但它也没有做到“全仓显式建模完成”：

- 部分通用 active-block UI 仍然几乎不看 `blockType`
- 一些组件只是把“有 activeBlock”直接等价成“running / paused / feedback”
- cleanup 计划明确把 `#759` 排除在本轮收口之外

所以 `#759` 的问题不是“gap 主链不可用”，而是**gap 语义没有均匀传播到所有消费者和治理环节**。

## 一、`任务/时间线` 是否仍按旧时间块范式分析

### 1. 文档目标态已经不是旧范式

统一时间块目标态写得非常明确：

- [2026-04-14-EDS-architecture-freeze-plan.md](../plans/2026-04-14-EDS-architecture-freeze-plan.md) 说 `TimeBlock` 只有一个统一数据结构，活跃块只是其中一种特殊状态。
- [2026-04-14-EDS-blueprint-handoff.md](../plans/2026-04-14-EDS-blueprint-handoff.md) 直接把 `active/completed` 双结构标成“已废弃的旧设计”，要求统一成单一 `blocks` 数组。

但 `任务/时间线` 的实施计划本身，在更早阶段就明确保留了旧 fallback：

- [2026-03-19-batch-b-task-timeline-plan.md](../plans/2026-03-19-batch-b-task-timeline-plan.md) 把模型分成两条来源：
  - 有 `task.*` 事件时走精确事件流
  - 老任务无事件时，直接“从时间块推导”

这意味着：`任务/时间线` 从设计之初就不是一个纯新范式页面，而是“新事件流 + 旧时间块推导”并存。

### 2. 页面加载链仍只拿 completed blocks

[src/ui/app/pages/TaskTimelinePage.tsx](../../src/ui/app/pages/TaskTimelinePage.tsx) 在加载时只取三样数据：

- `taskService.listTasks(true)`
- `eventLogService.loadEvents()`
- `timeBlockService.loadTimeBlocks()`

它没有加载统一 blocks，也没有加载 `activeBlock`。

这直接决定了：`/tasks/timeline` 的时间块侧分析，只能建立在 completed blocks 之上。

### 3. 模型里确实保留旧 fallback

[src/ui/app/pages/task-timeline-model.ts](../../src/ui/app/pages/task-timeline-model.ts) 的核心逻辑是：

- `hasTaskEvents ? buildSegmentsFromEvents : buildSegmentsFromTimeBlocks`

其中 `buildSegmentsFromTimeBlocks()` 的行为完全是旧范式：

- 读取 `task.timeBlockIds`
- 用 `block.startId` 去 completed blocks 里匹配
- 没有块时，从 `task.createdAt` 推一个长 `pending` 段
- 有块时，前置一个 `pending` 段，再把每个 block 直接推成一个 `in_progress` 段
- terminal marker 则直接借用 `task.status`

这不是“兼容一点旧数据”，而是**明确存在一条旧式任务状态建模通路**。

### 4. 测试也在保护这个旧 fallback

[tests/unit/ui/task-timeline-model.test.ts](../../tests/unit/ui/task-timeline-model.test.ts) 明确把下面这件事写成预期：

- “当没有 task 事件时，fallback 到 time blocks 推导”

这说明当前行为不是偶发残留，而是受测试保护的正式兼容逻辑。

### 5. 关键归因：RT 任务事件和前端识别契约还错位

这一点是本轮新增发现，而且是最关键的原因链之一。

前端时间线识别 `task.*` 事件时读取的是 camelCase metadata：

- `metadata.taskId`
- `metadata.toStatus`

见 [src/ui/app/pages/task-timeline-model.ts](../../src/ui/app/pages/task-timeline-model.ts)。

但 RT `tasks` 路由写入 EventLog 时写的是 snake_case：

- `task_id`
- `old_status`
- `new_status`

见 [crates/exomind-runtime/src/routes/tasks.rs](../../crates/exomind-runtime/src/routes/tasks.rs)。

同时：

- `EventLogRtAdapter` 没有做 metadata key 归一化
- `EventLogService` 也只是原样透传 metadata
- `TaskService` 在 `rt-sqlite` 下又不会再自己补发前端版 transition events

结果就是：

`/tasks/timeline` 虽然表面上是“task 事件优先”，但在 RT 主链里，很可能经常识别不到这些事件，于是自然落回 `task.timeBlockIds + completed blocks` 的旧推导分支。

这解释了为什么这个页面在新时间块系统启用后，看上去仍然“像旧系统”。

## 二、`#780 统一时间块类型` 的完成度判断

### 1. 文档目标态：不是“改善字段”，而是“统一语义”

`#780` 的目标不是多加一个字段，而是把时间块从旧结构改成统一结构：

- [2026-03-31-timeblock-unification-step1.md](../plans/2026-03-31-timeblock-unification-step1.md)：先加 `transitions` 和 derive 函数，再 service 双写，最后迁消费者并删除旧字段。
- [2026-03-31-timeblock-unification-step2.md](../plans/2026-03-31-timeblock-unification-step2.md)：让 Rust RT 成为 `transitions` 的唯一真相源。
- [2026-04-09-issue-780-timeblock-unification-tauri-validation-charter.md](../plans/2026-04-09-issue-780-timeblock-unification-tauri-validation-charter.md)：把“单一语义源：`transitions`”列为桌面验收对象。

这里最重要的一句话其实是 Step 1 里已经写出来的：

> 渐进式迁移：先双写，再迁消费者，最后删旧字段。

这本身就意味着：`#780` 从设计上就是一个允许中间态长期存在一段时间的迁移工程。

### 2. 已落地的部分：runtime/timeblock 主链已经明显转向新语义

#### 类型与派生

[src/lib/types/event.ts](../../src/lib/types/event.ts) 已经定义：

- `BlockTransition`
- `transitions?: BlockTransition[]`
- `resolveTimeBlockStartTime / EndTime / Phase`

[src/lib/timeblock/derive.ts](../../src/lib/timeblock/derive.ts) 也已经把 phase / paused / accumulatedRunMs 的派生优先建立在 `transitions` 上。

#### runtime

[crates/exomind-runtime/src/timeblock.rs](../../crates/exomind-runtime/src/timeblock.rs) 和 [crates/exomind-runtime/src/timeblock_sqlite.rs](../../crates/exomind-runtime/src/timeblock_sqlite.rs) 都已经持久化 `transitions`。

[crates/exomind-runtime/src/routes/timeblocks.rs](../../crates/exomind-runtime/src/routes/timeblocks.rs) 中：

- `do_new_block` 会给新 active 写 `start`
- 完成旧块时会补 `feedback_submit` / `end`
- `stop/pause/resume` 会继续 push transition

#### service

[src/lib/services/timeblock.service.ts](../../src/lib/services/timeblock.service.ts) 也已经：

- 在 canonicalization 时按 `transitions` 派生 phase、elapsed、pauseAccumulatedMs 等字段
- 在 `rt-sqlite` 模式下直接走新 RT route

#### 桌面主链验收

[docs/development/tauri-mcp-windows-playbook.md](../development/tauri-mcp-windows-playbook.md) 记录了 `#780` 的桌面叙事实测：

- terminal active 不再阻塞开始新块
- `pause / resume / feedback / gap` 都能由 `transitions` 派生一致语义
- reload / RT 重启后能恢复

这说明：**时间块主链本身并不处于“不可用”状态。**

### 3. 仍未收口的部分：对外合同和跨域消费者还活在 split world

尽管主链已转向 `transitions`，但当前系统并没有完全达到“统一时间块类型”的仓库级完成态。

#### 对外 service / adapter 合同仍 split

[src/lib/services/timeblock.service.ts](../../src/lib/services/timeblock.service.ts) 公开的仍是：

- `loadTimeBlocks()`：加载已完成时间块
- `loadActiveBlock()`：加载当前进行中的时间块

[src/lib/adapters/timeblock-rt-adapter.ts](../../src/lib/adapters/timeblock-rt-adapter.ts) 仍分别请求：

- `GET /timeblocks`
- `GET /timeblocks/active`

runtime route/store 也还是：

- `list_completed*`
- `get_active*`

所以即使内部语义转向了 `transitions`，对外消费接口仍然保持旧世界的二分法。

#### 类型层仍有大量 legacy fallback

[src/lib/types/event.ts](../../src/lib/types/event.ts) 自己就写着：

- `elapsed`：兼容旧结构，逐步迁移中
- `updatedAt`：兼容旧结构，逐步迁移中
- `taskId`：deprecated，保留反序列化兼容

而 `resolveTimeBlockPhase()` 也是：

1. 先看 `transitions`
2. 没有的话再回退 `feedbackSubmittedAt / phase / paused / actionEndedAt`

这不是坏事，但它说明统一类型迁移并未完成“删旧字段”这一步。

#### 跨域消费者没有全面转向 unified object model

最典型的还是：

- `TaskTimelinePage`
- `task-timeblock-detail-view`
- 任务详情页里的 `preferredBlockId` / `timeBlockIds` 反查

它们并没有真正把时间块当作“统一对象 + 统一状态机 + 历史关联日志”来消费，而仍然活在：

- `completed blocks`
- `active block`
- `task.timeBlockIds`

这类旧式合同中。

### 4. 对 `#780` 的准确判断

所以对 `#780` 最准确的判断不是“没做完”，而是：

> `#780` 已经把时间块主链从旧字段拼装推进到 `transitions` 驱动，但“统一时间块类型”的仓库级迁移还没有完成对外合同与消费者收口。

换句话说，它是：

- **主时间块链基本可用**
- **消费者迁移未完**
- **legacy 兼容层仍在**

## 三、`#759 gap block` 的完成度判断

### 1. `gap` 已经不是纸面概念，而是 runtime/timeblock 主链的一部分

`gap` 不是只停留在 issue 或文档里。

#### 类型层

[src/lib/types/event.ts](../../src/lib/types/event.ts) 已经定义：

- `BlockType = 'active' | 'gap'`
- `blockType?: BlockType`

并且明确写了：

- `active = 用户主动触发`
- `gap = 自动间隙`

#### service 层

[src/lib/services/timeblock.service.ts](../../src/lib/services/timeblock.service.ts) 里已经有完整的 `#759` 落点：

- `backfillGapBlocks()`
- 结束 active 后创建 gap
- legacy 分支里也会把 gap 截断成 completed gap
- `gap` 不触发 `timeblock.completed` signal

#### runtime 路由

[crates/exomind-runtime/src/routes/timeblocks.rs](../../crates/exomind-runtime/src/routes/timeblocks.rs) 已经围绕 gap 建立了明确约束：

- `start`：当前必须是 gap 或 empty，才允许创建新的 active
- `end`：当前必须是 active，结束后创建 gap
- `stop / pause / resume / patch_active_tasks`：当前是 gap 时都要拒绝
- `describe`：当前 active gap 和 completed gap 都允许命名；completed active 不允许
- `/timeblocks?block_type=gap` 支持过滤
- `/timeblocks/backfill-gaps` 支持历史补创

#### planner 主链

[crates/exomind-runtime/src/routes/today_planner.rs](../../crates/exomind-runtime/src/routes/today_planner.rs) 还明确把 gap 纳入 planner 主链：

- `can_replace_active_block_for_planner_start(active)` 返回 `active.is_gap() || active.is_completed()`
- `start_segment()` 会原子地“截断 gap + 创建 active”

这说明 gap 不仅存在，而且已经进入“今天规划 -> 启动工作片段 -> runtime 新 active”的业务主链。

### 2. `gap` 在部分 UI / consumer 中已经有明确语义

这一点说明 `#759` 不是只做了 runtime。

#### Today blocks 视图

[src/ui/app/pages/now-today-blocks-view.ts](../../src/ui/app/pages/now-today-blocks-view.ts) 已经把 `blockType` 暴露到 view item。

对应测试 [tests/unit/ui/now-today-gap-display.issue759.test.ts](../../tests/unit/ui/now-today-gap-display.issue759.test.ts) 也明确验证：

- gap 会出现在视图项里
- `blockType = gap`
- title 为空
- 无 linked tasks

#### Focus keep awake

[src/ui/app/components/FocusKeepAwakeController.tsx](../../src/ui/app/components/FocusKeepAwakeController.tsx) 明确拒绝 gap block：

- `if (block.blockType === 'gap') return false`

对应测试也覆盖了这点。

这说明 gap 并不是完全 invisible，而是已经进入部分消费者的正式判断逻辑。

### 3. 但 `#759` 仍没有做到全仓收口

#### cleanup 计划明确没有处理它

[docs/plans/PLAN-timeblock-cleanup-and-bugfix.md](../plans/PLAN-timeblock-cleanup-and-bugfix.md) 明确把 `#759` 排除在当前收口任务之外：

- “不处理间隙时间块 `#759`”

这意味着：项目自己并没有声称 gap 相关治理已经彻底结束。

#### 部分通用 active-block UI 仍缺少显式 gap 分支

这一点是本轮最重要的 gap 侧发现。

[src/ui/app/components/FocusTimerWidget.tsx](../../src/ui/app/components/FocusTimerWidget.tsx) 和 [src/components/TimeBlockWidget.tsx](../../src/components/TimeBlockWidget.tsx) 的主状态逻辑主要看的是：

- `phase`
- `paused`
- `feedback_*`

几乎看不到对 `blockType === 'gap'` 的显式 UI 语义分支。

类似地，[src/ui/app/overlay/now-workbench-overlay-model.ts](../../src/ui/app/overlay/now-workbench-overlay-model.ts) 也是：

- 只要 `input.activeBlock` 存在，就直接进入 `mode: 'running'`
- 没有先判断“当前 activeBlock 其实是 gap”

这说明 gap 虽然已经进入时间块主链，但并没有被所有通用 active-block 消费者显式建模。

更直白地说：

- 在 runtime/timeblock 主链里，gap 是一等状态
- 在一部分通用 UI 里，gap 还更像“特殊 active”，依赖 service 派生字段和外围约束兜着走

#### 同步与补偿层仍有专门的 gap 特判/保守处理

[docs/plans/2026-04-13-multi-domain-reconciliation-design.md](../plans/2026-04-13-multi-domain-reconciliation-design.md) 写到：

- completed gap block 的后续 `describe` 修改第一版不要求被 completed cursor 捕获
- 这类 drift 由 summary 发现，再靠 snapshot fallback 覆盖回来

这也说明 gap 语义在同步补偿层并不是“天然、处处对齐”的，而是仍然存在特殊处理和保守兜底。

### 4. 对 `#759` 的准确判断

所以 `#759` 不能简单说“没迁完”，也不能说“已经彻底收口”。

更准确的判断是：

> `gap block` 已经进入 runtime/timeblock/planner 主链，并在部分 UI / 视图中有正式语义；但它还没有被所有 active-block 消费者、同步补偿逻辑和清理计划完全均匀吸收。

也就是：

- **主链可用**
- **局部消费者已跟上**
- **全仓统一收口未完成**

## 四、三条调查线的共性与差异

### 共性

这三件事有一个共同背景：

当前时间块域整体处于“主链已经 RT 化，但 legacy 兼容层和旧消费者还没完全退场”的中间态。

这件事项目文档自己也承认了，见 [docs/plans/PLAN-timeblock-cleanup-and-bugfix.md](../plans/PLAN-timeblock-cleanup-and-bugfix.md)：

- 时间块主链路基本 RT 化
- 但仍残留 legacy 兼容层

因此：

- `#780` 不会天然一步到位
- `#759` 也不会天然一步到位
- `任务/时间线` 更不会自动跟上新语义

### 差异

三者不是同一种 unfinished。

#### `任务/时间线`

问题本质是：

- **任务分析消费层仍旧**
- 仍依赖 `task.timeBlockIds`
- 仍用 completed-only blocks 回推状态
- 还有 task event metadata 契约错位导致 fallback 更常触发

#### `#780`

问题本质是：

- **时间块主链已经显著迁到新语义**
- 但统一类型的仓库级迁移没有完成对外合同和消费者收口

#### `#759`

问题本质是：

- **gap 已经进入主链**
- 但没有在所有通用 UI / 同步治理环节里被完整显式建模

## 五、当前风险

### 1. 文档目标态与代码消费态继续漂移

架构/冻结文档已经明确要求统一时间块结构，但消费者里依然广泛存在 split 合同和旧 fallback。

如果后续继续以“文档已经统一”为前提设计新模块，而不先检查消费层现状，会反复产生“纸面统一，代码分裂”的错觉。

### 2. `任务/时间线` 会继续给出旧语义下的分析结果

这会导致：

- 页面看起来可用
- 但实际分析依据仍是 `task.timeBlockIds + completed blocks`
- 新时间块系统里的 `transitions / gap / planner provenance / 历史关联日志` 没有成为主输入

### 3. `gap` 可能在主链以外的通用 UI 中继续被误当成 running-like active

只要通用 active-block UI 还不先判断 `blockType`，就有可能出现：

- 视觉上看着像“当前正在专注”
- 但语义上其实只是“当前位于自动 gap”

本轮没有在桌面实例里复跑这类页面，因此这里只定性为风险，不定性为已复现 bug。

## 六、后续建议

如果后续要继续推进，这三步最值当。

### 1. 先做一张时间块迁移完成度矩阵

把每个模块放进统一表里：

- runtime/store
- service/adapter
- `TaskTimelinePage`
- 任务详情/任务时间块详情
- Today 任务视图
- Today blocks 视图
- TimeBlock 详情页
- FocusTimerWidget / TimeBlockWidget / overlay
- planner
- replication / reconcile / backup / snapshot

每个模块标三列：

- 是否使用 unified block model
- 是否显式建模 `gap`
- 是否仍依赖 legacy fallback

### 2. 单独拆 `任务/时间线` 的迁移问题

它不该再被模糊地记成“时间块还有 legacy”。

更准确的拆法应该是：

- 任务事件 metadata 命名归一化
- `/tasks/timeline` 从 completed-only blocks 升级到统一时间块输入
- 是否引入 `taskAssociationLog` / `transitions` / `sourcePlannedBlockId` 作为分析依据

### 3. 对所有通用 active-block UI 做一次 gap 语义巡检

重点不是把所有地方都显示 “gap” 标签，而是明确：

- 这个组件看到 `gap` 时应当怎么表现
- 是隐藏、降级、显示 idle-like 状态，还是显示“间隙中”
- 哪些控件在 `gap` 下必须禁用

## 复核说明

### 强证据

以下结论属于强证据：

- `任务/时间线` 仍保留旧 fallback
- `#780` 的目标态是统一语义，现实现状仍有 split 合同
- `#759` 已进入 runtime/timeblock/planner 主链
- `#759` 尚未完成全仓收口

它们都可以直接从文档、代码、测试或 git 历史中得到。

### 高可信推断

以下结论属于高可信推断，而不是本轮 live 复现：

- RT 任务事件 metadata 命名错位会让 `/tasks/timeline` 更频繁落回旧 fallback
- 部分通用 active-block UI 可能会把 gap 继续表现成 running-like active

这两点都有完整代码链支撑，但本轮没有重新跑 live app 去实机重现，因此这里保留“推断”表述。
