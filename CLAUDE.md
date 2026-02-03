# ExoMind - CLAUDE.md

> 以 Claude Code 为核心的跨平台自主生命体系统

## 项目概述

ExoMind 是一个以 Claude Code 为核心的跨平台自主生命体系统，支持 Windows/macOS/Linux/Android 平台。项目采用 Tauri 2.0 + React + Rust 技术栈，前端负责 UI 展示，后端负责 Agent 调度和系统集成。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18.3.1 | UI 展示层 |
| 前端语言 | TypeScript 5.6.2 | 类型安全 |
| 构建工具 | Vite 6.0.3 | 快速构建 |
| 桌面框架 | Tauri 2.0 | 跨平台桌面应用 |
| 后端语言 | Rust 2021 Edition | 高性能核心逻辑 |
| 包管理器 | Bun | 前端依赖管理 |
| 目标平台 | Windows/macOS/Linux/Android | 全平台支持 |

## 核心架构

```
L7-UI 前端展示层 (React)
    ↓ IPC (Tauri invoke)
L6 核心业务逻辑层 (Claude Runner, Agent Layer, Notification, Storage)
    ↓
L5  SignalPool (发布-订阅信号系统)
    ↓
L4  终端执行器 (跨平台命令执行)
    ↓
L3  平台适配层 (Windows/macOS/Linux/Android)
```

### 核心模块

| 模块 | 路径 | 状态 | 优先级 |
|------|------|------|--------|
| SignalPool 信号池 | `docs/specs/SPEC-201-SignalPool.md` | 已完成 | P0 |
| Agent Layer | `docs/specs/SPEC-202-AgentLayer.md` | 已完成 | P0 |
| Claude Runner | 待实现 | 待开始 | P0 |
| Terminal Executor | 待实现 | 待开始 | P0 |
| Android Termux 集成 | 待实现 | 待开始 | P1 |
| 通知拦截模块 | 待实现 | 待开始 | P1 |

## 目录结构

```
exomind/
├── src/                      # 前端源代码 (React + TypeScript)
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   └── assets/               # 静态资源
│
├── src-tauri/                # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs            # Rust 核心库
│   │   └── main.rs           # 程序入口
│   ├── Cargo.toml            # Rust 依赖配置
│   └── tauri.conf.json       # Tauri 配置
│
├── docs/                     # 文档目录
│   ├── ARCHITECTURE.md       # 架构设计文档
│   ├── ARCHITECTURE_7LAYER.md # 7层架构详解
│   └── specs/                # 详细规格文档
│
├── pm/                       # 项目管理
│   ├── PRD.md                # 产品需求文档
│   ├── roadmap.md            # 产品路线图
│   ├── development.md        # 开发规范
│   └── memory/               # 长期记忆
│
├── modules/                  # 可独立部署模块
│   └── ExoMind-NLS-Guardian/ # Android 通知权限守护模块
│
└── build-*.ps1               # 自动化构建脚本
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动开发服务器 (Vite) |
| `bun build` | 构建前端 |
| `bun tauri dev` | 启动 Tauri 开发环境 |
| `bun tauri build` | 构建桌面应用 |
| `dev.ps1` | 完整开发启动脚本 |

## 关键文件

### 前端入口
- `src/main.tsx` - React 应用入口
- `src/App.tsx` - 主应用组件

### 后端入口
- `src-tauri/src/main.rs` - Rust 程序入口
- `src-tauri/src/lib.rs` - Rust 核心库

### 配置
- `package.json` - 前端依赖配置
- `src-tauri/Cargo.toml` - Rust 依赖配置
- `src-tauri/tauri.conf.json` - Tauri 应用配置
- `tsconfig.json` - TypeScript 配置
- `vite.config.ts` - Vite 构建配置

## 开发规范

参考 `pm/development.md` 获取完整的开发规范，包括：
- Git 提交规范
- 代码风格
- 文档要求

## 长期记忆

项目关键决策和开发历史记录在 `pm/memory/long-term.md`，每次重大变更后应更新。

## 构建输出

| 平台 | 输出路径 |
|------|----------|
| Windows Desktop | `src-tauri\target\release\exomind.exe` |
| Android | `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk` |

## 相关文档

- [架构设计](docs/ARCHITECTURE.md) - 核心架构设计
- [7层架构详解](docs/ARCHITECTURE_7LAYER.md) - 分层架构详解
- [产品需求文档](pm/PRD.md) - PRD 和功能定义
- [产品路线图](pm/roadmap.md) - 开发和发布计划
