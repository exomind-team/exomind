# ExoMind - CLAUDE.md

> 以 Claude Code 为核心的跨平台自主生命体系统

## 项目概述

ExoMind 是一个以 Claude Code 为核心的跨平台自主生命体系统，支持 Windows/macOS/Linux/Android 平台。项目采用 Tauri 2.0 + React + Rust 技术栈，前端负责 UI 展示，后端负责 Agent 调度和系统集成。

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **前端框架** | React | 18.3.1 | UI 展示层 |
| **前端语言** | TypeScript | 5.6.2 | 类型安全 |
| **构建工具** | Vite | 6.0.3 | 快速构建 |
| **UI 库** | shadcn/ui + Tailwind CSS | - | 现代化组件库 |
| **状态管理** | zustand | 5.0+ | 轻量状态管理 |
| **图标库** | lucide-react | - | 现代化图标 |
| **路由** | @tanstack/react-router | 1.0+ | 类型安全路由 |
| **桌面框架** | Tauri | 2.0 | 跨平台桌面应用 |
| **后端语言** | Rust | 2021 Edition | 高性能核心逻辑 |
| **包管理器** | Bun | - | JS 包管理 |
| **测试框架** | Vitest | - | 单元测试框架 |
| **目标平台** | Windows/macOS/Linux/Android | - | 全平台支持 |

## 核心架构

### 7 层架构模型

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ExoMind 7 层架构                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L7-UI 前端展示层 (React + TypeScript)                               │
│      ↓ IPC (Tauri invoke)                                           │
│  L6 核心业务逻辑层 (Claude Runner, Agent Layer)                       │
│      ↓                                                              │
│  L5  SignalPool (发布-订阅信号系统)                                   │
│      ↓                                                              │
│  L4  终端执行器 (跨平台命令执行)                                       │
│      ↓                                                              │
│  L3  平台适配层 (Windows/macOS/Linux/Android)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心模块状态

| 模块 | 路径 | 状态 | 优先级 |
|------|------|------|--------|
| SignalPool 信号池 | `docs/specs/SPEC-201-SignalPool.md` | 已完成 | P0 |
| Agent Layer | `docs/specs/SPEC-202-AgentLayer.md` | 已完成 | P0 |
| ResourcePool | `docs/specs/SPEC-204-ResourcePool.md` | 已完成 | P1 |
| Claude Runner | 待实现 | 待开始 | P0 |
| Terminal Executor | 待实现 | 待开始 | P0 |
| Android Termux 集成 | 待实现 | 待开始 | P1 |
| 通知拦截模块 | 待实现 | 待开始 | P1 |

## 工作流程

### Ralph Loop 流程 ⭐

**权威流程定义**: `docs/specs/TEMPLATE.md` 和 `pm/development.md`

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ralph Loop 标准流程                            │
├─────────────────────────────────────────────────────────────────┤
│  0. 读取输入（优先级：pm/input.md > pm/PRD.md > pm/tasks_plan.md）│
│  1. 评审完成情况，更新 TodoWrite                                 │
│  2. 架构设计 + 编写 Spec 文档                                    │
│  3. 按 Spec 编码                                                 │
│  4. 单元测试（100% 覆盖率，直到通过）                             │
│  5. 集成测试 + E2E 测试                                          │
│  6. 文档更新（API 文档、README）                                 │
│  7. Git 小提交 + 更新 pm/memory/long-term.md                     │
│  8. 分支 PR 提交 + 记录 PR 编号                                  │
│  9. 自我评估 + 更新 agent.md → 下一轮                           │
└─────────────────────────────────────────────────────────────────┘
```

### 双终端工作模式 ⭐

**一个对话终端 + 一个编码终端**

| 终端 | 用途 | 特点 |
|------|------|------|
| **对话终端** | 对话、思考、想法执行 | 即时响应，想到就做 |
| **编码终端** | 专注代码开发 | Ralph Loop 迭代开发 |

**工作流程**：
```
对话终端 ←→ pm/logs/YYYY-MM-DD.jsonl（记录想法）
     ↓
编码终端读取日志 → 执行编码任务 → Git 提交
```

### 修改即提交原则 ⭐

**每次修改文件后立即提交 Git commit**

| 原则 | 说明 |
|------|------|
| **触发时机** | 任何文件修改后立即提交 |
| **提交粒度** | 按文件/功能，小步提交 |
| **提交信息** | `[类型]: [简短描述] [修改文件]` |
| **分支** | 在 feature 分支上提交，不影响主分支 |

**示例**：
```bash
# 修改一个文件后
git add pm/memory.md
git commit -m "DOCS: 添加修改即提交原则 [pm/memory.md]"

# 修改多个相关文件
git add pm/memory.md pm/agent.md
git commit -m "DOCS: 记录工作流程原则 [pm/memory.md, pm/agent.md]"
```

**为什么？**
1. Git 成为 Agent 的完整历史
2. 每次变更可追溯、可回滚
3. 便于 code review 和审计
4. 小的提交更容易理解和调试

### Git 提交类型

| 类型 | 说明 |
|------|------|
| `FEAT` | 新功能 |
| `FIX` | Bug 修复 |
| `REFACTOR` | 重构 (不改变外在行为) |
| `PERF` | 性能优化 |
| `DOCS` | 文档更新 |
| `CHORE` | 其他维护 (构建、依赖等) |
| `TEST` | 测试相关 |
| `STYLE` | 代码格式 (不影响语义) |
| `BUILD` | 构建系统相关 |
| `CI` | CI 配置相关 |
| `REVERT` | 回滚提交 |

## 测试标准

### 单元测试

- **框架**: Vitest + bun test
- **覆盖率要求**: 核心逻辑 **100%**
- **原则**:
  - 每个功能点至少一个测试
  - 边界条件测试
  - 异常情况测试

### 集成测试

- **场景**: 端到端流程、多模块协作、真实数据
- **Mock 策略**: 外部依赖 MOCK、文件系统 MOCK

## 分支管理

参考 `docs/GIT_FLOW.md` 获取完整的分支策略：

```
master (生产环境) ─────────────●────────────────●──
                               └── hotfix/v1.x.y
                               │
dev (开发主干) ─────●──●──●──●──●──●──●──●──●──●──
                    \              /
                     ●──────────●  (feature/xxx)

| 分支 | 角色 | 生命周期 |
|------|------|----------|
| `master` | 生产环境 | 永久 |
| `dev` | 开发主干 | 永久 |
| `feature/*` | 功能开发 | 临时 |
| `release/*` | 预发布 | 临时 |
| `hotfix/*` | 紧急修复 | 临时 |
```

## systemd 服务管理

```bash
# 查看状态
systemctl --user status exomind

# 重启服务
systemctl --user restart exomind

# 查看日志
journalctl --user -u exomind -f

# 首次开机自启需要
sudo loginctl enable-linger $(whoami)
```

## 项目配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| API 服务端口 | **1949** | Life OS 专用端口 |
| 服务名称 | **exomind** | systemd 服务名 |
| 测试覆盖率 | **100%** | 单元测试覆盖率要求 |

## 目录结构

```
exomind/
├── src/                      # 前端源代码 (React + TypeScript)
│   ├── App.tsx               # 主应用组件
│   ├── main.tsx              # React 入口
│   ├── components/           # 组件目录
│   │   ├── ui/              # shadcn/ui 基础组件
│   │   ├── Terminal/        # 终端页面
│   │   ├── Chat/            # 对话页面
│   │   └── Settings/        # 设置页面
│   ├── hooks/                # 自定义 Hooks
│   ├── stores/               # zustand stores
│   └── lib/                  # 工具函数
│
├── src-tauri/                # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs            # Rust 核心库
│   │   ├── main.rs           # 程序入口
│   │   └── core/            # 核心模块
│   ├── Cargo.toml            # Rust 依赖配置
│   └── tauri.conf.json       # Tauri 配置
│
├── docs/                     # 文档目录
│   ├── ARCHITECTURE.md       # 架构设计文档
│   ├── ARCHITECTURE_7LAYER.md # 7层架构详解
│   ├── GIT_FLOW.md          # 分支管理规范
│   ├── FRONTEND_STACK.md    # 前端技术栈规划
│   └── specs/                # 详细规格文档
│       ├── SPEC-200.md       # 核心架构
│       ├── SPEC-201-SignalPool.md
│       ├── SPEC-202-AgentLayer.md
│       └── ...
│
├── pm/                       # 项目管理
│   ├── PRD.md                # 产品需求文档
│   ├── roadmap.md            # 产品路线图
│   ├── development.md        # 开发规范
│   ├── agent.md              # Agent 配置
│   └── memory/               # 长期记忆
│       └── long-term.md      # 项目历史记录
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
| `bun build` | 构建前端 + 类型检查 |
| `bun test` | 运行单元测试 |
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

## 构建输出

| 平台 | 输出路径 |
|------|----------|
| Windows Desktop | `src-tauri\target\release\exomind.exe` |
| Android | `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk` |

## 沟通风格

### 对话原则

- **简短自然**: 像朋友聊天，不用 Markdown 格式
- **可用颜文字**: 😊 👀 🌸 💕
- **一行或两行**: 除非必要，不超过 3 行

### 何时用 Markdown

- `/help` 命令帮助信息
- `/status` 状态展示
- `/allowance` 额度展示
- 正式功能说明

### 何时不用

- 日常问候
- 闲聊
- 简单回复

## 相关文档

| 文档 | 路径 |
|------|------|
| 架构设计 | `docs/ARCHITECTURE.md` |
| 7层架构详解 | `docs/ARCHITECTURE_7LAYER.md` |
| 分支管理规范 | `docs/GIT_FLOW.md` |
| 开发规范 | `pm/development.md` |
| Agent 配置 | `pm/agent.md` |
| 产品需求文档 | `pm/PRD.md` |
| 产品路线图 | `pm/roadmap.md` |
| 长期记忆 | `pm/memory/long-term.md` |
