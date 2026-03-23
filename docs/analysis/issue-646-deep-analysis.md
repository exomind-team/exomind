# Issue #646 深度分析报告

> **research(desktop-windowing): 顶级导航页逐步独立为窗口，并定义多窗口/标签聚合/移动端回退模型**
> 分析日期：2026-03-21 | 分析基线：dev@9a15d06f

---

## 一、用户背景与意图分析

### 1.1 用户画像还原

提出者是 ExoMind 的核心用户兼开发者（@ARCJ137442），日常使用场景：

| 场景 | 当前体验 | 痛点 |
|------|---------|------|
| **专注工作** | 在「当下」页停留，偶尔切到「任务」查状态 | 切换导航=离开工作语境 |
| **多任务并行** | 反复在 当下↔任务↔网络 之间切换 | 单窗口只能看一个页面 |
| **桌面大屏** | 1920+ 宽屏只显示一个页面 | 屏幕空间严重浪费 |
| **悬浮窗辅助** | now-workbench-overlay 提供计时 | 悬浮窗是特制的，不能放任意页面 |

### 1.2 核心意图拆解

用户的需求不是"做一个多窗口功能"，而是一种**空间使用权的回归**：

1. **心智模型升级**：从"应用里有几个页面"升级为"每个页面都是独立工作台"
2. **上下文保持**：在看「任务依赖图」的同时能保持「当下」页面的计时器和记录入口
3. **渐进式解耦**：不是一步到位把所有页面拆成窗口，而是"高频页面先独立"
4. **移动端不掉队**：桌面端走向多窗口时，移动端不应变成功能残缺版

### 1.3 隐含诉求（Issue 文本未显式表达但可推导）

- **窗口布局记忆**：关闭再打开时，窗口位置/大小能恢复
- **窗口间快速切换**：类似 Alt+Tab 但只在 ExoMind 窗口间切换
- **最小化 → 悬浮窗**：大窗口可以"缩小为"悬浮窗模式（mini mode）
- **统一的关闭语义**：关闭子窗口 ≠ 关闭应用，关闭主窗口才退出

---

## 二、现状诊断（As-Is）

### 2.1 当前架构快照

```
┌─────────────────────────────────────────────┐
│                 Tauri App                    │
│                                              │
│  ┌──────────┐     ┌──────────────────────┐  │
│  │ main     │     │ 独立 HTML 窗口       │  │
│  │ window   │     │                      │  │
│  │          │     │ • voice-overlay      │  │
│  │ ┌──────┐ │     │ • now-workbench-     │  │
│  │ │React │ │     │   overlay            │  │
│  │ │ App  │ │     │                      │  │
│  │ │      │ │     │ (各自独立 HTML 入口,  │  │
│  │ │Router│ │     │  无共享 React 上下文) │  │
│  │ └──────┘ │     └──────────────────────┘  │
│  └──────────┘                                │
│                                              │
│  Rust 层：lib.rs + commands/                 │
│  • now_workbench_overlay_commands.rs          │
│  • shortcut_commands.rs                      │
│  • voice_overlay_commands.rs                 │
└─────────────────────────────────────────────┘
```

### 2.2 关键代码分析

**路由层**（`src/routes.tsx`）：
- 所有页面注册在单一 `newRootRoute` 下，共享 `NewLayout` 壳层
- `NewLayout` 通过 `useIsDesktop()` 判断走 `DesktopLayout`（侧边栏+内容区）还是 `MobileShell`（底部Tab）
- 页面全部 `lazy()` 加载，但都在**同一个 React 树**中

**App 初始化**（`src/App.tsx`）：
- `useSignalStream()` 在 App 级别调用一次 — 整个应用只有一个 SSE 连接
- `initVoiceShortcutService()` / `initMainWindowShortcutService()` / `getNowWorkbenchOverlayService().init()` 都是全局单例
- 这些初始化逻辑**假设只有一个 main window**

**信号流**（`src/ui/hooks/useSignalStream.ts`）：
- 每次调用都会 `new SignalStreamService()` 并 `start()` — 如果多个窗口各自初始化 App，**会产生多个并行 SSE 连接**
- 信号处理器（eventlog.appended、review.completed）会在每个窗口各执行一次 — **数据可能重复写入**

**已有悬浮窗**（`src-tauri/src/commands/now_workbench_overlay_commands.rs`）：
- 使用 `WebviewWindowBuilder` 创建，加载独立 `now-workbench-overlay.html`
- `#[cfg(not(any(target_os = "android", target_os = "ios")))]` 条件编译 — 移动端直接裁掉
- 属性：`always_on_top(true)`, `decorations(false)`, `skip_taskbar(true)` — 纯悬浮窗，不是"页面窗口"

**Tauri Capabilities**（`src-tauri/capabilities/`）：
- `default.json`：仅授权给 `main` 窗口
- `now-workbench-overlay.json`：仅授权给 `now-workbench-overlay` 窗口
- **当前没有** `core:webview:allow-create-webview-window` 权限 — 前端**无法**动态创建窗口

### 2.3 缺失清单

| 维度 | 现状 | 缺失 |
|------|------|------|
| 窗口创建 | 只有预定义的 overlay 窗口 | 无通用窗口创建机制 |
| 路由所有权 | 所有路由在单一 React 树 | 无"窗口绑定路由"概念 |
| 窗口去重 | 不存在 | 无去重/聚焦已有窗口逻辑 |
| 跨窗口状态同步 | 不需要（只有一个主窗口） | 无同步机制 |
| RT 订阅管理 | 单一 SSE 连接 | 多窗口会产生多个连接 |
| 窗口生命周期 | 主窗口关闭=退出 | 无主/子窗口层级管理 |
| 移动端回退 | DesktopLayout / MobileShell 二选一 | 无"多窗口回退为聚合导航"的抽象 |
| Tauri 权限 | 仅 main + overlay | 无动态窗口权限模板 |

---

## 三、预期与差距分析（Gap Analysis）

### 3.1 Issue 声明的完成条件 vs 可达性评估

| 完成条件 | 难度 | 前置依赖 | 评估 |
|----------|------|---------|------|
| 明确"页面即窗口"是否为长期方向 | 低 | 产品决策 | ✅ 可在讨论中决定 |
| 明确三层（顶级/子路由/详情）独立窗口边界 | 中 | 需先理解 RT 订阅成本 | ⚠️ 需要量化数据支撑 |
| 明确主窗口/标签宿主/独立窗口/mini悬浮窗关系 | 高 | 需架构原型验证 | ⚠️ 光靠讨论难以定论 |
| 明确移动端回退策略 | 中 | 需先确定桌面模型 | ⚠️ 依赖桌面方案 |
| 明确 RT/重复窗口/合并/一致性约束 | 高 | 需要原型验证 | ❌ 纯讨论不够，需 spike |
| 拆出后续 spec/architecture/feat issue | 低 | 以上都完成后 | ✅ 自然产出 |

### 3.2 核心差距

**最大的差距不是"能不能做多窗口"，而是"ExoMind 的信号流架构是否支撑多窗口"。**

当前 `useSignalStream` 在每个前端实例初始化时创建独立的 SSE 连接，且信号处理器（eventlog 写入、review 处理）**没有幂等保护**。这意味着：

```
主窗口 App init → SSE 连接 1 → eventlog.appended → 写入 EventLog
子窗口 App init → SSE 连接 2 → eventlog.appended → 重复写入 EventLog ← 问题！
```

这不是"多开浏览器标签"的安全问题 — 这是**架构级的数据一致性风险**。

---

## 四、可行性评估

### 4.1 技术可行性（Tauri 2.0 侧）

| 能力 | Tauri 2.0 支持 | ExoMind 现状 | 改造工作量 |
|------|---------------|-------------|-----------|
| 动态创建窗口 | ✅ `WebviewWindowBuilder` / 前端 `WebviewWindow` | 已有 overlay 先例 | 小 |
| 窗口权限隔离 | ✅ Capabilities per window | 需新增权限模板 | 小 |
| 跨窗口事件 | ✅ `emit_to()` / `listen()` | 未使用 | 中 |
| 窗口位置/大小持久化 | ✅ `tauri-plugin-window-state` | 未集成 | 小 |
| 系统托盘 | ✅ `tauri-plugin-tray` | 未使用 | 小 |
| 前端跨窗口状态同步 | ❌ 需自建（Tauri 事件 or BroadcastChannel） | 无 | **大** |
| 单 React 树跨窗口 | ❌ Tauri 不支持（非 Electron） | 不适用 | 需重新架构 |

**关键限制**：Tauri 2.0 的每个窗口是独立的 WebView 进程，**不共享 JavaScript 上下文**。这意味着不能像 Electron 的 `window.open` 那样在新窗口继承父窗口的 React 状态。每个窗口需要独立初始化 React 应用。

### 4.2 架构可行性评估

```
                        可行性评分（1-5）

页面即窗口（顶级导航）   ████░ 4/5 — 技术可行，需要解决信号流重复
标签聚合宿主窗口        ███░░ 3/5 — Tauri 原生不支持标签，需自建
子路由独立窗口          ██░░░ 2/5 — 粒度过细，状态同步代价高
mini 悬浮窗谱系         ████░ 4/5 — 已有先例(now-workbench-overlay)
移动端回退模型          ████░ 4/5 — 可复用已有 MobileShell 模式
```

### 4.3 成本效益分析

| 方案 | 开发成本 | 用户价值 | ROI |
|------|---------|---------|-----|
| A. 顶级导航页可弹出为独立窗口 | 中（2-3 周） | 高 | ★★★★ |
| B. A + 标签聚合宿主 | 高（4-6 周） | 中 | ★★★ |
| C. B + 子路由也可独立 | 很高（6-8 周） | 低（边际递减） | ★★ |
| D. C + 完整 mini 悬浮窗谱系 | 极高（8+ 周） | 低 | ★ |

**建议**：先做 A，验证后再渐进至 B。C 和 D 是远期愿景。

---

## 五、技术难点深度分析

### 5.1 难点一：信号流（SSE）的多窗口安全

**问题**：当前每个窗口实例化 App 时都会调用 `useSignalStream()`，产生独立 SSE 连接。信号处理器（`onEventLogAppended`、`onReviewCompleted`）会在**每个窗口各执行一次**，导致数据重复写入。

**解决方案**：引入**主窗口代理订阅**模式。

```
┌─────────────┐    SSE     ┌─────────┐
│ 主窗口      │←──────────│ RT 后端  │
│ (唯一SSE)   │           └─────────┘
│             │
│ Tauri Event │──emit_to──→ ┌────────────┐
│ Broadcaster │──emit_to──→ │ 子窗口 1   │
│             │──emit_to──→ │ 子窗口 2   │
│             │             │ 子窗口 N   │
└─────────────┘             └────────────┘
```

实现要点：
- 只有主窗口建立 SSE 连接并执行写操作
- 子窗口通过 Tauri `listen()` 接收投影后的数据变更通知
- 窗口标识：通过 `window.__TAURI_INTERNALS__.metadata.currentWindow.label` 判断是否为 main

### 5.2 难点二：前端状态同步

**问题**：zustand store 在不同窗口是完全独立的内存。当用户在窗口 A 切换了档案，窗口 B 的状态不会自动更新。

**解决方案**：分层同步策略。

| 状态类型 | 同步策略 | 机制 |
|---------|---------|------|
| **持久化配置**（主题、设置） | localStorage + StorageEvent | 浏览器原生 |
| **运行时状态**（当前档案、活跃时间块） | Tauri Event 广播 | `emit_to` all windows |
| **临时UI状态**（滚动位置、面板展开） | 不同步 | 各窗口独立 |
| **数据变更**（EventLog、Task） | RT 信号 → 主窗口 → 广播 | 已有 SSE 信号 |

### 5.3 难点三：窗口生命周期管理

**问题**：关闭主窗口时，子窗口该怎么处理？多个窗口打开同一路由怎么去重？

**规则建议**：

```
主窗口（shell）
├── 关闭行为：关闭=最小化到托盘（桌面端）/ 关闭=退出应用（Web端）
├── 职责：SSE 连接、全局快捷键、系统托盘、窗口注册表
│
独立页面窗口
├── 关闭行为：关闭=销毁窗口（不退出应用）
├── 去重规则：
│   ├── 同一顶级路由（如 /tasks）：聚焦已有窗口
│   └── 同一路由不同参数（如 /tasks/123 vs /tasks/456）：允许多开
│
mini 悬浮窗
├── 关闭行为：关闭=隐藏（不销毁，下次可快速恢复）
└── 职责：精简视图，always_on_top
```

### 5.4 难点四：路由与窗口的所有权映射

**问题**：当前所有路由在一个 React 树里。如果窗口 A 打开了 `/tasks/dag`，用户在里面点击了某个任务详情 `/tasks/123`，这个导航应该在窗口 A 内发生还是弹出新窗口？

**设计原则**：**窗口绑定页面类型，内部导航在窗口内完成**。

```
窗口 A 绑定 /tasks/* 路由域：
  /tasks       → 任务列表
  /tasks/dag   → 依赖图     ← 窗口内导航
  /tasks/123   → 任务详情   ← 窗口内导航

窗口 B 绑定 /eventlog 路由域：
  /eventlog    → 当下/专注

跨域跳转（从 /tasks 跳到 /eventlog）：
  → 聚焦或创建目标域窗口
```

### 5.5 难点五：移动端回退模型

**问题**：移动端不支持原生多窗口。桌面端的"页面即窗口"心智模型如何在移动端保持一致？

**回退策略**：

```
桌面端                          移动端
┌──────────┐ ┌──────────┐     ┌──────────────────┐
│ 窗口 A   │ │ 窗口 B   │     │ 聚合导航壳层     │
│ /eventlog│ │ /tasks   │     │                  │
│          │ │          │ ──→ │  底部Tab切换     │
│          │ │          │     │  /eventlog ↔     │
│          │ │          │     │  /tasks          │
└──────────┘ └──────────┘     └──────────────────┘

桌面端 mini 悬浮窗             移动端
┌─────────────┐               ┌──────────────────┐
│ 当下悬浮窗  │               │ 通知栏常驻通知   │
│ (always_on_ │           ──→ │ + 浮动小按钮     │
│  top)       │               │                  │
└─────────────┘               └──────────────────┘
```

关键设计：引入 `WindowAbstraction` 层，让上层业务代码不关心"窗口"还是"Tab"。

```typescript
interface WorkspaceSlot {
  id: string;
  routeDomain: string;        // '/tasks' | '/eventlog' | '/agents' | ...
  mode: 'window' | 'tab';     // 桌面=window, 移动=tab
  state: 'active' | 'hidden'; // 当前是否在前台
}
```

---

## 六、行业参考与模式选型

### 6.1 参考产品对比

| 产品 | 多窗口模式 | 标签聚合 | 状态同步 | 适用度 |
|------|-----------|---------|---------|--------|
| **VS Code** | 多窗口，每窗口独立扩展宿主 | 编辑器标签 | 文件系统 + IPC | 中 — 太重 |
| **Figma** | 每个文件一个窗口/标签 | 浏览器标签 | 服务端同步 | 高 — 粒度合理 |
| **Notion** | 单窗口 + 侧边栏 | 无原生多窗口 | 服务端同步 | 低 — 不适用 |
| **Arc Browser** | 多窗口 + Space | 标签 + Space 分组 | 浏览器引擎 | 高 — Space 概念好 |
| **Windows Terminal** | 单窗口 + Tab + Pane | 标签 + 分屏 | 独立进程 | 高 — 最佳参考 |

### 6.2 推荐模式：Windows Terminal 式 + Figma 式混合

```
ExoMind 窗口谱系
├── Shell Window（宿主窗口）
│   ├── 标签栏：[当下] [任务] [网络] [+]
│   ├── 分屏支持（远期）
│   └── 标签可拖出为独立窗口
│
├── Detached Window（独立窗口）
│   ├── 从 Shell 标签拖出 / 从托盘快速打开
│   ├── 可拖回 Shell 成为标签
│   └── 关闭 = 销毁（不影响其他窗口）
│
└── Mini Overlay（悬浮窗）
    ├── 从 Shell/Detached 缩小而来
    ├── always_on_top, decorations(false)
    └── 点击展开回 Shell/Detached
```

### 6.3 Tauri 2.0 多窗口通信模式选型

| 模式 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| Tauri Event (`emit_to`/`listen`) | 原生、可靠、全平台 | 手动序列化 | ★★★★★ |
| BroadcastChannel (Web API) | 简单、标准 | macOS Safari 15.6+ 限制 | ★★★ |
| Rust 共享状态 + IPC | 类型安全、高性能 | 需更多 Rust 代码 | ★★★★ |
| localStorage + StorageEvent | 零成本、已有代码 | 仅适合配置类数据 | ★★★ |

**推荐组合**：
- 配置/偏好同步 → localStorage + StorageEvent（已有）
- 运行时数据同步 → Tauri Event System
- RT 信号转发 → 主窗口代理 + Tauri `emit_to`

---

## 七、实现方法论：渐进式演进路线

### Phase 0: 架构验证 Spike（1 周）

**目标**：用最小代码验证"顶级页面可独立为窗口"的技术可行性。

```
验证内容：
□ Tauri 动态创建窗口加载 /tasks 路由
□ 新窗口能正常渲染 React 页面
□ SSE 信号流不重复（主窗口独占 SSE）
□ localStorage 变更能跨窗口同步
□ 子窗口关闭不影响主窗口
```

交付物：
- `docs/architecture/windowing-spike-report.md` — spike 结论
- 可运行的 PoC 分支

### Phase 1: 基础设施搭建（2 周）

| 任务 | 产出 |
|------|------|
| 窗口注册表服务 | `src/services/window-registry.service.ts` |
| 窗口创建命令 | `src-tauri/src/commands/window_manager.rs` |
| Capabilities 模板 | `src-tauri/capabilities/page-window.json` |
| SSE 主窗口代理 | 改造 `useSignalStream` 为主窗口独占 |
| 跨窗口事件总线 | `src/services/cross-window-bus.service.ts` |

### Phase 2: 顶级导航页独立窗口（2 周）

| 任务 | 产出 |
|------|------|
| "弹出为窗口"按钮 | 侧边栏右键菜单 / 拖拽 |
| 路由域绑定 | 窗口创建时指定路由域 |
| 窗口去重 | 同路由域聚焦已有窗口 |
| 窗口位置持久化 | `tauri-plugin-window-state` 集成 |
| 主窗口最小化到托盘 | 系统托盘图标 + 快速打开 |

### Phase 3: 标签聚合宿主（远期，3 周）

| 任务 | 产出 |
|------|------|
| Shell 窗口标签栏 | React 标签组件 |
| 标签拖入/拖出 | Drag & Drop ↔ 窗口创建/销毁 |
| 标签排序持久化 | localStorage |

### Phase 4: 移动端回退与 mini 悬浮窗（远期）

| 任务 | 产出 |
|------|------|
| WorkspaceSlot 抽象 | `window` / `tab` 统一接口 |
| 移动端"最近页面"列表 | 模拟多窗口切换 |
| 更多 mini overlay | 复用 now-workbench-overlay 模式 |

---

## 八、风险评估与缓解

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|--------|------|---------|
| SSE 重复写入导致数据重复 | **严重** | 高 | Phase 0 spike 验证主窗口独占 SSE |
| 多窗口内存压力 | 中 | 中 | 限制最大窗口数（建议 ≤ 5） |
| macOS BroadcastChannel 不可用 | 中 | 低 | 不依赖 BroadcastChannel，用 Tauri Event |
| 移动端心智模型分叉 | 中 | 高 | Phase 1 就引入 WorkspaceSlot 抽象 |
| 窗口过多导致用户迷失 | 中 | 中 | 提供"合并所有窗口"快捷操作 |
| Tauri 权限管理复杂化 | 低 | 中 | 使用通配符 capabilities 模板 |
| 开发周期膨胀 | 中 | 高 | 严格 Phase 0 spike 决策点：不可行则暂停 |

---

## 九、决策框架：是否接受"页面即窗口"方向

### 9.1 决策树

```
"页面即窗口"是否是 ExoMind 的长期方向？
│
├── YES（接受）
│   │
│   ├── Phase 0 Spike 通过？
│   │   ├── YES → 进入 Phase 1-2
│   │   └── NO → 重新评估架构，可能需要先重构信号流
│   │
│   └── 优先级
│       ├── P1（立即开始 Spike）→ 如果 #418 / #613 等阻塞项已清
│       └── P2（排在其他批次后）→ 当前推荐
│
└── NO（拒绝 / 暂缓）
    │
    └── 替代方案
        ├── 分屏模式（主窗口内左右分屏）— 更轻量
        ├── 浮动面板（类似 VS Code 面板拖出到侧边）
        └── 保持现状 + 优化悬浮窗
```

### 9.2 推荐决策

**推荐接受"页面即窗口"作为长期方向，但当前定位为 P2，优先完成 Phase 0 Spike。**

理由：
1. 用户诉求真实且符合桌面端发展趋势
2. Tauri 2.0 技术上完全支持
3. 已有 overlay 窗口先例，不是从零开始
4. 但当前还有更高优先级的工作（#613 开源治理、设置页重构批次）

### 9.3 本 Issue 的建议闭环路径

```
当前（research）
  → 讨论确认方向 YES/NO
  → 输出 ADR (Architecture Decision Record)

Phase 0
  → 创建 spike 分支
  → 1 周内验证核心假设
  → 输出 spike 报告

Phase 1-2
  → 拆出 spec issue（窗口注册表、SSE 代理、路由域绑定）
  → 拆出 feat issue（弹出窗口按钮、窗口去重、位置持久化）
  → 标准 feature 分支 + PR 流程
```

---

## 十、与其他 Issue 的关系梳理

| Issue | 关系 | 影响 |
|-------|------|------|
| **#528** 侧边栏收起/展开 | 互补 — 侧边栏在"标签宿主"模式下可能演化为标签栏 | 低冲突 |
| **#597** 当下页导航升级 | 互补 — 当下页独立为窗口后，导航可能简化 | 低冲突 |
| **#613** 代码库公开方案 | 无直接关系，但 P1 优先级更高 | 时间竞争 |
| **#645** 悬浮窗计时器整合 | 直接相关 — 属于"悬浮窗谱系"的一部分 | 应作为子任务 |
| **#635** 当下/专注页布局收敛 | 互补 — 当下页独立为窗口后，布局需求可能变化 | 中等依赖 |
| **#644** UI/UX 交互规范 | 前置依赖 — 多窗口的交互规范应纳入统一规范 | 建议先完成 |
| **#418** 任务与时间块解耦 | 间接关联 — 多窗口下时间块状态同步更复杂 | 应先完成 |

---

## 十一、附录

### A. 参考资料

- [Tauri v2 Multi-Window Guide (Oflight)](https://www.oflight.co.jp/en/columns/tauri-v2-multi-window-system-tray)
- [Tauri v2 API: WebviewWindow](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [Zustand Store 跨 Tauri 窗口同步](https://www.gethopp.app/blog/tauri-window-state-sync)
- [Tauri 2.x Multi-Window 实践 (Oreate AI)](https://www.oreateai.com/blog/tauri-2x-practice-implementing-multiwindow-management-and-system-tray-functionality-based-on-vue3/3983ab1af42b93d3abb0068965b1bae2)
- [GitHub Discussion: Tauri 2 create window 400 error](https://github.com/tauri-apps/tauri/discussions/9487)
- [Electron Multi-Window Architecture (2025)](https://blog.bloomca.me/2025/07/21/multi-window-in-electron.html)
- [React Portals for Multi-Window (Screen Studio)](https://pietrasiak.com/creating-multi-window-electron-apps-using-react-portals)
- [Electron NestJS-inspired Modular Architecture](https://dev.to/29_x_395a8d7880988c00d53f/build-electron-apps-like-nestjs-modular-architecture-multi-window-management-and-typed-ipc-15oh)

### B. 关键文件清单

| 文件 | 与本议题的关联 |
|------|---------------|
| `src/routes.tsx` | 路由定义，需引入路由域概念 |
| `src/App.tsx` | 应用初始化，需区分主窗口/子窗口 |
| `src/ui/hooks/useSignalStream.ts` | SSE 连接，需改造为主窗口独占 |
| `src/services/now-workbench-overlay.service.ts` | 已有 overlay 模式参考 |
| `src/config/runtime-target.ts` | RT 连接配置，需考虑多窗口共享 |
| `src-tauri/tauri.conf.json` | 窗口配置入口 |
| `src-tauri/capabilities/default.json` | 权限配置，需新增动态窗口权限 |
| `src-tauri/src/commands/now_workbench_overlay_commands.rs` | 窗口创建 Rust 先例 |

---

*分析者：Claude Code (Opus 4.6)*
*分析基线：dev@9a15d06f*
*日期：2026-03-21*
