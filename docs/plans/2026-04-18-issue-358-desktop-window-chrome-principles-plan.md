# Issue #358 Desktop Window Chrome Principles Plan

## 目标

把 `#358` 的“基于外心设计风格自定义桌面窗口边界与标题栏”沉淀成一份可供后续实现直接参考的本地原则文档。

这份文档不直接替代实现计划，而是回答三个前置问题：

1. 这件事在操作系统层到底是什么问题。
2. 这件事在软件架构层到底该怎么拆。
3. ExoMind 后续实现时，哪些原则必须先冻结，哪些细节可以后置。

## 问题定义

这条需求不应被理解成：

- “把系统标题栏隐藏掉”
- “做一个 frameless window（无边框窗口）”
- “用内部边界代替窗口边界”

更准确的定义是：

> ExoMind 在桌面端为主窗口实现一套基于自身设计风格的 `client chrome（客户端窗口壳层）`，逐步接管标题栏、顶部边界、窗口控制区，以及在支持平台上更完整的非客户区语义。

这意味着目标不是单纯视觉换皮，而是让 ExoMind 的窗口本身成为产品体验的一部分。

## 范围

### 本文档要覆盖

- Windows / macOS / Linux 下窗口壳层的基本原理
- `client area（客户区）` 与 `non-client area（非客户区）` 的设计含义
- 为什么 `decorations(false)` 只是起点，不是结果
- ExoMind 在 Tauri 架构下应如何分层实现
- 推荐的推进阶段与验证顺序

### 本文档不覆盖

- 具体视觉稿
- 具体 API 全量枚举
- 一次性完整多窗口系统设计
- 移动端状态栏 / 安全区问题

## 相关议题与本地参考

- `#358`：桌面窗口边界 / 标题栏 / client chrome 主议题
- `#914`：客户端更像 App 而非网页的体验基线
- `#646`：未来桌面多窗口 / 页面即窗口模型
- `#920`：系统标题栏中的版本信息，后续需迁移进自定义标题栏

相关代码入口：

- [src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json)
- [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs)
- [src-tauri/src/commands/shortcut_commands.rs](../../src-tauri/src/commands/shortcut_commands.rs)
- [src-tauri/src/commands/now_workbench_overlay_commands.rs](../../src-tauri/src/commands/now_workbench_overlay_commands.rs)
- [src/pages/NowWorkbenchOverlayPage.tsx](../../src/pages/NowWorkbenchOverlayPage.tsx)
- [docs/development/ui-spec.md](../development/ui-spec.md)

## 核心原则

### 原则 1：目标是 ExoMind 自己的一版窗口边界，不是单纯去系统边框

“把系统壳层去掉”只是技术动作。

真正要交付的是：

- ExoMind 自己定义的标题栏
- ExoMind 自己定义的边界层次
- ExoMind 自己定义的窗口信息承载
- ExoMind 自己定义的激活态 / 非激活态反馈

如果最后只落成 `decorations(false) + 顶部一排按钮`，这件事就会退化成普通 frameless 实现，而不是 ExoMind 的产品壳层。

### 原则 2：窗口边界本质上是“语义几何”，不是单纯视觉

窗口壳层不是一张图，而是一组区域语义：

- 哪些区域可以拖拽
- 哪些区域可以缩放
- 哪些区域是窗口控制按钮
- 哪些区域只负责显示，不接受窗口级交互

系统不关心“这里看起来像标题栏没有”，系统关心“这里到底算拖拽区、缩放边、还是普通内容区”。

### 原则 3：保留系统级窗口行为，比纯自定义视觉更重要

一个合格的 ExoMind 自定义窗口壳层，不只是更沉浸，还必须继续像一个正式桌面窗口：

- 能拖拽
- 能最小化
- 能最大化 / 还原
- 有清晰激活态
- 缩放边命中可靠
- 不破坏平台常用行为

如果它看起来更像 ExoMind，但行为更不像桌面窗口，这就是退步。

### 原则 4：平台一致的是产品语义，不是像素级外观

Windows、macOS、Linux 的窗口文化不同。

应该统一的是：

- ExoMind 的状态层次
- ExoMind 的信息结构
- ExoMind 的品牌与沉浸感

不应该强求的是：

- 三端完全相同的窗口按钮位置
- 三端完全相同的边界命中方式
- 三端完全相同的最大化 / 标题栏细节

## 操作系统原理

## Windows

### 1. 客户区与非客户区

Windows 传统窗口会把界面分成两部分：

- `client area`
  应用自己绘制的内容区
- `non-client area`
  系统默认管理的壳层区，例如标题栏、边框、窗口按钮、拖拽区、缩放区

ExoMind 要做的事情，本质上是把部分原本属于非客户区的能力，转移到客户端自己定义和绘制。

### 2. 关键不在“画”，而在“命中测试”

在 Windows 里，自定义窗口边界的核心不是视觉，而是：

- 哪块区域返回标题栏语义
- 哪块区域返回边缘缩放语义
- 哪块区域返回普通内容语义

也就是说，窗口边界首先是系统交互合同，其次才是视觉表现。

### 3. DWM 与现代合成桌面

现代 Windows 下，窗口最终显示由 DWM 合成。

这意味着：

- 阴影
- 圆角
- 透明
- 部分边界观感

不完全是应用单独控制的。

因此 ExoMind 不应追求“完全脱离系统”，而应采用：

> 客户端绘制为主，系统级窗口行为保底

### 4. Windows 侧必须警惕的点

- DPI 变化
- 多显示器坐标与 scale 差异
- 最大化后的边界 / 内边距变化
- Snap / 贴边行为
- 激活态 / 非激活态切换
- 边缘缩放命中可靠性

## macOS

### 1. 更适合“融合 titlebar”，不适合彻底重写平台壳层

macOS 对窗口标题栏与 toolbar 的融合有更强的平台预期。

用户通常默认接受：

- 左上角 traffic lights
- 与 titlebar 融合的工具栏
- 平台化的标题栏拖拽 / 双击语义

所以 ExoMind 在 macOS 上更适合的思路通常不是“彻底重写所有外壳”，而是：

- 保留平台关键窗口语义
- 让内容延伸到标题栏区域
- 在标题栏区域内融入 ExoMind 的视觉和信息结构

### 2. macOS 上真正要避免的事

- 把窗口做得完全不像 Mac 软件
- 强制复用 Windows 那套按钮布局
- 为追求统一而破坏平台直觉

## Linux

### 1. Linux 最大的问题是生态碎片

Linux 桌面环境没有统一壳层行为。

需要面对：

- X11
- Wayland
- 不同 compositor / window manager
- server-side decorations 与 client-side decorations 差异

### 2. Linux 上的设计策略应更保守

Linux 往往更容易接受 CSD，但也更容易因为桌面环境差异导致体验不一致。

因此 ExoMind 在 Linux 上的原则应是：

- 先保证基础窗口行为稳定
- 再逐步增加更强的 client chrome 表现
- 不把 Linux 当成与 Windows 完全等价的假设平台

## 软件架构原理

### 1. `decorations(false)` 只是能力开关，不是产品实现

`decorations(false)` 的含义只是：

> 告诉系统不要帮你画默认壳层。

一旦系统不画，应用就必须自己补：

- 标题栏
- 按钮
- 拖拽区
- 激活反馈
- 部分边界语义

所以它只是入口，不是交付物。

### 2. 视觉层、交互层、系统契约层必须分开

一个成熟的桌面 client chrome 至少应拆成三层：

#### 视觉层

负责：

- 标题栏布局
- 边界样式
- 分隔线
- 材质 / 阴影 / 颜色 / 激活态表现

#### 交互层

负责：

- 拖拽区域
- 双击最大化 / 还原
- 按钮 hover / press / disabled
- 边界缩放触发区

#### 系统契约层

负责：

- 最小化 / 最大化 / 关闭
- 焦点变化
- 平台行为保留
- DPI / 多显示器 / 最大化边界

如果三层混在一起，后续平台适配会非常痛苦。

### 3. Tauri 下天然是“前端画壳层，原生承接窗口语义”

在 ExoMind 的 Tauri 架构里：

- HTML / CSS / React 适合画窗口头部和边界视觉
- Rust / Tauri command 负责窗口级能力与平台差异

这意味着主窗口 client chrome 的实现应避免两种极端：

- 极端 1：全靠前端假装一套窗口 UI，但不接原生行为
- 极端 2：全靠原生硬编码壳层，失去 ExoMind 的设计控制

正确路线是：

> 前端负责壳层视觉与区域声明，原生负责窗口行为与平台适配。

## ExoMind 当前代码现状的原理判断

### 1. 主窗口还没有进入 client chrome 阶段

当前主窗口仍然依赖系统标题栏：

- [src-tauri/tauri.conf.json](../../src-tauri/tauri.conf.json) 只配置了普通窗口参数
- [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) 仍用 `set_title()` 承载标题文本

所以主窗口目前仍属于“系统壳层 + WebView 内容”的模式。

### 2. overlay 已经验证了局部技术路径

当前 overlay 方案已经证明两件事：

- 可以使用无装饰窗口
- 可以在前端标记拖拽区

参考：

- [src-tauri/src/commands/shortcut_commands.rs](../../src-tauri/src/commands/shortcut_commands.rs)
- [src-tauri/src/commands/now_workbench_overlay_commands.rs](../../src-tauri/src/commands/now_workbench_overlay_commands.rs)
- [src/pages/NowWorkbenchOverlayPage.tsx](../../src/pages/NowWorkbenchOverlayPage.tsx)

因此 ExoMind 主窗口 client chrome 不是从零开始，而是从“overlay 先例”提升到“主窗口体系”。

### 3. 旧问题定义过弱

旧表述“使用内部边界作为窗口边界”有两个问题：

- 它更像技术手段，而不是产品目标
- 它无法约束实现必须体现 ExoMind 自己的设计风格

因此 `#358` 已改为“自定义桌面窗口边界与标题栏”，这是必要的语义升级。

## 参考实现抽象（仅作内部设计启发，不在公开 issue / PR 中点名）

近期对一个公开的 `Tauri + Vue + Rust` 多窗口桌面应用做了更细的实现级调研。它真正值得借鉴的，不是视觉主题本身，而是它如何把“客户端自定义窗口壳层”做成一套可复用的桌面基础设施。

### 1. 它不是只做了一个标题栏组件，而是把窗口壳层放在 App Root

这个参考实现的主窗口不是“页面里最上方加一条 header”。

它在应用根组件中直接定义：

- `window-frame`
- `titlebar`
- `window-body`
- 自定义窗口控制按钮
- 自定义缩放命中区

也就是说，它把窗口壳层当作桌面应用根骨架，而不是普通页面局部 UI。

这点非常关键。

如果 ExoMind 后续只在某个页面顶部插入一条自定义 header，而不是在主窗口根层建立真正的 `Window Chrome Shell`，那么最后做出来的仍然会是“网页内容 + 假标题栏”，而不是自己的桌面窗口边界。

### 2. 它把窗口壳层做成“多窗口共享语法”，不是单窗口特例

这个参考实现不是只给一个主窗口做特殊皮肤。

它的主窗口、终端窗口、工作区选择窗口，都会复用同一种窗口壳层策略：

- 无系统装饰
- 透明背景
- 根层自定义标题栏
- 同一套窗口激活态 / 非激活态
- 同一套圆角与边界处理思路

只是不同窗口在标题文本、视图内容、初始脚本上有差异。

这说明一个成熟做法不是“先给主窗口临时写一版”，而是尽早把窗口壳层提升成共享基础设施。

对 ExoMind 的含义是：

- 先做主窗口 spike 没问题
- 但实现结构必须天然允许后续复用到 overlay / 二级窗口 / future page-as-window

### 3. 它在前端层明确承担了四类窗口职责

这个参考实现的前端根组件负责的不只是视觉，还包括窗口交互语义声明：

- 标题栏 DOM 作为拖拽区
- 双击标题栏触发最大化 / 还原
- 最小化 / 最大化 / 关闭按钮
- 明确的八方向缩放命中区

特别值得注意的是，它不是把缩放完全寄托给系统边框，而是在前端放置透明 resize handles，再调用原生窗口缩放能力。

这说明“client-defined window chrome”在前端层至少要显式承担：

- drag regions
- window controls
- resize hit targets
- focus / maximize visual state

如果只做前两项，不做后两项，体验会停留在“半成品自定义标题栏”。

### 4. 它在原生层明确承担了四类平台托底职责

这个参考实现的 Rust / Tauri 侧做的事情并不轻：

- 静态主窗口与动态新窗口统一采用 `decorations(false)`
- 配合 `transparent(true)` 与平台化 `shadow` 策略
- macOS 额外保留 `title bar overlay` 路线，而不是强行按 Windows 方式硬做
- Windows 额外补圆角区域、frame refresh、窗口显示后重绘修正

这说明前端再强，也不可能独立完成桌面窗口壳层。

原生层必须承担：

- window creation policy
- platform-specific fixes
- frame refresh
- maximize / rounding / shadow compatibility

对于 ExoMind，这再次印证：

> 前端负责“声明和绘制窗口壳层”，原生负责“让这套壳层在不同平台上真正像窗口”。

### 5. Windows 上最值得借鉴的是“补丁意识”，不是视觉风格

这个参考实现在 Windows 上明显不是天真地认为：

> `decorations(false)` 打开后，一切都会自然工作。

它额外处理了这些问题：

- frameless + transparent + shadow 组合在 Windows 上可能出现白边
- 无边框窗口的圆角需要额外裁剪或区域设定
- hide / show / maximize 后窗口 frame 可能需要主动 refresh
- 最大化与普通态下，圆角策略要变化

这类处理说明：

- 桌面 client chrome 在 Windows 上一定会有平台补丁层
- 这层补丁不是“以后再说”的尾活，而是架构的一部分

ExoMind 后续实现时，不应把 Windows 特殊处理混在 React 组件里，而应放进 `Platform Window Adapter`。

### 6. 它值得借鉴的是“壳层分工”，不是“赛博主题”

这个参考实现的视觉方向很强，带有明显的玻璃、渐变、赛博氛围与控制面板感。

这些并不适合直接照搬到 ExoMind。

ExoMind 应借鉴的是：

- 根层窗口壳层结构
- 标题栏与内容区的分离方式
- 拖拽区 / 控制区 / 缩放区的职责拆分
- 激活态 / 非激活态的明确反馈
- 多窗口共享 window chrome grammar

ExoMind 不应照搬的是：

- 对方的主题色
- 对方的字体系统
- 对方的密集控制台气质
- 对方的赛博朋克氛围表现

ExoMind 仍应延续自己的：

- page shell 层次
- overlay shell 气质
- 更偏长期使用、可呼吸、低噪声的桌面壳层表达

### 7. 对 ExoMind 的直接实现启发

结合这次调研，ExoMind 的推荐路线可以更具体地收敛成下面几条：

#### A. 主窗口壳层必须放在应用根层，而不是某个页面内部

至少应形成：

- `DesktopWindowFrame`
- `DesktopWindowTitlebar`
- `DesktopWindowControls`
- `DesktopResizeHandles`

#### B. 主窗口与未来二级窗口应共享一套 shell grammar

可以不同尺寸、不同信息密度，但不应每个窗口各发明一套标题栏。

#### C. Windows 必须预留平台补丁层

至少提前预留：

- 圆角策略
- shadow / white edge 策略
- maximize 后 frame 行为
- show / hide / restore 后 refresh 策略

#### D. 不要把“沉浸感”理解成更厚重的装饰

沉浸感更大程度来自：

- 窗口边界与内容是同一语言
- 标题栏不再像外来的系统附加物
- 激活态 / 非激活态反馈自然
- 控件与拖拽 / 缩放行为一致可信

而不是简单增加：

- 更重的玻璃
- 更多的发光
- 更强的装饰渐变

#### E. 对外表述继续保持抽象，不绑定具体外部产品名

公开 issue / PR / 设计说明里，统一表述为：

- 参考公开桌面 client shell 做法
- 参考 Tauri 桌面窗口壳层最佳实践
- 结合 ExoMind 自身 page shell / overlay shell 演进

不把具体外部项目名写进公开叙述中，避免把 ExoMind 的窗口设计描述成某个产品的变体。

## 推荐的实现分层

建议后续实现至少按下面五层组织：

### Layer 1: Window Chrome Tokens

定义：

- 激活态 / 非激活态颜色
- 标题栏高度
- 边界厚度
- 分隔线与阴影
- 按钮间距与 hit area

这层必须受 [docs/development/ui-spec.md](../development/ui-spec.md) 约束。

### Layer 2: Window Chrome React Shell

负责：

- 标题区布局
- 标题 / 版本 / 身份信息
- 控制按钮
- 拖拽区域 DOM 标记

这是 ExoMind “看起来像自己”的核心层。

### Layer 3: Window Interaction Regions

负责：

- 哪块区域能拖
- 哪块区域能双击最大化
- 哪块区域禁止拖拽
- 哪块区域用于边界缩放

这一层应当显式，不应把交互语义散落到普通业务组件里。

### Layer 4: Platform Window Adapter

负责：

- Windows 适配
- macOS 适配
- Linux 适配

职责是把统一的 ExoMind window chrome 语义映射成各平台可接受的窗口行为。

### Layer 5: Verification Matrix

负责：

- 平台差异验证
- 最大化态验证
- DPI / 多屏验证
- 焦点 / 激活态验证

这一层必须在实现初期就存在，不应等 UI 做完才补。

## 推荐推进阶段

## Phase 0：原则冻结

先冻结这些问题，不写代码也要定：

- ExoMind 要的是自己的窗口边界，不是通用 frameless
- 主窗口优先，overlay 方案只作先例参考
- Windows 首先验证，macOS / Linux 做平台差异留白
- 标题 / 版本 / 身份信息必须迁移到自定义标题栏

## Phase 1：Windows 主窗口 spike

只做 Windows 主窗口：

- 自定义标题栏
- 拖拽区
- 最小化 / 最大化 / 关闭
- 激活态 / 非激活态

不在这一阶段试图做完完整多窗口系统。

## Phase 2：统一 ExoMind Window Chrome Shell

把 spike 结果沉淀成可复用的主窗口壳层组件与原生桥，而不是写一堆一次性逻辑。

## Phase 3：平台适配

逐步补：

- macOS 融合式 titlebar 策略
- Linux 保守兼容策略

## Phase 4：更完整非客户区接管评估

只有在前面三阶段稳定后，才评估：

- 更完整边界缩放命中
- 更完整平台差异吸收
- 与未来多窗口模型的整合

## 验证矩阵

后续实现至少要覆盖这些验证维度：

### Windows

- 普通窗口
- 最大化窗口
- 多显示器
- 高 DPI
- Snap / 贴边
- 激活态 / 非激活态

### macOS

- traffic lights 布局
- titlebar 融合
- 全屏 / 还原
- 激活态

### Linux

- GNOME / KDE 至少一类主流桌面
- X11 / Wayland 差异记录
- 基础拖拽 / 缩放 / 最大化可用性

### 产品一致性

- 是否符合 ExoMind 既有 page shell / overlay shell 风格
- 是否保留标题 / 版本 / 身份信息
- 是否显著提升沉浸感，而不是只把系统边框删掉

## 当前结论

ExoMind 这条需求的正确技术和产品定义，不是：

> 做一个无边框窗口。

而是：

> 为 ExoMind 桌面主窗口实现一套基于自身设计语言的 client-defined window chrome（客户端自定义窗口壳层），并在不同桌面平台上尽量保留正式窗口应有的系统行为。

所以后续所有实现决策，都应服从这三个判断：

1. 这是窗口语义问题，不只是视觉问题。
2. 这是平台适配问题，不只是前端问题。
3. 这是 ExoMind 产品壳层问题，不只是技术上的 `decorations(false)`。

## 内部参考实现启发（匿名化）

以下内容来自一个外部开源桌面应用的只读调研，仅作为 ExoMind 内部实现启发使用。

这里记录的是“值得借鉴的做法抽象”，不是公开对标文案，也不应直接进入公开 issue / PR 描述。

### 为什么它值得参考

它的相关性不在于视觉主题，而在于它已经把桌面窗口当成产品壳层来实现，而不是把 Web 内容直接塞进系统标题栏下面。

它实际体现的是：

- 主窗口使用 client-defined window chrome
- 多窗口表面共享统一窗口壳层语言
- 前端壳层与原生窗口语义有明确分工
- 平台差异没有被假装抹平，而是做了局部让步

### 观察到的关键实现模式

#### 模式 1：先把系统壳层撤掉，再谈自定义壳层

它的桌面窗口配置不是“保留系统标题栏，再做一点 CSS 修饰”，而是直接把系统默认壳层关闭，然后由应用自己承担窗口壳层职责。

对 ExoMind 的启发是：

- `decorations(false)` 只是第一步，但这一步必须尽早进入 spike
- 如果系统壳层还在，很多真正的标题栏 / 边界问题不会暴露出来

#### 模式 2：窗口壳层是根布局，不是页面里的一个局部组件

它把整个应用根节点拆成：

- `window-frame`
- `titlebar`
- `window-body`

这意味着标题栏不是某个页面 header 的特例，而是整个桌面窗口最外层结构的一部分。

对 ExoMind 的启发是：

- 后续应区分 `app shell / page shell / window chrome shell`
- 自定义标题栏不应直接塞进普通页面内容树里
- `PageShell` 不能替代 `WindowChromeShell`

#### 模式 3：拖拽区、按钮区、双击最大化是显式语义

它没有把“能不能拖拽”交给视觉猜测，而是显式区分：

- 标题栏拖拽区
- 按钮排除拖拽
- 双击标题栏最大化 / 还原

这符合前面文档说的“窗口边界是语义几何”。

对 ExoMind 的启发是：

- 后续必须显式建模 drag region
- 窗口控制按钮必须显式排除拖拽
- 双击标题栏这一类桌面惯例应当保留

#### 模式 4：边缘缩放不是浏览器盒模型，而是独立交互层

它在窗口最外层额外放置了不可见的边缘 / 角落命中区，并把这些命中区映射到原生窗口 resize dragging。

这说明一个成熟 client chrome 不会只依赖系统残留边框，也不会试图用普通 DOM resize 模拟正式窗口缩放。

对 ExoMind 的启发是：

- 需要单独的 `WindowResizeHandles` / `WindowInteractionRegions`
- 缩放命中区应和视觉边框解耦
- Windows 首期实现就要验证四边与四角，不然后面补会更痛

#### 模式 5：窗口状态直接参与壳层视觉

它把下面这些窗口状态直接映射到根壳层 class / style：

- 最大化态
- 焦点态 / 非焦点态
- hover 恢复前的抑制态

也就是说，窗口壳层样式不是纯静态皮肤，而是跟窗口生命周期联动的状态机。

对 ExoMind 的启发是：

- 后续需要 `isFocused / isMaximized / isFullscreen / isPointerReady` 这一类壳层状态
- 激活态 / 非激活态不应只影响标题文字，还应影响边界、阴影、材质和按钮反馈

#### 模式 6：平台统一的是壳层语义，不是所有像素

它在 macOS 上没有强制照搬 Windows 那套标题按钮，而是保留平台约定位置，并在布局上预留空间。

这正好印证了前文原则：

- 平台一致的是产品语义
- 平台不一致的是局部窗口细节

对 ExoMind 的启发是：

- Windows 可以优先完整接管窗口控制区
- macOS 更适合走“融合 titlebar”而不是“完全重写 traffic lights”
- Linux 要按兼容性优先，而不是先追求三端完全同形

#### 模式 7：原生层负责圆角与窗口区域修正，前端不硬扛

它在 Windows 原生层显式处理：

- 窗口圆角区域
- 最大化 / 全屏时圆角切换
- 显示 / 恢复后的 frame refresh

这说明前端 CSS 本身不足以兜住完整桌面窗口边界行为，原生适配层是必需品。

对 ExoMind 的启发是：

- 后续 `PlatformWindowAdapter` 不能只是按钮命令桥
- Windows 需要专门处理圆角、最大化、恢复、frame refresh 一类问题

#### 模式 8：同一套壳层语言要覆盖主窗与辅助窗口

它不仅主窗口这么做，终端窗口、工作区选择窗口、通知预览窗口也延续了同类壳层处理方式。

这意味着它把窗口壳层当成一套跨窗口 surface system，而不是一次性的主页面样式。

对 ExoMind 的启发是：

- `#358` 不应只做主窗口一次性标题栏
- 需要从一开始考虑未来主窗口、overlay、潜在 secondary window 的壳层一致性
- 但落地顺序仍应是“先主窗口，后抽象复用”

### ExoMind 可以借的，不该借的

#### 可以借

- 把窗口壳层提升为根级结构，而不是页面内 header
- 把拖拽、缩放、控制按钮做成显式交互语义层
- 把窗口状态纳入壳层 token 与视觉状态机
- 让前端负责壳层视觉，原生负责 frame / rounding / resize / focus 等平台适配
- 用同一套壳层语言覆盖未来多窗口体系

#### 不该直接照搬

- 对方产品的赛博 / 玻璃 / 高饱和主题
- 对方的品牌色、字体气质、图标语言
- 对方全局 `user-select` 与交互抑制策略
- 对方的信息架构与导航层级

ExoMind 要借的是：

- “桌面窗口本身是产品壳层”的实现思路

而不是：

- “把对方视觉主题移植过来”

### 对 ExoMind 实现排序的进一步修正

结合这次参考调研，ExoMind 后续更合理的落地顺序应是：

1. Windows 主窗口先建立 `WindowChromeShell`
2. 明确 drag region / control region / resize region 三类交互区
3. 让焦点态、最大化态、恢复态进入壳层状态机
4. 再把这套能力抽到共享的 `PlatformWindowAdapter`
5. 最后再讨论 overlay / secondary window 的统一壳层扩展

这进一步说明：

- 先写一个好看的标题栏，不够
- 先做一层 CSS 壳子，也不够
- 必须从第一版开始就把“窗口交互语义 + 原生适配”一起设计进去
