# Agent Workbench 画布主对象讨论笔记（Draft，草稿）

> 日期：2026-03-30
> 状态：已完成讨论收敛，作为 `#728` 改写依据（discussion converged，作为 issue 改写依据）
> 用途：本笔记用于压缩上下文（context compression，上下文压缩）、保存阶段性理解，并作为现有 Epic issue 改写草案的本地依据。

---

## 1. 已确认的用户意图（Confirmed Intent，已确认意图）

### 1.1 范围主轴

这次的主轴不是“通用 terminal workbench（通用终端工作台）”本身，而是：

- `Agent workbench（Agent 工作台）`
- `Agent Hub / Signal Network（Agent 中心 / 信号网络）` 的下一阶段产品化
- `terminal view（终端视图）` 与 `structured view（结构化视图）` 的融合
- 多个 `agent session（Agent 会话）`、`SSH session（SSH 会话）`、`terminal session（终端会话）` 的统一纳管

### 1.2 真相源（Source of Truth，事实源）

已确认的原则：

- `raw terminal stream（原始终端流）` / `raw output stream（原始输出流）` 是事实源
- `structured parse result（结构化解析结果）` 是派生层

这意味着：

1. 任何结构化卡片、状态摘要、工具调用时间线，都不能替代原始流
2. 持久化设计应优先保证原始会话日志、原始输出片段、输入事件不丢失
3. 后续 parser（解析器）可以迭代，但历史事实层不应被重写

### 1.3 当前最小需求（MVP，最小可行产品）

用户此轮真正的最小需求已经收缩为：

1. 在 ExoMind 内**持久化管理**多个 `agent / SSH / terminal` 会话
2. 能把多个会话纳入同一个“工作台（workbench，工作台）”里统一查看与调度
3. 结构化解析是下一层加成，不是第一步的阻塞项

---

## 2. ExoMind 当前基础（Current Foundations，当前基础）

### 2.1 已有运行时能力

ExoMind 当前并不是从零开始：

- 已有 `xterm.js` 前端终端组件
- 已有 `portable-pty + axum + SSE` 的 PTY 运行时链路
- 已有 `AgentSession（统一会话抽象）` 方向的设计文档
- 已有 `Signal Network（信号网络）` / `Topology（拓扑）` 页面
- 已有 `now-workbench-overlay（当下工作台悬浮窗）`
- 已有 `desktop windowing（桌面多窗口）` 的研究议题

### 2.2 关键缺口

当前缺口不是“能不能开终端”，而是下面这层产品模型还没真正长出来：

1. 缺一个统一的 `workbench space（工作台空间）` 概念
2. 缺一个把 `session / task / note / artifact / topology` 放进同一画布的容器模型
3. 缺一个明确的“事实层 vs 派生层”分层存储设计
4. 缺一个页面级的“主对象（primary object，主对象）”定义

---

## 3. 参考项目结论（Reference Findings，参考结论）

### 3.1 Tabby

`Tabby` 更像“强终端内核（terminal core，终端核心）”参考。

值得借鉴的点：

- `Profile -> NewTabParameters -> Tab` 的启动链路清晰
- `BaseSession（基础会话）` 统一抽象到位
- `SSHSession / SSHShellSession` 分层明确
- `SSHMultiplexerService（SSH 复用服务）` 说明 SSH 不应简单等于一个 terminal tab（终端标签）
- `SplitContainer（分屏容器）` 说明终端 UI 需要树状布局，而不是平铺数组

对 ExoMind 的启发：

- `SSH connection（SSH 连接）`、`terminal instance（终端实例）`、`workbench node（工作台节点）` 应拆层
- ExoMind 后续需要复用连接（reuse connection，连接复用）与分屏树，而不只是“开多个终端”

### 3.2 Electerm

`electerm` 更像“多连接工作台（multi-connection workspace，多连接工作台）”参考。

值得借鉴的点：

- `tabs[] + activeTabId + layout` 的工作台状态模型
- `SSH / SFTP / terminal` 被统一纳入 workspace（工作空间）
- 存在 `split view（分栏视图）`、批量输入、连接资产管理

对 ExoMind 的启发：

- 工作台不能只理解为“一个终端”
- 多对象并存时，需要一个上层 `workspace store（工作区状态存储）`

### 3.3 Happy / Hapi

`Happy / Hapi` 更像“原始流 -> 结构化会话协议（session protocol，会话协议）”参考。

关键发现：

1. `Happy` 把 provider 原始日志映射为 `SessionEnvelope（会话信封）`
2. 它不是直接抛弃原始流，而是做 `mapping（映射）`
3. `tool-call-start / tool-call-end / text / turn-start / turn-end` 这种结构，是从 provider 输出派生出来的
4. `Hapi` 在 hub 侧把：
   - `SessionCache（会话缓存）`
   - `MessageService（消息服务）`
   - `TerminalRegistry（终端注册表）`
   分成了三个层次

对 ExoMind 的启发：

- ExoMind 的结构化层应该学习 `raw stream（原始流） -> normalized envelopes（标准化事件） -> UI projections（界面投影）`
- `terminal transport（终端传输）`、`session model（会话模型）`、`derived presentation（派生展示）` 需要拆开

---

## 4. 可关联的现有 GitHub Issue（Existing Issues，可关联的现有议题）

当前看下来，后续 Epic issue（总设计议题）至少应关联这些已有 issue，而不是再开一堆子 issue：

- `#385` `feat(agent-hub)`：Claude / Codex 接入、流式会话、动态 Agent 生命周期
- `#646` `research(desktop-windowing)`：页面即窗口、多窗口/聚合/回退模型
- `#728` `epic(signal-network)`：信号网络从只读拓扑走向交互式编排
- `#382` `feat(agent-hub)`：拓扑图手动布局持久化
- `#392` `feat(agent-hub)`：Agent/Actor 运行态监控
- `#372` `feat(agent-hub)`：ECS peer / relay / topology 可观测性
- `#535` `tech-debt`：AgentsPage 巨型页面拆分
- `#702` `bug(timeblock/tauri)`：独立窗口状态同步不一致

初步判断：

- `#385` 是“会话/运行时”底座
- `#646` 是“窗口/工作台容器”底座
- `#728` 是“画布/编排视图”底座

---

## 5. 工作台主对象候选（Primary Object Candidates，主对象候选）

### 方案 A：`Session-centered（会话中心）`

页面以 `session（会话）` 为中心展开，其他对象都挂在会话旁边。

优点：

- 最贴近当前已有实现
- 最容易先把多个终端持久化起来

缺点：

- 笔记、任务、依赖关系、Agent 间通信会退化成附件
- 不符合“一个比较大的画布，什么都能放进去”的心智

### 方案 B：`Task-centered（任务中心）`

页面以 `task（任务）` 为中心，终端与 Agent 都是任务执行器。

优点：

- 对交付型工作很强

缺点：

- 对探索型、多线程并行、多 Agent 协作并不自然
- SSH 运维、资料查阅、临时笔记都不一定天然属于某个 task

### 方案 C：`Workspace-centered / Space-centered（工作区中心 / 空间中心）`

页面根对象不是终端、不是任务、也不是单个会话，而是：

`WorkbenchSpace（工作台空间）`

在这个空间里，`session（会话）`、`task（任务）`、`note（笔记）`、`artifact（工件）`、`topology view（拓扑视图）` 都是可摆放对象。

优点：

- 最符合“大画布”心智
- 能同时容纳终端工作、结构化摘要、任务调度、笔记备忘
- 与 `desktop windowing（桌面多窗口）`、`Signal Network（信号网络）`、`Agent Hub` 都更容易对齐

缺点：

- 抽象层更高，若直接全做，容易过大

---

## 6. 当前推荐（Current Recommendation，当前推荐）

### 6.1 页面根对象

我当前推荐：

**页面主对象 = `WorkbenchSpace（工作台空间）`**

不是：

- 单个 `terminal（终端）`
- 单个 `session（会话）`
- 单个 `task（任务）`

而是一个**围绕某次工作上下文展开的画布空间**。

### 6.2 画布上的一等公民（First-class Objects，一等对象）

在 `WorkbenchSpace` 内，第一批应支持的对象建议是：

1. `SessionNode（会话节点）`
   - `AgentSessionNode（Agent 会话节点）`
   - `SshSessionNode（SSH 会话节点）`
   - `TerminalSessionNode（终端会话节点）`
2. `TaskCard（任务卡片）`
3. `NoteCard（笔记卡片）`
4. `StructuredPanel（结构化面板）`
   - 这是某个 session 的派生视图，不是事实源

### 6.3 关键分层

建议把模型拆成三层：

#### Layer 1: `Source layer（事实层）`

- 原始输入
- 原始终端输出
- 原始 agent 流事件

#### Layer 2: `Session layer（会话层）`

- 会话身份
- 会话状态
- 会话上下文（issue / branch / worktree / machine / ssh target）

#### Layer 3: `Projection layer（投影视图层）`

- 结构化摘要
- 工具调用时间线
- 待办提取
- 错误/等待输入标记
- 卡片化 UI

这样可以保证：

- 先做 Layer 1 + Layer 2，就能交付 MVP
- Layer 3 以后再增强，不会把底层设计做死

---

## 7. 一个更精确的表述（Sharper Framing，更精确的表述）

如果必须用一句话回答“工作台页面的主对象是什么”：

> **主对象不是终端，而是 `WorkbenchSpace（工作台空间）`；真正的一等操作对象则是挂在空间里的 `SessionNode（会话节点）`。**

也就是：

- 页面是 `space-first（空间优先）`
- 运行时是 `session-first（会话优先）`
- 数据可信性是 `raw-stream-first（原始流优先）`

这个三层说法，和你现在的需求是对齐的。

---

## 8. 建议的实现收敛顺序（Suggested Sequence，建议收敛顺序）

### Phase 0：模型先行（不急着做重 UI）

先补：

1. `WorkbenchSpace` 数据模型
2. `SessionNode` 持久化模型
3. `raw event log（原始事件日志）` 存储模型

### Phase 1：先把终端/会话纳入空间

只做：

1. 多 `session` 持久化
2. 多 `terminal/SSH` 会话挂进一个 `space`
3. 基础画布布局保存

### Phase 2：再做结构化派生

在不动事实层的前提下，增加：

1. `structured summary（结构化摘要）`
2. `tool timeline（工具时间线）`
3. `waiting-input（等待输入）`、`error state（错误状态）`、`todo extraction（待办提取）`

---

## 9. 当前还需要继续讨论的问题（Open Questions，开放问题）

下一轮最值得继续收敛的问题只有一个：

**一个 `WorkbenchSpace` 到底对应什么边界？**

备选边界目前有三种：

1. 对应一个 `issue / mission（议题 / 任务使命）`
2. 对应一个 `work episode（工作时段 / 一次工作上下文）`
3. 对应一个 `project workspace（项目工作区）`

这三个边界会直接决定：

- 一个空间里允许放多少 session
- 空间与 GitHub issue 的绑定关系
- 空间切换是否像“页面”，还是像“标签组 / 房间”

---

## 10. 新增澄清：时间块与工作区的关系（New Clarification，新增澄清）

用户进一步确认后，`WorkbenchSpace（工作台空间）` 的边界应更偏：

- `work context（一次工作的上下文）`

而不是直接等同于：

- 单个 `GitHub issue（议题）`
- 单个 `terminal tab（终端标签）`

### 10.1 工作区应是持久的

`WorkbenchSpace` 更像一个长期存在的“工作房间 / 工作桌面（workspace room / work desk）”：

1. 它可以长期存在，不随某次专注开始或结束而消失
2. 它可以与任务相关，但不被某个任务完全绑定
3. 用户可以在开始工作时：
   - 创建新的 `space（空间）`
   - 或复用已有 `space（空间）`

### 10.2 时间块不是空间本身，而是空间中的一次记录窗口

当用户开始 `focus timer（专注计时）` / `time block（时间块）` 时：

1. 当前时间块会绑定到某个 `WorkbenchSpace`
2. 在这个时间段里发生的事情会被记录下来
3. 这段记录后续应支持：
   - `replay（回放）`
   - `history lookup（历史检索）`
   - `relation discovery（关联发现）`

也就是说：

- `WorkbenchSpace` 是持久容器
- `FocusRun / WorkEpisode（专注运行 / 工作片段）` 是时间边界内的一次工作过程记录

### 10.3 用户真正想要的是“只打开这一个软件就能干活”

这意味着 ExoMind 的目标不是只做：

- 终端管理器
- Agent 面板
- 笔记工具

而是逐步收敛成一个“工作认知操作系统（work cognition operating surface）”：

1. 浏览器/文档/终端/Agent/笔记等工作相关内容能被纳入同一工作区
2. 在专注过程中，系统持续记录“发生了什么”
3. 工作结束后，不只是保留结果，还保留过程，并能回看与发现联系

### 10.4 由此带来的模型变化

仅有 `WorkbenchSpace -> SessionNode` 两层还不够，需要再补一层：

```text
WorkbenchSpace（持久工作区）
  ├─ Objects（空间内对象）
  │   ├─ SessionNode
  │   ├─ TaskCard
  │   ├─ NoteCard
  │   └─ ResourceLink / File / BrowserRef
  └─ FocusRuns（专注片段 / 时间块工作过程）
      ├─ startAt / endAt
      ├─ bound timeblock id
      ├─ event tape（事件带）
      └─ replay index（回放索引）
```

其中：

- `Space` 回答“我在哪个工作上下文里干活”
- `FocusRun` 回答“这段时间里实际发生了什么”

### 10.5 新增澄清：空间比任务更持久

用户进一步确认：

1. 上午做“Agent 工作台设计”、下午做“语音输入修复”，可以属于**同一个** `WorkbenchSpace`
2. 它们只是同一空间下的两个 `FocusRun`
3. `agent conversation（Agent 对话）`、页面布局、资源摆放，更偏空间级持久对象

这意味着：

- `Space != Task（空间不等于任务）`
- `Space != Issue（空间不等于单个议题）`
- `FocusRun` 才是和具体时间块、专注段直接绑定的东西

### 10.6 空间更像“布局与资源编排层”

用户给出的新线索非常明确：工作空间更像在保存下面这些长期状态：

1. `layout preset（布局预设）`
   - 页面怎么排
   - 哪些 panel（面板）开着
   - 哪些 session node（会话节点）放在哪
2. `resource arrangement（资源摆放）`
   - 终端
   - 笔记
   - 任务卡片
   - 参考资料
3. `persistent conversations（持久对话）`
   - Agent 对话上下文
   - SSH/terminal 会话上下文

因此 `WorkbenchSpace` 不只是逻辑容器，也应是：

- `layout container（布局容器）`
- `resource container（资源容器）`
- `conversation container（对话容器）`

### 10.7 空间数量模型

当前更合理的产品假设是：

1. 系统通常同时只有一个 `active space（激活空间）`
2. 但允许存在多个 `spaces（空间）`
3. 多空间的切分，更像：
   - `personal space（个人空间）`
   - `team space（团队空间）`
   - `project space（项目空间）`

而不是：

- 每个任务一个空间
- 每次专注一个空间

这会直接影响后续 Epic 的表述：

- 空间是“长期工作场景”
- 时间块是“空间中的工作片段”

### 10.8 新增澄清：布局模型不是三选一，而是多投影（multi-projection，多种投影）

用户进一步确认：

1. 需要 `pure canvas mode（纯画布模式）`
2. 也需要 `docked mode（停靠模式）`
3. 也允许表现得像 `IDE layout（类 IDE 固定布局）`
4. 整体上，各种组件的排布应保持较高自由度

这意味着布局层不应该被建模成：

- “系统只支持纯白板”
- 或“系统只支持固定三栏 IDE”

而更应建模成：

`WorkbenchSpace + LayoutSchema + ViewMode`

```text
WorkbenchSpace
  ├─ objects（对象集合）
  ├─ layout schema（布局结构）
  ├─ zones（区域 / 停靠槽）
  └─ view mode（视图模式）
       ├─ canvas
       ├─ hybrid
       └─ docked
```

其中：

- `objects` 是空间里的真实对象
- `layout schema` 描述对象如何被摆放、停靠、分组
- `view mode` 决定当前以哪种方式投影同一空间

### 10.9 当前推荐的布局结论

当前更合理的结论不是选某一种布局“获胜”，而是：

1. **底层主模型** 应该是 `freeform object graph（自由对象图）`
2. **默认产品入口** 建议采用 `hybrid mode（混合模式）`
   - 中间：`infinite canvas（无限画布）`
   - 左右：`dock panels（停靠面板）`
3. `IDE layout` 更适合被视为一种受限的 `hybrid preset（混合预设）`
4. `pure canvas` 则是一种更极端的自由工作视图

也就是说：

- 画布能力是底座
- 停靠区是高频工作效率层
- IDE 风格只是其中一种落地外观，不应成为唯一真模型

这样才和用户目标一致：

- 既能自由摆
- 又不会因为全自由而失去高频操作效率
- 还能随着产品演进逐步增加不同工作模式

### 10.10 新增澄清：三栏默认语义

用户进一步确认了 `hybrid mode（混合模式）` 下三栏的大致语义：

#### 左栏：任务推进轴（task progression rail，任务推进侧栏）

左侧不应优先放 `sessions（会话列表）`，而应更偏：

1. 当前工作区要完成哪些任务
2. 今天 / 本次专注要完成哪些任务
3. 任务拆分步骤（steps）
4. 当前进度（progress）

也就是：

- 左侧更接近 `plan / todo / progress（计划 / 待办 / 进度）`
- 而不是纯 `session inventory（会话清单）`

#### 中栏：工作画布（work canvas，工作画布）

中间区域是工作台的主舞台，承载：

1. `Agent nodes（Agent 节点）`
2. `Terminal / SSH nodes（终端 / SSH 节点）`
3. 各种工作对象与资源
4. 多种渲染方式：
   - `free canvas（自由画布）`
   - `network / topology view（网络 / 拓扑视图）`

#### 右栏：结果 / 状态 / 详情区（待继续收敛）

用户目前倾向右侧承载：

1. `final result（最终结果）`
2. `status（状态）`
3. 可能也包含某些详情内容

这一侧的优先级还需要继续讨论：

- 是偏 `selection inspector（选中对象详情）`
- 还是偏 `run summary / outcome（运行摘要 / 结果总览）`

### 10.10.1 新增修正：三栏只是默认预设，不是结构真相

用户进一步明确指出：

- 现有“三栏”讨论**仍然不够自由**
- 更理想的方向是像 `IDE panes（IDE 面板框）` 一样，可以自由组织每个框里放什么内容
- 因此左/中/右不应成为底层强约束

这意味着：

1. `left rail / center canvas / right panel` 只能是 `default preset（默认预设）`
2. 真正的底层模型应该是 `generic container system（通用容器系统）`
3. 用户应能自由决定：
   - 哪个容器里放任务
   - 哪个容器里放 session
   - 哪个容器里放结果
   - 哪个容器里放网络图

### 10.10.2 更底层的布局抽象：容器树 / 面板图

因此，布局层更好的抽象不应是：

- 页面 = 左栏 + 中栏 + 右栏

而应是：

- 页面 = `container graph（容器图）`

```text
WorkbenchSpace
  ├─ objects（真实对象）
  ├─ layout graph（布局图）
  │   ├─ ContainerNode
  │   ├─ SplitNode
  │   ├─ TabsNode
  │   ├─ FloatingNode
  │   └─ DockZone
  └─ view presets（视图预设）
      ├─ default-hybrid
      ├─ pure-canvas
      ├─ network-focus
      └─ ide-focus
```

其中每个 `ContainerNode（容器节点）` 里装的不是固定“左栏内容”，而是：

- `TaskListView（任务列表视图）`
- `SessionListView（会话列表视图）`
- `CanvasView（画布视图）`
- `NetworkView（网络视图）`
- `InspectorView（详情视图）`
- `OutcomeView（结果视图）`
- `NoteView（笔记视图）`

### 10.10.3 新的产品判断

更准确地说：

1. **工作台的真模型不是“三栏工作台”**
2. **工作台的真模型是“自由组织的容器化工作空间”**
3. 三栏、IDE、纯画布，都只是这套容器系统上的 `layout preset（布局预设）`

这样才能满足用户目标：

- 足够自由
- 可高度个性化
- 仍能提供默认好用的起始布局

### 10.10.4 新增澄清：容器至少应分两类

用户进一步明确了一个更实用的方向：

- 不只是“容器里放视图”
- 而是容器本身也应有不同工作语义

当前至少应抽象出两类容器：

#### A. `Auto-layout container（自动布局容器）`

这类容器更像 IDE 的 pane / split / tabs：

1. 自动参与分栏、停靠、铺满
2. 适合放：
   - `TaskListView`
   - `SessionListView`
   - `InspectorView`
   - `OutcomeView`
   - `NoteView`
3. 目标是高频、稳定、信息密度高的工作区组织

#### B. `Canvas container（画布容器）`

这类容器本身是一个局部自由空间，容器内部可以继续摆放对象：

1. 容器作为一个视图节点被放进工作台布局
2. 容器内部再承载：
   - `Agent nodes`
   - `Terminal nodes`
   - `Resource nodes`
   - `Topology graph`
3. 它既可以显示自由摆放对象，也可以切换不同渲染方式

这意味着：

- “工作台外层”是容器化布局
- “画布容器内层”是自由摆放与多视图渲染

### 10.10.5 由此得到的更完整结构

```text
WorkbenchSpace
  ├─ layout graph（外层容器图）
  │   ├─ Auto-layout containers
  │   └─ Canvas containers
  ├─ objects（真实对象）
  ├─ focus runs（专注片段）
  └─ event tape（事实事件带）
```

这样可以同时满足两种需求：

1. 喜欢 IDE 式“铺满面板”的用户，可以主要使用 `Auto-layout container`
2. 喜欢自由编排的用户，可以主要使用 `Canvas container`

而两者不是两个产品，而是同一工作空间里的两种容器能力

### 10.11 新增判断：Signal Network 应并入 Workbench 视图系统

用户提出一个非常关键的判断：

- `signal network（信号网络）` 与 `workbench（工作台）` 不应被看成两个完全独立产品

当前更合理的方向是：

1. `Signal Network` 是 `WorkbenchSpace` 的一种 `derived view（派生视图）`
2. `free canvas`、`topology graph`、未来可能的 `timeline replay`，都只是同一底层对象模型的不同投影

这意味着后续 Epic 的表述应避免写成：

- 一个工作台产品
- 再加一个平行的网络产品

而应写成：

- 一个统一的 `Agent Workbench`
- 拥有多种视图：
  - `canvas view（画布视图）`
  - `network view（网络视图）`
  - `run replay view（运行回放视图）`

---

## 11. 当前结论（Compressed Takeaway，压缩结论）

当前最稳的判断是：

1. ExoMind 这次应做的是 `Agent workbench（Agent 工作台）`，不是传统终端工具
2. 但它必须建立在扎实的 `terminal / SSH / session` 底座上
3. 页面主对象应是 `WorkbenchSpace（工作台空间）`
4. `WorkbenchSpace` 应是长期持久的，而不是一次性页面实例
5. 画布上的主操作对象应是 `SessionNode（会话节点）` 等空间对象
6. 时间块应绑定到 `FocusRun / WorkEpisode（专注片段 / 工作过程记录）`，用于记录与回放
7. `structured view（结构化视图）` 必须是派生层，不能反过来替代原始终端事实层

---

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
