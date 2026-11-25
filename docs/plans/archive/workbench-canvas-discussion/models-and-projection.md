# 模型比较、图谱和跨端视图

[返回《Agent Workbench 画布主对象讨论》](../../2026-03-30-agent-workbench-canvas-brainstorm.md)

## 12. 与其他模型的对比（Model Comparison，模型对比）

### 12.1 `Fixed page shell（固定页面壳层）`

示例心智：

- 左导航 + 中内容 + 右详情

优点：

- 最容易做
- 学习成本低

缺点：

- 很快卡死产品上限
- 不适合多 Agent、多终端、多资源自由编排
- 无法承载用户想要的“爱怎么摆怎么摆”

结论：

- 只能作为默认预设，不适合作为真模型

### 12.2 `Document-centric（文档中心）`

可类比：

- Obsidian 的“一个 pane（面板）里打开一个 note view（笔记视图）”

优点：

- 很适合知识管理
- `pane tree（面板树）` 心智成熟
- 插件机制容易围绕 view 扩展

缺点：

- 核心对象是 document / file（文档 / 文件）
- 对 `runtime node（运行时节点）`、`terminal session（终端会话）`、`agent process（Agent 进程）` 的表达不够自然

结论：

- ExoMind 应借 Obsidian 的 `pane + view` 机制
- 但不能把 `note/document` 当成唯一核心对象

### 12.3 `Pure canvas / node graph（纯画布 / 节点图）`

可类比：

- 白板、流程图、可视化 Agent 编排

优点：

- 非常适合表达关系、流动、拓扑、编排
- 很适合 `Agent / terminal / signal` 这种对象

缺点：

- 高频工作效率容易变差
- 列表、详情、长文、表格类内容不好承载
- 作为唯一主界面会过于漂浮

结论：

- 必须要有
- 但不能独占整个工作台模型

### 12.4 `IDE / pane-centric（IDE / 面板中心）`

可类比：

- VS Code / JetBrains / Obsidian 风格的 pane tree + tabs

优点：

- 高密度信息组织能力强
- 停靠、分栏、标签很成熟

缺点：

- 对自由编排和关系表达不够强
- 容易把一切都压成“文档/面板”

结论：

- 很适合作为外层布局系统
- 不适合作为内层所有对象的唯一呈现方式

### 12.5 当前推荐模型：`Pane tree + Canvas container + Runtime graph`

这是当前最贴近用户意图的统一模型：

1. 外层用 `pane tree（面板树）` 组织工作台
2. 中间允许存在一个或多个 `canvas container（画布容器）`
3. 底层对象不是文件，而是 `workbench objects（工作台对象）`
4. 运行时对象通过 `session/runtime binding（会话/运行时绑定）` 接进来

一句话概括：

> `Obsidian-like pane system（类 Obsidian 面板系统）` + `node/canvas work surface（节点/画布工作面）` + `runtime/event tape（运行时/事件带）`

---

## 13. 更稳的底层数据结构（Data Model，数据模型）

### 13.1 根对象：`WorkbenchSpace`

```ts
type WorkbenchSpace = {
  id: string;
  name: string;
  scope: 'personal' | 'team' | 'project';
  description?: string;

  // 长期状态
  layoutGraph: LayoutNode;
  objectIds: string[];
  activePresetId?: string;

  // 运行中的时间片
  focusRunIds: string[];
  activeFocusRunId?: string;

  createdAt: string;
  updatedAt: string;
};
```

它回答的问题是：

- 这是哪个长期工作空间
- 里面有哪些对象
- 当前布局长什么样
- 最近有哪些工作片段

### 13.2 外层布局：`LayoutGraph`

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
  children: string[];
  sizes?: number[];
};

type TabsNode = {
  id: string;
  kind: 'tabs';
  children: string[];
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
  canvasId: string;
};
```

关键点：

- 外层布局只关心容器怎么组织
- 不直接关心某个 Agent 节点长什么样

### 13.3 视图实例：`ViewInstance`

```ts
type ViewInstance = {
  id: string;
  viewType: string;
  title?: string;
  target?: ViewTarget;
  state?: Record<string, unknown>;
};

type ViewTarget =
  | { kind: 'space'; spaceId: string }
  | { kind: 'object'; objectId: string }
  | { kind: 'focus-run'; focusRunId: string }
  | { kind: 'query'; query: string };
```

这层非常重要。

它说明：

- **UI 真正打开的是一个 view（视图）**
- view 可以看整个空间、看某个对象、看某次工作片段、或看某种查询结果

这和 Obsidian 非常像，但目标对象更广。

### 13.4 真实对象：`WorkbenchObject`

```ts
type WorkbenchObject =
  | TaskObject
  | NoteObject
  | SessionObject
  | ResourceObject
  | ResultObject
  | AgentNodeObject
  | TerminalNodeObject
  | SensorNodeObject;

type WorkbenchObjectBase = {
  id: string;
  objectType: string;
  title?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  pluginId?: string;
};
```

这一层才是“节点是什么”。

这里的重点不是 UI，而是**语义对象本身**。

### 13.5 节点与运行时分离：`Object` 不等于 `Process`

例如一个 `TerminalNodeObject（终端节点对象）` 不应该直接等于某个 PTY 进程。

更好的设计是：

```ts
type RuntimeBinding = {
  id: string;
  objectId: string;
  bindingType: 'pty' | 'ssh' | 'agent-session' | 'external-process';
  runtimeRef: string;
  status: 'running' | 'idle' | 'waiting' | 'stopped' | 'error';
  metadata?: Record<string, unknown>;
};
```

这样：

1. 对象可长期存在
2. 运行时句柄可以断开/重连/替换
3. 不会把 UI 节点和底层进程耦死

### 13.6 时间片与事实层：`FocusRun + EventTape`

```ts
type FocusRun = {
  id: string;
  spaceId: string;
  timeblockId?: string;
  name?: string;
  startedAt: string;
  endedAt?: string;
  eventTapeId: string;
};

type EventTapeEvent = {
  id: string;
  tapeId: string;
  ts: string;
  sourceType: 'user' | 'agent' | 'terminal' | 'system' | 'plugin';
  sourceRef?: string;
  eventType: string;
  raw: unknown;
};
```

这里的原则要始终保持：

- `EventTape（事件带）` 是事实源
- `summary / timeline / relations（摘要 / 时间线 / 关联）` 都是派生

---

## 14. 节点与视图的关系（Node vs View，节点与视图关系）

用户提到“每个节点都有自己的 UI”，这个方向是对的，但要拆清楚层次：

### 14.1 正确拆法

不是：

- 节点 = 一整块写死的 UI

而是：

- 节点类型定义自己的 `UI contract（界面契约）`

例如一个插件型节点可以提供：

1. `card renderer（卡片渲染）`
2. `detail renderer（详情渲染）`
3. `full view renderer（完整视图渲染）`
4. `actions（动作）`
5. `runtime hooks（运行时钩子）`

```ts
type ObjectTypeProvider = {
  objectType: string;
  displayName: string;
  defaultIcon?: string;
  renderCard?: string;
  renderInspector?: string;
  renderFullView?: string;
  availableActions?: string[];
};
```

这样感知节点、执行节点、结果节点、文档节点都可以有自己的 UI，但系统底层仍然统一。

---

## 15. 插件模型应怎么接（Plugin Model，插件模型）

### 15.1 插件不只是“加一个按钮”

后续更好的插件模型应允许插件注册：

1. `object types（对象类型）`
2. `view types（视图类型）`
3. `inspectors（详情面板）`
4. `actions / commands（动作 / 命令）`
5. `runtime providers（运行时提供者）`
6. `parsers / derived projections（解析器 / 派生投影）`

### 15.2 一个更合理的产品边界

并不是每个节点都直接“跑一个任意进程”。

更稳的做法是：

1. 节点对象定义语义
2. 节点可选地绑定 `runtime provider`
3. `runtime provider` 再去管理：
   - PTY
   - SSH
   - Agent process
   - 外部服务

这样自由度很高，但不会把系统打散。

---

## 16. 当前综合判断（Current Synthesis，当前综合判断）

如果把用户现在的想法压成一句最准确的话：

> ExoMind 的目标不是做一个固定三栏 app，而是做一个支持插件扩展、容器自由组织、可承载运行时节点与工作过程回放的 `containerized work cognition space（容器化认知工作空间）`。

更具体一点：

1. `WorkbenchSpace` 是长期持久的工作场景
2. 外层是 `pane/container graph（面板/容器图）`
3. 内层允许 `canvas container（画布容器）`
4. 节点对象与运行时绑定分离
5. 每次专注记录为 `FocusRun`
6. 所有事实沉淀到 `EventTape`
7. `Signal Network` 只是同一底层对象的一个派生视图

---

## 17. `SessionObject` vs `AgentNodeObject`（会话对象 vs Agent 节点对象）

这是当前最关键的建模分歧之一。

### 17.1 两者分别是什么

#### `SessionObject`

`SessionObject（会话对象）` 更像一次“持续交互过程”的语义对象。

它关心的是：

1. 谁在和谁交互
2. 这段交互从什么时候开始
3. 当前状态如何（running / waiting / stopped）
4. 历史消息、历史输出、上下文、恢复点

典型例子：

- 一个 Claude/Codex 对话
- 一个 SSH shell 会话
- 一个 PTY 终端会话
- 一个长期的人机对话

#### `AgentNodeObject`

`AgentNodeObject（Agent 节点对象）` 更像工作台画布上的一个“可视化节点 / 能力节点”。

它关心的是：

1. 这个节点代表什么能力/角色
2. 在画布里放在哪里
3. 它和哪些节点有关系
4. 它当前展示成什么 UI

典型例子：

- 规划 Agent 节点
- 执行 Agent 节点
- 评审 Agent 节点
- 感知节点 / 工具节点 / 结果节点

### 17.2 为什么要分开

如果分开，得到的好处是：

1. **一个 Agent 节点可以挂多个 session**
   - 例如同一个“评审 Agent”节点，上午一次会话，下午一次会话
2. **一个 session 可以脱离画布继续存在**
   - 会话是历史与事实的一部分，不应因为节点被删除就丢掉
3. **节点强调“空间中的角色与关系”，会话强调“时间中的过程”**
4. 更适合你要的“长期工作空间 + 多次专注片段”模型

一句话：

- `AgentNodeObject` 更偏空间语义
- `SessionObject` 更偏时间语义

### 17.3 为什么也可能不分开

如果不分开，模型会更简单：

1. 画布上一个 Agent 节点就是一个会话
2. UI、状态、消息、运行时都挂在同一个对象上
3. MVP 会更快

但问题也会更快出现：

1. 节点删了，会不会把历史删掉？
2. 一个 Agent 长期存在，但中间经历多轮会话，怎么表示？
3. “角色”与“某次运行”会混在一起

### 17.4 当前更推荐的结论

我现在更倾向：

- **逻辑上分开**
- **产品上可以先合并显示**

也就是底层建模：

```text
AgentNodeObject 1 --- N SessionObject
```

但在前期 UI 上，可以表现得像“点开一个 Agent 节点，就看到它当前/最近的 session”。

这样既不把未来做死，也不让 MVP 太复杂。

---

## 18. “是不是所有东西都是容器？”（Everything as Container?，万物皆容器？）

用户提出的方向很重要：

- 文档是不是容器？
- 图片显示是不是容器？
- 对话是不是容器？
- 任务是不是容器？

### 18.1 需要区分两种“容器”

这里最容易混淆，所以必须拆开：

#### A. `Layout container（布局容器）`

它的职责是“放东西”：

- panel
- split
- tabs
- floating
- canvas host

它是 UI 布局结构的一部分。

#### B. `Content object（内容对象）`

它的职责是“被展示 / 被操作”：

- document
- image
- conversation
- task
- note
- agent node
- result

它不一定是容器，它首先是语义对象。

### 18.2 有些内容对象自己又是“内容容器”

比如：

- `DocumentObject（文档对象）` 里面可以嵌多媒体
- `ConversationObject（对话对象）` 里面有消息流
- `TaskObject（任务对象）` 里面有步骤、子任务、状态

这类可以叫：

- `semantic container（语义容器）`

所以更准确的说法不是“万物皆布局容器”，而是：

> 有些对象本身是语义容器，但不是所有对象都应该当成布局容器。

这个区分非常重要，不然模型会乱掉。

---

## 19. 和“超系统窗口”的区别（Difference from isolated windows，与隔离窗口的区别）

用户提出了一个很好的对比：

- 如果只是做“很多窗口”
- 但窗口之间数据不互通
- 那就只是一个外壳系统，不是 ExoMind 想要的东西

### 19.1 ExoMind 更像“共享底层图谱，多种视图/容器去看”

ExoMind 更合理的方向应该是：

1. 底层不是多个孤立窗口状态
2. 底层是一张共享的 `work graph / signal graph（工作图 / 信号图）`
3. 不同容器、不同视图、不同窗口，只是在看这张大图的不同切片

### 19.2 这张大图至少包含几类边

```text
Person / Team / Project / Space
  -> Task
  -> FocusRun
  -> Session
  -> Note / Document / Resource
  -> AgentNode / SensorNode / ResultNode
  -> SignalRoute / Relation
```

也就是说：

- 任务和会话互相关联
- 文档和任务互相关联
- Agent 和结果互相关联
- 时间块和事件带互相关联

这才是你说的“底层是一整张大的数据网络”。

### 19.3 `Signal Network` 在这张图里的位置

`Signal Network` 更像是这张图的一种“关系投影视图”：

- 当你关心信号流时，它显示拓扑
- 当你关心任务推进时，它显示任务/进度
- 当你关心回顾时，它显示时间线/回放

所以真正统一的不是“窗口”，而是：

- `shared graph（共享图谱）`
- `shared objects（共享对象）`
- `shared event tape（共享事件带）`

窗口、面板、画布，都只是上层承载形式

---

## 20. 共享底层图谱：核心节点类型（Shared Graph Node Types，共享图谱节点）

用户已经明确提出一个关键要求：

- 有些对象偏静态
- 有些对象偏动态

这个区分必须进入底层模型。

### 20.1 一层分类：静态对象 vs 动态对象

#### A. `Static semantic objects（静态语义对象）`

这类对象通常长期存在，变化慢，偏“内容 / 结构 / 资源”：

1. `DocumentObject（文档对象）`
2. `FileObject（文件对象）`
3. `ImageObject（图片对象）`
4. `VideoObject（视频对象）`
5. `AudioObject（音频对象）`
6. `NoteObject（笔记对象）`
7. `TaskObject（任务对象）`
8. `GoalObject（目标对象）`
9. `PersonObject / TeamObject / ProjectObject（人 / 团队 / 项目对象）`
10. `KnowledgeChunkObject（知识片段对象）`

这些对象更像“被长期管理和引用的内容实体”。

#### B. `Dynamic runtime objects（动态运行时对象）`

这类对象会启动、停止、等待、输出，偏“过程 / 活动 / 执行”：

1. `SessionObject（会话对象）`
2. `AgentNodeObject（Agent 节点对象）`
3. `TerminalNodeObject（终端节点对象）`
4. `SshNodeObject（SSH 节点对象）`
5. `SensorNodeObject（感知节点对象）`
6. `ExecutionNodeObject（执行节点对象）`
7. `ResultNodeObject（结果节点对象）`
8. `FocusRun（专注片段）`
9. `SignalRouteObject / EdgeObject（信号路由 / 关系边对象）`

这些对象更像“会动、会变、会产生日志的实体”。

### 20.2 再往上一层：哪些是“图节点”，哪些只是对象

并不是所有对象都必须直接显示成画布节点。

更合理的分层是：

1. **Object layer（对象层）**
   - 所有语义对象都在这里
2. **Graph projection layer（图投影层）**
   - 某些对象在当前视图里被投影成节点

例如：

- `ImageObject` 在资源面板里是列表项
- 在画布里也可以被投影成一个资源节点

这样模型更灵活。

### 20.3 当前推荐的核心对象族

如果只保留最核心的一组，建议先收敛为：

```text
Identity / Scope
  - PersonObject
  - TeamObject
  - ProjectObject
  - WorkbenchSpace

Planning / Knowledge
  - GoalObject
  - TaskObject
  - NoteObject
  - DocumentObject
  - ResourceObject

Runtime / Execution
  - AgentNodeObject
  - SessionObject
  - TerminalNodeObject
  - SshNodeObject
  - SensorNodeObject
  - ResultNodeObject
  - FocusRun

Evidence / History
  - EventTape
  - EventTapeEvent
```

---

## 21. 共享底层图谱：核心关系类型（Shared Graph Edge Types，共享图谱关系）

如果底层是一整张大图，那么必须明确边的语义，而不是全都叫“关联”。

### 21.1 建议的关系类型

#### 结构关系（Structural relations，结构关系）

1. `contains（包含）`
   - `WorkbenchSpace contains TaskObject`
   - `DocumentObject contains KnowledgeChunkObject`
2. `owns（拥有）`
   - `ProjectObject owns WorkbenchSpace`
   - `TeamObject owns DocumentObject`
3. `parent_of / child_of（父子）`
   - 任务树、目标树、文档块树

#### 引用关系（Reference relations，引用关系）

4. `references（引用）`
   - 笔记引用任务
   - 任务引用文档
   - 会话引用文件
5. `derived_from（派生自）`
   - 结果节点派生自某次 session
   - summary 派生自 EventTape

#### 运行关系（Runtime relations，运行关系）

6. `runs_as（运行成）`
   - `AgentNodeObject runs_as SessionObject`
7. `binds_to（绑定到）`
   - `TerminalNodeObject binds_to RuntimeBinding`
8. `produces（产出）`
   - session 产出 result
   - sensor 产出 signal
9. `consumes（消费）`
   - agent 消费 task / signal / document

#### 编排关系（Orchestration relations，编排关系）

10. `depends_on（依赖）`
11. `blocks（阻塞）`
12. `delegates_to（委托）`
13. `informs（提供信息给）`

#### 时间关系（Temporal relations，时间关系）

14. `occurred_in（发生于）`
   - session occurred_in focus run
   - event occurred_in event tape
15. `active_during（活跃于）`
16. `replayed_from（回放自）`

### 21.2 为什么要明确边类型

因为不同视图其实是在消费不同类型的边：

- `Task view` 主要看 `depends_on / blocks / parent_of`
- `Signal Network view` 主要看 `produces / consumes / informs / binds_to`
- `Replay view` 主要看 `occurred_in / active_during / derived_from`

这正好支持“同一图谱，多种派生视图”。

---

## 21.5 对 `C 方案` 的进一步澄清（Clarifying Hybrid Model，澄清混合模型）

用户对 “`owns（拥有）`” 这个词提出疑问是合理的。

### 21.5.1 `C 方案` 不是“空间拥有一切”

`C 方案（Space = 节点 + 子图视角）` 的真正意思不是：

- 一个 `WorkbenchSpace` 把所有任务、文档、图片、会话都“装进去”

而是：

1. `WorkbenchSpace` 本身是图中的一个真实对象节点
2. 它同时定义了“当前工作要看哪一部分图”的一个子图视角

也就是：

```text
Space = anchor object（锚点对象）
      + view lens（视图透镜）
```

### 21.5.2 为什么需要 `anchor object（锚点对象）`

如果 `WorkbenchSpace` 只是一个纯过滤器，那么下面这些东西没有稳定归属点：

1. 布局预设
2. 打开的视图集合
3. 固定停靠的节点/面板
4. 空间级偏好
5. 这个空间下的 `FocusRun`

这些东西都需要“挂在某个地方”。

所以 `Space` 必须是一个真实对象。

### 21.5.3 为什么还需要 `view lens（子图视角）`

如果 `WorkbenchSpace` 只是一个封闭容器，就会出现几个问题：

1. 一个文档是否要复制到多个空间？
2. 一个任务同时服务个人空间和团队空间时怎么办？
3. 一个历史会话和多个任务都相关时怎么办？

这会把共享图谱切成很多小孤岛。

所以 `Space` 还必须是一个“看图规则”：

- 某些对象虽然不归属于这个空间
- 但在当前空间里是可见、可操作、可关联的

### 21.5.4 更好的词：不要让 `owns` 承担太多含义

如果“拥有”这个词太重，我建议在 `Space` 这里直接不用它，而改成三类更精确的关系：

#### A. `space-local（空间本地）`

表示这个东西是空间自己的长期资产。

例子：

- 布局预设
- 空间级 pinned views（固定视图）
- 空间级 pinned nodes（固定节点）
- 空间级便签
- FocusRun

#### B. `visible-in-space（在空间中可见）`

表示这个对象当前在这个空间里被纳入工作视野，但不一定“属于”它。

例子：

- 某个项目任务
- 某个共享文档
- 某个历史会话
- 某个结果节点

#### C. `occurred-in-focus-run（发生在某次专注中）`

表示这个对象/事件在某个时间片里发生或活跃。

例子：

- session occurred in focus run
- terminal output occurred in focus run
- event occurred in focus run

### 21.5.5 用“房间”来理解 `C 方案`

`WorkbenchSpace` 更像一个工作房间：

1. 房间里有自己的家具
   - 这对应 `space-local`
2. 房间里当前摆出来看的资料，不一定是房间独有的
   - 这对应 `visible-in-space`
3. 房间里某天上午发生过一次会议/工作过程
   - 这对应 `FocusRun / EventTape`

所以房间不是一个死文件夹，也不是一个纯过滤器。

它是：

- 有自己布置的地方
- 但又能把全局图谱里相关的东西拉进来看

### 21.5.6 因此，`C 方案` 的正确表达

更准确的表达应该是：

> `WorkbenchSpace` 是共享底层图谱中的一个锚点节点，同时也是一个对子图的工作视角；它只对“空间本地资产”负责，而对其他对象主要通过“可见 / 引用 / 发生于”关系接入。

这比“空间拥有一切”更符合用户目标，也更符合 ExoMind 想要的一张大图互通模型。

---

## 22. 端适配：桌面 / 平板 / 手机如何统一（Responsive Projection，响应式投影）

用户提出的担忧是对的：

- 电脑上可以同时开很多视图
- 手机上不可能照搬

所以需要统一心智，但不同投影。

### 22.1 不应统一“布局”，应统一“对象与视图模型”

不应该要求：

- 手机和桌面长得一样

应该要求：

- 手机、平板、桌面访问的是**同一组对象**
- 只是显示方式不同

也就是说，统一的是：

1. `WorkbenchSpace`
2. `ViewInstance`
3. `WorkbenchObject`
4. `FocusRun / EventTape`

变化的是：

1. 同时可见的容器数
2. 导航方式
3. 默认进入的视图预设

### 22.2 推荐的端投影模型

#### Desktop（桌面端）

目标：

- 多容器并行
- 自由编排
- 高信息密度

推荐：

- 完整 `container graph`
- 多 `panel + canvas host + floating`
- 右侧 detail panel / overlay 正常使用

#### Tablet（平板端）

目标：

- 保留一定多栏能力
- 减少同时可见复杂度

推荐：

- `master-detail + optional canvas`
- 2 栏优先，必要时 3 栏
- 画布视图和详情视图按场景切换

#### Mobile（手机端）

目标：

- 以任务流和当前专注为中心
- 降低并行可见量

推荐：

- `one active surface（单活跃工作面）`
- 底部 tab / 上下文切换
- 详情改为 `sheet / drawer`
- 画布改为“全屏子视图”

这和 ExoMind 当前已有模式是对齐的：

- 桌面：sidebar + content
- 手机：MobileShell + bottom tab
- 详情：desktop panel / mobile drawer

### 22.3 更统一的抽象：不是 WindowAbstraction，而是 `SurfaceAbstraction`

此前 `WorkspaceSlot` 更偏窗口/标签抽象。

但对你现在的产品来说，更高一层的抽象应是：

```ts
type SurfaceSlot = {
  id: string;
  mode: 'panel' | 'tab' | 'drawer' | 'window' | 'overlay' | 'canvas-fullscreen';
  viewId: string;
  visible: boolean;
};
```

因为真正变化的不是“是不是窗口”，而是：

- 这个 view 当前通过什么 surface（承载面）被呈现

桌面可能是 `panel`
手机可能是 `drawer`
同一个 view 仍然是同一个 view

### 22.4 当前推荐的跨端结论

最稳的跨端说法应该是：

1. **同一底层图谱**
2. **同一 view/object 模型**
3. **不同设备用不同 surface projection（承载投影）**

这样：

- 桌面不会绑死手机
- 手机也不会变成功能残缺版
- 只是“同一系统，不同尺寸下看同一世界的不同方式”
