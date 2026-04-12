# Headless Runtime vs UI-Owned Side Effects

- Date: 2026-04-13
- Scope: 仅基于本仓库现有代码、测试与文档；不使用外部资料
- Core question: 当仓库已经把 RT 定义成“持续运行的核心”时，为什么实际持续职责仍然绑在 UI 挂载生命周期上？

## 检索路线与来源选择

这次调查只看内部证据，顺序是：

1. 先看目标态与边界文档，确认仓库自己声称的 runtime-first 原则是什么：`docs/architecture/overview.md`、`docs/plans/2026-04-02-ui-system-epic-phase-map.md`、`docs/plans/2026-04-02-issue-807-rt-boundary-audit.md`。
2. 再看已经暴露问题的清点文档，确认哪些冲突已被明文指出：`docs/analysis/2026-04-10-open-issue-source-census.md`、`docs/analysis/issue-646-deep-analysis.md`、`docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md`。
3. 最后回到代码入口，找出真正由 React 挂载启动、由窗口存活维持的持续 side effects：`src/App.tsx`、`src/routes.tsx`、`src/ui/hooks/useSignalStream.ts`、`src/ui/app/components/ReminderNotifier.tsx`、`src/ui/app/components/RtDomainBackfillCoordinator.tsx`、`src/ui/app/components/TimeBlockSyncCoordinator.tsx`，以及它们背后的 service / test。

## 问题定义

仓库的目标态写得并不含糊。架构总览把 RT 定义为“持续运行、自主决策、真实责任能力”的承载体，并把 L4 UI 描述成“React + zustand，只调 Service”；同时，SignalPool 拓扑里 RT 负责主动路由与 SSE 推送，前端只是订阅者之一（`docs/architecture/overview.md:23-25`, `docs/architecture/overview.md:47-58`, `docs/architecture/overview.md:68-88`, `docs/architecture/overview.md:264-315`）。UI 系统 phase map 进一步把“GUI / CLI / Voice 都只是 RT 的不同客户端”写成目标，并明确规定跨实体、跨状态、跨模块的业务动作不应只存在于 UI（`docs/plans/2026-04-02-ui-system-epic-phase-map.md:49-65`, `docs/plans/2026-04-02-ui-system-epic-phase-map.md:153-223`, `docs/plans/2026-04-02-ui-system-epic-phase-map.md:416-439`）。`#807` 的 RT boundary audit 也已经把判断标准写清楚：客户端负责“怎么触发”，RT 负责“业务动作真正怎么执行、执行后状态如何变化”（`docs/plans/2026-04-02-issue-807-rt-boundary-audit.md:43-57`）。

冲突在于，当前代码里真正“持续跑着”的一批职责，并没有待在 RT，而是由 App 或 route 壳层在挂载时启动、卸载时停止。`App.tsx` 启动 update checker、voice shortcut、voice assistant runtime、main-window shortcut、overlay 初始化，并在同一进程里调用 `useSignalStream()`、挂 `TimeBlockSyncCoordinator` 和 `RtDomainBackfillCoordinator`（`src/App.tsx:31-57`）。同时，`ReminderNotifier` 不是某个提醒页面里的局部组件，而是被放在根路由壳层里，无论桌面还是移动 shell 都会挂载一次（`src/routes.tsx:664-694`）。这意味着至少在当前实现里，React 树并不只是“客户端 UI”，它实际上兼任了若干 runtime worker 的 supervisor。

所以这里的结构冲突不是“UI 里还有一点业务代码”这么简单，而是：**headless runtime 想把持续运行能力收口到 RT；当前实现却让多个关键 side effects 依赖 UI 进程是否存在、页面是否挂载、窗口是否还活着。**

## 已探索出的新成果

先说已经做成的部分，不然分析会失真。

第一，时间块域已经出现了明确的 RT 迁移成果。`TimeBlockService` 在 `rt-sqlite` 模式下，`startBlock`、`pauseBlock`、`resumeBlock`、`markEnding`、`endBlock` 都走 RT adapter，代码注释也明确写着“RT 处理状态转换、事件写入、gap 截断”，前端主要负责更新本地状态与通知 UI（`src/lib/services/timeblock.service.ts:322-334`, `src/lib/services/timeblock.service.ts:413-418`, `src/lib/services/timeblock.service.ts:468-473`, `src/lib/services/timeblock.service.ts:526-531`, `src/lib/services/timeblock.service.ts:596-604`）。这证明“从 UI-owned business flow 迁到 RT”不是空谈，至少时间块已经走出一条路。

第二，`useSignalStream` 已经从“直接开 SSE”进化到“先等待 embedded RT 真正起来，再连接并做一层统一投影”。它会先轮询 runtime status，等 embedded RT 报告 `running` 后才建立 SSE；然后统一处理 task/reminder/eventlog/timeblock/review/keyboard 等信号，并且对 active-block 快照做节流去重（`src/ui/hooks/useSignalStream.ts:121-173`, `src/ui/hooks/useSignalStream.ts:194-391`）。对应测试已经覆盖了 embedded runtime hydration、`eventlog.appended` 桥接和 active-block 节流去重（`tests/unit/ui/use-signal-stream.m4.test.tsx:209-259`, `tests/unit/ui/use-signal-stream.m4.test.tsx:261-350`, `tests/unit/ui/use-signal-stream.m4.test.tsx:379-543`）。这说明仓库已经意识到“UI 直接乱连 RT”会出问题，并开始做约束。

第三，提醒域不是完全停在原地。`ReminderService` 已经在创建和编辑时对“已到期”的 reminder 立即转成 `triggered`，避免一部分 stale pending 状态（`src/lib/services/reminder.service.ts:63-108`）。`ReminderSchedulerService` 也有单元测试守住“只触发一次”和“完成后再次触发还能重新发出”两条语义（`tests/unit/services/reminder-scheduler.service.issue375.test.ts:56-98`）。这不是 headless 解法，但至少说明提醒状态机的边缘语义已经被摸清。

第四，peer recovery/backfill 不是没有补丁。`RtDomainBackfillService` 已能对 confirmed peers 导出 EventLog/Task/TimeBlock sqlite snapshot，再 merge 回本地；`RtDomainBackfillCoordinator` 则在登录且有 profile 时，按挂载、15 秒轮询、focus、online 四种时机触发 backfill（`src/lib/services/rt-domain-backfill.service.ts:89-147`, `src/ui/app/components/RtDomainBackfillCoordinator.tsx:13-50`）。这说明“live sync 会漏窗，需要 recovery”这个问题已经被承认并有代码补丁。

这些成果的共同点是：仓库已经在局部把“业务真相回归 RT”推进了几步，但持续职责的启动权和兜底权仍大量握在 UI 手里。

## 仍由 UI 生命周期承担的职责

### 1. Reminder 到期推进仍由前端 scheduler 驱动

这是最直接、最硬的冲突。issue census 已经把 `#893` 定性成“到期推进仍依赖前端 scheduler 轮询与 UI 挂载，仓库里没有 RT 侧 due actor”，并明确给出强反证（`docs/analysis/2026-04-10-open-issue-source-census.md:193`）。

代码层面，`ReminderSchedulerService` 自己维护 `setInterval`，按 30 秒轮询 pending reminder，然后直接调用 `markTriggered()` 改写 reminder 状态；这不是展示层刷新，而是业务状态推进（`src/lib/services/reminder-scheduler.service.ts:25-41`, `src/lib/services/reminder-scheduler.service.ts:51-87`）。真正启动它的地方是 `ReminderNotifier` 的 `useEffect`：组件挂载就 `scheduler.start()`，卸载就 `scheduler.stop()`，并顺手负责音效、系统通知、toast 同步（`src/ui/app/components/ReminderNotifier.tsx:163-186`）。而 `ReminderNotifier` 又被根路由壳层永久挂在桌面/移动 shell 上（`src/routes.tsx:678-694`）。

结论很简单：**只要没有 UI React 树，这个 scheduler 就不存在；没有这个 scheduler，due reminder 的状态推进就不存在。**

### 2. RT 信号消费与本地投影仍由 UI hook 负责

`useSignalStream()` 是另一个核心冲突点。它不是“UI 看看消息”这么轻，而是在收到信号后做本地数据投影和 side effects：task/reminder/timeblock 刷新、`eventlog.appended` 写入本地 EventLog、`review.completed` 追加 `agent_feedback`、active block snapshot 投影、keyboard state 应用（`src/ui/hooks/useSignalStream.ts:218-374`）。

更关键的是，这些投影最终会进入真正的数据 adapter，而不只是 React state。EventLog projector 在 `rt-sqlite` 模式下会先查 RT 里的 event 是否存在，不存在就 `appendEventData()`；task/reminder/timeblock projector 也分别通过 `TaskRtAdapter`、`ReminderRtAdapter`、`TimeBlockRtAdapter` 去落地复制快照（`src/lib/services/ecs-eventlog-replication.service.ts:144-162`, `src/lib/services/ecs-task-replication.service.ts:69-82`, `src/lib/services/ecs-reminder-replication.service.ts:23-34`, `src/lib/services/ecs-timeblock-completed-replication.service.ts:23-34`）。

这意味着当前前端不是被动 observer，而是一个**信号消费后再 materialize domain state 的 projector**。如果 UI 没有挂上这条 hook，RT 的信号不会被这层前端逻辑消费；如果将来有多个窗口各自挂这条 hook，还会出现并行 projector 的一致性问题。`issue-646` 的分析已经明确指出：每个窗口各自初始化 App 会产生并行 SSE 连接，`eventlog.appended` / `review.completed` 这类 handler 可能在每个窗口各执行一次，形成重复写入风险（`docs/analysis/issue-646-deep-analysis.md:73-80`, `docs/analysis/issue-646-deep-analysis.md:178-199`）。

### 3. Peer recovery/backfill 仍靠 UI 定时器、focus 和 online 事件兜底

`RtDomainBackfillCoordinator` 的存在本身就说明 recovery 没有被 RT 自己收住。它用 `window.setInterval` 每 15 秒跑一次，同时监听 `focus` 和 `online` 来补跑（`src/ui/app/components/RtDomainBackfillCoordinator.tsx:20-48`）。而 `RtDomainBackfillService` 做的不是 UI cache refresh，而是导出 peer snapshot 后 merge 回本地 eventlog/task/timeblock 数据域（`src/lib/services/rt-domain-backfill.service.ts:98-145`）。

`#885` 的 EventLog sync debug plan 已经把这个补丁的真实边界写穿了：当前 recovery/backfill “只在挂载 / 15s / focus / online 触发”，因此 live sync 中断会形成漏窗；修复方向应当是 `confirmed_peer + auth ready` 或 mesh reconnect 后立即触发，而不是继续靠“用户碰巧 focus 或等下一次轮询”（`docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md:24-27`, `docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md:77-83`, `docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md:166-191`）。

换句话说，这里不是 UI 在“展示同步状态”，而是 UI 在代替 runtime 做恢复性同步调度。

### 4. TimeBlock 同步的启停仍由 UI 挂载决定，且部分业务信号仍从前端发出

时间块域已经迁了一半，但没有迁干净。`TimeBlockSyncCoordinator` 在登录 + active profile 条件下调用 `startSync()`，卸载时 `stopSync()`；是否保持 sync 订阅，当前仍取决于这个 UI coordinator 是否存在（`src/ui/app/components/TimeBlockSyncCoordinator.tsx:11-27`）。

同时，`TimeBlockService` 虽然已把核心状态迁到 RT，但 `timeblock.completed` 这条对 Review Agent 有业务意义的信号，当前仍由前端 service 通过 `SignalStreamService` 主动 publish，且 source 直接写成 `frontend:timeblock-service`（`src/lib/services/timeblock.service.ts:927-960`）。这和架构总览里的当前信号清单是对得上的：`timeblock.completed` 与 `session.end` 目前仍被记录为“前端 UI 发布，Agent 订阅”（`docs/architecture/overview.md:321-328`）。

这不是小细节。它说明**即使时间块状态机主体已经进 RT，跨域副作用的“触发时机与发布者”仍没有完全收口到 RT。**

### 5. App 级平台 daemon 与业务 daemon 仍混在同一启动边界

`App.tsx` 在同一个 `useEffect` 里初始化了 update checker、voice shortcut、voice assistant runtime、main-window shortcut、overlay service（`src/App.tsx:32-43`）。其中有些职责本来就应该留在客户端，例如：

- update auto-check 是客户端更新体验，不是业务真相；它通过 `AutoCheckController` 的 `setInterval` 周期跑（`src/ui/stores/update-store.ts:171-186`, `src/lib/services/update.service.ts:218-239`）。
- voice shortcut service 依赖 Tauri event、`window` / `document` 生命周期、麦克风预热、overlay 偏移同步和本地 prewarm loop，这些都是平台/设备侧职责，不可能整个搬进纯 RT（`src/services/voice-shortcut.service.ts:323-396`, `src/services/voice-shortcut.service.ts:374-395`, `src/services/voice-shortcut.service.ts:621-643`）。

问题不在“这些东西为什么在 UI”，而在于**它们与 reminder scheduler、signal projector、backfill coordinator 这种本该 RT 化的长期职责混在一处启动**。这会让“哪些是客户端平台能力，哪些是业务运行时兜底”越来越难分。

### 6. 页面级轮询 / SSE 模式仍在扩散

除了全局入口，页面内部也在继续复制“页面活着就有后台 loop”的模式：

- `AgentsPage` 为右侧 agent detail 每 2 秒轮询 energy，同时还维护 local link-proof signal service 与定时 adoption poll（`src/ui/app/pages/AgentsPage.tsx:1735-1761`, `src/ui/app/pages/AgentsPage.tsx:7927-7968`）。
- `WorkspaceTabs` 每 5 秒 auto-refresh workspace actions（`src/ui/app/pages/agents/WorkspaceTabs.tsx:286-292`）。
- `AgentConversationPage` 直接在页面里开 `EventSource` 订阅 agent 相关 signal（`src/ui/app/pages/agents/AgentConversationPage.tsx:105-145`）。
- `useSessionStream` 也是“页面启用就创建一个或多个 `EventSource`”的模式（`src/hooks/useSessionStream.ts:145-158`, `src/hooks/useSessionStream.ts:327-395`）。

这些 loop 不一定都该进 RT，但它们证明了同一个结构习惯还在蔓延：**页面存在 = 后台行为存在；页面消失 = 行为停止。**

## 这如何阻碍 headless/runtime-first

第一，它直接破坏了 headless 的最低定义。只要 UI 不挂载，reminder 到期推进和 peer backfill 就会停掉；这不是“缺少一个可视入口”，而是业务过程根本没有继续运行（`docs/analysis/2026-04-10-open-issue-source-census.md:193`, `src/lib/services/reminder-scheduler.service.ts:25-41`, `src/ui/app/components/RtDomainBackfillCoordinator.tsx:20-48`）。

第二，它把“谁拥有业务真相”变成了不稳定问题。phase map 说 RT 应该拥有真正发生了什么，但 `useSignalStream` 当前仍负责把 RT 信号再投影回本地 eventlog/task/reminder/timeblock 存储，导致“RT 发信号”和“前端把信号变成真相”之间有一层额外耦合（`docs/plans/2026-04-02-ui-system-epic-phase-map.md:176-223`, `src/ui/hooks/useSignalStream.ts:218-374`, `src/lib/services/ecs-eventlog-replication.service.ts:144-162`）。

第三，它让多客户端一致性没有真正成立。仓库想要 GUI / CLI / Voice 都只是 RT 客户端，但 reminder due、timeblock completion signal、peer backfill、review feedback materialization 这些关键 side effects 现在都依赖 React / browser / window 生命周期；CLI 和纯 headless RT 根本无法天然复用这一层（`docs/plans/2026-04-02-ui-system-epic-phase-map.md:416-439`, `src/ui/app/components/ReminderNotifier.tsx:78-186`, `src/lib/services/timeblock.service.ts:927-960`）。

第四，它放大了多窗口和多实例风险。`issue-646` 之所以把多窗口 SSE 视为架构级一致性风险，不是因为 SSE 本身危险，而是因为 current handlers 里包含了真正的写操作。只要一个新窗口也跑 `App` / route shell，同一条 signal 就可能被多个 UI 进程消费并重复 materialize（`docs/analysis/issue-646-deep-analysis.md:122-132`, `docs/analysis/issue-646-deep-analysis.md:178-199`）。

第五，它让可观测性和责任归因变差。RT 层看起来像在发信号，但真正决定 reminder 何时变 `triggered`、何时执行 backfill、何时把 review 写成 eventlog 的，却是 UI 里的 hook / coordinator / notifier。出了问题之后，责任边界天然含糊：到底是 RT 没发，还是 UI 没挂，还是某个窗口多挂了一份？

## 已有补丁与其局限

### 补丁 1：TimeBlock 主状态迁 RT

这是当前最有价值的正向样板。时间块的 start/pause/resume/end 已迁 RT，证明复杂状态机可以收口（`src/lib/services/timeblock.service.ts:322-334`, `src/lib/services/timeblock.service.ts:413-418`, `src/lib/services/timeblock.service.ts:596-604`）。

局限也很明确：sync 启停仍由 UI coordinator 驱动，`timeblock.completed` 仍由前端 service publish，文档中的当前信号所有权也仍把它列为 frontend publisher（`src/ui/app/components/TimeBlockSyncCoordinator.tsx:11-27`, `src/lib/services/timeblock.service.ts:927-960`, `docs/architecture/overview.md:321-328`）。

### 补丁 2：SignalStream 的 hydration、节流和测试护栏

`useSignalStream` 已经不再是裸连；embedded runtime status hydration、active-block 节流、同源 echo 跳过等防护都补上了，并且测试覆盖已经存在（`src/ui/hooks/useSignalStream.ts:121-173`, `src/ui/hooks/useSignalStream.ts:307-350`, `tests/unit/ui/use-signal-stream.m4.test.tsx:209-259`, `tests/unit/ui/use-signal-stream.m4.test.tsx:379-714`）。

局限在于：这仍然是**更稳的 UI projector**，不是 RT 内化。只要 hook 不挂载，逻辑就不跑；如果挂载多份，`issue-646` 指出的多窗口重复消费风险仍然存在（`docs/analysis/issue-646-deep-analysis.md:73-80`, `docs/analysis/issue-646-deep-analysis.md:178-199`）。

### 补丁 3：Reminder 的即时 overdue transition 与 scheduler 语义测试

`ReminderService` 在 create/update 时对 overdue reminder 立即 `triggered`，减少了“刚创建就过期还卡在 pending”的问题；scheduler 也有重放与去重测试（`src/lib/services/reminder.service.ts:63-108`, `tests/unit/services/reminder-scheduler.service.issue375.test.ts:56-98`）。

局限是：这解决的是“写入时已经过期”的局部情形，不解决“未来某个时刻到期时谁来推进”的根问题。真正的 due progression 依旧绑在 `setInterval + React mount` 上（`src/lib/services/reminder-scheduler.service.ts:25-41`, `src/ui/app/components/ReminderNotifier.tsx:163-186`）。

### 补丁 4：Backfill coordinator 作为 live sync 漏窗补丁

`RtDomainBackfillCoordinator` 与其 service 已经提供 snapshot merge，这能补一部分“短时断链后最终能收敛”的问题（`src/ui/app/components/RtDomainBackfillCoordinator.tsx:20-48`, `src/lib/services/rt-domain-backfill.service.ts:98-145`）。

局限是，debug plan 自己已经承认这个补丁本质上还是机会式触发：挂载、15 秒、focus、online。它没有把 recovery 变成 runtime contract，只是把漏窗变得没那么频繁（`docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md:77-83`, `docs/plans/2026-04-09-issue-885-eventlog-sync-debug-plan.md:166-191`）。

## 迁移阻力

第一，缺的是 RT 合同，不只是代码位置。issue census 已经指出当前看不到 RT 侧 reminder due actor；如果没有这个 actor 或等价 `act` contract，前端 scheduler 删掉之后不是“更纯”，而是直接失能（`docs/analysis/2026-04-10-open-issue-source-census.md:193`）。

第二，当前仓库内部对“谁发布业务信号”本身还没彻底统一。phase map 说跨状态业务动作应进 RT，但架构总览的当前信号清单仍把 `session.end`、`timeblock.completed` 记成 frontend publisher（`docs/plans/2026-04-02-ui-system-epic-phase-map.md:176-223`, `docs/architecture/overview.md:321-328`）。这意味着迁移不仅要改实现，还要改现行合同。

第三，很多前端 side effect 同时夹带平台 API。Notification、Audio、`window.focus`、`document.visibilitychange`、global hotkey、overlay 偏移、麦克风 prewarm，这些都天然属于客户端/设备侧；不能用“全部进 RT”这种粗暴说法一刀切（`src/ui/app/components/ReminderNotifier.tsx:57-112`, `src/services/voice-shortcut.service.ts:374-395`, `src/services/voice-shortcut.service.ts:621-643`）。真正难的是把“平台执行器”与“业务推进器”拆开，而不是一起迁。

第四，多窗口 / 多入口会把问题放大。只要未来 detached window、headless shell、voice-first surface 都共存，任何依赖 React mount 的 projector / scheduler / backfill loop 都会面临“是少挂了导致不跑，还是多挂了导致重复跑”的双向风险（`docs/analysis/issue-646-deep-analysis.md:96-103`, `docs/analysis/issue-646-deep-analysis.md:178-199`）。

第五，当前很多 projector 默认站在“前端拿到信号后再落本地 adapter”这个模型上。EventLog、Task、Reminder、TimeBlock 都有对应前端 projector，这让 UI 成了 replication materializer，而不是纯 viewer（`src/lib/services/ecs-eventlog-replication.service.ts:144-162`, `src/lib/services/ecs-task-replication.service.ts:69-82`, `src/lib/services/ecs-reminder-replication.service.ts:23-34`, `src/lib/services/ecs-timeblock-completed-replication.service.ts:23-34`）。要迁移，必须先决定哪些投影必须 RT 内化，哪些只是客户端缓存。

## 建议的后续验证问题

1. 如果 12 小时内没有任何 GUI 窗口、overlay 或 route shell 挂载，reminder 是否还能从 `pending` 自动推进到 `triggered`？这需要一个 RT 级 actor / integration test，而不是前端 service test。
2. `eventlog.appended`、`review.completed`、`task.replication.upserted`、`reminder.replication.upserted`、`timeblock.replication.completed` 中，哪些应该在 RT 内完成 materialization，哪些才允许由客户端做本地缓存投影？现在没有单一规则。
3. `timeblock.completed` 和 `session.end` 是否仍允许由 frontend publisher 发出？如果不允许，RT 在何处以“状态已提交”为前提发出它们？
4. peer recovery 的正式触发点到底是什么？`confirmed_peer + auth ready`、mesh reconnect、runtime startup，至少要选一个写成合同，替代“15 秒 / focus / online”这种机会式补丁。
5. 多窗口场景下，谁是唯一 signal consumer / writer？是主窗口代理、RT 内 actor，还是每窗口只读订阅？`issue-646` 的结论应该落成测试，而不是只留在分析文档。
6. 客户端平台职责的边界要不要显式拆成另一层？例如 hotkey、notification、audio、overlay 应留在 client daemon，但它们只能调用 RT action，不能自己推进 reminder/timeblock/eventlog 真相。
7. 当前 `App.tsx` 和 root route 是否应该继续担任 runtime worker supervisor？如果答案是否定的，就需要一个独立的 startup matrix，明确哪些进程/窗口会启动哪些服务，哪些只能有单实例。
