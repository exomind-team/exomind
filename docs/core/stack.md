# 技术选型一致性评审报告

> **版本**: v1.0
> **创建日期**: 2026-02-03
> **状态**: 待处理

---

## 1. 执行摘要

本报告评审了以下文档之间的技术选型一致性：

| 文档 | 用途 | 主要内容 |
|------|------|----------|
| `docs/ARCHITECTURE.md` | 主架构文档 | 七层架构、Tauri + React 技术栈 |
| `docs/specs/SPEC-200.md` | 核心架构规范 | 七层架构、Bun + 独立服务器 |
| `docs/specs/SPEC-203.md` | Interface 层规范 | HTTP + WebSocket + 原生 JS |
| `docs/specs/SPEC-205.md` | UI 仪表盘增强 | 资源图表、实时监控 |
| `docs/FRONTEND_STACK.md` | 前端技术规划 | React + shadcn/ui + Tailwind |

### 关键发现

| 问题类别 | 严重程度 | 数量 |
|----------|----------|------|
| **架构层级冲突** | 🔴 严重 | 3 |
| **技术栈冲突** | 🔴 严重 | 5 |
| **UI 选型不一致** | 🟡 中等 | 4 |
| **待定义/未实现** | 🟢 轻微 | 12 |

---

## 2. 七层架构一致性分析

### 2.1 层级定义对比

| 层级 | ARCHITECTURE.md | SPEC-200.md | SPEC-203.md | 一致性 |
|------|-----------------|-------------|-------------|--------|
| **L1** | 平台适配层 (Windows/macOS/Android) | 入口层 (Interface) | 未定义 | ❌ 冲突 |
| **L2** | 未定义 | 信号层 (Signals) | 未定义 | ❌ 缺失 |
| **L3** | 核心业务逻辑层 | 资源层 (Resources) | 未定义 | ❌ 冲突 |
| **L4** | 终端执行器 | 行动者层 (Actors) | 未定义 | ⚠️ 部分 |
| **L5** | SignalPool | 智能体层 (Agents) | 未定义 | ❌ 冲突 |
| **L6** | 核心业务逻辑 | 认知层 (Cognition) | 未定义 | ⚠️ 部分 |
| **L7** | UI 前端展示层 | 记忆层 (Memory) | Interface 用户界面层 | ❌ 冲突 |

### 2.2 层级顺序问题

```
ARCHITECTURE.md (由内到外构建):
L1 平台适配 → L2 抽象 → L3 资源 → L4 执行 → L5 信号 → L6 业务 → L7 UI

SPEC-200.md (由外到内处理):
L1 入口 → L2 信号 → L3 资源 → L4 行动者 → L5 智能体 → L6 认知 → L7 记忆
```

**核心问题**: 两个文档的层级顺序**完全相反**，L1 和 L7 的定义互换了位置。

### 2.3 SPEC-203 的层级矛盾

| 属性 | SPEC-200 定义 | SPEC-203 定义 | 状态 |
|------|---------------|---------------|------|
| **L7 名称** | 记忆层 (Memory) | Interface 用户界面层 | ❌ 直接矛盾 |
| **L7 职责** | 长期记忆 | Web 仪表盘、API | ❌ 完全冲突 |

---

## 3. 技术栈冲突分析

### 3.1 后端架构对比

| 维度 | Specs 定义 | 当前项目 | 冲突级别 |
|------|-----------|---------|----------|
| **运行时** | Bun | Bun (仅用于脚本) | ⚠️ 部分 |
| **HTTP 服务器** | 独立 Bun 服务器 (端口 1949) | 无独立 HTTP 服务器 | 🔴 严重 |
| **前端框架** | 原生 JavaScript | React 18.3 | 🔴 严重 |
| **通信协议** | RESTful API + WebSocket | Tauri IPC | 🔴 严重 |
| **实时通信** | WebSocket 长连接 | Tauri Events | 🟡 中等 |
| **UI 组件库** | 原生 HTML | 无 | 🟡 中等 |

### 3.2 架构模式对比图

```
Specs 定义的架构 (Bun + 独立服务器):
┌─────────────────────────────────────────────────────────────┐
│                      用户浏览器                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP / WebSocket
┌─────────────────────────────────────────────────────────────┐
│  Bun HTTP Server (端口 1949)                                │
│  ├── RESTful API (/health, /api/*)                         │
│  ├── WebSocket Handler (/ws)                               │
│  └── Static Files (/static/) ← 原生 HTML/CSS/JS            │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
           SignalPool           AgentCoordinator
           (发布-订阅)           ├── ClaudeCodeAdapter
                                └── MiniMaxAdapter

当前项目实际架构 (Tauri + Rust + React):
┌─────────────────────────────────────────────────────────────┐
│                      Tauri 窗口 (WebView2)                   │
│                      React 18 前端                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ Tauri IPC
┌─────────────────────────────────────────────────────────────┐
│  Tauri Rust 后端 (src-tauri)                                │
│  └── Tauri Commands / Events                                │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              (待实现)             (待实现)
           SignalPool           AgentCoordinator
```

### 3.3 前端技术选型对比

| 技术类别 | Specs 定义 | FRONTEND_STACK 建议 | 当前实现 | 三方一致性 |
|---------|-----------|---------------------|---------|-----------|
| **前端框架** | 原生 JS | React 18.3 | React 18.3 | ❌ 不一致 |
| **UI 组件库** | 无 | shadcn/ui | 无 | ⚠️ 待添加 |
| **样式方案** | CSS | Tailwind CSS | CSS | ⚠️ 待迁移 |
| **状态管理** | 原生变量 | zustand | useState | ⚠️ 待升级 |
| **路由方案** | 文件路径 | @tanstack/react-router | 无 | ⚠️ 待添加 |
| **图标库** | 无 | lucide-react | 无 | ⚠️ 待添加 |
| **图表库** | 需选择 | 未明确 | 无 | ⚠️ 待选型 |

---

## 4. UI 组件需求对比

### 4.1 SPEC-205 要求的 UI 组件

| 组件 | SPEC-205 要求 | FRONTEND_STACK 建议 | 状态 |
|------|--------------|---------------------|------|
| 能源仪表盘 | 显示当前能量状态 | Card + 数据可视化 | 待开发 |
| Agent 网络图 | 可视化 Agent 连接 | 拓扑图组件 | 待开发 |
| 信号队列面板 | 实时信号监控 | Table + 实时更新 | 待开发 |
| 资源使用图表 | 资源历史可视化 | 图表库 (待选型) | 待开发 |
| 交互控制 | 开始/停止/重启 | Button + Dialog | 待增强 |
| 对话视图 | 聊天界面 | Chat 组件 | 待开发 |
| 资源监控 | MiniMax/VPS 状态 | Dashboard 页面 | 待开发 |

---

## 5. 冲突汇总

### 5.1 严重冲突 (需优先决策)

| # | 冲突项 | 影响 | 建议方案 |
|---|--------|------|----------|
| 1 | **七层架构层级定义** | 文档间描述矛盾 | 统一采用 ARCHITECTURE.md 的 L1-L7 定义 |
| 2 | **前端框架选型** | Specs 使用原生 JS，项目用 React | 采用 React，废弃 Spec 原生 JS 方案 |
| 3 | **HTTP 服务器** | Specs 期望独立 Bun 服务器 | 仅将 Bun 作为 API 代理层 |
| 4 | **L7 层级定义** | SPEC-200 与 SPEC-203 矛盾 | 修正 SPEC-203 的 L7 描述 |
| 5 | **通信协议** | RESTful API vs Tauri IPC | 保持 Tauri IPC，映射 Spec API 端点 |

### 5.2 待定义/未实现项

| # | 项目 | Spec 状态 | 实现状态 |
|---|------|----------|---------|
| 1 | 数据库/持久化 | 未定义 | 未实现 |
| 2 | Claude Code 集成 | 已定义接口 | 未实现 |
| 3 | MiniMax API 集成 | 已定义接口 | 未实现 |
| 4 | VPS 监控 | 已定义资源类型 | 未实现 |
| 5 | TaskScheduler | 已定义接口 | 未实现 |
| 6 | 认证中间件 | 已规划 | 待实现 |
| 7 | 限流中间件 | 已规划 | 待实现 |
| 8 | 图表库选型 | 未定义 | 待选型 |
| 9 | 暗色主题 | 已规划 | 待实现 |
| 10 | 移动端适配 | 已规划 | 待实现 |
| 11 | 资源使用图表 | 已规划 | 待实现 |
| 12 | 交互式控制 | 已规划 | 待实现 |

---

## 6. 建议方案

### 6.1 架构统一方案

```
推荐：采用 Tauri 嵌入式架构，将 Spec 需求映射到 React 前端

数据流设计：
┌─────────────────────────────────────────────────────┐
│                    用户交互                          │
└─────────────────┬───────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────┐
│           Tauri React 前端 (src/)                    │
│  · React 18 组件架构                                 │
│  · shadcn/ui 现代化组件                              │
│  · Tailwind CSS 原子化样式                           │
│  · zustand 状态管理                                  │
│  · @tanstack/react-router 路由                       │
│  · lucide-react 图标                                │
└─────────────────┬───────────────────────────────────┘
                  ↓ (Tauri invoke)
┌─────────────────────────────────────────────────────┐
│           Rust 后端 (src-tauri/)                     │
│  · 核心业务逻辑                                      │
│  · SignalPool 发布-订阅                             │
│  · AgentCoordinator 协调器                          │
│  · ClaudeCodeAdapter CLI 集成                       │
│  · MiniMaxAdapter API 集成                          │
│  · ResourcePool 资源管理                            │
└─────────────────┬───────────────────────────────────┘
                  ↓ (可选)
┌─────────────────────────────────────────────────────┐
│           Bun HTTP API 服务器 (开发/调试)            │
│  · 外部 API 代理                                     │
│  · WebSocket 实时推送 (开发模式)                     │
│  · 端口 1949 (开发调试用)                           │
└─────────────────────────────────────────────────────┘
```

### 6.2 层级统一方案

采用 **ARCHITECTURE.md** 的层级定义作为权威标准：

| 层级 | 名称 | 核心职责 | 对应 Spec |
|------|------|----------|----------|
| **L7** | UI 前端展示层 | 用户交互入口 | SPEC-203 L7 Interface |
| **L6** | 核心业务层 | 业务逻辑 | SPEC-200 L5 Agents |
| **L5** | 信号层 | 事件与通信 | SPEC-200 L2 Signals |
| **L4** | 执行层 | 任务执行 | SPEC-200 L4 Actors |
| **L3** | 资源层 | 资源管理 | SPEC-200 L3 Resources |
| **L2** | 抽象层 | 能力抽象 | 新增 |
| **L1** | 平台层 | 平台适配 | ARCHITECTURE.md 定义 |

### 6.3 技术栈整合

| 组件 | 采用方案 | 来源 |
|-----|---------|------|
| 前端框架 | React 18.3 | 当前 + FRONTEND_STACK |
| 桌面框架 | Tauri v2 | 当前 |
| UI 组件库 | shadcn/ui | FRONTEND_STACK |
| 样式方案 | Tailwind CSS | FRONTEND_STACK |
| 状态管理 | zustand | FRONTEND_STACK |
| 路由 | @tanstack/react-router | FRONTEND_STACK |
| 图标 | lucide-react | FRONTEND_STACK |
| 图表库 | **Recharts** | 建议选型 |
| HTTP 运行时 | Bun (脚本) + Rust (核心) | 当前 |
| 事件系统 | SignalPool (Rust) + Tauri Events | 当前 |

---

## 7. 行动计划

### Phase 1: 架构统一 (P0)

| 任务 | 优先级 | 负责人 | 状态 |
|------|--------|--------|------|
| 统一七层架构定义 | P0 | - | 待开始 |
| 更新 SPEC-203 L7 描述 | P0 | - | 待开始 |
| 确认前端技术栈为 React | P0 | - | 待开始 |
| 创建 API 映射文档 | P0 | - | 待开始 |

### Phase 2: 前端基础设施 (P1)

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 初始化 Tailwind CSS | P1 | 待开始 |
| 安装 shadcn/ui 组件库 | P1 | 待开始 |
| 配置 zustand 状态管理 | P1 | 待开始 |
| 设置 @tanstack/react-router | P1 | 待开始 |
| 添加 lucide-react 图标 | P1 | 待开始 |
| 选择并集成图表库 | P1 | 待开始 |

### Phase 3: UI 组件开发 (P2)

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 开发能源仪表盘组件 | P2 | 待开始 |
| 开发 Agent 网络图组件 | P2 | 待开始 |
| 开发信号队列面板 | P2 | 待开始 |
| 开发资源使用图表 | P2 | 待开始 |
| 开发对话视图 | P2 | 待开始 |

---

## 8. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 架构设计 | `docs/ARCHITECTURE.md` | 主架构文档 |
| 七层架构详解 | `docs/ARCHITECTURE_7LAYER.md` | 需更新 |
| 前端技术栈 | `docs/FRONTEND_STACK.md` | 待评审 |
| SPEC-200 | `docs/specs/SPEC-200.md` | 需修订 |
| SPEC-203 | `docs/specs/SPEC-203-InterfaceLayer.md` | 需修订 |
| SPEC-205 | `docs/specs/SPEC-205.md` | 需更新 |

---

## 9. 附录

### A. Spec 间技术一致性矩阵

| Spec | Bun 运行时 | HTTP/WebSocket | RESTful API | Claude/MiniMax | SignalPool |
|------|------------|----------------|-------------|----------------|------------|
| SPEC-200 | ❌ | ✅ | ✅ | ✅ | ✅ |
| SPEC-201 | ❌ | ❌ | ❌ | ❌ | ✅ |
| SPEC-202 | ❌ | ❌ | ❌ | ✅ | ✅ |
| SPEC-203 | ✅ | ✅ | ✅ | ❌ | ✅ |
| SPEC-204 | ❌ | ❌ | ✅ | ❌ | ✅ |
| SPEC-205 | ✅ | ✅ | ✅ | ❌ | ❌ |

### B. 冲突优先级说明

| 级别 | 说明 | 处理时限 |
|------|------|----------|
| 🔴 严重 | 架构级冲突，需立即决策 | 1 周内 |
| 🟡 中等 | 技术选型差异，需规划解决 | 2 周内 |
| 🟢 轻微 | 待定义/未实现，可后续处理 | 按需 |

---

*文档创建时间：2026-02-03*
*版本：v1.0*
# 前端技术栈与 UI 依赖规划

> **版本**: v1.0
> **创建日期**: 2026-02-03
> **状态**: 待评审

---

## 1. 当前状态分析

### 1.1 现有技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | React 18.3 | UI 框架 |
| **前端语言** | TypeScript 5.6 | 类型安全 |
| **构建工具** | Vite 6 | 快速构建 |
| **桌面框架** | Tauri v2 | 跨平台桌面 |
| **包管理器** | Bun | JS 包管理 |

### 1.2 现有 UI 代码问题

| 文件 | 问题 | 严重程度 |
|------|------|----------|
| `index.html` | 缺少 `lang` 属性 | 低 |
| `App.tsx:39-44` | 输入框缺少关联标签 | 中 |
| `App.tsx` | 缺少 ARIA 属性 | 低 |
| `App.css:1-7` | `filter: drop-shadow` 性能问题 | 低 |
| `App.css:98` | 缺少 `color-scheme` 声明 | 低 |

---

## 2. 推荐技术栈

### 2.1 核心依赖

```
┌─────────────────────────────────────────────────────────────────────┐
│                     推荐前端技术栈                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   React 18   │  │  TypeScript  │  │    Vite 6    │              │
│  │   (已有)     │  │   (已有)     │  │   (已有)     │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ shadcn/ui    │  │Tailwind CSS  │  │  zustand     │              │
│  │ 现代化组件   │  │  原子化样式   │  │  轻量状态    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │lucide-react  │  │  @tanstack   │  │   date-fns   │              │
│  │  现代化图标   │  │react-router  │  │  日期处理    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 依赖清单

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-opener": "^2",
    "zustand": "^5.0.0",
    "lucide-react": "^0.475.0",
    "@tanstack/react-router": "^1.0.0",
    "date-fns": "^4.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0"
  },
  "devDependencies": {
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@types/node": "^22.0.0",
    "typescript": "~5.6.2",
    "vite": "^6.0.3",
    "@tauri-apps/cli": "^2"
  }
}
```

---

## 3. 选型理由

### 3.1 shadcn/ui

| 特性 | 说明 |
|------|------|
| **设计质量** | Vercel 设计团队出品，符合现代审美 |
| **可定制性** | 源码复制到项目，完全掌控样式 |
| **无障碍** | 基于 Radix UI，原生支持 ARIA |
| **主题系统** | 支持亮色/暗色主题，易于定制 |
| **组件丰富** | 包含 Dialog、Dropdown、Select 等常用组件 |

### 3.2 Tailwind CSS

| 特性 | 说明 |
|------|------|
| **开发效率** | 原子化类，无需编写 CSS |
| **类型安全** | @tailwindcss/vite 插件提供类型提示 |
| **按需生成** | 生产包仅包含使用的样式 |
| **响应式** | 内置断点支持 |
| **暗色模式** | 原生 `dark:` 前缀支持 |

### 3.3 zustand

| 特性 | 说明 |
|------|------|
| **轻量** | 仅约 1KB |
| **简单** | API 简洁，学习成本低 |
| **类型安全** | TypeScript 友好 |
| **中间件** | 支持持久化、时间旅行等 |
| **Tauri 友好** | 适合 IPC 场景的状态同步 |

### 3.4 lucide-react

| 特性 | 说明 |
|------|------|
| **图标数量** | 1000+ 图标 |
| **一致性** | 统一的设计语言 |
| **按需导入** | 减少包体积 |
| **活跃维护** | 持续更新 |
| **与 shadcn 兼容** | 官方推荐的图标库 |

---

## 4. 目录结构

### 4.1 推荐的 src 结构

```
src/
├── components/          # 组件目录
│   ├── ui/             # shadcn/ui 基础组件
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   └── ...
│   ├── Terminal/       # Terminal 页面组件
│   ├── Chat/           # Chat 页面组件
│   ├── Notification/   # 通知面板组件
│   └── Settings/       # 设置页面组件
│
├── features/           # 业务功能模块
│   ├── claude/         # Claude 相关
│   ├── notifications/  # 通知相关
│   └── agent/          # Agent 相关
│
├── hooks/              # 自定义 Hooks
│   ├── useClaude.ts
│   ├── useNotifications.ts
│   └── useTheme.ts
│
├── stores/             # zustand stores
│   ├── useClaudeStore.ts
│   ├── useNotificationStore.ts
│   └── useSettingsStore.ts
│
├── lib/                # 工具函数
│   ├── utils.ts        # clsx + tailwind-merge 封装
│   ├── api.ts          # Tauri API 调用
│   └── constants.ts
│
├── pages/              # 页面组件
│   ├── TerminalPage.tsx
│   ├── ChatPage.tsx
│   ├── NotificationPanel.tsx
│   └── SettingsPage.tsx
│
├── styles/             # 全局样式
│   └── globals.css     # Tailwind 入口
│
├── App.tsx             # 主应用组件
└── main.tsx            # 入口文件
```

### 4.2 shadcn/ui 组件安装

```bash
# 初始化 shadcn/ui
npx shadcn@latest init

# 安装常用组件
npx shadcn@latest add button input dialog dropdown-menu select
npx shadcn@latest add tabs textarea scroll-area separator
```

---

## 5. 性能考量

### 5.1 关键性能指标

| 指标 | 目标值 | 优化策略 |
|------|--------|----------|
| **首屏加载** | < 500ms | 代码分割、懒加载 |
| **LCP** | < 1s | 关键CSS内联 |
| **FID** | < 100ms | 减少主线程阻塞 |
| **CLS** | < 0.1 | 图片尺寸预设 |
| **包体积** | < 2MB | 摇树优化、按需导入 |

### 5.2 Tauri 特定优化

- 使用 `@tauri-apps/api` 而非 tauri-apps 完整包
- Rust 命令异步调用，避免阻塞 UI
- 大数据使用 Tauri 的 `invoke` 序列化传输
- SignalPool 事件驱动，减少不必要的状态更新

---

## 6. 实施计划

| 阶段 | 任务 | 优先级 |
|------|------|--------|
| **Phase 0** | 初始化 Tailwind CSS 和 shadcn/ui | P0 |
| **Phase 1** | 替换现有 App.tsx/App.css 为现代化 UI | P0 |
| **Phase 2** | 实现基础 Layout 和路由结构 | P1 |
| **Phase 3** | 添加 Terminal 页面组件 | P1 |
| **Phase 4** | 添加 Chat 页面组件 | P1 |
| **Phase 5** | 添加 Notification 面板组件 | P2 |
| **Phase 6** | 添加 Settings 页面组件 | P2 |

---

## 7. 相关文档

| 文档 | 路径 |
|------|------|
| 架构设计 | `docs/ARCHITECTURE.md` |
| 七层架构 | `docs/ARCHITECTURE_7LAYER.md` |
| SignalPool | `docs/specs/SPEC-201-SignalPool.md` |

---

*文档创建时间：2026-02-03*
*版本：v1.0*
