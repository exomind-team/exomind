# 2026-04-18：统一时间块类型 / 间隙时间块类型完全收口与迁移可行性分析

## 任务目标

这轮调研要回答的不是“`#780` / `#759` 有没有做”，而是更具体的四个问题：

1. `#780`「统一时间块类型」和 `#759`「间隙时间块类型」现在离“完全收口”还差什么。
2. 这些尾巴属于“遗漏未迁移”，还是“刻意保留的兼容层”。
3. 继续把这两个概念工作真正收口，是否可能、是否可行、风险在哪里。
4. 如果继续做，合理的 issue 治理与分阶段计划应怎样设计。

## 任务清单

- [x] 复读仓库约束、必读文档、已有分析稿与最新 route
- [x] 核对 `#780 / #759 / #749 / #692 / #751 / #906` 及其评论
- [x] 核对 runtime / service / adapter / UI / tests 的真实调用链
- [x] 区分“主链已落地”和“仓库级完全收口”之间的差距
- [x] 形成收口可能性、阻塞点、风险点与阶段计划
- [x] Markdown 落盘
- [ ] 后续若进入实施，再按本文阶段计划拆 issue / 改代码 / 验证

## 调查范围与方法

本轮只做仓库内只读调查，没有改代码，也没有重新跑桌面实例或测试。

主要证据来自四类来源：

- 既有分析稿：
  - [2026-04-18-timeblock-migration-status-analysis.md](./2026-04-18-timeblock-migration-status-analysis.md)
- GitHub issue / 评论：
  - [#780](https://github.com/exomind-team/exomind/issues/780)
  - [#759](https://github.com/exomind-team/exomind/issues/759)
  - [#749](https://github.com/exomind-team/exomind/issues/749)
  - [#692](https://github.com/exomind-team/exomind/issues/692)
  - [#751](https://github.com/exomind-team/exomind/issues/751)
  - [#805](https://github.com/exomind-team/exomind/issues/805)
  - [#787](https://github.com/exomind-team/exomind/issues/787)
  - [#675](https://github.com/exomind-team/exomind/issues/675)
  - [#317](https://github.com/exomind-team/exomind/issues/317)
  - [#906](https://github.com/exomind-team/exomind/issues/906)
- 关键代码：
  - `src/lib/types/event.ts`
  - `src/lib/timeblock/derive.ts`
  - `src/lib/adapters/timeblock-rt-adapter.ts`
  - `src/lib/services/timeblock.service.ts`
  - `src/config/domain-backend-mode.ts`
  - `src/lib/storage/active-block-storage.ts`
  - `src/ui/app/pages/TaskTimelinePage.tsx`
  - `src/ui/app/pages/task-timeline-model.ts`
  - `src/ui/app/pages/TaskDetailPage.tsx`
  - `src/ui/app/pages/task-timeblock-detail-view.ts`
  - `src/ui/app/pages/tasks-today-view.ts`
  - `src/ui/app/components/FocusTimerWidget.tsx`
  - `src/components/TimeBlockWidget.tsx`
  - `src/ui/app/overlay/now-workbench-overlay-model.ts`
  - `crates/exomind-runtime/src/routes/timeblocks.rs`
  - `crates/exomind-runtime/src/routes/today_planner.rs`
  - `crates/exomind-runtime/src/routes/tasks.rs`
  - `crates/exomind-runtime/src/timeblock.rs`
  - `crates/exomind-runtime/src/timeblock_sqlite.rs`
- 计划 / 架构文档：
  - [2026-03-31-timeblock-unification-step1.md](../plans/2026-03-31-timeblock-unification-step1.md)
  - [PLAN-timeblock-cleanup-and-bugfix.md](../plans/PLAN-timeblock-cleanup-and-bugfix.md)
  - [2026-04-14-EDS-architecture-freeze-plan.md](../plans/2026-04-14-EDS-architecture-freeze-plan.md)

## 结论先行

### 结论 1：两项工作都可以继续收口，而且不是概念上不可达

`#780` 和 `#759` 的核心 runtime / planner 主链已经落地。现在的问题不再是“能不能设计出来”，而是“仓库里的公共合同、消费者和治理尾巴还没有完全一起收口”。

换句话说：

- `#780` 更像**架构迁移收尾**。
- `#759` 更像**语义传播与治理收尾**。

### 结论 2：可行，但不适合 big-bang

这两项工作的完全收口是可行的，但不适合一把梭。原因不是代码量大本身，而是当前存在一个非常危险的中间态：

- runtime 会生成并传播 `gap`
- service 和一部分 consumer 又仍在把“当前块”近似等价成“正在运行的 active 块”
- 任务侧多个页面仍把 `task.timeBlockIds + completed blocks` 当主索引

如果先暴露 gap、再迁 UI，或者先删旧类型、再迁消费者，都会把现有页面一起打穿。

### 结论 3：当前真正的硬阻塞主要是 `#749` 和 `#692`

- `#749` 阻塞的是 `#780` 最终收口，因为 timeblock 仍保留 legacy/migration fallback 的运行期尾巴。
- `#692` 阻塞的是 `#759` 最终收口，因为 gap/current block 的空名、补名、冻结、rename event 语义还没完全落地。

其余 issue 更多是：

- 质量门：`#805`
- API 清尾：`#787`
- 宽泛 audit 容器：`#675`
- 历史遗留歧义项：`#317`

## 一、为什么说两项工作“主链已完成，但仓库级未完全收口”

### 1. `#780` 已经把主时间块链迁到了 `transitions`

这部分是强证据，不是推断。

- [#780](https://github.com/exomind-team/exomind/issues/780) 关闭评论已明确写出：
  - core objectives achieved
  - 但仍有 cleanup follow-up
- `src/lib/types/event.ts` 已定义 `BlockTransition` 与 `transitions`
- `src/lib/timeblock/derive.ts` 已把 start/end/phase/run/pause 等派生统一建立在 `transitions`
- `crates/exomind-runtime/src/routes/timeblocks.rs` 已有 `start / stop / end / pause / resume / describe`
- `crates/exomind-runtime/src/timeblock_sqlite.rs` 已把 completed / active 合并进同一张 `timeblocks` 表
- `src/lib/adapters/timeblock-rt-adapter.ts` 已暴露新 RT 路由方法

因此，`#780` 不是“没落地”，而是**主链落地了，但尾巴没有全部 issue 化、删净、迁完**。

### 2. `#759` 已经把 gap 放进 runtime / planner 主链

这部分同样是强证据。

- [#759](https://github.com/exomind-team/exomind/issues/759) 的评论已明确写出：
  - gap 功能已完成
  - 统一数据结构转到 `#780`
- `crates/exomind-runtime/src/routes/timeblocks.rs` 已实现：
  - `end -> gap`
  - `gap -> next active`
  - gap guard
  - `backfill-gaps`
- `crates/exomind-runtime/src/routes/today_planner.rs` 已允许 planner start 替换 `gap / completed`
- `src/lib/services/timeblock.service.ts` 已集成 gap backfill
- `src/ui/app/pages/now-today-blocks-view.ts` 已显式暴露 `blockType`
- `src/ui/app/components/FocusKeepAwakeController.tsx` 已把 gap 排除在 keep-awake 之外

因此，`#759` 也不是“gap 还没做”，而是**gap 主链可用，但没有均匀传播到所有 current-block consumer 与治理环节**。

## 二、当前最关键的未收口点

### 1. service 公共合同仍然是 split world

这是 `#780` 最实质的技术尾巴。

现状仍然是：

- `src/lib/services/timeblock.service.ts`
  - `loadTimeBlocks()` 读 completed blocks
  - `loadActiveBlock()` 单独读当前块
- `src/lib/adapters/timeblock-rt-adapter.ts`
  - `GET /timeblocks`
  - `GET /timeblocks/active`
- `crates/exomind-runtime/src/timeblock.rs`
  - `list_completed_scoped`
  - `get_active_scoped`
- `crates/exomind-runtime/src/timeblock_sqlite.rs`
  - 仍按 `end_time IS NOT NULL` 与 “当前 active” 分开查询

这说明：

- 内部存储已经统一
- 但对外公共读模型还没有统一

### 2. “当前块”合同本身仍不一致

这是这轮调查里最危险的点。

在 `src/lib/services/timeblock.service.ts` 里，当前至少同时存在两套互相牵扯的心智：

- `loadActiveBlock()` 会把 terminal/gap block 视为 completed/null，从而对外隐藏
- 但 RT `endBlock()` 路径又会把 gap block 直接 `notifyChange()` 给订阅者

这会导致：

- 一部分 consumer 以为“有当前块 = 正在运行”
- 另一部分 consumer 会在订阅时真的收到一个 gap 当前块

只要这个合同不先拆清楚，后续任何“显式 gap 化”都会变成连锁回归源。

### 3. legacy 尾巴仍真实存在，而且已被 `#749` 明确接管

这部分不是推断，是 `#749` 评论和代码双重明示。

`#749` 评论已经把 timeblock legacy follow-up 锚到这里：

- `src/lib/storage/active-block-storage.ts`
- `src/lib/services/timeblock.service.ts` 的 injected-env / legacy path

代码里也有明确注释：

- `src/config/domain-backend-mode.ts`
  - `Timeblock domain is pinned to rt-sqlite`
  - 但 `legacy` variant 仍保留给 MigrationDialog 迁移语义
- `src/lib/storage/active-block-storage.ts`
  - 文件头直接写着只用于 legacy backend mode
  - `TODO(#749)` 说明等桌面迁移 fallback 去掉后再删
- `src/ui/components/MigrationDialogController.tsx`
  - skip/failure 仍会 `setAllBackendModes('legacy')`

因此，`#780` 的“完全收口”已经不再是“旧写路由还有效”，而是：

- legacy write mainline 已封住
- 但 legacy fallback / migration escape hatch 仍在

### 4. 任务侧消费者仍大量使用旧索引

这是目前最明显的“跨域消费者未迁完”。

`src/ui/app/pages/TaskTimelinePage.tsx` 的加载链仍只取：

- tasks
- events
- completed blocks

它不加载统一 current block，也不以 block history 作为主视角。

`src/ui/app/pages/task-timeline-model.ts` 仍保留强旧范式 fallback：

- `hasTaskEvents ? buildSegmentsFromEvents : buildSegmentsFromTimeBlocks`
- fallback 仍直接读 `task.timeBlockIds`

`src/ui/app/pages/TaskDetailPage.tsx`、`src/ui/app/pages/task-timeblock-detail-view.ts`、`src/ui/app/pages/tasks-today-view.ts` 也都还在：

- completed blocks
- activeBlock
- `task.timeBlockIds`

三者混用。

这意味着：

- 只要先删旧字段或先停止维护旧索引
- 任务时间线 / 详情 / today 相关页面会一起回归

### 5. 通用 current-block UI 还没显式吸收 gap

这一组是 `#759` 的核心尾巴。

典型位置包括：

- `src/ui/app/components/FocusTimerWidget.tsx`
- `src/components/TimeBlockWidget.tsx`
- `src/ui/app/overlay/now-workbench-overlay-model.ts`

它们当前更接近以下假设：

- 只要拿到一个当前块
- 就按 running / paused / feedback 的 active 专注块去理解

但 gap 当前块一旦显式暴露，这个假设就会失效。

### 6. 任务事件 metadata 仍有 camelCase / snake_case 错位

这不是整个迁移的最大块头，但属于必须补的一刀。

当前：

- `src/ui/app/pages/task-timeline-model.ts` 读取：
  - `metadata.taskId`
  - `metadata.toStatus`
- `crates/exomind-runtime/src/routes/tasks.rs` 写入 EventLog 时使用：
  - `task_id`
  - `old_status`
  - `new_status`
- `src/lib/adapters/eventlog-rt-adapter.ts` 与 `src/lib/services/eventlog.service.ts` 没有做 metadata key 归一化

结果就是：

- RT 主链里虽然有 task event
- 时间线页面却经常识别不到
- 然后继续掉回 `task.timeBlockIds + completed blocks` 的旧 fallback

## 三、issue 生态判断

## 直接阻塞 / 强相关

### `#749`：`#780` 完全收口的硬阻塞

这是当前最明确的 blocker。

原因：

- 它直接承接了 timeblock legacy follow-up
- 代码注释和 issue 评论都把 timeblock legacy path 挂在这里

若 `#749` 不收，`#780` 就很难被准确表述为“仓库级完全迁移完成”。

### `#692`：`#759` 完全收口的硬阻塞

gap/current block 语义想完全收口，不能绕开命名语义：

- 允许空名启动
- 结束前可补名/改名
- 结束后冻结
- rename event
- gap/current block 的对外显示名 helper

`#759` 的很多“补录/冻结/当前 gap 可持续修改”语义，实质上都和 `#692` 强耦合。

## 已完成前置

### `#751`

这已经不是阻塞项，而是已完成前置：

- Today Planner 是一等对象
- `sourcePlannedBlockId` 已进入主链

它证明 planner provenance 不再是阻碍收口的主要问题。

## 质量门 / cleanup / audit

### `#805`

它不是语义前置，但它是非常现实的质量门。

如果要宣称“时间块语义完全收口”，那 runtime route / state machine 测试网兜应该补齐。

### `#787`

它更多是 API cleanup，不是当前语义主阻塞。

### `#675`

它是泛化的“UI -> RT 功能迁移清点”容器，可以作为参考，但不能替代时间块专用 follow-up issue。

## 历史歧义项

### `#317`

这条历史 issue 仍 open，会持续制造歧义：

- 旧的“当前激活时间块状态机 RT 化”
- 新的 `#780` / `#759`

它们不应该继续平行悬着。

## 上位迁移语境

### `#906`

这不是 timeblock 实现阻塞，但它定义了现在的大方向：

- 不是继续在旧骨架上补 patch
- 而是做搬迁式重构

这会影响我们如何判断“完全收口”的含义：

- 不要求把所有旧兼容层永久维持住
- 但要求把已经验证的时间块语义迁入新的 canonical contract

## 四、可行性判断

### 1. 可能性：高

这两项工作继续收口的可能性是高的，因为：

- runtime / store / planner 的核心语义已经存在
- 并不需要再发明一套新时间块模型
- 当前缺口主要在 service 边界、consumer 迁移、命名语义与 issue 治理

### 2. 工程可行性：中高

它不是简单 cleanup，但也不是重新做一遍时间块系统。

最现实的成本来源是：

- consumer 面广
- 旧索引仍被任务页面依赖
- gap 暴露后 UI 容易误判
- MigrationDialog 仍保留 legacy fallback

### 3. big-bang 可行性：低

不建议 big-bang，原因有三：

1. current-block 合同还不一致
2. 任务侧旧索引还在被正式消费
3. 类型删除与 UI 迁移不能倒序做

## 五、推荐的 4 阶段收口路线

## Phase 1：legacy 尾巴隔离 + service 边界冻结

### 目标

先把“还留着的 legacy/migration 语义”和“后续要逐步替换的公共合同”拆开，不立刻改页面。

### 重点模块

- `src/lib/services/timeblock.service.ts`
- `src/config/domain-backend-mode.ts`
- `src/lib/storage/active-block-storage.ts`
- `src/ui/components/MigrationDialogController.tsx`

### 核心动作

- 把 legacy 明确限制为迁移语义，而不是长期运行时语义
- 在 service 层显式拆出：
  - raw current block contract
  - 旧 active facade contract
- 暂时不要立刻让所有页面看到 gap current block

### 验证面

- adapter / service / runtime route 单测
- 与 MigrationDialog 相关的最小回归
- 确认 Web / Tauri 默认主链不再倒向 legacy

### 主要风险

如果这一步直接把 gap 暴露给旧 UI，而不先冻结合同，会出现 running UI 误显示。

## Phase 2：任务历史消费者迁移

### 目标

把任务时间线 / 详情 / today 相关页面从“旧 completed-block 索引”逐步迁到“新 block 语义 + 事件 + 关联日志”。

### 重点模块

- `src/ui/app/pages/task-timeline-model.ts`
- `src/ui/app/pages/TaskTimelinePage.tsx`
- `src/ui/app/pages/TaskDetailPage.tsx`
- `src/ui/app/pages/task-timeblock-detail-view.ts`
- `src/ui/app/pages/tasks-today-view.ts`
- `src/lib/types/event.ts` 相关 helper
- `crates/exomind-runtime/src/routes/tasks.rs`
- `src/lib/adapters/eventlog-rt-adapter.ts`
- `src/lib/services/eventlog.service.ts`

### 核心动作

- 先补 task event metadata 归一化
- 抽一个共享 helper：
  - 按 block / association log 反建 task 关联索引
- 再统一替换任务页面
- 避免每页自己拼一套“block -> task”映射逻辑

### 验证面

- task timeline fallback / event-first 回归
- Task detail / task timeblock detail / tasks today 相关单测
- 重点验证：不再只能依赖 `task.timeBlockIds`

### 主要风险

如果在页面迁移完成前就停止维护旧索引，会直接打断任务侧主路径。

## Phase 3：current-block / gap 显式化

### 目标

在任务消费者迁完后，再让通用 current-block UI 正式吸收 gap 语义。

### 重点模块

- `src/ui/app/components/FocusTimerWidget.tsx`
- `src/components/TimeBlockWidget.tsx`
- `src/ui/app/overlay/now-workbench-overlay-model.ts`
- 其他 current-block consumer

### 核心动作

- 明确区分：
  - running-like active block
  - gap current block
- 更合理的方向是：
  - gap 视为 `idle-like`
  - 或单独 `gap` mode
- 不要继续把 gap 伪装成 running active

### 验证面

- current-block UI 单测
- overlay / widget / focus timer smoke
- 至少一轮桌面/Tauri 人工 smoke

### 主要风险

这一步是最容易出现“页面没崩，但语义表现错了”的阶段，不能只靠类型通过。

## Phase 4：最终类型清理 + issue 收口

### 目标

前三阶段都稳定后，再做真正的类型与合同清理。

### 重点模块

- `src/lib/types/event.ts`
- `src/lib/services/timeblock.service.ts`
- 所有 `ActiveBlockData` 使用点
- 相关测试

### 核心动作

- 删除 `ActiveBlockData` 心智
- 收缩 TS 端旧字段 fallback
- 评估 `startTime/endTime` 在类型层的最终位置
- 将剩余 cleanup 正式回链到 issue

### 一个重要判断

是否必须连 `/timeblocks/active` 一起退掉，才算 `#780` 完成，我倾向于不是收口前置。

更关键的前置是：

- consumer 不再把“无 active = 无当前块”当成唯一语义
- service 对 current block 的公共合同已经一致

## 六、推荐的 issue 治理方案

### 1. 不建议重开 `#780`

更合理的做法是：

- 保持 `#780` 作为“主链落地已完成”的历史锚点
- 新开 follow-up issue 承接剩余清理

建议至少拆出：

1. `refactor(timeblock): 删除 ActiveBlockData 与 TS 端旧字段 fallback`
2. `refactor(timeblock/ui): current-block consumer 显式吸收 gap 语义`
3. `refactor(task-timeblock): 任务侧消费者从 task.timeBlockIds 旧索引迁移`

### 2. `#749` 继续作为 `#780` 收口的硬锚点

不建议把 legacy cleanup 重新塞回 `#780`。

因为现在最真实的 blocker 已经不是统一结构本身，而是：

- MigrationDialog fallback
- legacy runtime mode 尾巴
- active-block-storage 等旧兼容物

### 3. `#759` 应做一次明确的 closeout remap

现在 `#759` 继续 open 会制造一个错误印象：好像 gap 还没主链落地。

更准确的治理方式应是：

- 在 `#759` 补一条 closeout comment
  - 说明 gap 主链已完成
  - 统一结构跟到 `#780`
  - 语义尾巴主要跟到 `#692` 和新的 gap-aware consumer follow-up
- 待 `#692` 与 gap-aware consumer audit 完成后再关闭

### 4. `#317` 应标注 superseded 或关闭

否则 issue 生态会一直保留一个旧 RT 化 issue，与 `#780` 平行混淆。

### 5. `#805` 与 `#787` 继续保留

- `#805` 负责质量门
- `#787` 负责 API 清尾

但不应把它们误写成当前“统一类型 / gap 类型尚未可用”的证据。

## 七、主要风险与验收重点

### 风险 1：过早改变 current block 语义

这会直接影响：

- FocusTimerWidget
- TimeBlockWidget
- overlay

因此必须晚于 service 边界冻结和任务消费者迁移。

### 风险 2：过早停止维护 `task.timeBlockIds`

只要任务页面还依赖它，就不能先删。

### 风险 3：MigrationDialog 反向把三域切回 legacy

这是 `#749` 之所以是真 blocker 的原因之一。

### 风险 4：只做类型迁移，不做显示名/helper 统一

如果 `#692` 不配合补显示名 / rename / 空名语义 helper，gap/current block UI 很容易继续各写各的 fallback。

## 八、我对“完全收口”的定义

这轮调查后的判断是：

`#780` / `#759` 的“完全收口”不应再理解成“runtime 能跑 + 几个测试通过”，而应至少满足：

1. runtime / planner 主链稳定
2. service 对外 current block 合同一致
3. 任务侧消费者不再主要依赖旧 completed-block 索引
4. 通用 current-block UI 已显式吸收 gap 语义
5. legacy fallback 退出长期运行时主路径
6. 旧类型与残余 issue 被正式关闭或 remap

## 复核

### 强证据

- `#780` 主链已完成，但 issue 评论明示仍有 cleanup follow-up
- `#759` gap 功能已完成，但 issue 仍 open
- `#749` 已明确承接 timeblock legacy follow-up
- `#692` 仍 open，且直接影响 gap/current block 的命名与冻结语义
- runtime / planner 主链接近完成
- service 公共合同仍 split
- 任务侧多个页面仍使用 `task.timeBlockIds + completed blocks`
- 多数通用 current-block UI 还未显式吸收 gap

### 推断

- `/timeblocks/active` 是否必须彻底退场，才算 `#780` 完成
- gap current block 在 UI 上最终是单独 mode，还是表现成 idle-like

这两点属于后续设计决策，不影响本轮“能不能继续收口、应该怎么收口”的判断。

## 最终判断

可以继续把「统一时间块类型」与「间隙时间块类型」这两项工作真正收口，而且应该继续做。

但合理路径不是：

- 直接删类型
- 直接让所有页面看到 gap
- 直接宣称 `#780/#759` 全完成

而是：

1. 先收 `#749` 这一类 legacy/runtime fallback 尾巴
2. 再迁任务侧消费者
3. 再显式 gap 化 current-block UI
4. 最后删旧类型、关旧 issue、补质量门

这条路线的好处是：它尊重当前仓库真实中间态，不会把“主链已落地”的成果，误用成“现在就适合一把梭清理”的理由。
