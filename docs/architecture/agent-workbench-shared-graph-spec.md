# Agent Workbench 共享工作图谱架构规格

> **版本**: v0.2-draft  
> **日期**: 2026-03-30  
> **状态**: 待评审（review pending，待评审）  
> **文档类型**: architecture / spec（架构规格）  
> **定位**: 定义 `Agent Workbench（Agent 工作台）` 的产品主对象、共享底层模型、事实源、视图系统、跨端承载方式，以及首批可开工的模块与实现边界。  
> **关联**:
> - Epic: `#728`
> - 讨论笔记: `docs/plans/2026-03-30-agent-workbench-canvas-brainstorm.md`
> - 参考: `docs/architecture/agent-hub-ui-spec.md`
> - 参考: `docs/specs/SPEC-goal-system-v0.3-logic.md`
> - 现有运行时: `crates/exomind-runtime/src/session/types.rs`

---

## 0. 文档契约

### 0.1 这份文档回答什么

这份文档回答的是：

1. `Agent Workbench` 到底是什么产品，边界在哪里
2. 为什么页面主对象应该是 `WorkbenchSpace（工作空间）`，而不是 terminal / session / task
3. 为什么外层布局要建模成 `container graph（容器图）`，内层语义要建模成 `shared work graph（共享工作图谱）`
4. 为什么 `EventTape（事件带）` 必须是事实源，而结构化解析只能是派生层
5. `AgentNodeObject（Agent 节点对象）`、`SessionObject（会话对象）`、`RuntimeBinding（运行时绑定）`、`FocusRun（专注片段）` 应该如何分层
6. 桌面 / 平板 / 手机如何共享同一组对象模型，但使用不同 `surface（承载面）`
7. 第一阶段应该落哪些类型、表、服务、页面骨架，才能开始实现

### 0.2 这份文档不回答什么

这份文档不回答：

1. 像素级视觉稿和最终样式细节
2. 插件权限沙箱与插件市场协议
3. 完整多窗口系统的全部技术细节
4. 每个组件的最终交互动画

### 0.3 术语约定

1. 下文统一使用 `SessionObject（会话对象）`
2. 用户口述里如果出现 `section / session` 混用，统一按“会话对象”理解
3. 下文中的“对象”指领域对象，不等于 React 组件，不等于运行时句柄

---

## 1. 产品目的与设计意图

### 1.1 真实目标

这次设计不是为了继续把 ExoMind 做成：

- 一个通用 terminal manager（终端管理器）
- 一个孤立的 signal topology editor（信号拓扑编辑器）
- 一个只会记笔记的 note app（笔记工具）

而是为了把 ExoMind 收敛成一个真正可工作的统一工作台：

> 用户只打开 ExoMind 这一个软件，就可以进入长期持久的工作空间，在里面组织任务、和多个 Agent 对话、挂接 terminal / SSH、查看结果、记录专注过程，并在事后回放与追溯整个工作事实。

### 1.2 必须保留的设计意图

这几条是这次规格必须保留的产品意图，后续实现不能悄悄改掉：

1. **工作台不是固定三栏**
   - 三栏只能是默认预设，不能是底层真模型
2. **工作台不是纯白板**
   - 画布非常重要，但它只是工作台中的一种承载形态
3. **工作台不是多个互不相通的窗口**
   - 各种面板、画布、网络图、详情页看到的是同一批对象和同一批事实
4. **工作台不是只围绕单个任务展开**
   - 工作空间比任务更持久；同一工作空间中可以发生多段专注工作
5. **结构化解析不是事实源**
   - 原始终端流、原始 Agent 流、原始事件流才是事实源
6. **产品不是先做“通用终端”再考虑 Agent**
   - 终端能力必须是底座能力，但产品主线仍然是多 Agent 工作台
7. **Signal Network 不是平行产品**
   - 它应该成为 Workbench 的一种网络视图

### 1.3 一句话定义

> `Agent Workbench` 是一个支持容器自由组织、运行时对象纳管、工作过程记录与回放、并可承载多种派生视图的 `containerized work cognition space（容器化认知工作空间）`。

---

## 2. 核心架构判断

### 2.1 为什么要分成两层图

这次设计的关键，不是只引入几个新对象，而是明确两层图：

1. `container graph（容器图）`
   - 解决“屏幕上怎么排”
   - 是空间级布局模型
2. `shared work graph（共享工作图谱）`
   - 解决“系统里到底有什么对象，它们怎么关联”
   - 是产品语义模型

如果不分开，会出现两个常见错误：

1. 把对象位置、对象关系、运行时状态都塞进单一画布模型
2. 把三栏布局、停靠关系、对象语义、网络关系全部混成 UI 状态

### 2.2 为什么 `WorkbenchSpace` 是主对象

如果页面主对象是 terminal：

- 任务、笔记、结果、Agent 协作都只能变成“终端附属物”

如果页面主对象是 task：

- 多终端、多 Agent、多文档、多专注片段没有稳定宿主

如果页面主对象是 session：

- 长期布局、空间偏好、固定视图、跨多次会话的组织能力无处安放

因此：

> 页面主对象必须是 `WorkbenchSpace`，它代表长期持久的工作场景；task / session / terminal / note 都是在这个空间中被组织和呈现的对象。

### 2.3 为什么 `AgentNodeObject` 和 `SessionObject` 必须分开

两者解决的是不同问题：

1. `AgentNodeObject`
   - 解决“这个节点在工作空间里是谁，它和别的节点是什么关系”
2. `SessionObject`
   - 解决“这一次实际交互或执行过程是什么，它有哪些历史和输出”

不分开会导致：

1. 历史会话无法独立保留
2. 一个 Agent 节点无法自然对应多次运行
3. 规划关系和运行过程被硬绑死

因此这里的关系应该是：

```text
AgentNodeObject 1 --- N SessionObject
TerminalNodeObject 1 --- N SessionObject
```

### 2.4 为什么 `EventTape` 必须是事实源

如果把“结构化解析结果”当事实源，会马上遇到这些问题：

1. 解析策略变了，历史就变了
2. 终端流和 Agent 流中的细节被丢失
3. Replay / Summary / Timeline / Network 的结果不再可追溯

因此必须采用：

```text
raw stream / raw event
  -> EventTape
  -> derived projections
```

派生层可以删掉重算，事实层不能静默改写。

---

## 3. 系统总模型

### 3.1 总览

```text
WorkbenchSpace
  ├─ layout graph
  ├─ surface slots
  ├─ view instances
  ├─ space-local links
  ├─ visible-in-space links
  └─ focus runs
       └─ event tape

Shared Work Graph
  ├─ static semantic objects
  ├─ dynamic runtime objects
  ├─ object relations
  └─ runtime bindings

Derived Layer
  ├─ canvas projection
  ├─ network projection
  ├─ replay projection
  ├─ session summary
  └─ structured parse artifacts
```

### 3.2 三层分工

#### A. `space layer（空间层）`

回答：

- 我现在在哪个工作空间里
- 空间里打开了哪些视图
- 这些视图是怎么摆的

#### B. `object layer（对象层）`

回答：

- 工作里有哪些对象
- 它们之间是什么关系
- 哪些是长期对象，哪些是运行时对象

#### C. `fact layer（事实层）`

回答：

- 这一段工作里到底发生了什么
- 哪个事件先发生，哪个事件后发生
- 结构化结论是否可追溯到原始事实

---

## 4. 核心对象模型

## 4.1 `WorkbenchSpace`

### 定义

`WorkbenchSpace` 是长期持久的工作场景。  
它既不是“文件夹”，也不是“临时过滤器”，而是：

1. `anchor object（锚点对象）`
2. `view lens（子图视角）`

### 最小结构

```ts
type WorkbenchSpace = {
  id: string;
  name: string;
  scope: 'personal' | 'team' | 'project';
  description?: string;

  rootLayoutNodeId: string;
  activePresetId?: string;
  defaultSurfaceMode: 'desktop' | 'tablet' | 'mobile';

  createdAt: string;
  updatedAt: string;
};
```

### 语义要求

1. `WorkbenchSpace` 可以长期存在，不随某次会话结束而销毁
2. 一个 `WorkbenchSpace` 下可以发生多次 `FocusRun`
3. 空间可以拥有自己的布局、固定视图、局部笔记、局部偏好
4. 对象不一定属于某个空间，但可以在某个空间中可见

## 4.2 `ViewInstance`

### 定义

UI 真正打开的是视图实例，不是直接打开对象。

```ts
type ViewTarget =
  | { kind: 'space'; spaceId: string }
  | { kind: 'object'; objectId: string }
  | { kind: 'focus-run'; focusRunId: string }
  | { kind: 'query'; queryKey: string };

type ViewInstance = {
  id: string;
  viewType:
    | 'task-list'
    | 'session-list'
    | 'canvas'
    | 'network'
    | 'replay'
    | 'note'
    | 'inspector'
    | 'outcome';
  title?: string;
  target: ViewTarget;
  state?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

### 语义要求

1. 同一个对象可以被多个视图实例同时查看
2. 同一个视图实例可以在不同端投影到不同 `surface`
3. 视图状态和对象状态分开保存

## 4.3 `LayoutNode` 与外层容器图

### 定义

```ts
type LayoutNode =
  | SplitNode
  | TabsNode
  | PanelNode
  | FloatingNode
  | CanvasHostNode;

type SplitNode = {
  id: string;
  kind: 'split';
  direction: 'horizontal' | 'vertical';
  childIds: string[];
  sizes?: number[];
};

type TabsNode = {
  id: string;
  kind: 'tabs';
  childIds: string[];
  activeChildId: string;
};

type PanelNode = {
  id: string;
  kind: 'panel';
  viewId: string;
};

type FloatingNode = {
  id: string;
  kind: 'floating';
  childId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasHostNode = {
  id: string;
  kind: 'canvas-host';
  viewId: string;
};
```

### 语义要求

1. 这是布局真模型，不是“默认三栏”真模型
2. `PanelNode` 更适合稳定高频信息
3. `CanvasHostNode` 是一个外层容器，内部再承载自由布局
4. 对象在画布中的摆位属于视图状态，不属于对象本体

## 4.4 `SurfaceSlot`

### 定义

`SurfaceSlot` 是更高一层的端侧承载抽象，用来表达“同一个 view 在不同设备上怎么挂载”。

```ts
type SurfaceSlot = {
  id: string;
  mode: 'panel' | 'tab' | 'drawer' | 'window' | 'overlay' | 'canvas-fullscreen';
  viewId: string;
  visible: boolean;
  priority?: number;
};
```

### 语义要求

1. 桌面端可以把 `ViewInstance` 投影为 `panel / tab / floating`
2. 手机端可以把同一 `ViewInstance` 投影为 `drawer / fullscreen`
3. `SurfaceSlot` 只描述 UI 挂载方式，不描述业务语义

## 4.5 `WorkbenchObject`

### 基础定义

```ts
type WorkbenchObjectKind =
  | 'task'
  | 'goal'
  | 'document'
  | 'note'
  | 'resource'
  | 'agent-node'
  | 'terminal-node'
  | 'session'
  | 'result';

type WorkbenchObjectBase = {
  id: string;
  kind: WorkbenchObjectKind;
  title: string;
  createdAt: string;
  updatedAt: string;
};
```

### 分类

#### 静态语义对象（static semantic objects，静态语义对象）

变化慢，偏知识、内容、结构：

1. `TaskObject`
2. `GoalObject`
3. `DocumentObject`
4. `NoteObject`
5. `ResourceObject`

#### 动态运行时对象（dynamic runtime objects，动态运行时对象）

变化快，偏执行、交互、运行：

1. `AgentNodeObject`
2. `TerminalNodeObject`
3. `SessionObject`
4. `ResultObject`

## 4.6 `AgentNodeObject`

### 定义

```ts
type AgentNodeObject = WorkbenchObjectBase & {
  kind: 'agent-node';
  role: string;
  providerKind?: string;
  defaultInteractionMode: 'terminal' | 'structured' | 'hybrid';
  status?: 'idle' | 'active' | 'warning' | 'error';
  capabilityTags?: string[];
};
```

### 语义要求

1. 它代表“空间里的一个能力节点 / 角色节点”
2. 它不是某次具体运行
3. 它可以对应多次 `SessionObject`

## 4.7 `TerminalNodeObject`

### 定义

```ts
type TerminalNodeObject = WorkbenchObjectBase & {
  kind: 'terminal-node';
  transportKind: 'pty' | 'ssh';
  hostRef?: string;
  shellRef?: string;
  status?: 'idle' | 'connected' | 'warning' | 'error';
};
```

### 语义要求

1. 终端能力要被建模成长期对象，而不是只建临时 PTY 句柄
2. `ssh` 是一种 transport（传输/连接方式），不是单独产品
3. 同一个终端节点可以有多次历史会话

## 4.8 `SessionObject`

### 定义

```ts
type SessionKind = 'agent' | 'terminal' | 'ssh' | 'conversation';

type SessionObject = WorkbenchObjectBase & {
  kind: 'session';
  sessionKind: SessionKind;
  status: 'running' | 'waiting_input' | 'paused' | 'completed' | 'error' | 'archived';
  interactionMode: 'terminal' | 'structured' | 'hybrid';
  anchorObjectId?: string;
  runtimeBindingId?: string;
  summary?: string;
  lastEventAt?: string;
};
```

### 语义要求

1. `SessionObject` 是一次交互/执行过程的历史容器
2. 它允许脱离当前运行时继续存在
3. 它可以被重新绑定到新的 `RuntimeBinding`
4. 它可以被纳入多个视图，但仍只是一份会话事实

## 4.9 `ResultObject`

### 定义

```ts
type ResultObject = WorkbenchObjectBase & {
  kind: 'result';
  resultType: 'message' | 'artifact' | 'summary' | 'decision' | 'plan';
  sourceSessionId?: string;
  sourceFocusRunId?: string;
  derived: boolean;
  derivedFromEventIds?: string[];
};
```

### 语义要求

1. 用户最终看到的结果，需要能回溯到会话或事件
2. 如果它是派生产物，必须能标注来源

## 4.10 `RuntimeBinding`

### 定义

```ts
type RuntimeBinding = {
  id: string;
  objectId: string;
  bindingType: 'pty' | 'ssh' | 'agent-session' | 'external-process';
  runtimeRef: string;
  status: 'running' | 'idle' | 'waiting' | 'stopped' | 'error';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

### 语义要求

1. 长期对象和底层运行时句柄必须分开
2. `runtimeRef` 是当前活跃句柄，不是对象 ID
3. 对象删除或隐藏，不等于一定要杀死运行时
4. 运行时断开后，会话历史仍然存在

## 4.11 `FocusRun`

### 定义

```ts
type FocusRun = {
  id: string;
  spaceId: string;
  timeblockId?: string;
  title?: string;
  status: 'planned' | 'running' | 'paused' | 'ended';
  startedAt: string;
  endedAt?: string;
  eventTapeId: string;
  summary?: string;
};
```

### 语义要求

1. `FocusRun` 表示一段专注工作过程，不等于整个空间
2. 一个空间下允许存在多次 `FocusRun`
3. 一次 `FocusRun` 中可以有多个活跃 session / terminal / note / result

## 4.12 `EventTape`

### 定义

```ts
type EventTape = {
  id: string;
  focusRunId: string;
  createdAt: string;
};

type TapeEvent = {
  id: string;
  tapeId: string;
  ts: string;
  sourceType: 'user' | 'agent' | 'terminal' | 'system' | 'plugin';
  sourceObjectId?: string;
  sourceSessionId?: string;
  eventType: string;
  raw: unknown;
};
```

### 语义要求

1. `TapeEvent.raw` 必须保留事实
2. 任何结构化摘要都不能覆盖 `raw`
3. Replay、Summary、Timeline、Network 均应从 `EventTape` 派生

---

## 5. 关系模型与不变量

## 5.1 关系类型

### 空间相关

1. `space_local`
   - 空间自己的长期资产
2. `visible_in_space`
   - 在这个空间中可见的共享对象
3. `pinned_in_space`
   - 被固定在空间里的对象或视图

### 结构与引用

1. `contains`
2. `parent_of`
3. `references`
4. `derived_from`

### 运行与编排

1. `binds_to`
2. `runs_as`
3. `produces`
4. `consumes`
5. `depends_on`
6. `blocks`
7. `delegates_to`
8. `informs`

### 时间

1. `occurred_in`
2. `active_during`
3. `replayed_from`

## 5.2 核心不变量

这些不变量必须成立，否则实现会逐渐滑回旧模型：

### I1. 布局图和工作图谱分离

- `LayoutNode` 不能直接承载业务对象数据
- `LayoutNode` 只能引用 `ViewInstance`

### I2. 对象和运行时分离

- `WorkbenchObject` 不等于 PTY / SSH / 进程句柄
- 运行时绑定必须通过 `RuntimeBinding`

### I3. Session 与 AgentNode 分离

- `SessionObject` 不能兼任 `AgentNodeObject`

### I4. 事实层优先

- `EventTape` 是原始事实层
- 结构化解析结果必须可丢弃、可重建

### I5. 画布位置不属于对象本体

- 对象的画布坐标属于 `ViewInstance.state`
- 不是对象公共属性

### I6. 空间不是对象孤岛

- 对象可以跨空间复用
- 空间只是锚点与视角，不是封闭仓库

### I7. 跨端统一对象模型

- 桌面、平板、手机共享同一组对象与事实
- 差异只发生在 `surface` 投影层

---

## 6. 视图系统与派生层

## 6.1 为什么 `Signal Network` 应并入视图系统

`Signal Network` 如果继续作为平行产品，会造成：

1. 同一批对象在两套产品语义里重复建模
2. 用户心智继续割裂
3. 任务 / 对话 / 终端 / 结果 / 信号之间无法自然共用底层关系

因此：

> `Signal Network` 应变成 `Agent Workbench` 的一种 `network view（网络视图）`。

## 6.2 首批视图类型

建议首批只收下面这些视图：

1. `task-list`
2. `session-list`
3. `canvas`
4. `network`
5. `replay`
6. `inspector`
7. `note`
8. `outcome`

## 6.3 派生层规则

派生层至少包括：

1. `network projection`
2. `canvas projection`
3. `replay projection`
4. `session summary`
5. `structured parse artifacts`

派生层必须遵守：

1. 可删除
2. 可重建
3. 必须带来源信息

可选最小定义：

```ts
type DerivedArtifact = {
  id: string;
  artifactType: 'network-projection' | 'replay-projection' | 'session-summary' | 'structured-parse';
  sourceTapeId?: string;
  sourceEventIds?: string[];
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

---

## 7. 跨端承载策略

## 7.1 总原则

统一：

1. `WorkbenchSpace`
2. `ViewInstance`
3. `WorkbenchObject`
4. `FocusRun`
5. `EventTape`

不统一：

1. 面板数量
2. 同时可见的内容
3. 默认布局形态

## 7.2 Desktop（桌面端）

目标：

1. 多容器并行
2. 自由组织
3. 高信息密度

建议：

1. 完整 `container graph`
2. 支持 `panel + tabs + floating + canvas-host`
3. 右侧详情、左侧任务、中间画布只是默认预设，不是唯一布局

## 7.3 Tablet（平板端）

目标：

1. 保留一定多栏能力
2. 降低认知负担

建议：

1. `master-detail + optional canvas`
2. 默认 2 栏
3. 详情与画布按上下文切换

## 7.4 Mobile（手机端）

目标：

1. 只突出当前工作流
2. 降低并行信息量

建议：

1. `one active surface（单活跃承载面）`
2. 当前 focus / 当前 session / 当前 task 优先
3. 详情以 `sheet / drawer` 形式显示
4. 画布视图以全屏子页面打开

---

## 8. 事实流与解析链路

## 8.1 推荐事件链

首批建议统一到下面的事实流：

```text
runtime / terminal / ssh / user action
  -> TapeEvent(raw)
  -> parser / projector
  -> derived artifact
  -> view read model
```

## 8.2 首批事件类型建议

不需要一开始就穷尽所有类型，但建议先覆盖这些：

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

解析层当前可以做：

1. session summary（会话摘要）
2. structured output blocks（结构化输出块）
3. replay timeline（回放时间线）
4. network edge hints（网络边提示）

当前不要做：

1. 强依赖 LLM 的唯一真相提取
2. 一次性做完所有自动洞察
3. 没有来源链路的“聪明结论”

---

## 9. 持久化模型建议

这部分不是最终数据库设计，而是“现在就能开工”的持久化边界建议。

## 9.1 最小存储面

建议至少落这些持久化主题：

1. `workbench_spaces`
2. `workbench_views`
3. `workbench_layout_nodes`
4. `surface_slots`
5. `workbench_objects`
6. `space_object_links`
7. `focus_runs`
8. `event_tapes`
9. `tape_events`
10. `runtime_bindings`
11. `derived_artifacts`

## 9.2 推荐中间关联模型

为避免把一堆 ID 数组直接塞回对象，建议引入显式关联表：

```ts
type SpaceObjectLink = {
  id: string;
  spaceId: string;
  objectId: string;
  relationType: 'space_local' | 'visible_in_space' | 'pinned_in_space';
  createdAt: string;
};
```

这样后续：

1. 对象跨空间复用会更自然
2. 空间级对象和共享对象更容易区分
3. 迁移到更正式的图谱存储也更顺

## 9.3 `workbench_objects` 的建议

MVP 阶段可以先用一张对象总表 + kind 区分：

```ts
type StoredWorkbenchObject = {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

等对象类型稳定后，再拆分 specialized table（专用表）。

## 9.4 `tape_events` 的建议

这里应该偏 append-only（追加写入）：

```ts
type StoredTapeEvent = {
  id: string;
  tapeId: string;
  ts: string;
  sourceType: string;
  sourceObjectId?: string;
  sourceSessionId?: string;
  eventType: string;
  rawJson: string;
};
```

要求：

1. 不要静默覆盖历史事件
2. 派生层单独存，不回写覆盖原始事件

---

## 10. 模块与服务边界

## 10.1 运行时建议模块

建议新增：

```text
crates/exomind-runtime/src/workbench/
  mod.rs
  types.rs
  store.rs
  service.rs
  projection.rs
```

### 角色分工

1. `types.rs`
   - 放 `WorkbenchSpace / ViewInstance / FocusRun / RuntimeBinding / link` 等核心类型
2. `store.rs`
   - 负责持久化读写
3. `service.rs`
   - 负责业务操作
4. `projection.rs`
   - 负责 `network / replay / summary` 等派生层计算

## 10.2 前端建议模块

建议不要继续把未来工作台主逻辑堆进 `AgentsPage.tsx`。

建议新增：

```text
src/ui/app/pages/workbench/
  WorkbenchPage.tsx
  workbench-types.ts
  workbench-view-registry.ts
  workbench-layout.ts
  workbench-surface.ts
  workbench-presets.ts
  views/
    CanvasView.tsx
    NetworkView.tsx
    ReplayView.tsx
    TaskListView.tsx
    SessionListView.tsx
    InspectorView.tsx
    OutcomeView.tsx
```

## 10.3 首批服务建议

首批建议至少有这些服务边界：

1. `WorkbenchService`
   - space / view / layout / link 管理
2. `FocusRunService`
   - run 生命周期 + tape 绑定
3. `SessionFederationService`
   - 多 session 纳管与跨对象关联
4. `RuntimeBindingService`
   - 对象和 PTY / SSH / agent runtime 的绑定
5. `ProjectionService`
   - network / replay / summary 派生

## 10.4 推荐首批命令面

如果要从 service 层切 API，建议优先有这些命令：

1. `create_space`
2. `save_space_layout`
3. `create_view`
4. `link_object_to_space`
5. `create_session_object`
6. `attach_runtime_binding`
7. `start_focus_run`
8. `append_tape_event`
9. `end_focus_run`
10. `derive_projection`

---

## 11. 与现有代码的映射建议

## 11.1 已有 runtime session 模型

现有：

- `crates/exomind-runtime/src/session/types.rs`

它已经具备：

1. `SessionStatus`
2. `InteractionMode`
3. `AgentSession`
4. `SessionMessage`
5. `WorkContext`

建议做法：

1. 保留现有 session 模型作为 `SessionObject` 的运行时底座
2. 不要直接推翻重写
3. 在 `workbench` 模块中新增外层语义与关联，而不是把工作台全部塞回 `session/types.rs`

## 11.2 已有 `AgentsPage`

现有：

- `src/ui/app/pages/AgentsPage.tsx`

它已经包含：

1. 多会话管理
2. 终端 PTY 挂载
3. 拓扑视图
4. 右侧详情面板
5. 布局持久化经验

建议做法：

1. 短期把 `AgentsPage` 作为 `Workbench` 的一个过渡来源
2. 中期把其中的 `topology / sessions / right panel / pty` 拆成可注册视图
3. 长期让 `WorkbenchPage` 成为容器外壳，`AgentsPage` 退化为历史页面或兼容入口

## 11.3 已有 `TaskDagPage`

现有：

- `src/ui/app/pages/TaskDagPage.tsx`

它已经有：

1. 画布交互经验
2. 布局/视口持久化经验
3. 详情面板与图主视图共存经验

建议做法：

1. 复用其 `canvas + side inspector` 的经验
2. 不直接复用其任务专用数据模型
3. 抽取可通用的布局与视图骨架

## 11.4 路由层

现有：

- `src/routes.tsx`

建议方向：

1. 新增 `/workbench` 或让 `/agents` 最终转向 `WorkbenchPage`
2. 桌面/手机差异继续走现有 `useIsDesktop + shell mode` 思路
3. 但工作台自己的 `surface` 规则应从页面内部再做一层抽象

---

## 12. MVP 边界

## 12.1 MVP 必须具备

1. `WorkbenchSpace`
   - 创建、命名、保存/恢复布局
2. `ViewInstance + LayoutNode`
   - 至少支持 panel / tabs / canvas-host
3. `SessionObject`
   - 至少能纳管多个 agent / terminal / SSH 会话
4. `AgentNodeObject` 与 `TerminalNodeObject`
   - 至少能作为空间中的长期节点
5. `RuntimeBinding`
   - 会话可绑定到底层运行时
6. `FocusRun + EventTape`
   - 能记录原始事件并支持基础回放
7. 双视图
   - `canvas`
   - `network`

## 12.2 MVP 明确不做

1. 完整插件系统
2. 完整多窗口管理器
3. 所有对象类型一次性统一
4. 所有智能解析和自动洞察
5. 一次性替换所有旧页面

## 12.3 MVP 首批对象集合

为避免第一阶段范围爆炸，建议 MVP 先收这几类对象：

1. `AgentNodeObject`
2. `TerminalNodeObject`
3. `SessionObject`
4. `ResultObject`
5. `TaskObject`（轻量接入）
6. `NoteObject`（轻量接入）

`DocumentObject / ResourceObject / GoalObject` 可以在下一阶段继续补入。

---

## 13. 开工切片建议

这部分不是 issue checklist，而是“工程上怎么切第一刀”。

## 13.1 Slice A: 先落运行时模型

目标：

1. 新增 `workbench/types.rs`
2. 定义 `WorkbenchSpace / ViewInstance / LayoutNode / FocusRun / RuntimeBinding / SpaceObjectLink`
3. 先不做复杂 UI

交付标准：

1. 能创建空间
2. 能保存布局树
3. 能把 session/object 挂进空间

## 13.2 Slice B: 先起页面外壳

目标：

1. 新增 `WorkbenchPage.tsx`
2. 支持默认 layout preset
3. 支持视图注册与 panel 渲染

交付标准：

1. 页面能打开
2. 至少有 `task-list / session-list / canvas / inspector` 四类 view
3. 布局能持久化

## 13.3 Slice C: 把现有 session / terminal 纳入空间

目标：

1. 把现有 `AgentSession`、PTY、SSH 通道挂到 `SessionObject + RuntimeBinding`
2. 让一个空间里能同时看多个 session

交付标准：

1. 一个空间中能稳定展示多个 agent / terminal / ssh 会话
2. 断开重连后历史不丢

## 13.4 Slice D: 接入 `FocusRun + EventTape`

目标：

1. 开始记录专注过程
2. 让事件有 append-only 底座

交付标准：

1. 能开始/结束 `FocusRun`
2. 会话输出和用户输入会进入 `EventTape`
3. 至少有基础 timeline / replay 面板

## 13.5 Slice E: 做双视图投影

目标：

1. `canvas view`
2. `network view`

交付标准：

1. 同一批对象可以在两种视图中切换
2. 两种视图看到的是同一底层对象，不是两套假数据

---

## 14. 团队评审重点

开工前只需要确认下面这些点，不需要再回到泛泛讨论：

- [ ] `WorkbenchSpace` 是长期工作场景，而不是任务或会话
- [ ] `AgentNodeObject` 与 `SessionObject` 必须分开
- [ ] `EventTape` 是事实源，解析是派生层
- [ ] 布局真模型是 `container graph`，不是固定三栏
- [ ] `Signal Network` 是 `Workbench` 的一种视图，不是平行产品
- [ ] 桌面/平板/手机统一对象模型，不统一布局
- [ ] MVP 先做会话纳管、空间布局、专注记录、双视图，不做全量插件化

---

## 15. 仍保留的开放问题

这些问题不阻塞开工，但会影响第二阶段设计：

1. `workbench_objects` 是否在 MVP 阶段先用一张总表，还是直接拆专用表
2. `TaskObject / NoteObject` 接入时，是做只读投影，还是直接成为主对象
3. 手机端默认首页更偏 `current focus（当前专注）` 还是 `current task flow（当前任务流）`
4. `network view` 是否直接适配现有 `Signal Network` 数据契约，还是先做 `view adapter（视图适配层）`

---

## 16. 结论

这次规格的关键不是“再做一个更自由的 UI”，而是明确：

1. 外层是 `container graph`
2. 内层是 `shared work graph`
3. 时间事实层由 `FocusRun + EventTape` 承担
4. `SessionObject` 与 `AgentNodeObject`、`TerminalNodeObject` 分层建模
5. `Signal Network / Canvas / Replay` 都只是同一底层模型的不同投影

只要团队接受这五条，工程上就已经可以开始切第一批 PR 了。
