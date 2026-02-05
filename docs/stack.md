# 技术栈总览

> **版本**: v2.0
> **更新日期**: 2026-02-05
> **状态**: 已更新

---

## 1. 前端技术栈

### 1.1 核心框架

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 18.3.1 | UI 框架 |
| **TypeScript** | 5.6 | 类型安全 |
| **Vite** | 6.0.3 | 构建工具 |

### 1.2 UI 组件

| 技术 | 用途 | 说明 |
|------|------|------|
| **Tailwind CSS** | 3 | 原子化样式 |
| **shadcn/ui** | - | 现代化组件库 |
| **Radix UI** | - | 无障碍组件基础 |
| **Lucide React** | 0.563 | 图标库 |
| **class-variance-authority** | 0.7.1 | 变体管理 |

### 1.3 状态与路由

| 技术 | 用途 |
|------|------|
| **zustand** | 5.0.11 | 轻量状态管理 |
| **@tanstack/react-router** | 1.158 | 类型安全路由 |

### 1.4 测试

| 技术 | 用途 |
|------|------|
| **Vitest** | 4.0.18 | 单元测试 |
| **Playwright** | 1.58.1 | E2E 测试 |
| **Happy DOM** | 20.5.0 | 测试环境 |

---

## 2. 后端技术栈

### 2.1 Rust (Tauri 2.0)

| 技术 | 版本 | 用途 |
|------|------|------|
| **Rust** | 2021 Edition | 后端逻辑 |
| **Tauri** | 2 | 桌面框架 |
| **Tokio** | 1 | 异步运行时 |
| **Tungstenite** | 0.21 | WebSocket |
| **Serde** | 1 | 序列化 |

### 2.2 Rust 关键依赖

| 技术 | 用途 |
|------|------|
| **tauri-plugin-mcp-bridge** | MCP 协议桥接 |
| **parking_lot** | 高性能同步 |
| **chrono** | 日期时间处理 |
| **regex** | 正则表达式 |

---

## 3. 技术栈选择理由

### 3.1 为什么选择 React + TypeScript？

- **生态系统成熟**：最大的前端社区
- **类型安全**：TypeScript 提供编译时检查
- **组件化**：易于复用和维护

### 3.2 为什么选择 Tauri 而不是 Electron？

| 对比项 | Tauri | Electron |
|--------|-------|----------|
| **包体积** | ~2-10 MB | ~100+ MB |
| **内存占用** | 低 | 高 |
| **依赖** | 系统 Rust | 系统 Node.js |

### 3.3 为什么选择 zustand？

- **轻量**：仅约 1KB
- **简单**：API 简洁，学习成本低
- **Tauri 友好**：适合 IPC 场景的状态同步

---

## 4. 目录结构

```
src/
├── components/          # 组件目录
│   ├── ui/             # shadcn/ui 基础组件
│   ├── Terminal/       # Terminal 页面组件
│   ├── Chat/           # Chat 页面组件
│   └── Settings/       # 设置页面组件
├── hooks/              # 自定义 Hooks
├── stores/             # zustand stores
├── lib/                # 工具函数
├── pages/              # 页面组件
├── App.tsx             # 主应用组件
└── main.tsx            # 入口文件
```

---

## 5. 相关文档

| 文档 | 路径 |
|------|------|
| 架构设计 | `docs/architecture.md` |
| 快速上手 | `docs/quickstart.md` |
| 模块规格 | `docs/specs/modules/` |

---

*最后更新: 2026-02-05*
