# 意图、参照与时间块／工作区

[返回《Agent Workbench 画布主对象讨论》](../../2026-03-30-agent-workbench-canvas-brainstorm.md)

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
