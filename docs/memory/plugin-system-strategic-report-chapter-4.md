# 第4章 ExoMind 表面系统（Surface System）

表面系统是 ExoMind 插件体系的核心承载层，它将 L3 层的 Agent/Actor 世界物理投影到用户的视觉感知空间。从技术架构的角度看，表面系统不仅仅是一套传统的窗口管理机制，更是 Agent 生命形态在数字空间中的具身化表达。当我们在讨论表面系统设计时，实际上是在回答一个根本性的问题：ExoMind 如何让用户在与 Agent 交互的过程中，获得既高效又愉悦的视觉与操作体验？

表面系统的设计需要平衡多重目标：首先是功能性，确保不同类型的 Agent 交互场景都能找到合适的呈现方式；其次是一致性，让用户在 ExoMind 的各个角落都能感受到统一的视觉语言和交互范式；第三是扩展性，为插件系统提供足够的自由度，使其能够承载丰富多样的自定义视图；最后是性能，在保持界面流畅的同时处理可能的大量并发 Agent 实例。这些目标之间存在复杂的权衡关系，需要通过精心设计的架构来协调。

本章将围绕 ExoMind 表面模型、灵活窗格系统、多窗口支持、插件 UI 承载以及与 Agent Workbench 的统一等五个核心维度，深入剖析表面系统的架构设计。每一部分都会从设计理念、技术实现、扩展机制三个层面展开论述，力求为读者呈现一个完整且可执行的表面系统架构蓝图。

---

## 4.1 ExoMind Surface Model（表面模型）

### 4.1.1 表面模型的设计哲学

ExoMind 的表面模型建立在一个核心认知之上：窗口系统不是目的，而是手段。它的终极目标是让用户能够高效地与 Agent 进行多模态交互，同时保持对复杂信息空间的结构化感知。传统的桌面操作系统将窗口视为应用的容器，但在 ExoMind 的语境下，窗口更像是 Agent 的「舞台」——每个 Agent 都有自己的表演空间，多个 Agent 可以同台竞技，也可以各自独处。

这种认知导致我们在设计表面模型时采取了与传统窗口系统不同的策略。传统系统强调窗口的独立性和隔离性，强调用户对窗口的显式控制（移动、调整大小、最小化最大化）。ExoMind 的表面模型则在保留这些基础能力的同时，更加强调窗口之间的协同关系，强调系统对用户意图的智能推断，强调 Agent 行为的可视化呈现。

表面模型的另一个独特之处在于它与生命体隐喻的深度融合。在 ExoMind 的架构中，Agent 不仅有逻辑层面的生命周期（创建、运行、终止），还有视觉层面的「具身」形态。一个 Agent 的表面呈现不是静态的图标或标签，而是一个动态的、可交互的、能够反映 Agent 当前状态的视觉实体。这种具身化设计让用户能够直观地感知 Agent 的「生命征象」——活跃度、注意力焦点、任务进度、情绪状态等。

### 4.1.2 五层层次体系详解

ExoMind 的表面模型采用 Screen → Window → Workspace → Pane → View 的五层层次体系。这一体系的设计灵感来源于现代 IDE 的多窗格界面，但经过了大幅度的定制和扩展，以适应 ExoMind 独特的 Agent 交互需求。

**Screen（屏幕层）** 是层次体系的根节点，代表物理或虚拟的显示设备。在桌面场景下，Screen 对应真实的显示器；在移动场景下，Screen 对应设备的屏幕；在平板或折叠设备上，Screen 还需要处理屏幕尺寸变化和设备姿态切换。Screen 层负责管理显示区域的分配、屏幕坐标系的定义以及跨屏幕的窗口调度。从插件系统的角度来看，Screen 层是最高层的上下文，插件可以通过 Screen 层获取当前显示环境的信息，例如屏幕尺寸、DPI、是否处于横屏模式等。

**Window（窗口层）** 是 ExoMind 中的主要容器单元。与传统桌面系统中的窗口不同，ExoMind 的 Window 不仅承载应用内容，还承载 Agent 实例的视觉表示。一个 Window 可以包含一个或多个 Workspace，每个 Workspace 代表一个特定的工作场景或任务领域。Window 层负责窗口的创建、销毁、激活、层级管理（z-order）、装饰（标题栏、边框、控件）等基础功能。值得注意的是，Window 在 ExoMind 中具有强标识性——每个 Window 都有一个唯一的标识符，用于跨组件的状态同步和事件传递。

**关于 Window 层的技术实现**：ExoMind 采用单 Tauri WebviewWindow + 多虚拟窗口的设计。Window 层在技术上对应一个顶层的 div 容器或浏览器 tab，而非独立的操作系统窗口。这种设计的优势在于资源开销小、状态同步简单，但在多显示器场景下需要进行额外的视图投影逻辑。桌面端的「独立窗口」功能通过创建新的 BrowserWindow（electron）或浮层（web）来实现。

**Workspace（工作区层）** 是 ExoMind 表面模型的核心创新之一。Workspace 可以理解为「场景化的窗口内容」，它定义了一组相关的窗格布局和视图配置，用于支持特定的工作场景。例如，一个用户可能有一个「代码开发」的 Workspace，一个「日常事务处理」的 Workspace，一个「深度研究」的 Workspace。Workspace 之间的切换不仅仅是布局的变化，还包括上下文状态的迁移——当你从一个 Workspace 切换到另一个时，当前活跃的 Agent 实例、终端会话、任务列表等都会相应地切换。Workspace 层为插件提供了将多个视图组件组合成一个连贯工作环境的能力。

**Pane（窗格层）** 是 Workspace 内的布局单元，代表一个可以独立承载内容或 Agent 呈现的矩形区域。窗格是 ExoMind 灵活布局系统的基本元素，它们可以水平或垂直拆分、合并、调整大小、重新排列。窗格之间形成树形结构，这种设计使得复杂的布局可以通过简洁的数据结构来描述和持久化。窗格不仅可以是简单的矩形容器，还可以承载特殊的布局模式，例如标签页式窗格（多个视图共享同一窗格空间）、浮动窗格（脱离主布局的临时容器）、最小化窗格（折叠为图标或标题栏）。

**View（视图层）** 是五层体系的叶子节点，代表具体的内容呈现。视图可以是系统内置的类型（如终端视图、知识库视图、任务看板视图），也可以是插件自定义的类型。视图负责内容的渲染和用户交互的处理。每个视图都有一个明确的类型标识，用于系统识别如何初始化、布局和交互。视图层是插件系统的主要接入点——插件通过注册自定义视图类型来实现其用户界面的呈现。

这五层之间的关系不仅仅是包含关系，还包括丰富的交互和通信机制。父层可以向子层传递上下文信息（例如 Window 的激活状态影响 Workspace 的显示），子层也可以向父层报告事件（例如 Pane 内的视图请求提升为独立 Window）。这种双向通信机制确保了表面模型既是一个层级分明的结构，又是一个动态响应 的有机系统。

### 4.1.3 表面模型的数据结构

为了支持灵活的操作和高效的状态管理，ExoMind 的表面模型需要一套精心设计的数据结构来描述各层次的状态。以下是各层核心数据结构的概要设计。

Screen 层的数据结构相对简单，主要包含显示设备的基本信息：

```typescript
interface Screen {
  id: string;
  name: string;
  bounds: Rectangle;        // 屏幕物理尺寸和位置
  workArea: Rectangle;       // 排除系统任务栏后的工作区域
  scaleFactor: number;       // DPI 缩放因子
  isPrimary: boolean;        // 是否为主屏幕
  orientation: 'portrait' | 'landscape';
}
```

Window 层的数据结构需要包含窗口的标识、位置、样式、状态等信息：

```typescript
interface Window {
  id: string;
  title: string;
  screenId: string;
  bounds: Rectangle;
  state: WindowState;        // normal, minimized, maximized, fullscreen
  isActive: boolean;
  zIndex: number;
  opacity: number;           // 支持半透明窗口
  isDecorated: boolean;      // 是否显示系统装饰（标题栏等）
  workspaceId: string | null; // 关联的工作区（可为空表示多工作区窗口）
  persistentId: string;       // 用于跨会话的窗口标识
}
```

Workspace 层的数据结构需要描述工作区的元信息和布局配置：

```typescript
interface Workspace {
  id: string;
  name: string;
  icon: string;              // 工作区图标
  color: string;             // 工作区主题色
  paneTree: PaneNode;         // 窗格树的根节点
  activePaneId: string | null;
  metadata: WorkspaceMetadata;
  createdAt: number;
  lastAccessedAt: number;
}

interface WorkspaceMetadata {
  description?: string;
  tags: string[];
  agentIds: string[];        // 工作区关联的 Agent 实例
  defaultAgentId?: string;
}
```

Pane 层的数据结构是整个表面模型中最为复杂的，因为它需要支持灵活的树形布局：

```typescript
type PaneNode = SplitPane | ContentPane;

interface SplitPane {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number;             // 子窗格的比例分配
  children: [PaneNode, PaneNode];
  lockRatio?: boolean;       // 是否锁定比例不允许用户调整
}

interface ContentPane {
  type: 'content';
  id: string;
  viewType: string;          // 视图类型标识
  viewState: ViewState;      // 视图的实例状态
  tabs?: TabItem[];          // 如果支持标签页
  isActive: boolean;
  title?: string;            // 自定义标题
  icon?: string;             // 自定义图标
  isFloating?: boolean;      // 是否为浮动窗格
  floatingBounds?: Rectangle;
  isMinimized?: boolean;     // 是否最小化
}
```

View 层的数据结构需要支持系统内置视图和插件自定义视图：

```typescript
interface View {
  type: string;              // 视图类型标识
  id: string;                // 视图实例标识
  paneId: string;            // 所属窗格
  title: string;
  icon?: string;
  state: ViewState;
  capabilities: ViewCapabilities;  // 视图支持的能力
  pluginId?: string;         // 如果是插件提供的视图
}

interface ViewCapabilities {
  canClose: boolean;
  canDetach: boolean;        // 可以分离为独立窗口
  canSplit: boolean;         // 可以作为拆分源
  canMinimize: boolean;
  canMaximize: boolean;
  supportsTabs: boolean;
  acceptsDrop: boolean;      // 是否接受拖拽放置
}
```

这些数据结构的设计遵循了几个关键原则。首先是**可序列化**——所有状态都可以被序列化并持久化，支持跨会话的布局恢复。其次是**可比较**——通过唯一标识符和版本号，系统可以精确地检测状态变化并触发相应的更新。第三是**可扩展**——通过 type 字段的多态设计，系统可以容纳新的窗格类型和视图类型，而不需要修改核心数据结构。

### 4.1.4 表面模型与 L3 层的映射关系

表面模型的设计不是孤立的，它需要与 L3 层的 Agent/Actor 系统建立清晰的映射关系。这种映射是双向的——L3 层的变化需要反映到表面呈现上，表面的交互事件也需要传递到 L3 层进行处理。

在 L3 到 L4 的方向上，每个 Agent 实例在表面模型中都有对应的视觉表示。这个表示可以是多层次的：一个 Agent 可能有一个主视图（展示其核心交互界面），同时还有若干辅助视图（如通知、状态面板、工具窗口）。当 Agent 的状态发生变化时（例如从 idle 变为 running、从 running 变为 waiting_for_input），表面模型需要及时更新相应的视觉表示。这种状态同步需要一套可靠的事件传播机制，确保 L3 层的状态变化能够及时、准确地反映到 L4 层。

在 L4 到 L3 的方向上，用户的交互事件需要传递给相应的 Agent 进行处理。例如，用户在某个 Agent 的视图中点击了一个按钮、输入了一段文本、拖拽了一个元素，这些交互事件都需要被路由到正确的 Agent 实例。表面模型需要维护一个从视图到 Agent 的映射表，确保每个视图的交互事件都能被正确地处理。

这种双向映射的设计还需要考虑性能因素。在 ExoMind 中，可能同时运行数十个 Agent 实例，如果每个 Agent 的状态变化都触发完整的 UI 重渲染，性能开销将难以承受。因此，表面模型需要实现精细的变化检测机制——只有发生变化的部分才需要更新，而不是整个视图树重新渲染。虚拟化技术和懒加载策略也是常用的优化手段。

**Agent 状态的视觉呈现**：不同生命状态的 Agent 应有对应的视觉表达。

```typescript
interface AgentVisualState {
  lifecycle: 'creating' | 'idle' | 'running' | 'waiting' | 'completed' | 'terminated';
  attentionFocus: 'foreground' | 'background' | 'dormant';
  intensity: number;  // 0-100，表示活跃度
}
```

---

## 4.2 灵活窗格系统

### 4.2.1 窗格系统的设计目标

灵活窗格系统是 ExoMind 表面模型中承担具体布局管理的子系统。它的设计目标可以从用户视角和开发者视角两个维度来理解。

从用户视角来看，窗格系统需要实现以下目标：**操作的直觉性**，用户可以通过拖拽、快捷键、上下文菜单等直观方式来完成窗格的拆分、合并、调整大小等操作；**布局的持久化**，用户创建的布局可以被保存和恢复，不需要每次打开应用都重新配置；**命名布局的支持**，用户可以为不同的布局起名字（如「代码审查」、「日常事务」），通过名字快速切换；**自动布局重放**，系统可以记录用户的布局操作序列，并在合适的时机自动重放（例如当新 Agent 启动时，自动将其放置到预设的位置）。

从开发者视角来看，窗格系统需要提供：**声明式的布局描述**，开发者可以通过配置文件或代码声明来定义窗格布局，而不需要手动计算每个窗格的位置和尺寸；**自定义视图类型的支持**，插件可以注册自己的视图类型，这些类型可以像系统内置视图一样参与窗格布局；**布局算法的可扩展性**，除了默认的拆分布局，系统还可以支持其他布局模式（如瀑布流、网格、极简模式）；**主题和样式的解耦**，窗格的视觉呈现与布局逻辑相互独立，开发者可以专注于功能实现，而不需要关心样式细节。

### 4.2.2 窗格树的数据结构与操作

窗格树是灵活窗格系统的核心数据结构。如前所述，它是一个二叉树结构，其中内部节点代表「拆分」操作，叶子节点代表「内容窗格」。这种设计的优势在于：任何复杂的布局都可以通过递归地应用「水平拆分」和「垂直拆分」来构建。

窗格树的基本操作包括：

**拆分操作（Split）** 是将一个已有的窗格分割成两个子窗格。拆分操作需要指定三个参数：被拆分的窗格、拆分方向（水平或垂直）、拆分比例。拆分操作会产生一个新的父节点（SplitPane），原窗格成为新父节点的第一个子节点，同时创建一个新的空内容窗格作为第二个子节点。从用户的角度来看，拆分操作会创建一个新的视图占位符，用户可以在其中打开新的视图或移动现有的视图。

```typescript
function splitPane(
  paneId: string,
  direction: 'horizontal' | 'vertical',
  ratio: number = 0.5
): PaneTree {
  // 找到目标窗格
  const targetPane = findPane(root, paneId);
  // 如果目标已经是 SplitPane，需要找到其叶子节点
  const leafPane = findLeafPane(targetPane);

  // 创建新的拆分节点
  const newSplit: SplitPane = {
    type: 'split',
    direction,
    ratio,
    children: [
      leafPane,
      { type: 'content', id: generateId(), viewType: 'empty', viewState: {} }
    ]
  };

  // 替换原位置
  return replacePane(root, paneId, newSplit);
}
```

**合并操作（Merge）** 是拆分的逆操作，将两个相邻的窗格合并为一个。合并操作需要指定两个要合并的窗格，合并后会删除其中一个窗格，另一个窗格会扩展以占据合并后的空间。合并操作的语义比较复杂——当两个窗格都包含内容时，系统需要询问用户如何处理（例如选择保留其中一个、创建一个新的标签页、或合并内容）。

**调整大小（Resize）** 是改变拆分窗格比例的操作。每个 SplitPane 节点都有一个 ratio 属性，表示第一个子窗格占据的空间比例。调整大小时，只需要更新这个比例值即可。UI 层会根据新的比例重新计算所有窗格的像素位置。

**移动操作（Move）** 是将一个窗格移动到另一个位置。这包括在同一 Workspace 内移动和跨 Workspace 移动两种情况。移动操作可能会触发窗格的合并或拆分，视目标位置的当前状态而定。

**删除操作（Close）** 是移除一个窗格。如果被删除的窗格有内容，系统会提示用户确认。删除操作可能会导致父节点的合并——当一个 SplitPane 的两个子节点之一被删除后，另一个子节点会「提升」到父节点的位置。

### 4.2.3 窗格操作的交互方式

为了让用户能够直观地进行窗格操作，ExoMind 的窗格系统需要提供多种交互方式。

**拖拽交互** 是最直观的窗格操作方式。用户可以通过拖拽窗格的边缘来调整窗格大小，通过拖拽窗格的标题栏来移动窗格位置，通过将一个窗格拖拽到另一个窗格的边缘来触发拆分。拖拽交互需要提供丰富的视觉反馈——例如，当用户拖拽窗格边缘时，系统应该显示分隔线的预览位置；当他将窗格拖拽到可能的拆分位置时，应该显示一个拆分预览。

**快捷键交互** 是高效用户的主要操作方式。ExoMind 需要定义一套快捷键来支持常见的窗格操作，例如：垂直拆分（Ctrl+\）、水平拆分（Ctrl+Shift+\）、关闭当前窗格（Ctrl+W）、切换活动窗格（Ctrl+Tab）、最大化当前窗格（Ctrl+M）、保存当前布局（Ctrl+Shift+S）。快捷键的设计需要考虑与 Agent 操作的快捷键不冲突，并提供快捷键自定义功能。

**上下文菜单** 提供了最完整的窗格操作选项。在窗格上点击右键会显示上下文菜单，包含以下操作分组：视图操作（打开新视图、移动视图、替换视图）、布局操作（拆分、合并、均匀化）、窗格操作（最大化、最小化、关闭、悬浮）、布局保存（保存当前布局、加载布局）。上下文菜单的内容应该根据当前窗格的状态动态调整——例如，如果窗格已经是最大化的，最大化选项应该显示为已禁用状态。

**命令面板** 是另一种高效的交互方式。用户可以通过 Ctrl+Shift+P 打开命令面板，输入布局相关的命令（如「Split Horizontal」「Save Layout」）。命令面板的优势在于它不需要用户记忆快捷键，只需要输入命令的关键词即可。

### 4.2.4 命名布局的保存与切换

命名布局是 ExoMind 窗格系统的重要特性，它允许用户保存特定的窗格配置，并在需要时快速恢复。以下是命名布局系统的核心设计。

**布局的保存** 需要记录以下信息：Workspace 标识（布局属于哪个 Workspace）、布局名称、布局创建时间、布局最后使用时间、窗格树的完整结构、每个内容窗格关联的视图信息（视图类型、视图状态、如果是插件视图还需要记录插件标识）。布局数据应该持久化到本地存储，以便跨会话恢复。

```typescript
interface NamedLayout {
  id: string;
  name: string;
  workspaceId: string;
  createdAt: number;
  lastUsedAt: number;
  paneTree: PaneNode;
  viewMappings: Map<string, ViewMapping>;  // 窗格 ID 到视图的映射
  tags: string[];                           // 用于分类和搜索
  isDefault?: boolean;                      // 是否为默认布局
}

interface ViewMapping {
  viewType: string;
  pluginId?: string;
  initialState?: ViewState;
}
```

**布局的切换** 需要处理以下场景：新布局与当前布局的差异计算、当前内容的处理策略、新布局的加载和渲染、切换动画。差异计算需要比较两个布局的窗格树结构，找出需要删除、新建、移动的窗格。当前内容的处理需要询问用户——是关闭当前视图、保存到某处、还是移动到新布局的对应位置。

**自动布局重放** 是一个高级特性，它可以在特定条件下自动应用预设的布局。例如：当新 Agent 启动时，将其放置到预设的窗格位置；当特定类型的 Agent 被激活时，切换到对应的布局；当外部事件触发时（如收到特定类型的通知），调整当前布局。自动布局重放需要定义触发条件和目标布局的映射关系。

### 4.2.5 插件视图类型的注入

插件系统是 ExoMind 灵活窗格系统的重要组成部分。插件可以通过注册自定义视图类型来扩展窗格系统的内容承载能力。

**视图类型的注册** 发生在插件激活时。插件需要声明它提供的视图类型，以及这些视图类型的元信息：

```typescript
// 插件Manifest中的视图类型声明
interface PluginManifest {
  id: string;
  name: string;
  views: PluginViewType[];
}

interface PluginViewType {
  type: string;                 // 视图类型标识，如 "pluginId:customView"
  name: string;                 // 人类可读的视图名称
  icon?: string;                // 视图图标
  capabilities: ViewCapabilities;
  defaultSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  maxSize?: { width: number; height: number };
  supportsStreaming?: boolean;  // 是否支持流式渲染
  InitialStateSchema?: Schema; // 初始状态的JSON Schema
}
```

**视图的实例化** 是当用户在一个空窗格中打开某个插件视图时发生的。系统会根据视图类型查找对应的插件，调用插件的视图工厂函数来创建视图实例：

```typescript
interface ViewFactory {
  createView(type: string, initialState: ViewState): ViewInstance;
  destroyView(instanceId: string): void;
}

interface ViewInstance {
  id: string;
  type: string;
  mount(domElement: HTMLElement): void;
  unmount(): void;
  onStateChange(callback: (state: ViewState) => void): void;
  onAction(callback: (action: ViewAction) => void): void;
}
```

**视图的生命周期管理** 需要遵循以下规则：视图在首次显示时进行初始化、视图在切换到后台时可以暂停渲染以节省资源、视图在隐藏一定时间后可以完全卸载以释放内存、视图在关闭时需要清理所有资源并保存状态。窗格系统需要维护这些生命周期状态，并与插件系统协调。

---

## 4.3 多窗口支持

### 4.3.1 多窗口的设计理念

ExoMind 的多窗口支持是其表面系统区别于传统单一窗口应用的关键特征。这一设计基于以下认知：在多 Agent 并行工作的场景下，单一窗口的布局空间远远不够用。用户可能需要同时监控多个 Agent 的状态、与多个 Agent 进行交互、或者在不同的任务上下文之间快速切换。多窗口设计让用户可以将不同的 Agent 和工作场景分散到不同的窗口中，每个窗口都可以独立地调整大小、位置和布局。

然而，多窗口设计也带来了额外的复杂性。ExoMind 需要在桌面端提供全面的多窗口支持，同时在移动端优雅地降级为单窗口模式。这是因为移动设备的屏幕空间有限，且用户的使用习惯与传统桌面不同。此外，多窗口之间的状态同步、Agent 实例的跨窗口共享、窗口之间的通信等都是需要仔细设计的系统级问题。

ExoMind 的多窗口设计还引入了「联邦模型」的概念。在这个模型中，每个窗口都不是孤立的岛屿，而是整个应用状态的一部分。一个窗口中的操作可以影响其他窗口（例如，在一个窗口中启动的 Agent 可以在另一个窗口中看到）。这种设计让用户可以在不同的窗口中关注同一个 Agent 的不同方面，或者在不同的窗口中并行处理不同的任务。

### 4.3.2 桌面多窗口架构

在桌面平台上，ExoMind 的多窗口架构需要处理以下核心问题：窗口的创建和管理、窗口间状态的同步、窗口的布局和层级、窗口的持久化和恢复。

**窗口的创建** 可以通过多种方式触发：用户通过菜单或快捷键创建新窗口、Agent 实例请求自己的独立窗口、插件请求创建浮动窗口、特定的 UI 操作（如拖拽到屏幕边缘）触发新窗口。创建窗口时需要指定窗口的初始属性：尺寸、位置、标题、图标、是否显示装饰、初始工作区等。

**窗口的管理** 通过一个全局的窗口管理器来实现。窗口管理器维护所有窗口的元信息，处理窗口的激活、层级调整、最小化、最大化等操作。窗口管理器还需要处理窗口之间的父子关系——某些窗口可以设置为其他窗口的子窗口，当父窗口最小化或关闭时，子窗口也会相应地受到影响。

```typescript
interface WindowManager {
  createWindow(options: WindowOptions): string;  // 返回窗口ID
  closeWindow(windowId: string): void;
  minimizeWindow(windowId: string): void;
  maximizeWindow(windowId: string): void;
  restoreWindow(windowId: string): void;
  setWindowBounds(windowId: string, bounds: Rectangle): void;
  setWindowZIndex(windowId: string, zIndex: number): void;
  activateWindow(windowId: string): void;
  getWindowInfo(windowId: string): WindowInfo;
  getAllWindows(): WindowInfo[];
  onWindowEvent(callback: (event: WindowEvent) => void): void;
}
```

**窗口间的状态同步** 是多窗口架构中最复杂的部分。ExoMind 需要同步的状态包括：Agent 实例的运行状态、任务进度和结果、通知和消息、用户偏好设置、视图的滚动位置等。同步机制需要考虑实时性和效率——某些状态需要即时同步（如 Agent 的输出），某些状态可以延迟同步（如视图的滚动位置）。ExoMind 采用事件驱动的同步模型：状态变化产生事件，事件通过消息总线分发到所有窗口，接收窗口根据事件更新自己的状态。

### 4.3.3 移动端单窗口回退

在移动设备上，ExoMind 需要采用不同于桌面的交互模式。移动设备的屏幕空间有限，且用户主要通过触摸进行交互，这使得传统的多窗口模型不太适用。ExoMind 的移动端策略是在保持功能等价的前提下，将多窗口能力映射到单窗口的多种模式中。

**模式切换** 是移动端处理多场景的主要方式。在一个单窗口中，ExoMind 通过底部导航栏、侧边抽屉、模式切换器等方式，让用户在不同的场景之间切换。每个场景对应桌面端的一个独立窗口的功能。例如，桌面端的「Agent 工作区」窗口和「知识库」窗口，在移动端可以表现为两个可切换的视图。

**分屏与悬浮窗** 是移动端多任务处理的补充。在支持分屏的设备上，用户可以将 ExoMind 与其他应用并排放置。在支持悬浮窗的设备上，ExoMind 可以以小窗口模式运行，允许用户一边使用其他应用一边监控 Agent 的状态。

**手势导航** 是移动端窗口切换的主要方式。ExoMind 支持以下手势：左滑/右滑切换相邻的场景、上滑打开应用概览（显示所有打开的场景）、下滑打开通知面板、双指捏合进入编辑模式（调整布局）。这些手势需要与 Agent 视图内的手势进行区分，系统需要维护一个手势冲突的解决规则。

**移动端场景映射表**：

| 桌面端功能 | 移动端实现 | 备注 |
|-----------|-----------|------|
| 多 Window | 底部导航切换 | 每个导航项对应一个功能域 |
| Workspace 切换 | 侧边抽屉 | 通过 drawer 展示所有 Workspace |
| 浮动窗格 | Bottom Sheet | 底部弹出式信息展示 |
| Pane 拆分 | 响应式折叠 | 小屏幕自动折叠为手风琴 |

### 4.3.4 跨窗口状态同步与联邦模型

ExoMind 的多窗口系统不是一个简单的「每个窗口独立运作」的模型，而是一个有机的整体。这就是「联邦模型」的含义——每个窗口都是联邦的一部分，共享共同的状态和资源。

**联邦状态的层次** 可以分为三级：第一级是全局状态，如当前登录用户、应用设置、主题配置等，这些状态在所有窗口中完全相同；第二级是会话状态，如当前打开的 Agent 实例列表、每个 Agent 的基本状态等，这些状态需要实时同步；第三级是窗口本地状态，如窗口的位置和大小、窗口内的滚动位置、某个特定视图的展开/折叠状态等，这些状态通常是窗口私有的，不需要同步。

**同步机制的实现** 基于发布-订阅模式。有一个全局的状态存储（类似于 Redux 的 store），每个窗口都有自己的状态副本。当任何窗口修改状态时，修改操作首先应用到本地副本，然后通过消息通道同步到其他窗口。为了减少不必要的同步开销，系统会使用差异检测——只有真正变化的部分才会被序列化并传输。

```typescript
// 状态同步的核心机制
class StateFederation {
  private localStore: Store;
  private syncChannel: MessageChannel;
  private pendingChanges: Change[] = [];

  dispatch(action: Action): void {
    // 本地立即应用
    this.localStore.dispatch(action);

    // 序列化并发送到其他窗口
    const change = this.serializeChange(action);
    this.broadcastToPeers(change);
  }

  onPeerChange(change: Change): void {
    // 接收并应用来自其他窗口的变化
    // 需要处理冲突（例如两个窗口同时修改同一个值）
    this.resolveAndApply(change);
  }
}
```

**冲突解决** 是联邦模型中的一个重要问题。当两个窗口同时修改同一个状态项时，系统需要决定最终的值。ExoMind 采用「最后写入胜出」的策略作为默认方案，但允许某些状态项声明为「合并类型」（例如列表类型的状态，后写入的会被追加到列表末尾）。对于需要人工干预的冲突，系统会提示用户选择。

```typescript
type ConflictStrategy = 'last-write-wins' | 'merge-list' | 'user-prompt';

const conflictPolicies: Record<string, ConflictStrategy> = {
  'agent.runningState': 'last-write-wins',
  'task.progress': 'last-write-wins',
  'workspace.paneTree': 'user-prompt',
  'terminal.output': 'merge-list',
};
```

### 4.3.5 特殊窗口类型

除了标准的应用窗口，ExoMind 还支持多种特殊类型的窗口，以满足不同的使用场景。

**浮动窗格（Floating Pane）** 是一种可以脱离主窗口布局的窗格。用户可以将任意窗格「浮出」为一个独立的浮动窗口，这个窗口可以移动到屏幕的任何位置，并且可以设置为始终置顶。浮动窗格适合需要持续关注但不需要占用主窗口空间的场景，例如监控某个 Agent 的日志输出。浮动窗格与主窗口保持状态同步，当主窗口关闭时，浮动窗格可以选择一起关闭或保留。

**迷你窗口（Mini Window）** 是一种简化的窗口形态，只显示最核心的信息。迷你窗口的尺寸通常很小（如 300x200 像素），可以吸附到屏幕边缘。迷你窗口适合在专注于其他任务时保持对 ExoMind 的关注。用户可以将任意 Workspace 切换到迷你窗口模式，此时会显示关键信息（如活跃 Agent 的简要状态、最近的任务进度）。

**浮层（Overlay）** 是一种临时性的 UI 覆盖层，用于显示模态对话框、上下文菜单、工具提示、通知等。浮层不需要在窗口系统中单独创建，而是作为主窗口的一部分进行管理。浮层的优势在于轻量——创建和销毁的开销很小，适合短暂显示的内容。

**外部窗口（External Window）** 是一种将 ExoMind 的某个部分渲染到外部窗口的功能。这可以用于将某个 Agent 的工作区完全分离到独立的操作系统窗口中。外部窗口与主窗口保持通信，但可以独立移动和调整大小。当用户希望将注意力完全集中在某个 Agent 上时，外部窗口是一个有用的选择。

---

## 4.4 插件 UI 承载

### 4.4.1 插件视图注册机制

插件系统是 ExoMind 功能扩展的核心途径，而插件 UI 承载则是插件与用户交互的主要界面。ExoMind 的插件视图注册机制需要解决以下问题：插件如何声明它提供的视图类型、系统如何验证和加载插件的视图、视图的生命周期如何管理、视图之间如何通信和协作。

插件视图的注册发生在插件的生命周期中。插件在激活时需要向系统注册它提供的所有视图类型，每个视图类型需要一个唯一的标识符（如 `my-plugin:my-custom-view`）。注册信息包括视图的元数据（名称、图标、描述）和视图的工厂函数。

```typescript
// 插件激活时的视图注册
function activatePlugin(context: PluginContext): void {
  // 注册视图类型
  context.registerViewType({
    type: 'my-plugin:custom-chart',
    name: 'Custom Chart',
    icon: 'chart-line',
    description: '显示自定义图表的视图',
    capabilities: {
      canClose: true,
      canDetach: true,
      canSplit: false,
      canMinimize: true,
      canMaximize: true,
      supportsTabs: true,
      acceptsDrop: true
    },
    defaultSize: { width: 600, height: 400 },
    minSize: { width: 300, height: 200 }
  });

  // 关联工厂函数
  context.setViewFactory('my-plugin:custom-chart', (container, initialState) => {
    return new CustomChartView(container, initialState);
  });
}
```

**视图工厂** 是创建视图实例的函数。每个视图类型都需要关联一个工厂函数，这个函数接受容器元素和初始状态，返回一个视图实例。视图实例需要实现标准接口，包括挂载（mount）、卸载（unmount）、状态更新、事件回调等方法。

```typescript
interface ViewFactory {
  create(container: HTMLElement, initialState?: ViewState): ViewInstance;
}

interface ViewInstance {
  mount(): void;
  unmount(): void;
  setState(state: ViewState): void;
  getState(): ViewState;
  onEvent(callback: (event: ViewEvent) => void): void;
  onAction(callback: (action: ViewAction) => void): void;
  focus(): void;
  blur(): void;
}
```

**视图的验证** 在注册时和加载时都需要进行。注册时的验证确保插件声明的视图类型符合规范（唯一标识符、合法的元数据、有效的工厂函数）。加载时的验证确保视图的实现符合接口要求（提供了所有必需的方法、正确处理状态和事件）。

### 4.4.2 主题与样式隔离

插件提供的视图可能来自不同的开发者，它们可能使用不同的样式方案。为了确保 ExoMind 的整体视觉一致性，同时不限制插件的样式选择，ExoMind 实现了主题与样式隔离机制。

**CSS 变量注入** 是样式隔离的核心技术。ExoMind 定义了一套完整的 CSS 变量，涵盖颜色、间距、字体、圆角等视觉属性。这些变量会被注入到每个插件视图的容器中，插件的样式可以引用这些变量来保持与系统主题的一致性。

```css
/* ExoMind 核心 CSS 变量 */
.exomind-surface {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-bg-tertiary: #eeeeee;
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #666666;
  --color-accent: #0066cc;
  --color-accent-hover: #0052a3;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --border-radius-sm: 4px;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

**样式封装** 确保插件的样式不会泄漏到外部。ExoMind 使用 Shadow DOM 技术来实现样式的完全隔离。在 Shadow DOM 中定义的样式不会影响外部元素，外部样式也不会影响内部元素（除非使用特定的穿透技术）。这意味着插件可以自由地使用任何 CSS 选择器，不需要担心与系统样式或其他插件样式冲突。

```typescript
// 使用 Shadow DOM 创建隔离的视图容器
function createIsolatedContainer(): HTMLElement {
  const container = document.createElement('div');
  const shadow = container.attachShadow({ mode: 'open' });

  // 注入系统样式
  const styleSheet = document.createElement('style');
  styleSheet.textContent = getSystemStyles();
  shadow.appendChild(styleSheet);

  // 插件内容将放在这里
  const contentHost = document.createElement('div');
  contentHost.className = 'plugin-content';
  shadow.appendChild(contentHost);

  return contentHost;  // 返回插件可以操作的内部元素
}
```

**主题支持** 让插件视图能够响应系统主题的变化。ExoMind 支持亮色主题、暗色主题和跟随系统设置的主题。CSS 变量会被设计为响应式——当主题变化时，CSS 变量的值会更新，所有使用这些变量的插件样式也会相应变化。插件开发者不需要编写额外的代码来处理主题切换，只需要确保样式中使用的是 CSS 变量而非硬编码的颜色值。

### 4.4.3 响应式布局适配

ExoMind 运行在多种不同尺寸和能力的设备上，从大型桌面显示器到小型手机屏幕。插件视图需要能够适应这些不同的显示环境。响应式布局适配机制帮助插件实现这一目标。

**布局断点系统** 定义了不同屏幕尺寸的分类。ExoMind 的断点系统包括：极小（< 320px）、小（320-639px）、中（640-1023px）、大（1024-1439px）、超大（>= 1440px）。每个断点对应不同的布局策略，插件可以根据当前断点调整其内容呈现。

**自适应组件库** 提供了一套响应式的 UI 组件，插件可以使用这些组件来快速实现响应式布局。这些组件包括：自适应容器（根据可用空间调整布局）、响应式栅格系统、响应式文本（根据容器大小调整字体大小）、响应式图片（根据屏幕尺寸加载不同分辨率的图片）。

```typescript
// 自适应容器的使用示例
function createAdaptiveLayout(): HTMLElement {
  return createElement('adaptive-container', {
    breakpoints: {
      // 默认布局（桌面）
      default: {
        layout: 'grid',
        columns: 3,
        gap: '16px'
      },
      // 平板布局
      '(max-width: 1023px)': {
        layout: 'grid',
        columns: 2,
        gap: '12px'
      },
      // 手机布局
      '(max-width: 639px)': {
        layout: 'stack',
        gap: '8px'
      }
    }
  });
}
```

**视图尺寸协商** 是插件与窗格系统之间的协作机制。当窗格大小发生变化时（如用户调整窗格大小），系统会通知受影响的视图。视图可以根据新的尺寸调整自己的布局，如果调整后无法正常显示，可以向系统报告并请求帮助（例如切换到另一种呈现模式）。

### 4.4.4 插件间视图协作

在复杂的 ExoMind 环境中，可能同时运行多个插件，每个插件可能提供多个视图。这些视图之间可能需要相互通信和协作。ExoMind 提供了一套插件间视图协作的机制。

**视图消息通道** 允许不同视图之间进行通信。每个视图都可以创建和订阅命名消息通道。消息可以是任意类型的数据，发送方不需要知道接收方是谁，只需要知道通道名称。这种设计实现了松耦合的通信——视图之间不需要直接引用，只需要约定通道名称。

```typescript
// 视图A发送消息
viewA.postMessage('agent-status', {
  agentId: 'agent-123',
  status: 'running',
  progress: 75
});

// 视图B订阅消息
viewB.onMessage('agent-status', (message) => {
  console.log('Agent status update:', message.data);
});
```

**视图事件总线** 是另一个协作机制，它允许视图发布和订阅应用级别的事件。与消息通道不同，事件总线中的事件是全局的，任何视图都可以发布或订阅。事件总线适合需要跨多个视图协调的场景。

**共享数据空间** 允许视图之间共享结构化数据。一个视图可以声明它管理的共享数据（如某个 Agent 的输出缓存），另一个视图可以订阅这些数据的变化。这种机制适合需要展示同一数据的多个视图（如一个图表视图和一个表格视图显示同一数据集）。

---

## 4.5 与 Agent Workbench 的统一

### 4.5.1 Agent Workbench 概述

Agent Workbench（智能体工作台）是 ExoMind 系统中用于承载 Agent 交互的核心界面组件。从概念上讲，它是 L3 Agent/Actor 在 L4 表面的主要「演出舞台」。Issue #728 对 Agent Workbench 进行了详细的需求定义，它不仅仅是一个终端或聊天界面，而是一个完整的 Agent 交互环境，包括信号流、终端会话、知识上下文等多个维度。

Agent Workbench 的设计目标是让用户能够：创建和管理多个 Agent 实例、监控 Agent 的运行状态和输出、与 Agent 进行多模态交互（文本、语音、文件等）、为 Agent 提供必要的上下文和资源、在 Agent 之间进行切换和协作。

在 ExoMind 的插件系统架构中，Agent Workbench 占据核心位置。它是系统内置的最大插件，同时也是其他插件的参考实现和扩展基础。其他插件可以与 Agent Workbench 集成，在其基础上添加新的能力，或者完全替换其某些功能。

### 4.5.2 信号流的统一承载

信号流（Signal Flow）是 Agent Workbench 中一个核心概念，它描述了 Agent 与外部世界之间的信息交换。在 ExoMind 的架构中，信号流不仅仅是简单的输入输出，而是一个复杂的、多向的、持续的信息流网络。

**信号的类型** 可以分为几类：用户输入信号（用户通过键盘、语音、文件等方式提供给 Agent 的信息）、Agent 输出信号（Agent 产生的文本、动作、状态变化等）、系统信号（来自 ExoMind 系统的通知、事件、状态变化）、环境信号（来自外部环境的数据，如时间、位置、其他应用的状态等）。

**信号的路由** 是信号流系统的核心功能。每个信号都需要被正确地路由到它的目的地。信号的路由规则可以由用户配置，也可以由 Agent 自己定义。例如，一个 Agent 可以设置只接收特定类型的信号，或者将某类信号转发到另一个 Agent。

在表面系统的层面，信号流通过以下方式呈现：用户输入通过视图的输入控件进入系统，Agent 输出通过视图的输出区域展示给用户，信号的变化通过视图的状态变化反映出来。表面系统需要提供足够的灵活性，让不同的 Agent 交互模式都能找到合适的呈现方式。

### 4.5.3 终端会话的统一承载

终端（Terminal）是 Agent Workbench 中最基础也是最强大的交互模式。在 ExoMind 的语境下，「终端」不仅指传统的命令行界面，还包括任何支持持续交互的文本或多媒体界面。

**终端会话的生命周期** 包括创建、运行、暂停、恢复、终止等阶段。每个阶段都有对应的 UI 呈现：创建时显示初始化界面、运行时显示实时输出、暂停时显示暂停状态、终止时显示总结信息。表面系统需要为终端会话提供这些不同阶段的 UI 支持。

**终端视图的类型** 可以有多种：纯文本终端（传统的命令行风格）、富文本终端（支持格式化文本、链接、代码高亮）、多媒体终端（支持图片、视频、音频的展示）、交互式终端（支持按钮、表单等交互元素）。表面系统的窗格系统可以容纳这些不同类型的终端视图，用户可以根据需要选择合适的呈现方式。

**终端与会话的分离** 是 ExoMind 设计的一个重要特点。多个终端可以对应同一个 Agent 会话（多终端访问同一个 Agent），一个终端也可以切换到不同的 Agent 会话（通过终端重置实现）。这种分离让用户可以在不同的视图布局中使用同一 Agent，而不需要重复创建 Agent 实例。

### 4.5.4 知识上下文的统一承载

知识上下文（Knowledge Context）是 Agent Workbench 中用于为 Agent 提供背景信息的机制。在 ExoMind 的架构中，Agent 不是孤立运行的，它需要 access 到各种上下文信息才能有效地工作。

**上下文的内容** 包括：长期记忆（用户的历史交互、偏好设置、知识库）、短期记忆（当前会话中的关键信息）、外部资源（文件系统、网络数据、API 响应）、会话状态（Agent 的当前状态、变量、调用栈）。

在表面系统中，知识上下文通过多种方式呈现：专门的知识面板（如知识库视图）、上下文感知的信息展示（如在交互时自动显示的相关背景）、上下文选择器（如允许用户选择要提供给 Agent 的上下文片段）。表面系统需要提供灵活的 UI 组件，让插件可以方便地构建自己的上下文呈现方式。

**上下文的持久化** 是知识上下文系统的另一个重要方面。用户的交互历史、Agent 的输出、重要的上下文片段都需要被持久化，以便后续检索和使用。表面系统需要与存储层协作，确保知识上下文能够被正确地保存和恢复。

### 4.5.5 表面系统与 Agent Workbench 的集成架构

表面系统与 Agent Workbench 的集成是通过一系列标准化接口实现的。这些接口定义了表面系统如何呈现 Agent 的各个方面，以及 Agent 的状态如何反映到 UI 上。

**视图工厂接口** 规定了 Agent Workbench 需要的各种视图如何创建。系统需要为每种视图类型提供工厂函数，这些函数可以由系统内置，也可以由插件提供。

```typescript
// Agent Workbench 视图工厂接口
interface AgentWorkbenchViews {
  // 主交互视图
  createInteractionView(container: HTMLElement, agentId: string): InteractionView;

  // 状态面板视图
  createStatusPanelView(container: HTMLElement, agentId: string): StatusPanelView;

  // 知识面板视图
  createKnowledgePanelView(container: HTMLElement, agentId: string): KnowledgePanelView;

  // 输出日志视图
  createOutputLogView(container: HTMLElement, agentId: string): OutputLogView;
}
```

**状态同步接口** 规定了 Agent 状态变化如何同步到 UI。每个视图需要实现状态更新回调，当 Agent 状态变化时，系统会调用这些回调来更新视图。

```typescript
// Agent 状态同步接口
interface AgentStateListener {
  onAgentStateChange(agentId: string, state: AgentState): void;
  onAgentOutput(agentId: string, output: AgentOutput): void;
  onAgentError(agentId: string, error: AgentError): void;
  onAgentLifecycle(agentId: string, event: LifecycleEvent): void;
}
```

**事件路由接口** 规定了用户的交互如何路由到相应的 Agent。当用户在某个视图上进行交互时，交互事件需要被传递到正确的 Agent 进行处理。

```typescript
// 事件路由接口
interface EventRouter {
  // 路由用户输入到 Agent
  routeInput(input: UserInput, target: AgentIdentifier): Promise<void>;

  // 路由动作请求到 Agent
  routeAction(action: ViewAction, target: AgentIdentifier): Promise<void>;

  // 路由拖拽事件
  routeDrag(drag: DragEvent, source: ViewIdentifier, target: AgentIdentifier): Promise<void>;
}
```

通过这些标准化接口，表面系统为 Agent Workbench 提供了一个灵活、可扩展的 UI 基础。Agent Workbench 可以根据需要选择使用哪些视图、如何组织它们、它们之间如何协作。插件也可以通过实现这些接口来扩展或替换 Agent Workbench 的某些部分。

---

## 本章小结

ExoMind 的表面系统是连接 L3 Agent/Actor 层与用户感知的关键桥梁。本章从五个维度详细剖析了表面系统的架构设计：

**表面模型** 建立了 Screen → Window → Workspace → Pane → View 的五层层次体系，为整个 UI 架构提供了清晰的结构。每一层都有明确的职责和边界，层与层之间通过标准化的接口进行通信。这种层次化设计既保证了系统的可理解性，又为未来的扩展预留了充足的空间。

**灵活窗格系统** 实现了窗格的拆分、合并、调整大小、保存布局等功能，让用户能够根据自己的工作需求自由组织界面。命名布局和自动布局重放机制进一步提升了布局的复用性，而插件视图类型的注入机制则确保了系统的可扩展性。

**多窗口支持** 让 ExoMind 能够在桌面平台上充分利用多显示器的优势，同时在移动端优雅地回退到单窗口模式。跨窗口的状态同步和联邦模型确保了多窗口环境下的一致性用户体验。浮动窗格、迷你窗口等特殊窗口类型则满足了特定场景的需求。

**插件 UI 承载** 为插件开发者提供了一套完整的界面集成机制。视图注册机制、样式隔离、响应式适配、视图间协作等功能，让插件能够无缝地融入 ExoMind 的 UI 环境，同时保持自身的独立性。

**与 Agent Workbench 的统一** 将表面系统与核心的 Agent 交互功能紧密结合。信号流、终端会话、知识上下文等核心概念都在表面系统中找到了合适的呈现方式，用户可以通过统一的界面与各种类型的 Agent 进行交互。

这五个维度共同构成了 ExoMind 表面系统的完整架构。在下一阶段的实现中，团队需要基于这个架构进行详细的技术设计，确定具体的实现方案和时间表。同时，表面系统的设计也需要与 L3 层的 Agent 系统紧密配合，确保两层之间的接口稳定和高效。 Issue #646（Desktop Windowing）和 Issue #728（Agent Workbench）的具体需求将指导这个实现过程。

---

*本章完稿日期：2026-04-06*
*章节版本：v1.0*
*关联 Issue：#646（Desktop Windowing）, #728（Agent Workbench）*