# 不变量、视图、持久化与实施

[返回《Agent Workbench 共享工作图谱规格》](../agent-workbench-shared-graph-spec.md)

## 5. 核心不变量

### I1. 布局图和工作图谱分离

- `LayoutNode` 不承载业务对象数据
- `LayoutNode` 只负责同端容器组织

### I2. 空间布局按 `surface profile` 分离

- 桌面、平板、手机可以各有自己的布局根
- 不能再用一棵全端共用布局树

### I3. `ViewInstance` 不是产品主对象

- 视图只是呈现机制
- 用户的一等操作对象仍然是节点、会话、任务、终端、结果

### I4. `SessionObject` 与 `AgentNodeObject`/`TerminalNodeObject` 分离

- 逻辑上分开
- 产品上通过默认入口规则收敛，不暴露成双主对象

### I5. 对象与运行时分离

- `RuntimeBinding`/`RuntimeAttachment` 负责连接运行时
- 对象不等于 PTY / SSH / 进程句柄

### I6. 事实层优先

- `EventTape` 是原始事实层
- 结构化解析结果必须可丢弃、可重建

### I7. 事件顺序可重建

- `TapeEvent` 必须有稳定顺序键
- 不能只靠时间戳推断顺序

### I8. 空间不是对象孤岛

- 对象可以跨空间复用
- 空间视角由 membership + rule 共同决定

### I9. `FocusRun` 是 `TimeBlock` 的统一上层语义

- MVP 阶段不能并行存在两套“当前专注”真相源

### I10. 旧页面复用必须通过 adapter

- 不能直接把 `AgentsPage`/`TaskDagPage` 的内部状态当成 Workbench 模型

---

## 6. 视图系统与产品规则

## 6.1 首批视图类型

建议首批只收下面这些视图：

1. `task-list`
2. `session-list`
3. `session`
4. `conversation`
5. `terminal`
6. `work-area`
7. `note`
8. `inspector`
9. `outcome`

说明：

1. `browser` 虽然保留在长期 `ViewType` 枚举中，但不是 Phase 1 首批视图
2. Phase 1 不以 `browser pane` 作为关闭 issue 的验收门槛

## 6.2 `work-area` 与投影模式

中间主舞台统一叫 `work-area`。  
它可以切三种投影模式：

1. `canvas`
2. `network`
3. `replay`

这样可以避免：

1. `canvas` 同时表示容器、视图、派生产物
2. `network` 同时表示页面与派生关系图

## 6.3 长期默认产品预设（post-Phase-1）

下面这组预设描述的是 Phase 1 之后的长期桌面目标，不是 Phase 1 的默认交付面。  
Phase 1 当前默认交付面以 `Flat Workbench（平铺工作台）` 为准，优先是 `session panes + inspector / outcome`，而不是 `canvas-first`。

若不另行定制，桌面端默认预设建议为：

1. 左侧：
   - `task-list`
   - `note`
   - 可切 `session-list`
2. 中间：
   - `work-area`
   - 默认 `projectionMode = canvas`
3. 右侧：
   - `outcome`
   - `inspector`

这意味着：

1. `session-list` 是库存/辅助视图
2. 它不是默认主导航
3. 真正干活仍发生在节点、会话、终端、任务和工作主舞台里

## 6.4 节点与会话的默认交互规则

1. 点击 `AgentNodeObject`
   - 默认进入当前活跃 session
   - 如果没有，则创建/恢复最近 session
2. 点击 `TerminalNodeObject`
   - 默认进入当前终端会话或终端工作面
3. `session-list`
   - 主要服务于切换、回看、恢复
   - 不是顶层心智中心

## 6.5 `Signal Network` 的位置

`Signal Network` 应被定义为：

- `work-area` 上的 `network` 投影模式

而不是：

- 与 `Workbench` 平行的另一个产品页面

---

## 7. 跨端承载策略

## 7.1 总原则

统一：

1. `WorkbenchSpace`
2. `WorkbenchObject`
3. `SessionObject`
4. `FocusRun`
5. `EventTape`
6. `ViewInstance.sharedState`

不统一：

1. 端侧布局树
2. 当前活跃承载面
3. drawer / sheet / fullscreen 的导航状态
4. `SurfaceSlot.localState`

## 7.2 Desktop（桌面端，长期目标）

目标：

1. 多容器并行
2. 高信息密度
3. 自由组织

建议：

1. 完整 `container graph`
2. 支持 `panel + tabs + floating + work-area-host`
3. 默认三栏只是预设，不是唯一布局

补充说明：

1. 这部分描述的是长期桌面能力，不是 Phase 1 的默认实现范围
2. Phase 1 桌面默认实现以平铺 pane 工作台为准，不要求先交付 `floating + work-area-host`

## 7.3 Tablet（平板端）

目标：

1. 保留一定多栏能力
2. 降低认知复杂度

建议：

1. `master-detail + optional work-area`
2. 默认 2 栏
3. 详情与工作主舞台由 `SurfaceNavigationState` 切换

## 7.4 Mobile（手机端）

目标：

1. 突出当前工作流
2. 降低并行信息量

建议：

1. `one active surface（单活跃承载面）`
2. 当前 `focus / session / task` 优先
3. 详情以 `sheet / drawer` 呈现
4. `work-area` 以 `fullscreen` 子视图打开

---

## 8. 事实流与解析链路

## 8.1 推荐事件链

```text
runtime / terminal / ssh / user action
  -> TapeEvent(raw)
  -> parser / projector
  -> DerivedArtifact
  -> view read model
```

## 8.2 首批事件类型建议

1. `user.message.sent`
2. `agent.message.delta`
3. `agent.message.completed`
4. `terminal.stdin.write`
5. `terminal.stdout.chunk`
6. `terminal.stderr.chunk`
7. `ssh.connection.state_changed`
8. `session.status.changed`
9. `focus_run.started`
10. `focus_run.ended`
11. `task.linked`
12. `result.created`

## 8.3 派生解析边界

当前可以做：

1. session summary（会话摘要）
2. structured output blocks（结构化输出块）
3. replay timeline（回放时间线）
4. projection read model（投影读模型）

当前不要做：

1. 强依赖 LLM 的唯一真相提取
2. 一次性做完所有自动洞察
3. 没有来源链路的聪明结论

---

## 9. 持久化模型建议

## 9.1 最小存储面

建议至少落这些持久化主题：

1. `workbench_spaces`
2. `workbench_layout_profiles`
3. `workbench_layout_nodes`
4. `workbench_views`
5. `surface_slots`
6. `surface_navigation_states`
7. `workbench_objects`
8. `space_object_memberships`
9. `workbench_relations`
10. `focus_runs`
11. `event_tapes`
12. `tape_events`
13. `runtime_bindings`
14. `runtime_attachments`
15. `session_anchors`
16. `derived_artifacts`

## 9.2 `workbench_objects`

MVP 阶段可以先用总表，但不能只有开放 JSON：

```ts
type StoredWorkbenchObject = {
  id: string;
  kind: WorkbenchObjectKind;
  schemaVersion: number;
  title: string;
  status?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

要求：

1. `kind` 必须是受控枚举
2. `schemaVersion` 必须存在
3. 高频生命周期字段不要全藏进 `payload`

## 9.3 `space_object_memberships`

```ts
type StoredSpaceObjectMembership = SpaceObjectMembership;
```

要求：

1. `(spaceId, objectId)` 复合唯一
2. `isPinned => isVisible`

## 9.4 `workbench_relations`

```ts
type StoredWorkbenchRelation = WorkbenchRelation;
```

要求：

1. 这是共享工作图谱中关系边的正式存储
2. 不能把对象边退回到 `payload` 或 ID 数组

## 9.5 `tape_events`

```ts
type StoredTapeEvent = {
  id: string;
  tapeId: string;
  seq: number;
  ts: string;
  sourceType: string;
  sourceObjectId?: string;
  sourceSessionId?: string;
  sourceStreamId?: string;
  sourceOffset?: string;
  idempotencyKey?: string;
  eventType: string;
  rawJson: string;
};
```

要求：

1. `(tapeId, seq)` 唯一
2. append-only（追加写入）
3. 派生层单独存，不回写原始事件

## 9.6 Phase 1 存储位置与迁移边界

当前必须明确：Phase 1 不是一次性把所有存储都搬完，而是分层落位。

### Phase 1 推荐落位

| 层 | Phase 1 推荐落位 | 说明 |
|---|---|---|
| `Flat Workbench` 壳层、最近 pane 恢复 | 前端本地持久层（`localStorage / PouchDB`） | 允许先做可见恢复，不阻塞 `/workbench` 起步 |
| `AgentSession -> SessionObject` 读模型桥接 | 前端 adapter + 现有 runtime API | 先桥接现有模型，不要求先反向改写 runtime 真相源 |
| `FocusRun / EventTape` 正式事实层 | runtime 侧持久层（优先复用现有 SQLite 能力） | 不能长期只留在前端本地缓存 |
| `signal / session / terminal` 原始输入 | 继续来自现有 runtime / signal 通道 | Workbench 先接入，不重复造第二份事实源 |

### Phase 1 迁移原则

1. `Slice A / B / E`
   - 允许先用前端本地恢复模型完成可见工作台
   - 但字段命名、对象边界、adapter 接口要向长期模型靠拢
2. `Slice D`
   - `EventTape` 进入正式事实层时，必须优先挂到 runtime 持久化能力
   - 不能让前端 `localStorage / PouchDB` 成为长期事实源
3. `Cross-Window Federation`
   - 如果需要跨窗口共享当前空间与当前 pane 集合，优先通过共享 service / runtime 通道实现
   - 不能依赖每个窗口各自维护一份互不相认的本地状态

---

## 10. 模块、服务与桥接层

## 10.1 运行时建议模块

```text
crates/exomind-runtime/src/workbench/
  mod.rs
  types.rs
  store.rs
  service.rs
  projection.rs
  adapters/
    session_interop.rs
    timeblock_focus_run.rs
```

## 10.2 前端建议模块

```text
src/ui/app/pages/workbench/
  WorkbenchPage.tsx
  workbench-types.ts
  workbench-layout.ts
  workbench-surface.ts
  workbench-presets.ts
  adapters/
    session-read-model-adapter.ts
    topology-projection-adapter.ts
    task-dag-view-state-adapter.ts
    route-compatibility-adapter.ts
  views/
    WorkAreaView.tsx
    SessionView.tsx
    ConversationView.tsx
    TerminalView.tsx
    TaskListView.tsx
    SessionListView.tsx
    InspectorView.tsx
    OutcomeView.tsx
```

## 10.3 首批服务建议

1. `WorkbenchService`
   - space / layout / membership / route shim 管理
2. `FocusRunService`
   - `FocusRun` 生命周期与 `EventTape` 绑定
3. `SessionFederationService`
   - 现有 `AgentSession` 到 `SessionObject` 的映射
4. `RuntimeBindingService`
   - `RuntimeBinding / RuntimeAttachment` 管理
5. `ProjectionService`
   - `canvas / network / replay` 投影读模型

## 10.4 必须先补的 adapter

1. `SessionInteropAdapter`
   - `AgentSession -> SessionObject`
2. `TimeBlockFocusRunAdapter`
   - `TimeBlock / activeBlock -> FocusRun`
3. `TopologyProjectionAdapter`
   - 现有 topology synthetic node -> 正式投影对象
4. `TaskDagViewStateAdapter`
   - 全局 localStorage key -> `ViewInstance.sharedState + SurfaceSlot.localState`
5. `RouteCompatibilityAdapter`
   - `/agents/*` -> `Workbench surface` 兼容路由

---

## 11. 与现有代码的映射与兼容矩阵

## 11.1 `AgentSession -> SessionObject`

当前现状：

- Rust 与 TS 都以 `AgentSession / SessionInfo` 为中心
- 核心字段仍是：
  - `agent_kind`
  - `pty_id`
  - `interaction_mode = terminal | structured`

因此在 MVP 中必须明确：

1. `SessionObject.sessionKind`
   - MVP 只稳定支持 `agent`
2. `terminal / conversation`
   - 保留为未来类型，不作为首批兼容目标
3. `hybrid`
   - 不进入 MVP 的 runtime 契约

### MVP 字段映射

| 现有字段 | 新模型字段 | 说明 |
|---|---|---|
| `AgentSession.id` | `SessionObject.id` | 保持一致 |
| `agent_kind` | `SessionObject.createdFromRuntimeModel` + metadata | 先保留原语义 |
| `interaction_mode` | `SessionObject.interactionMode` | 直接映射 |
| `pty_id` | `RuntimeBinding.runtimeRef` | 通过 `RuntimeAttachment` 连接 |
| `agent_id` | `SessionAnchor.anchorId` | 当存在对应 Agent 节点时 |
| `source_host_id` | `RuntimeBinding.metadata.hostId` | 先走 metadata |

### 明确约束

1. 不能直接把现有 `AgentSession` 等同于最终 `SessionObject`
2. 必须通过 `SessionInteropAdapter`

## 11.2 `TimeBlock -> FocusRun`

当前现状：

- 当前任务执行面仍以 `TimeBlock / activeBlock` 为“正在工作”的真相源

MVP 规则：

1. `FocusRun` 是 `TimeBlock` 的统一上层语义
2. MVP 先把 `FocusRun` 作为现有 `TimeBlock` 的薄投影/别名
3. `FocusRunService` 不能和 `TimeBlockService` 并行各自管理“当前专注”

### MVP 映射

| 现有对象 | 新模型 | 说明 |
|---|---|---|
| `activeBlock.startId` | `FocusRun.timeblockId` | 直接关联 |
| `loadActiveBlock()` | `resolveRunningFocusRun()` | 先走 adapter |
| `endBlock()` | `endFocusRun()` | 仍由旧服务执行，结果映射回新语义 |

## 11.3 `EventTape` 与现有 `eventlog / signals` 的阶段关系

这一条必须说清楚，否则后面会重复造“第二套事件系统”。

### 当前阶段结论

1. `eventlog`
   - 当前仍是已有事实日志基础设施
   - Phase 1 不能直接把它当成废弃系统
2. `signals`
   - 当前仍是实时分发与路由基础设施
   - Phase 1 不能要求它先完全改写成 Workbench 对象模型
3. `EventTape`
   - 当前是 Workbench 规格下的事实层目标形态
   - 需要通过 adapter 逐步和现有 `eventlog / signals` 对齐，而不是平地起第二套孤立存储

### 分阶段要求

1. `Slice A / B / C / E`
   - `EventTape` 可以只停留在接口与对象语义层
   - 旧系统继续承担现有运行时事实输入
2. `Slice D`
   - 必须明确 `EventTape` 的正式写入位置、序列化格式、以及和现有 `eventlog` 的关系
   - 若暂时复用现有 SQLite 事件日志实现，也必须保证 `Workbench` 读写接口稳定
3. 长期目标
   - `EventTape` 成为 Workbench 对象可追溯事实层
   - `signals / session stdout / terminal stream` 通过统一 ingress（事件入口）进入它

### 强约束

1. 不允许 Workbench 自己再造一套脱离 `eventlog / signals` 的孤立“事实流”
2. 不允许派生摘要回写覆盖原始事件
3. `Slice D` 关闭前，必须给出 `raw` 序列化与 retention（保留）策略

## 11.4 `AgentsPage`

当前现状：

1. 多会话管理
2. PTY 挂载
3. 拓扑视图
4. 右侧详情
5. 移动端全屏入口

### 必须修正的现实问题

1. 当前 PTY 节点被伪装成 `agent`
2. 当前移动端次级页面仍靠裸 `pushState`

因此：

1. 只能复用它的 read model 和交互经验
2. 不能直接把它的对象语义搬进共享工作图谱

## 11.5 `TaskDagPage`

当前现状：

1. 画布交互成熟
2. inspector 共存经验成熟
3. 大量状态写在全局 `localStorage / sessionStorage`

因此：

1. 可以复用交互经验
2. 不能直接复用状态持久化方式
3. 必须先做 `TaskDagViewStateAdapter`

## 11.6 路由兼容策略

当前现状：

- `/agents/chat/*`
- `/agents/agent/*`
- `/agents/actor/*`
- `/agents/signal/*`
- `AgentsPage` 内部还会跳 `/agents/pty/*`

MVP 兼容规则：

1. `/agents`
   - 先保留为兼容入口，可逐步转向 `WorkbenchPage`
2. `/agents/chat/*`
3. `/agents/agent/*`
4. `/agents/actor/*`
5. `/agents/signal/*`
6. `legacy /agents/pty/*`
   - 当前仍属于 `AgentsPage` 内部裸 `pushState` 次级路径
   - 不作为 `Slice A` 第一批 shim 完成标准
   - 归入后续路由正规化工作

强约束：

1. 不再新增裸 `window.history.pushState`
2. 统一通过 router-aware navigation bridge（路由感知导航桥）

---

## 12. 分阶段实施策略

## 12.1 长期愿景与当前落点

长期愿景保持不变：

1. `WorkbenchSpace` 仍是产品主对象
2. `container graph + shared work graph + EventTape` 仍是底层骨架
3. `Signal Network / Canvas / Replay` 最终仍要回到同一底层模型

但当前开工落点必须收紧为：

> **先做 `Flat Workbench（平铺工作台）` 并立起最小 `federation skeleton（联邦骨架）`，再增强 `Cross-Window Federation（跨窗口联邦）`，最后再把 `canvas / network / replay` 做成统一投影。**

这意味着：

1. Phase 1 不把自由画布当成阻塞项
2. Phase 1 先交付“一个稳定的多会话工作台”
3. `agent / PTY / SSH / browser runtime` 先通过统一 `SessionObject + RuntimeBinding` 纳管
4. Phase 1 只做“共享同一空间语义”的联邦骨架，增强型跨窗口能力留到后续阶段

## 12.2 Phase 1：`Flat Workbench（平铺工作台）`

Phase 1 必须具备：

1. `WorkbenchPage`
   - 提供固定或半固定的平铺工作面
   - 不先要求自由画布
2. `WorkbenchSpace`
   - 至少有一个稳定 `default space（默认空间）`
   - 能恢复最近使用的会话集合
3. `SessionObject`
   - MVP 先稳定兼容现有 `agent-backed session`
   - 同时给 `PTY / SSH` 稳定纳管，并给 `browser runtime` 预留一致入口
4. `RuntimeBinding + RuntimeAttachment + SessionAnchor`
   - 统一表示运行时句柄、宿主语义与附着关系
5. `SurfaceSlot + SurfaceNavigationState`
   - 先支撑“主窗口 + 次窗口/次承载面”的基本联邦
6. `EventTape`
   - 至少记录会话输入、会话输出、系统控制事件
   - 这是 Phase 1 终局要求，不是 `Slice A` 首刀阻塞项
7. `/agents/*` shim
   - 旧路由可以逐步映射到新的 `WorkbenchPage`
   - 允许先从代表性旧入口开始收口，再逐步覆盖完整兼容面

### 12.2.1 Phase 1 `default space` 生命周期

为了避免 `WorkbenchSpace` 继续停留在抽象名词，Phase 1 先把默认空间规则写死：

1. 首次打开 `/workbench`
   - 若本地还没有任何空间记录，则自动创建一个 `default space`
2. 再次打开 `/workbench`
   - 优先恢复最近一次活跃的同一默认空间
3. `default space` 的 Phase 1 身份规则
   - 当前本地 profile（本地档案）下固定使用同一个稳定 `spaceId`
   - 在没有多空间 UI 之前，默认实现就是 `default-space`
4. 主窗口与次窗口
   - 必须通过同一个 `resolveDefaultSpace()` 入口拿到当前默认空间
   - 若默认空间已存在，次窗口不得再次创建第二份“默认空间”
5. Phase 1 不提供：
   - 空间删除 UI
   - 空间归档 UI
   - 多空间切换管理 UI
6. Phase 1 允许：
   - 在模型层保留 `spaceId`
   - 在文案与测试里显式显示当前空间标识
7. 进入 Phase 2 之前：
   - `default space` 必须是稳定宿主，而不是临时页面状态

### 12.2.2 跨窗口共享同一 `WorkbenchSpace` 的执行契约

这部分不是长期愿景描述，而是后续 `Slice C` 必须落地的执行约束。

#### 共享状态（cross-window shared state）

1. `spaceId`
2. 当前空间内可见 pane 集合
3. `SessionObject / RuntimeBinding` 的附着关系
4. 当前运行中的 `FocusRun` 标识
5. 最近恢复集合的版本号或快照标识

#### 严格本地状态（surface-local state）

1. 某个窗口当前选中的 pane
2. 局部滚动位置
3. inspector 展开折叠
4. 仅服务当前窗口的临时 hover / selection / draft

#### 单写者规则（single-writer rule）

1. 事实层写入只能经过统一 service / runtime ingress（事件入口）
2. 任一窗口都不能直接把本地临时状态当成空间真相源
3. 跨窗口共享对象的改动，必须通过同一个 `WorkbenchService` 契约落盘或广播
4. `SurfaceNavigationState.localState` 默认视为窗口本地态，不参与事实层同步

### Phase 1 runtime 支持分档

1. `must ship（本阶段必须可见可用）`
   - `agent-backed session`
   - 平铺 pane 恢复
   - 至少一个 `runtime-attached non-agent pane（带运行时附着的非 agent 面板）`
   - 当前默认来源是 `PTY / SSH`
   - `/agents` 与 `/agents/chat/* -> /workbench` 的代表性兼容落点
2. `should ship（本阶段优先纳管）`
   - 现有 `PTY / SSH` 通过统一 `RuntimeBinding` 深化进入工作台语义
   - 不要求在本阶段先稳定为独立 `terminal SessionKind`
   - 也不要求在本阶段一次做完完整终端产品面
3. `model-only（只做模型预留）`
   - `browser-runtime`
   - 只要求统一模型入口与注册语义，不作为本阶段关闭条件

## 12.3 Phase 1 明确不做

1. 自由画布编排
2. 完整 `network` 投影编辑器
3. 完整多窗口管理器
4. 完整插件系统
5. 一次性替换所有旧页面
6. 全量智能解析与自动洞察

## 12.4 Phase 1 首批对象集合

1. `WorkbenchSpace`
2. `ViewInstance`
3. `SurfaceSlot + SurfaceNavigationState`
4. `SessionObject`
5. `AgentNodeObject`
6. `TerminalNodeObject`
7. `ResultObject`（轻量）
8. `TaskObject / NoteObject`（轻量接入）

注意：

1. `browser runtime` 在 Phase 1 先作为 `RuntimeBinding.bindingType = 'browser-runtime'`
2. 它在 Phase 1 只要求模型预留与注册入口，不作为关闭 issue 的强制可见功能
3. 是否升级为独立 `BrowserNodeObject` 留到下一轮评审

## 12.5 Phase 1 关键用户旅程

1. 打开 `/workbench`
   - 系统解析或创建 `default space`
   - 恢复最近活跃的 `SessionObject`
   - 用平铺工作面显示多个会话 pane（面板）
2. 在同一工作台中新增会话
   - 用户新建 `agent / PTY / SSH`
   - 系统创建 `SessionObject`
   - 系统通过 `RuntimeBinding` 附着到底层运行时
3. 从主窗口派生次窗口
   - 用户把某个 pane 或 view 弹到新窗口
   - 新窗口仍然属于同一 `WorkbenchSpace`
   - 共享同一底层对象、关系与事实流

## 12.6 Phase 1 可见功能与人类验收

Phase 1 不只是交付抽象模型，它必须给出人类可直接看到、可直接验收的功能面。

最低可见功能集合：

1. 访问 `/workbench`
   - 能打开一个稳定的平铺工作台
2. 在同一工作台中同时看到至少 2 个 session pane
   - 例如 `agent + PTY` 或 `agent + SSH`
   - 至少一个 pane 应来自真实运行时恢复或真实运行时挂载
   - 至少一个 pane 不是 `agent-backed session`
   - `Slice A` 首笔实现允许先以 `workbench-modeled non-agent pane（工作台建模的非 agent pane）` 起步
   - 但 Phase 1 关闭前必须接上真实 `PTY / SSH` 注册或恢复链路
3. 关闭并重新打开后
   - 最近工作台能恢复
4. 从主窗口派生一个次窗口工作面
   - 仅要求桌面端 / Tauri 路径成立
   - 次窗口仍加载同一 `WorkbenchSpace`

Phase 1 最低人类验收清单：

1. 打开工作台时不是空白页或跳错页
2. 可以从工作台新建至少一种运行时 pane
3. 主窗口中可同时看到 2 个以上工作面，且至少有一个不是 `agent-backed session`
4. 重启或刷新后，最近 pane 集合能够恢复
5. 桌面端打开次窗口后，两个窗口仍然指向同一空间语义
6. 基础会话输入/输出可继续进入事实流
7. 至少 2 个代表性旧入口仍可落到正确工作台位置
   - 第一批以 `/agents`、`/agents/chat/*` 为准
   - `legacy /agents/pty/*` 归入后续路由正规化工作

## 12.7 评审闭环状态

下面这张表用于回答“上一轮高风险评审意见现在还剩什么”：

| 评审点 | 当前状态 | 结论 |
|---|---|---|
| 自建窗口管理器过重 | 已收口为 `Phase 2+`，Phase 1 不做完整窗口管理器 | 已解决 |
| 关系类型过多 | 已收口为 Phase 1 最小关系集与操作别名 | 已解决 |
| `Signal Network` 直接并入会过重 | 已明确为长期 `projection`，Phase 1 与旧页共存 | 已解决 |
| `default space` 生命周期未定义 | 本版补充了 Phase 1 默认空间规则 | 已解决 |
| `EventTape` 与 `eventlog / signals` 关系不清 | 本版补充了分阶段关系，但正式落库仍留到 `Slice D` | 部分解决 |
| `tape_events retention / compression` 未定义 | 仍未最终定稿，但不阻塞 `Slice A / B / C / E` | 延后到 `Slice D` |

---

## 13. Phase 1 开工切片建议

## 13.1 Slice A：平铺壳层与兼容路由

目标：

1. 新增 `WorkbenchPage.tsx`
2. 接入 `/workbench`
3. 分成 `Slice A1` 与 `Slice A2`
4. 提供固定或半固定的多 pane 布局

交付标准：

1. 壳层能打开
2. 不打断当前移动端全屏与二级页面
3. 平铺工作面能稳定显示多个 pane

### `Slice A1`

1. 直接访问 `/workbench`
2. 创建或恢复 `default space`
3. 展示一个 `agent-backed session pane + non-agent pane`

### `Slice A2`

1. 建立代表性旧入口 shim
2. 优先覆盖 `/agents` 或 `/agents/chat/*` 其中之一
3. 明确返回路径与空间落点语义

## 13.2 Slice B：统一会话与运行时注册表

目标：

1. 抽 `SessionInteropAdapter`
2. 把现有 `AgentSession` 映射到 `SessionObject`
3. 把 `PTY / SSH / browser runtime` 收到统一 `RuntimeBinding` 语义
   - 其中 `browser runtime` 在 Phase 1 仅要求模型预留，不要求形成首批可见 pane
4. 消除“PTY 伪装成 agent”这类语义污染

交付标准：

1. 一个空间里能恢复多个 `agent-backed session`
2. 新旧语义映射可追溯
3. 新增运行时不再要求复制一套页面模型

## 13.3 Slice C：跨窗口联邦前置抽象

目标：

1. 让多个 `SurfaceSlot` 能映射到“主窗口 + 次窗口/次承载面”
2. 接入 `#646` 的窗口研究结论
3. 确立“同一 `WorkbenchSpace`，多个窗口共享对象与导航语义”的骨架

交付标准：

1. 可以从主窗口打开第二个工作面
2. 新窗口能加载同一空间中的子集视图
3. 不要求完整窗口拖放与任意停靠

补充执行契约：

1. 共享：
   - `spaceId`
   - pane membership（pane 归属）
   - `SessionObject / RuntimeBinding` 关联
2. 本地：
   - `SurfaceNavigationState.localState`
   - 当前窗口选中的 pane
   - 当前窗口的滚动和临时 UI 状态
3. 写入：
   - 多窗口都通过统一 service 修改共享状态
   - 事实层写入不能由窗口各自直接追加本地日志

## 13.4 Slice D：`FocusRun + EventTape` 基础接入

目标：

1. 桥接现有 `TimeBlock`
2. 把会话输入/输出与系统控制事件写入 append-only 事实流
3. 为后续 `structured projection（结构化投影）` 预留稳定来源链路

交付标准：

1. 能开始/结束 `FocusRun`
2. 同一空间内多个会话的事件进入同一 `EventTape`
3. 可生成最基础的 replay 时间线

## 13.5 Slice E：恢复、只读视图与评审支撑

目标：

1. 形成 `session list + active panes + outcome / inspector` 的稳定读模型
2. 把当前状态持久化到空间级模型，而不是散落在临时 `localStorage`
3. 给后续 `canvas / network` 投影提供只读恢复底座

交付标准：

1. 重启后可恢复最近工作台
2. 同一空间中的 pane 排布与会话集合可恢复
3. 评审文档与真实对象模型一致

---

## 14. 团队评审重点

- [ ] 长期愿景仍是 `WorkbenchSpace + shared work graph + EventTape`
- [ ] 当前第一阶段明确收敛为 `Flat Workbench`，不是自由画布
- [ ] `SessionObject + RuntimeBinding` 能统一承载 `agent / PTY / SSH / browser runtime`
- [ ] `SurfaceSlot + SurfaceNavigationState` 足以支撑跨窗口联邦前置抽象
- [ ] `EventTape` 仍是事实源，结构化层只能派生
- [ ] `/agents/*` 必须通过兼容路由逐步迁移
- [ ] Epic 与阶段 issue 的治理方式保持最小扩散
- [ ] 每个阶段 issue 都对应至少一个人类可见、可手测验收的功能面

---

## 15. 仍保留的开放问题

## 15.1 不阻塞 `Slice A / B / C / E` 的开放问题

1. `browser runtime` 是长期保持在 `RuntimeBinding` 层，还是升级为 `BrowserNodeObject`
2. `workbench_relations` 的端点类型约束是写在 schema 还是 service 层

## 15.2 `Slice D / F` 前必须收口的问题

1. `EventTape` 与现有 `eventlog / signals` 的最终落库与归属关系
2. `tape_events` 的 retention / compression / backpressure 策略
3. `raw` 事件的序列化约定（JSON / chunk / offset / idempotency 规则）

---

## 16. 结论

这次规格现在的执行重点，不再是“先做一个完美自由的 UI”，而是先把下面五件事落地：

1. `WorkbenchSpace` 作为长期工作场景先站住
2. `Flat Workbench` 先把多个会话工作面稳定纳管起来
3. `RuntimeBinding` 统一承载 `agent / PTY / SSH / browser runtime`
4. 跨窗口先实现联邦骨架，而不是完整窗口管理器
5. `EventTape` 为后续 `structured projection / canvas / network / replay` 提供稳定事实层

只要团队接受这个阶段收口，第一批 PR 就不必再被“先做自由画布”卡住。
