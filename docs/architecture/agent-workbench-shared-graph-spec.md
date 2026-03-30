# Agent Workbench 共享工作图谱架构规格

> **版本**: v0.3-draft  
> **日期**: 2026-03-30  
> **状态**: 待评审（review pending，待评审）  
> **文档类型**: architecture / spec（架构规格）  
> **定位**: 定义 `Agent Workbench（Agent 工作台）` 的产品主对象、共享底层模型、事实源、跨端承载方式、与现有代码的桥接边界，以及首批可直接开工的实施切片。  
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

1. `Agent Workbench` 到底是什么产品，不是什么产品
2. 为什么页面主对象必须是 `WorkbenchSpace（工作空间）`
3. 为什么外层要建模成 `container graph（容器图）`，内层要建模成 `shared work graph（共享工作图谱）`
4. 为什么 `EventTape（事件带）` 必须是事实源，结构化解析只能是派生层
5. `AgentNodeObject / TerminalNodeObject / SessionObject / RuntimeBinding / FocusRun` 之间到底怎么分层
6. 现有 `AgentSession / PTY / TimeBlock / AgentsPage / TaskDagPage / routes.tsx` 怎么映射到新模型
7. 哪些地方已经可以开工，哪些地方必须先补桥接层

### 0.2 这份文档不回答什么

这份文档不回答：

1. 像素级视觉稿
2. 插件沙箱与插件市场协议
3. 通用多窗口系统的全部底层实现
4. 每个组件的最终动画与交互细节

### 0.3 术语约定

1. 下文统一使用 `SessionObject（会话对象）`
2. 下文中的“对象”指领域对象，不等于 React 组件，不等于运行时句柄
3. 下文中的 `work area（工作主舞台）` 指中间主工作面
4. `canvas / network / replay` 在本规格中优先表示 `projection mode（投影模式）`，而不是顶层页面产品

---

## 1. 产品目的与设计意图

### 1.1 真实目标

这次设计不是为了继续把 ExoMind 做成：

- 一个通用 terminal manager（终端管理器）
- 一个孤立的 signal topology editor（信号拓扑编辑器）
- 一个只会记笔记的 note app（笔记工具）

真正目标是：

> 用户只打开 ExoMind 这一个软件，就能进入长期持久的工作空间，在里面组织任务、和多个 Agent 对话、挂接 terminal / SSH、查看结果、记录专注过程，并在事后回放与追溯整个工作事实。

### 1.2 必须保留的产品意图

这些意图后续不能被实现细节悄悄改掉：

1. **工作台不是固定三栏**
   - 三栏只能是默认预设，不是底层真模型
2. **工作台不是纯白板**
   - 画布很重要，但它只是工作主舞台的一种投影模式
3. **工作台不是多个互不相通的窗口**
   - 面板、画布、网络图、详情页看到的是同一批对象与事实
4. **工作台不是只围绕单个任务**
   - 工作空间比任务更持久，同一空间里会发生多段专注工作
5. **结构化解析不是事实源**
   - 原始终端流、原始 Agent 流、原始事件流才是事实源
6. **终端能力是底座，不是产品主轴**
   - 产品主轴仍是多 Agent 工作台
7. **Signal Network 不是平行产品**
   - 它应该成为 Workbench 的一种投影视图

### 1.3 一句话定义

> `Agent Workbench` 是一个支持容器自由组织、运行时对象纳管、工作过程记录与回放、并能以多种投影模式查看同一底层图谱的 `containerized work cognition space（容器化认知工作空间）`。

---

## 2. 核心架构判断

### 2.1 两层图必须分开

本次设计的关键，不是多几个对象，而是明确两层图：

1. `container graph（容器图）`
   - 解决“屏幕上怎么排”
   - 是空间级布局模型
2. `shared work graph（共享工作图谱）`
   - 解决“系统里到底有什么对象，它们怎么关联”
   - 是产品语义模型

如果不分开，最终一定会发生：

1. 把对象关系、运行时状态、画布坐标都塞进单一画布模型
2. 把布局状态、业务关系、跨端投影、导航状态都混成 UI 局部状态

### 2.2 `WorkbenchSpace` 为什么必须是主对象

如果页面主对象是 terminal：

- 任务、笔记、结果、Agent 协作都会退成终端附属物

如果页面主对象是 task：

- 多终端、多 Agent、多文档、多专注片段没有稳定宿主

如果页面主对象是 session：

- 长期布局、空间偏好、固定视图、跨多次会话的组织能力无处安放

因此：

> 页面主对象必须是 `WorkbenchSpace`。task / session / terminal / note / result 都是在空间里被组织、呈现和回放的对象。

### 2.3 `AgentNodeObject` 和 `SessionObject` 为什么必须分开

两者解决的是不同问题：

1. `AgentNodeObject`
   - 解决“这个节点在工作空间里是谁、它和别的节点是什么关系”
2. `SessionObject`
   - 解决“这一次实际交互或执行过程是什么、它有哪些历史和输出”

但在用户产品感知层面，二者也不能变成两个并列主对象。  
因此需要同时满足两条规则：

1. **逻辑层分开**
   - 节点与会话是不同对象
2. **产品层收敛**
   - 默认交互入口优先是节点/对象
   - 打开节点时，默认进入当前或最近一次会话
   - 历史 session（历史会话）作为时间视角或二级展开，而不是并列主入口

### 2.4 `EventTape` 为什么必须是事实源

如果把结构化解析结果当事实源，会马上遇到：

1. 解析策略一变，历史就变
2. 终端流和 Agent 流细节丢失
3. Replay / Summary / Timeline / Network 结果不再可追溯

因此必须采用：

```text
raw stream / raw event
  -> EventTape
  -> parser / projector
  -> derived artifacts
```

派生层可以删掉重算，事实层不能静默改写。

---

## 3. 系统总模型

### 3.1 总览

```text
WorkbenchSpace
  ├─ layout profiles
  ├─ surface slots
  ├─ surface navigation states
  ├─ view instances
  ├─ space memberships
  └─ focus runs
       └─ event tape

Shared Work Graph
  ├─ static semantic objects
  ├─ dynamic runtime objects
  ├─ typed relations
  ├─ runtime bindings
  └─ runtime attachments

Derived Layer
  ├─ projection artifacts
  ├─ session summaries
  └─ replay read models
```

### 3.2 四层分工

#### A. `space layer（空间层）`

回答：

- 我现在在哪个工作空间里
- 这个空间桌面/平板/手机各自怎么摆
- 当前前台工作面是什么

#### B. `object layer（对象层）`

回答：

- 工作里有哪些对象
- 谁是长期对象，谁是运行时对象
- 对象和对象之间是什么关系

#### C. `fact layer（事实层）`

回答：

- 这一段工作到底发生了什么
- 事件顺序是什么
- 哪些结论可以追溯到哪些事实

#### D. `projection layer（投影层）`

回答：

- 这些对象和事实现在以什么方式被看见
- 当前工作主舞台是 `canvas / network / replay` 哪一种投影模式

---

## 4. 核心对象模型

## 4.1 `WorkbenchSpace`

### 定义

`WorkbenchSpace` 是长期持久的工作场景。  
它既不是文件夹，也不是临时过滤器，而是：

1. `anchor object（锚点对象）`
2. `view lens（子图视角）`

### 最小结构

```ts
type SurfaceProfile = 'desktop' | 'tablet' | 'mobile';

type SpaceLayoutProfile = {
  surfaceProfile: SurfaceProfile;
  rootLayoutNodeId: string;
  activePresetId?: string;
  navigationStateId: string;
};

type WorkbenchSpace = {
  id: string;
  name: string;
  scope: 'personal' | 'team' | 'project';
  description?: string;

  layoutProfiles: Record<SurfaceProfile, SpaceLayoutProfile>;
  defaultEntryViewId?: string;
  visibilityRuleIds?: string[];

  createdAt: string;
  updatedAt: string;
};
```

### 语义要求

1. `WorkbenchSpace` 可以长期存在，不随单次会话结束而销毁
2. 一个空间下可以发生多次 `FocusRun`
3. 桌面、平板、手机可以有不同布局根节点
4. 空间视角由下面几类因素共同决定：
   - `space_local（空间本地对象）`
   - `visible_in_space（显式可见对象）`
   - `pinned_in_space（固定对象）`
   - `query / rule-based includes（查询/规则纳入）`

## 4.2 `ViewInstance`

### 定义

`ViewInstance` 是对象的呈现机制，不是产品主对象。  
用户真正干活的对象仍然是 `SessionObject / AgentNodeObject / TerminalNodeObject / TaskObject` 等。

```ts
type ProjectionMode = 'canvas' | 'network' | 'replay';

type ViewTarget =
  | { kind: 'space'; spaceId: string }
  | { kind: 'object'; objectId: string }
  | { kind: 'focus-run'; focusRunId: string }
  | { kind: 'query'; queryKey: string };

type ViewType =
  | 'task-list'
  | 'session-list'
  | 'session'
  | 'conversation'
  | 'terminal'
  | 'work-area'
  | 'note'
  | 'inspector'
  | 'outcome';

type ViewInstance = {
  id: string;
  viewType: ViewType;
  title?: string;
  target: ViewTarget;
  defaultProjectionMode?: ProjectionMode;
  sharedState?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

### 语义要求

1. 同一个对象可以被多个视图实例同时查看
2. `sharedState` 只保存跨端共享的语义状态
3. 终端 / 会话 / 对话是工作面，不只是列表条目
4. `work-area` 是中间主舞台；`canvas / network / replay` 是它的投影模式

## 4.3 `LayoutNode` 与外层容器图

### 定义

```ts
type LayoutNode =
  | SplitNode
  | TabsNode
  | PanelNode
  | FloatingNode
  | WorkAreaHostNode;

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

type WorkAreaHostNode = {
  id: string;
  kind: 'work-area-host';
  viewId: string;
  allowedProjectionModes: ProjectionMode[];
};
```

### 语义要求

1. 这是单一 `surface profile（端侧布局）` 内的放置真相源
2. `LayoutNode` 只负责同一端内的容器组织
3. `WorkAreaHostNode` 承载中间主舞台，不再直接用 `canvas-host` 命名
4. 对象在 `work-area` 中的坐标与展开状态属于视图状态，不属于对象本体

## 4.4 `SurfaceSlot` 与 `SurfaceNavigationState`

### 定义

`SurfaceSlot` 不再直接重复声明 `viewId` 的放置关系。  
它表达的是：当前端上有哪些承载槽位，以及这些槽位挂哪一棵布局树。

```ts
type SurfaceSlot = {
  id: string;
  surfaceProfile: SurfaceProfile;
  slotRole: 'primary' | 'secondary' | 'detail' | 'transient';
  mode: 'panel' | 'tab' | 'floating' | 'drawer' | 'sheet' | 'fullscreen' | 'window';
  rootLayoutNodeId: string;
  visible: boolean;
  priority?: number;
  localState?: Record<string, unknown>;
};

type SurfaceNavigationState = {
  id: string;
  surfaceProfile: SurfaceProfile;
  activeSurfaceSlotId?: string;
  activeLeafViewId?: string;
  selectionRef?: { kind: 'object' | 'session' | 'focus-run'; id: string };
  openedFromViewId?: string;
  backStack: string[];
  presentationState?: Record<string, unknown>;
  updatedAt: string;
};
```

### 语义要求

1. `LayoutNode` 负责同端容器组织
2. `SurfaceSlot` 负责跨端/跨窗口的挂载
3. `SurfaceNavigationState` 负责：
   - 当前前台工作面
   - master-detail 选择态
   - drawer / sheet / fullscreen 的返回路径
4. `ViewInstance.sharedState` 与 `SurfaceSlot.localState` 必须分开

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

1. `TaskObject`
2. `GoalObject`
3. `DocumentObject`
4. `NoteObject`
5. `ResourceObject`

#### 动态运行时对象（dynamic runtime objects，动态运行时对象）

1. `AgentNodeObject`
2. `TerminalNodeObject`
3. `SessionObject`
4. `ResultObject`

## 4.6 `AgentNodeObject`

```ts
type AgentNodeObject = WorkbenchObjectBase & {
  kind: 'agent-node';
  role: string;
  providerKind?: string;
  defaultInteractionMode: 'terminal' | 'structured';
  status?: 'idle' | 'active' | 'warning' | 'error';
  capabilityTags?: string[];
};
```

语义要求：

1. 表示空间中的能力节点/角色节点
2. 不是某次具体运行
3. 默认交互入口优先是节点，节点再解析到当前或最近 session

## 4.7 `TerminalNodeObject`

```ts
type TerminalNodeObject = WorkbenchObjectBase & {
  kind: 'terminal-node';
  transportKind: 'pty' | 'ssh';
  hostRef?: string;
  shellRef?: string;
  status?: 'idle' | 'connected' | 'warning' | 'error';
};
```

语义要求：

1. 终端能力建模成长期对象，而不是临时 PTY 句柄
2. `ssh` 只在 transport 层出现，不在 `SessionKind` 重复编码
3. 当前 `AgentsPage` 中的 PTY synthetic node 不能继续伪装成 `agent`

## 4.8 `SessionObject`

### 定义

```ts
type SessionKind = 'agent' | 'terminal' | 'conversation';

type SessionObject = WorkbenchObjectBase & {
  kind: 'session';
  sessionKind: SessionKind;
  status: 'running' | 'waiting_input' | 'paused' | 'completed' | 'error' | 'archived';
  interactionMode: 'terminal' | 'structured';
  summary?: string;
  lastEventAt?: string;
  createdFromRuntimeModel: 'agent-session-v1' | 'native-workbench-v1';
};
```

### 语义要求

1. `SessionObject` 是一次交互/执行过程的历史容器
2. 允许脱离当前运行时继续存在
3. 与节点的关系通过显式 anchor / relation 建模，不再用裸 `anchorObjectId`
4. MVP 阶段只要求稳定承载 `agent-backed session（现有 agent 会话）`

## 4.9 `SessionAnchor`

```ts
type SessionAnchor = {
  id: string;
  sessionId: string;
  anchorKind: 'agent-node' | 'terminal-node';
  anchorId: string;
  role: 'primary' | 'backing-terminal' | 'origin';
  attachedAt: string;
  detachedAt?: string;
};
```

语义要求：

1. `SessionAnchor` 是 session 宿主语义的真相源
2. 一个 session 可以有多个 anchor，但必须有明确 `role`
3. 迁移宿主时保留历史，不静默覆写

## 4.10 `ResultObject`

```ts
type ResultObject = WorkbenchObjectBase & {
  kind: 'result';
  resultType: 'message' | 'artifact' | 'summary' | 'decision' | 'plan';
  derived: boolean;
  sourceTapeId?: string;
  sourceSessionId?: string;
};
```

语义要求：

1. 若 `derived = true`，必须至少有一个稳定来源
2. 细粒度来源通过 `derived_from` 关系表达，不再把多来源 ID 数组塞回对象本体

## 4.11 `RuntimeBinding` 与 `RuntimeAttachment`

### 定义

```ts
type RuntimeBinding = {
  id: string;
  bindingType: 'pty' | 'ssh' | 'agent-session' | 'external-process';
  runtimeRef: string;
  status: 'running' | 'idle' | 'waiting' | 'stopped' | 'error';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type RuntimeAttachment = {
  id: string;
  bindingId: string;
  ownerType: 'session' | 'agent-node' | 'terminal-node';
  ownerId: string;
  role: 'primary' | 'backing' | 'mirror';
  attachedAt: string;
  detachedAt?: string;
};
```

### 语义要求

1. `RuntimeBinding` 表示运行时资源
2. `RuntimeAttachment` 表示谁在什么时段绑定了这个资源
3. 这是对象与运行时关联的单一真相源
4. 不再让 `SessionObject` 和 `RuntimeBinding` 双向各持一个外键

## 4.12 `FocusRun`、`EventTape`、`TapeEvent`

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

type EventTape = {
  id: string;
  focusRunId: string;
  createdAt: string;
};

type TapeEvent = {
  id: string;
  tapeId: string;
  seq: number;
  ts: string;
  sourceType: 'user' | 'agent' | 'terminal' | 'system' | 'plugin';
  sourceObjectId?: string;
  sourceSessionId?: string;
  sourceStreamId?: string;
  sourceOffset?: string;
  idempotencyKey?: string;
  eventType: string;
  raw: unknown;
};
```

### 语义要求

1. `FocusRun <-> EventTape` 在 MVP 中是严格 1:1
2. 一个空间同一时刻最多只允许一个 `running` 的 `FocusRun`
3. `ended` 状态必须带 `endedAt`
4. `(tapeId, seq)` 必须唯一
5. `TapeEvent` 追加写入，不静默改写

## 4.13 `SpaceObjectMembership`

```ts
type SpaceObjectMembership = {
  id: string;
  spaceId: string;
  objectId: string;
  isLocal: boolean;
  isVisible: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};
```

语义要求：

1. `(spaceId, objectId)` 复合唯一
2. `isPinned => isVisible`
3. `isLocal` 与对象跨空间复用不冲突

## 4.14 `WorkbenchRelation`

### 定义

```ts
type RelationType =
  | 'contains'
  | 'parent_of'
  | 'references'
  | 'derived_from'
  | 'binds_to'
  | 'runs_as'
  | 'produces'
  | 'consumes'
  | 'depends_on'
  | 'blocks'
  | 'delegates_to'
  | 'informs'
  | 'occurred_in'
  | 'active_during'
  | 'replayed_from';

type WorkbenchRelation = {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  scope: 'global' | 'space';
  scopeSpaceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  endedAt?: string;
};
```

### 语义要求

1. 这是共享工作图谱中对象边的统一存储模型
2. `SpaceObjectMembership` 不是它的替代品，只是空间可见性专用成员关系
3. 每种 `relationType` 后续需要补端点类型约束与基数约束

## 4.15 `DerivedArtifact`

```ts
type DerivedArtifact = {
  id: string;
  artifactType: 'projection' | 'session-summary' | 'structured-parse' | 'timeline-read-model';
  sourceTapeId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

语义要求：

1. 持久化的派生产物必须带 `sourceTapeId`
2. 事件级来源通过 `derived_from` 关系补足
3. 派生产物可删、可重算

---

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

## 6.2 `work-area` 与投影模式

中间主舞台统一叫 `work-area`。  
它可以切三种投影模式：

1. `canvas`
2. `network`
3. `replay`

这样可以避免：

1. `canvas` 同时表示容器、视图、派生产物
2. `network` 同时表示页面与派生关系图

## 6.3 默认产品预设

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

## 7.2 Desktop（桌面端）

目标：

1. 多容器并行
2. 高信息密度
3. 自由组织

建议：

1. 完整 `container graph`
2. 支持 `panel + tabs + floating + work-area-host`
3. 默认三栏只是预设，不是唯一布局

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

## 11.3 `AgentsPage`

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

## 11.4 `TaskDagPage`

当前现状：

1. 画布交互成熟
2. inspector 共存经验成熟
3. 大量状态写在全局 `localStorage / sessionStorage`

因此：

1. 可以复用交互经验
2. 不能直接复用状态持久化方式
3. 必须先做 `TaskDagViewStateAdapter`

## 11.5 路由兼容策略

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
6. `/agents/pty/*`
   - 全部保留 shim（兼容壳）
   - 内部映射到 `WorkbenchPage + SurfaceNavigationState`

强约束：

1. 不再新增裸 `window.history.pushState`
2. 统一通过 router-aware navigation bridge（路由感知导航桥）

---

## 12. MVP 边界

## 12.1 MVP 必须具备

1. `WorkbenchSpace`
   - 支持三端 layout profile
2. `ViewInstance + LayoutNode + SurfaceNavigationState`
   - 至少能表达 desktop / mobile 的差异
3. `SessionObject`
   - MVP 先稳定兼容现有 agent-backed session
4. `AgentNodeObject` 与 `TerminalNodeObject`
   - 作为空间中的长期节点
5. `RuntimeBinding + RuntimeAttachment + SessionAnchor`
6. `FocusRun + EventTape`
   - 先桥接现有 `TimeBlock`
7. `work-area`
   - 支持 `canvas` 与 `network` 两种投影模式

## 12.2 MVP 明确不做

1. 完整插件系统
2. 完整多窗口管理器
3. 全对象类型一次性统一
4. 全量智能解析与自动洞察
5. 一次性替换所有旧页面
6. 原生 `terminal / conversation` 新运行时协议

## 12.3 MVP 首批对象集合

1. `AgentNodeObject`
2. `TerminalNodeObject`
3. `SessionObject`
4. `ResultObject`
5. `TaskObject`（轻量接入）
6. `NoteObject`（轻量接入）

---

## 13. 开工切片建议

## 13.1 Slice A: 核心模型与关系存储

目标：

1. 新增 `WorkbenchSpace / LayoutProfile / SurfaceNavigationState`
2. 新增 `WorkbenchRelation / SessionAnchor / RuntimeAttachment`
3. 明确 `FocusRun / EventTape` 不变量

交付标准：

1. 能存空间
2. 能存布局 profile
3. 能存对象边与成员关系

## 13.2 Slice B: 抽取 adapter / read model

目标：

1. 抽 `SessionInteropAdapter`
2. 抽 `TimeBlockFocusRunAdapter`
3. 抽 `TopologyProjectionAdapter`
4. 抽 `TaskDagViewStateAdapter`

交付标准：

1. 不改旧页面主行为
2. 新模型已经能读旧数据

## 13.3 Slice C: Workbench 壳层与兼容路由

目标：

1. 新增 `WorkbenchPage.tsx`
2. 接入 `/workbench`
3. 建立 `/agents/*` shim

交付标准：

1. 壳层能打开
2. 不打断当前移动端全屏与二级页面

## 13.4 Slice D: 会话与终端纳管

目标：

1. 把现有 `AgentSession`、PTY、SSH 纳入 `SessionObject + RuntimeBinding`
2. 让一个空间里能稳定展示多个会话与终端工作面

交付标准：

1. 一个空间里能恢复多个 agent-backed session
2. PTY 不再以 `agent` 语义进入投影

## 13.5 Slice E: `FocusRun + EventTape`

目标：

1. 桥接现有 `TimeBlock`
2. 开始记录 append-only 事件

交付标准：

1. 能开始/结束 `FocusRun`
2. 会话输出和用户输入进入 `EventTape`
3. 能产出基础 replay timeline

## 13.6 Slice F: `work-area` 投影模式

目标：

1. `canvas`
2. `network`

交付标准：

1. 同一批对象在两种投影里切换
2. 共享同一底层对象与关系，不造两套假数据

---

## 14. 团队评审重点

- [ ] `WorkbenchSpace` 是长期工作场景，而不是任务或会话
- [ ] 三端布局根节点按 `surface profile` 分离
- [ ] `ViewInstance` 是呈现机制，不是产品主对象
- [ ] `SessionObject` 与 `AgentNodeObject` 分开，但产品入口仍然收敛
- [ ] `workbench_relations` 是正式对象边存储
- [ ] `EventTape` 是事实源，`TapeEvent` 有稳定顺序键
- [ ] `FocusRun` 在 MVP 中桥接现有 `TimeBlock`
- [ ] `/agents/*` 必须通过兼容路由逐步迁移

---

## 15. 仍保留的开放问题

1. `TaskObject / NoteObject` 在 MVP 是只读投影还是半托管对象
2. 手机端默认首页更偏 `current focus（当前专注）` 还是 `current task flow（当前任务流）`
3. `workbench_relations` 的端点类型约束是写在 schema 还是 service 层
4. `terminal / conversation` 何时从未来类型升级为首批原生运行时对象

---

## 16. 结论

这次规格的关键不是“再做一个更自由的 UI”，而是把下面五件事写成可执行模型：

1. 外层是按端分离的 `container graph`
2. 内层是有正式对象边存储的 `shared work graph`
3. 事实层由 `FocusRun + EventTape` 承担，并桥接现有 `TimeBlock`
4. `SessionObject`、节点对象、运行时资源通过 typed relation（类型化关系）连接
5. `Signal Network / Canvas / Replay` 不再是平行产品，而是 `work-area` 的不同投影模式

只要团队确认这五条，就已经可以按新的切片顺序开始第一批 PR。
