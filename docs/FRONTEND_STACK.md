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
