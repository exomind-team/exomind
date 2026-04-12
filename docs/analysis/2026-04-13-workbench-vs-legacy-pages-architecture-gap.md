# Workbench 长期主对象模型 vs Legacy Pages 架构断层调查

- Date: 2026-04-13
- Scope: `docs/architecture/agent-workbench-shared-graph-spec.md`、`docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md`、`src/ui/app/pages/workbench/workbench-storage.ts`、`src/ui/app/pages/workbench/WorkbenchPage.tsx`、`src/ui/app/pages/AgentsPage.tsx`、`src/ui/app/pages/agents/agents-tiled-persistence.ts`、`src/ui/app/pages/agents/tiled-pane-tree.ts`、`src/routes.tsx`
- Truth source: 仅限本仓库现有代码与文档
- Excluded: 外网资料、issue 评论、未落库的口头方案

## 问题定义

当前断层不是“`WorkbenchPage` 还缺拖拽和更多 UI 细节”，而是**长期主对象模型已经把页面宿主定义成 `WorkbenchSpace`，但现在真正掌握状态、导航、运行时生命周期和布局恢复的仍是 legacy `AgentsPage` 及其周边 persistence/route shim**。规格明确要求页面主对象是 `WorkbenchSpace`，外层是 `container graph`，内层是 `shared work graph`，事实层是 `EventTape`；同时还要求说明现有 `AgentsPage / routes.tsx` 如何映射到新模型，而不是继续把旧页内部状态直接当作 Workbench 模型 (`docs/architecture/agent-workbench-shared-graph-spec.md:22-30`, `docs/architecture/agent-workbench-shared-graph-spec.md:91-123`, `docs/architecture/agent-workbench-shared-graph-spec.md:144-190`, `docs/architecture/agent-workbench-shared-graph-spec.md:800-805`)。

现实却是另一套所有权：`WorkbenchPage` 读取本地 flat state，拉取 `SessionInfo[]`，把 session 映射成 pane 卡片，最后点击后再跳回 `/agents` 或 `/agents/chat/:agentId`；页面自己也明确承认当前只负责“恢复空间 + 展示 pane + 跳回旧入口” (`src/ui/app/pages/workbench/WorkbenchPage.tsx:141-160`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:220-233`, `src/ui/app/pages/workbench/workbench-storage.ts:298-365`)。这意味着 `/workbench` 目前不是主对象模型的前端宿主，而是一个带 legacy handoff 的 flat launcher。

## 长期 Workbench 模型已经清晰到什么程度

长期模型并不模糊，至少有五个关键边界已经写清楚。

### 1. 页面主对象已经确定为 `WorkbenchSpace`

规格不是在讨论“也许以后可以有空间”，而是明确写出页面主对象必须是 `WorkbenchSpace`；`task / session / terminal / note / result` 都只是被空间组织和呈现的对象。`WorkbenchSpace` 也被定义成长期持久的工作场景，一个空间下可以发生多次 `FocusRun`，而 `ViewInstance` 只是呈现机制，不是产品主对象 (`docs/architecture/agent-workbench-shared-graph-spec.md:107-123`, `docs/architecture/agent-workbench-shared-graph-spec.md:256-309`)。

### 2. 布局层和语义层必须拆开

规格明确要求把“屏幕怎么排”的 `container graph` 和“系统里到底有什么对象，它们怎么关联”的 `shared work graph` 分开，否则布局状态、业务关系、跨端投影和导航状态会全部坍缩成 UI 局部状态。`SurfaceSlot` 只负责承载槽位和布局树挂载，`SurfaceNavigationState` 负责当前前台工作面、返回路径和 selection，`ViewInstance.sharedState` 与 `SurfaceSlot.localState` 必须分开 (`docs/architecture/agent-workbench-shared-graph-spec.md:91-106`, `docs/architecture/agent-workbench-shared-graph-spec.md:409-449`)。

### 3. 运行时归属和事实层也已经定了

`RuntimeBinding`/`RuntimeAttachment` 被定义为对象与运行时关联的单一真相源，不允许再让 `SessionObject` 和运行时句柄双向各持一个外键。`FocusRun`、`EventTape`、`TapeEvent` 也已经定义到字段级，MVP 中要求 `FocusRun <-> EventTape` 严格 1:1，`EventTape` 是事实层，派生层只能重算，不能覆盖事实 (`docs/architecture/agent-workbench-shared-graph-spec.md:592-667`, `docs/architecture/agent-workbench-shared-graph-spec.md:144-161`)。

### 4. Phase 1 的落地边界也已经明确

规格和 Phase 1 计划都没有幻想“一步重写全部”。它们明确允许 `Flat Workbench` 壳层和最近 pane 恢复先留在前端本地持久层，但同时要求字段命名、对象边界和 adapter 接口向长期模型靠拢；`FocusRun / EventTape` 不能长期留在前端缓存，跨窗口共享状态必须通过统一 service，而不是每个窗口自己维护一份本地真相 (`docs/architecture/agent-workbench-shared-graph-spec.md:1096-1119`, `docs/architecture/agent-workbench-shared-graph-spec.md:1368-1440`, `docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:15-27`, `docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:88-125`)。

### 5. 旧页兼容方式也已经限定

规格明确说旧页只能通过 adapter 复用，不能直接把 `AgentsPage`/`TaskDagPage` 的内部状态当成 Workbench 模型；`AgentsPage` 只能复用 read model 和交互经验，不能把它的对象语义直接搬进共享工作图谱。对路由的要求也写死了：旧 `/agents/*` 可以先保留为兼容入口，但不能继续新增裸 `window.history.pushState`，最终要统一到 router-aware navigation bridge (`docs/architecture/agent-workbench-shared-graph-spec.md:800-805`, `docs/architecture/agent-workbench-shared-graph-spec.md:1283-1343`, `docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:520-526`)。

结论是：**长期模型的语义边界已经清楚，真正没有完成的是所有权迁移和桥接层落地。**

## 当前实现仍停留在哪个层次

### 1. `WorkbenchPage` 仍是 flat shell，不是主对象宿主

`WorkbenchPage` 的启动路径是：读取 URL search，解析 legacy intent，`readOrCreateWorkbenchFlatState()` 从 `localStorage` 拿一个 flat state，订阅 `useSessionStream()` 拿到 `SessionInfo[]`，再把 session 映射成 pane 卡片，最后把 pane 列表重新写回 `localStorage`。这条链路里并没有出现 `WorkbenchService.resolveDefaultSpace()`、`SessionInteropAdapter.loadRecentSessions(spaceId)` 之类计划中的服务入口，现实所有权仍在页面层缓存和 runtime session 列表之间来回拼接 (`src/ui/app/pages/workbench/WorkbenchPage.tsx:135-160`, `src/ui/app/pages/workbench/workbench-storage.ts:173-227`, `src/ui/app/pages/workbench/workbench-storage.ts:336-365`, `docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:241-246`)。

### 2. `WorkbenchSpace` 目前只是一个可显示的 header 结构

当前 `WorkbenchFlatState` 的 `space` 只有 `id / name / restoredAt`，`surface` 只有 `id / layoutPreset`，页面把这些值直接显示在 header 上。这离规格里的长期 `WorkbenchSpace` 还差得很远：没有 `layoutProfiles`、没有 `defaultEntryViewId`、没有 membership、没有 `focus runs`，也没有任何真正的 shared graph 入口 (`src/ui/app/pages/workbench/workbench-storage.ts:21-55`, `src/ui/app/pages/workbench/workbench-storage.ts:83-107`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:186-203`, `docs/architecture/agent-workbench-shared-graph-spec.md:169-190`, `docs/architecture/agent-workbench-shared-graph-spec.md:278-290`)。

### 3. pane 不是 `ViewInstance`，而是 legacy 路由卡片

当前 `WorkbenchPaneState` 携带的是 `viewKind`、`bindingType`、`sessionId`、`agentId`、`ptyId`、`openPath`。注释直接写明 `agent-session -> legacy chat`、`runtime pane -> legacy agents hub`；`buildWorkbenchPaneHref()` 也直接把 pane href 生成为 `/agents?workbenchBypass=true&focusSession=...` 或 `/agents/chat/:agentId?workbenchBypass=true`。因此当前 pane 不是 Workbench 内部可交互的视图实例，而是“点一下就退回旧页”的跳板 (`src/ui/app/pages/workbench/workbench-storage.ts:26-42`, `src/ui/app/pages/workbench/workbench-storage.ts:298-310`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:109-123`)。

### 4. 真正的工作台交互和布局产权还在 `AgentsPage`

`AgentsPage` 启动时同时读取 `readAgentsTiledWorkbenchPersistState()` 和 `readAgentsTiledPersistState()`，把 `tree / slots / paneOrder / focusedSlot / unassigned / immersive / named layouts` 全部装入自身 state。后续 `buildCurrentTiledLayoutSnapshot()` 又把这些状态重新组装成 `TiledLayoutPersistSnapshot`，并持续写回 `writeAgentsTiledWorkbenchPersistState()`。`TiledGrid` 也是直接吃 `tree / slots / paneOrder`。这说明真正的多 pane 编排、焦点、命名布局、沉浸态仍属于 legacy `AgentsPage`，不是 Workbench 主对象模型 (`src/ui/app/pages/AgentsPage.tsx:1122-1233`, `src/ui/app/pages/AgentsPage.tsx:1392-1428`, `src/ui/app/pages/AgentsPage.tsx:3898-3930`, `src/ui/app/pages/AgentsPage.tsx:8742-8761`)。

### 5. 运行时生命周期也还在 legacy 页面里

`AgentsPage` 的右侧栏逻辑明确依赖“保持 `PtyTerminal` 挂载以维持 PTY WebSocket 不断”，并把 fullscreen PTY 恢复挂在 `initialTiledState.fullscreenPtyId` 上。这不是 Workbench 统一的 `RuntimeBinding / RuntimeAttachment` 管理，而是页面组件生命周期持有运行时连接的现实策略 (`src/ui/app/pages/AgentsPage.tsx:1468-1471`, `src/ui/app/pages/AgentsPage.tsx:9094-9097`, `docs/architecture/agent-workbench-shared-graph-spec.md:592-623`)。

## legacy handoff / route shim / local storage 依赖

### 1. 当前是双向 shim，不是单向迁移

路由层已经把 `/agents` 和 `/agents/chat/:agentId` 包进 `LegacyWorkbenchShim`：当 shim 开启且没有 `workbenchBypass=true` 时，旧入口会被重定向到 `/workbench`，并带上 `legacySource=agents-hub` 或 `legacySource=agent-chat` (`src/routes.tsx:190-223`, `src/routes.tsx:1048-1060`, `src/routes.tsx:1142-1156`)。

但 `WorkbenchPage` 并没有在内部接住这些对象语义，而是反向把它们再吐回旧路由。`resolveWorkbenchLegacyIntent()` 解析 `legacySource`，`applyWorkbenchLegacyIntent()` 把首个 agent pane 改写成 legacy chat handoff，并写入 `openPath=${intent.route}?workbenchBypass=true`；pane 按钮点击后又通过裸 `window.history.pushState` 跳回旧页 (`src/ui/app/pages/workbench/workbench-storage.ts:230-279`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:53-60`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:220-233`)。这不是“旧页逐步被吸收”，而是“新页先接住入口，再把交互扔回旧页”。

### 2. 存在两套前端持久化政权

`WorkbenchPage` 有自己的 `WORKBENCH_PHASE1_STORAGE_KEY = exomind:workbench:phase1-flat:v1`，里面只存 `space / surface / panes`，而且 legacy migration 还是 stub：`isLegacyWorkbenchFlatState()` 永远返回 `false`，`normalizeLegacyWorkbenchFlatState()` 直接抛错 (`src/ui/app/pages/workbench/workbench-storage.ts:3`, `src/ui/app/pages/workbench/workbench-storage.ts:50-55`, `src/ui/app/pages/workbench/workbench-storage.ts:144-150`)。

`AgentsPage` 则有另一套 `AGENTS_TILED_PERSISTENCE_STORAGE_KEY = exomind:agentHubTiledState`，里面维护 versioned workbench layouts、active layout、layout order、fullscreen PTY 恢复等结构；读写函数还会把当前 layout snapshot 回灌到 active layout 记录里 (`src/ui/app/pages/agents/agents-tiled-persistence.ts:15-54`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:409-524`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:526-560`)。

### 3. legacy layout 兼容已经渗进当前数据结构

`AgentsPage` 并不是单纯保存“当前窗口怎么排”，而是在 `tiled-pane-tree.ts` 里保留了 `applyLegacyPaneOrderToBindings()` / `resolveLegacyPaneOrderFromTree()` 这类兼容逻辑，并在 slot binding 里直接塞 `sessionId` 与 `terminalRecovery`。这说明 legacy pane order 和对象/运行时绑定信息仍然和 layout 结构紧耦合，尚未被拆成 `ViewInstance.sharedState`、`SurfaceSlot.localState`、`RuntimeAttachment` 三种不同层级 (`src/ui/app/pages/agents/tiled-pane-tree.ts:403-446`, `src/ui/app/pages/agents/tiled-pane-tree.ts:635-690`, `docs/architecture/agent-workbench-shared-graph-spec.md:409-449`, `docs/architecture/agent-workbench-shared-graph-spec.md:592-623`)。

## 为什么这会阻碍主对象模型接管

### 1. `WorkbenchSpace` 还没有取得真正的状态所有权

规格要求 `WorkbenchSpace` 作为长期宿主承接多次 `FocusRun`、多端布局和默认入口视图，但当前 `space` 只是页面 header 可见的元数据；真正决定“哪些 pane 在空间里”“哪个 pane 被恢复”“哪个布局在生效”的还是 `WorkbenchPage` 本地 flat cache 和 `AgentsPage` 的 tiled state (`docs/architecture/agent-workbench-shared-graph-spec.md:278-296`, `src/ui/app/pages/workbench/workbench-storage.ts:44-55`, `src/ui/app/pages/AgentsPage.tsx:1170-1233`)。主对象没有拿到产权，就不可能变成真相源。

### 2. `ViewInstance` 没有落地，导致 Workbench 只能做入口包装

规格里 `ViewInstance` 是对象的呈现机制，而不是路由字符串；当前 pane 却主要通过 `openPath` 表达目标页，按钮文案也直接写着“Open legacy destination”。这使得 Workbench 无法在自己的对象模型内承接 session/terminal/conversation view，只能扮演 route shim 的前端门面 (`docs/architecture/agent-workbench-shared-graph-spec.md:304-332`, `src/ui/app/pages/workbench/workbench-storage.ts:26-42`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:114-123`)。

### 3. `SurfaceSlot`、布局树、对象绑定仍然混在一起

规格要求 `SurfaceSlot` 只负责挂载和承载，`ViewInstance.sharedState` 与 `SurfaceSlot.localState` 必须拆开；当前 `AgentsPage` 里的 layout snapshot 同时携带 `tree / slots / paneOrder / focusedSlot / immersive / unassignedSessionIds`，而 slot binding 直接塞 `sessionId` 和 `terminalRecovery`。这会让迁移不是“把布局状态换个存储位置”，而是先把布局语义、对象归属和运行时恢复语义拆产权 (`docs/architecture/agent-workbench-shared-graph-spec.md:409-449`, `src/ui/app/pages/AgentsPage.tsx:1392-1428`, `src/ui/app/pages/agents/tiled-pane-tree.ts:635-690`)。

### 4. `RuntimeBinding` 的单一真相源还没有建立

长期模型要求 `RuntimeBinding / RuntimeAttachment` 成为对象与运行时关联的唯一归属层；当前却同时存在 pane 上的 `agentId / ptyId`、`AgentsPage` 持久化里的 `fullscreenPtyId / fullscreenTerminalRecovery`、以及“保持右栏 PTY 挂载以保活 WebSocket”的页面级生命周期策略。这些都说明 runtime 句柄仍挂在页面和组件树上，而不是挂在 Workbench 对象层 (`docs/architecture/agent-workbench-shared-graph-spec.md:592-623`, `src/ui/app/pages/workbench/workbench-storage.ts:33-41`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:47-54`, `src/ui/app/pages/AgentsPage.tsx:9094-9097`)。

### 5. 导航契约仍是 legacy 路由驱动，而不是对象驱动

规格明确禁止继续新增裸 `window.history.pushState`，要求最终走 router-aware navigation bridge；当前 `WorkbenchPage`、`AgentsPage` 和 fullscreen PTY 都仍在直接 `pushState + PopStateEvent`。只要导航还是“切换到某个 legacy URL”，主对象模型就拿不到返回路径、detail pane、mobile fallback 等语义控制权 (`docs/architecture/agent-workbench-shared-graph-spec.md:1317-1343`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:53-60`, `src/ui/app/pages/AgentsPage.tsx:1569-1617`, `src/ui/app/pages/AgentsPage.tsx:9169-9174`)。

### 6. 当前前端存储结构和跨窗口契约相冲突

Phase 1 计划已经明确：共享状态必须通过统一 service 更新，事实层写入不能由窗口各自追加本地日志；而当前 `WorkbenchPage` 和 `AgentsPage` 都各自写自己的 `localStorage`，而且 key 和 schema 还不同。这直接阻断了“多个窗口共享同一 `WorkbenchSpace`”的主对象接管路径 (`docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:88-125`, `src/ui/app/pages/workbench/workbench-storage.ts:189-227`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:409-524`)。

## 迁移阻力

### 1. 不是一个页面替换问题，而是两套状态主权冲突

当前至少存在 `workbench-storage.ts` 的 flat state 和 `agents-tiled-persistence.ts` 的 tiled workbench state 两套前端“工作台”真相；其中后一套还承载 named layouts、fullscreen recovery、legacy pane order 兼容。把 `WorkbenchPage` 升成主对象宿主，首先要决定谁保留、谁映射、谁迁移，而这不是简单的 UI refactor (`src/ui/app/pages/workbench/workbench-storage.ts:50-55`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:21-54`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:409-560`)。

### 2. 现有用户状态包袱已经实化到本地 schema

`AgentsPage` 已经提供布局选择、新建、复制、删除、重命名等 layout CRUD；这意味着用户状态不是一次性临时缓存，而是已有持久化心智。任何迁移如果不能保留这些布局和恢复语义，就不是“架构升级”，而是直接清空用户现有工作台 (`src/ui/app/pages/AgentsPage.tsx:8668-8736`)。

### 3. PTY 生命周期现在绑定在页面组件行为上

只要 PTY 保活仍依赖“某个 aside 保持挂载”，就很难把 runtime ownership 上提到 `WorkbenchSpace` 或 `RuntimeBindingService`。迁移时不先切断这个依赖，主对象层就只能拿到一个不稳定的投影，而拿不到真正的 runtime 生命周期控制 (`src/ui/app/pages/AgentsPage.tsx:9094-9097`)。

### 4. 桥接层在规格里已命名，但代码里还没接管

规格已经把 `WorkbenchService`、`FocusRunService`、`SessionInteropAdapter`、`RuntimeBindingService`、`TaskDagViewStateAdapter` 等桥接和服务列出来；当前代码中与这些职责最接近的逻辑却仍是 `workbench-storage.ts` 里的手写 URL/intent 转换，以及 `AgentsPage` 自己的 snapshot 读写。也就是说，迁移的最大阻力不是“不知道该补什么层”，而是这些层还没从 legacy 页面里抽出来 (`docs/architecture/agent-workbench-shared-graph-spec.md:1123-1186`, `src/ui/app/pages/workbench/workbench-storage.ts:230-309`, `src/ui/app/pages/AgentsPage.tsx:1392-1428`)。

## 建议的后续验证问题

1. 当前 `AgentsPage` 里的哪些状态应该归入 `WorkbenchSpace`，哪些应该归入 `ViewInstance.sharedState`，哪些只是 `SurfaceSlot.localState`？如果这张映射表列不出来，就说明对象产权还没拆开 (`docs/architecture/agent-workbench-shared-graph-spec.md:409-449`, `src/ui/app/pages/AgentsPage.tsx:1170-1233`)。
2. `tiled-pane-tree` 的 `sessionId` 和 `terminalRecovery` 是否能从 slot binding 中移走，改成 `ViewInstance -> RuntimeAttachment` 的间接引用？如果不能，说明 layout 仍在充当业务对象表 (`src/ui/app/pages/agents/tiled-pane-tree.ts:635-690`, `docs/architecture/agent-workbench-shared-graph-spec.md:592-623`)。
3. `WORKBENCH_PHASE1_STORAGE_KEY` 和 `AGENTS_TILED_PERSISTENCE_STORAGE_KEY` 谁是迁移基底？是否需要先做只读导入，再把所有写操作收口到统一 `WorkbenchService`？当前 `workbench-storage` 的 legacy migration 还是未实现状态，这件事不能继续拖成隐含前提 (`src/ui/app/pages/workbench/workbench-storage.ts:3`, `src/ui/app/pages/workbench/workbench-storage.ts:144-150`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:15`, `src/ui/app/pages/agents/agents-tiled-persistence.ts:409-524`)。
4. 哪个组件或服务将接手“PTY 保活”语义？如果答案仍是 `AgentsPage` 右栏保持挂载，那么 `RuntimeBindingService` 只会是名义上的 service (`src/ui/app/pages/AgentsPage.tsx:9094-9097`, `docs/architecture/agent-workbench-shared-graph-spec.md:1166-1174`)。
5. 替代 `workbenchBypass=true` 和裸 `pushState` 的 router-aware navigation bridge 最小闭环是什么？至少要覆盖 `/agents`、`/agents/chat/:agentId`、`/agents/actor/:id`、`/agents/signal/:id`、`/agents/pty/:id` 五类 legacy secondary path，否则 Workbench 仍会被 route fallback 反向绑架 (`src/routes.tsx:190-223`, `src/routes.tsx:1048-1060`, `src/routes.tsx:1142-1156`, `src/ui/app/pages/AgentsPage.tsx:1569-1617`, `src/ui/app/pages/AgentsPage.tsx:9169-9174`)。
6. 计划里要求 `/workbench` 通过 `resolveDefaultSpace()` 和 `loadRecentSessions(spaceId)` 起页；当前实现只是在页面里读本地 flat state 再拉 session stream。下一步要验证的不是“能不能再加几个 pane”，而是能不能把当前起页流程替换成真正的 space-first service 流程 (`docs/plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md:241-246`, `src/ui/app/pages/workbench/WorkbenchPage.tsx:141-160`)。

## 调查结论

长期 Workbench 模型并不缺定义，缺的是**语义所有权迁移**。现在的 `/workbench` 已经有了新命名和入口，但没有拿到 layout ownership、runtime ownership、navigation ownership 和 persistence ownership；这些产权仍散落在 `AgentsPage`、legacy route shim 和两套 `localStorage` schema 里。只要这四类产权没有真正上收到 `WorkbenchSpace + ViewInstance + RuntimeBinding + SurfaceNavigationState` 这一层，Workbench 就很难从“新外壳”升级成真正的主对象模型宿主。
