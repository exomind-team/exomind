# ExoMind 架构设计文档

> **版本**: v1.0
> **创建日期**: 2026-02-03
> **状态**: 进行中

---

## 1. 项目概述

### 1.1 核心定位

ExoMind 是一个 **以 Claude Code 为核心的跨平台自主生命体系统**。

| 属性 | 值 |
|------|-----|
| **应用名称** | Exomind |
| **包名** | `com.exomind.app` |
| **核心功能** | 本地运行 Claude Code + 通知拦截 + Agent 自动化 |
| **支持平台** | Windows / macOS / Linux / Android |

### 1.2 核心价值主张

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ExoMind 核心价值                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. **本地 Claude Code**                                            │
│     · 无需云端依赖，数据隐私安全                                     │
│     · 完整的 Claude Code CLI 体验                                   │
│     · 多会话管理 + 流式输出                                         │
│                                                                     │
│  2. **通知拦截聚合**                                                 │
│     · 移动端 + 桌面端通知统一管理                                    │
│     · 智能分类 + 筛选                                               │
│     · 跨端同步（可选）                                              │
│                                                                     │
│  3. **Agent 自动化**                                                 │
│     · 自动运行的后台 Agent                                          │
│     · 输入输出流式处理                                              │
│     · 跨平台一致的编程体验                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ExoMind 整体架构                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                       L7-UI 前端展示层                          │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐  │ │
│  │  │ 终端页面   │ │ 对话页面   │ │ 通知面板   │ │ 设置页面     │  │ │
│  │  │ Claude CLI │ │ 聊天式交互 │ │ 通知聚合   │ │ Claude 配置  │  │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────────┘  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              ↓ IPC                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     Rust 后端核心                               │ │
│  │                                                                │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │                    核心业务逻辑层                         │  │ │
│  │  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │  │ │
│  │  │  │Claude Runner│ │Agent Layer│ │Notification│ │Storage │ │  │ │
│  │  │  │ Claude CLI │ │ Agent 协调 │ │ 拦截处理   │ │ 存储   │ │  │ │
│  │  │  └───────────┘ └───────────┘ └───────────┘ └─────────┘ │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                              ↓                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │                    SignalPool (L5)                       │  │ │
│  │  │  发布-订阅模式，统一事件处理                             │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                              ↓                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │                    终端执行器 (L4)                        │  │ │
│  │  │  跨平台命令执行 + Claude CLI 管理                         │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              ↓                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                       平台适配层                                │ │
│  │                                                                │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐  │ │
│  │  │  Windows    │ │ macOS/Linux │ │ Android (Termux)        │  │ │
│  │  │ cmd / pwsh  │ │  bash/zsh   │ │ proot + Termux API      │  │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘  │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | React 18.3 | UI 框架 |
| **前端语言** | TypeScript 5.6 | 类型安全 |
| **构建工具** | Vite 6 | 快速构建 |
| **桌面框架** | Tauri v2 | 跨平台桌面 |
| **后端语言** | Rust 2021 | 高性能核心 |
| **包管理器** | Bun | JS 包管理 |

---

## 3. 核心模块设计

### 3.1 Claude Runner 模块

**职责**: 管理本地 Claude Code CLI 的生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Runner 模块                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     ClaudeExecutor                             │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  TerminalExecutor Trait                                   │  │ │
│  │  │  · spawn()     创建会话                                   │  │ │
│  │  │  · send_input() 发送输入                                  │  │ │
│  │  │  · close()     关闭会话                                   │  │ │
│  │  │  · subscribe() 订阅输出                                   │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                              ↓                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  Platform Implementation                                 │  │ │
│  │  │  · WindowsExecutor  (cmd / PowerShell)                   │  │ │
│  │  │  · UnixExecutor     (bash / zsh)                         │  │ │
│  │  │  · AndroidExecutor  (Termux proot)                       │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                              ↓                                  │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │  Claude CLI                                              │  │ │
│  │  │  · 本地安装                                              │  │ │
│  │  │  · 流式输出处理                                          │  │ │
│  │  │  · 会话管理                                              │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
```

**文件结构**:
```
src-tauri/src/core/executor/
├── mod.rs              # 统一接口
├── terminal.rs         # 基础终端类型
├── claude_runner.rs    # Claude 专用运行器
├── session.rs          # 会话管理
└── platform/           # 平台特定实现
    ├── mod.rs
    ├── windows.rs
    ├── unix.rs
    └── android.rs      # Termux 集成
```

### 3.2 终端执行器设计

```rust
// 核心接口定义

#[async_trait]
pub trait TerminalExecutor: Send + Sync {
    async fn spawn(&mut self, shell: &str, working_dir: Option<&str>)
        -> Result<SessionId, ExecutorError>;

    async fn send_input(&self, session_id: &SessionId, input: &str)
        -> Result<(), ExecutorError>;

    async fn close(&self, session_id: &SessionId)
        -> Result<(), ExecutorError>;

    fn subscribe(&self, session_id: &SessionId)
        -> broadcast::Receiver<OutputEvent>;
}

pub struct OutputEvent {
    pub session_id: SessionId,
    pub content: String,
    pub event_type: OutputType,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub enum OutputType {
    Stdout,
    Stderr,
    Status,
    CommandComplete,
    Signal,
}
```

### 3.3 通知拦截模块

**核心问题**: Android 的 DND 模式会导致 `NotificationListenerService` 权限丢失

```
┌─────────────────────────────────────────────────────────────────────┐
│                    通知拦截 - 多方案备选                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  方案优先级:                                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  1. LSPosed (Root 用户)                                        │ │
│  │     · Xposed/LSPosed 框架钩子                                  │ │
│  │     · DND 不影响                                               │ │
│  │     · 权限最稳定                                               │ │
│  │                                                               │ │
│  │  2. Shizuku (高级用户)                                         │ │
│  │     · ADB 授权或 Root 启动                                     │ │
│  │     · 无需 NLS 权限                                            │ │
│  │                                                               │ │
│  │  3. NotificationListenerService (普通用户)                      │ │
│  │     · 用户手动授权                                             │ │
│  │     · DND 模式会丢失权限 ⚠️                                     │ │
│  │     · 需要自动检测并引导重新授权                                │ │
│  │                                                               │ │
│  │  4. AccessibilityService (备选)                                │ │
│  │     · DND 不影响                                               │ │
│  │     · Google Play 审核可能更严格                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 SignalPool 信号系统

```typescript
// 信号类型定义

export type NotificationSignalType =
  | 'notification:mobile:posted'      // 移动端通知到达
  | 'notification:mobile:removed'     // 移动端通知移除
  | 'notification:desktop:posted'     // 桌面端通知到达
  | 'notification:desktop:removed'    // 桌面端通知移除
  | 'nls:connected'                   // NLS 服务连接
  | 'nls:disconnected'                // NLS 服务断开
  | 'nls:permission:lost'             // NLS 权限丢失
  | 'nls:permission:restored';        // NLS 权限恢复

export type ClaudeSignalType =
  | 'claude:output'          // Claude 响应输出（流式）
  | 'claude:input'           // 用户输入
  | 'claude:status'          // 运行状态
  | 'claude:error'           // 错误
  | 'claude:thinking'        // 思考状态
  | 'claude:session:created' // 会话创建
  | 'claude:session:resumed'; // 会话恢复
```

---

## 4. 平台适配策略

### 4.1 平台支持矩阵

| 功能 | Windows | macOS | Linux | Android |
|------|---------|-------|-------|---------|
| **Claude CLI** | ✅ 原生 | ✅ 原生 | ✅ 原生 | ⚠️ Termux |
| **通知拦截** | ⚠️ 系统 API | ⚠️ 系统 API | ⚠️ 系统 API | ✅ NLS |
| **系统托盘** | ✅ 原生 | ✅ 原生 | ✅ 原生 | ❌ 不适用 |
| **后台运行** | ✅ 原生 | ✅ 原生 | ✅ 原生 | ⚠️ 前台服务 |

### 4.2 Android Termux 集成

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Android Termux 集成架构                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ExoMind App                                                        │
│       ↓                                                             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │              Termux Integration Manager                        │ │
│  │  · 检测 Termux 是否安装                                        │ │
│  │  · 检测 proot-distro                                          │ │
│  │  · 执行命令 (Tasker API / SSH)                                 │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              ↓                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    Termux 环境                                 │ │
│  │  proot-distro alpine                                          │ │
│  │       ↓                                                       │ │
│  │  apt install nodejs npm                                       │ │
│  │       ↓                                                       │ │
│  │  npm install -g @anthropic-ai/claude-code                     │ │
│  │       ↓                                                       │ │
│  │  claude (本地运行)                                             │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. 文件结构

```
exomind/
├── src/                          # 前端 (React + TypeScript)
│   ├── App.tsx                   # 主应用组件
│   ├── main.tsx                  # React 入口
│   ├── components/               # 通用组件
│   │   ├── Terminal/             # 终端组件
│   │   ├── NotificationPanel/    # 通知面板
│   │   └── Settings/             # 设置页面
│   ├── hooks/                    # React Hooks
│   │   ├── useClaude.ts          # Claude 相关 Hook
│   │   └── useNotifications.ts   # 通知 Hook
│   └── api/                      # Tauri API 调用
│
├── src-tauri/                    # 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs                # 主入口
│   │   ├── main.rs               # 移动端入口
│   │   ├── core/
│   │   │   ├── executor/         # ⭐ 终端执行器 (核心)
│   │   │   │   ├── mod.rs
│   │   │   │   ├── terminal.rs
│   │   │   │   ├── claude_runner.rs
│   │   │   │   └── platform/
│   │   │   ├── signals/          # 信号池
│   │   │   │   ├── mod.rs
│   │   │   │   ├── types.ts
│   │   │   │   └── pool.ts
│   │   │   └── storage/          # 存储层
│   │   ├── commands/             # Tauri 命令
│   │   │   ├── mod.rs
│   │   │   ├── claude_commands.rs
│   │   │   └── terminal_commands.rs
│   │   └── platform/             # 平台特定代码
│   │       ├── desktop/
│   │       └── android/
│   │           ├── mod.rs
│   │           └── termux.rs
│   ├── gen/
│   │   └── android/              # Android 项目（自动生成）
│   ├── capabilities/
│   └── Cargo.toml
│
├── docs/                         # 文档
│   ├── ARCHITECTURE.md           # ⭐ 本文档
│   ├── specs/                    # 详细规格
│   └── README.md
│
├── pm/                           # 项目管理
│   ├── long-term.md              # 长期记忆
│   ├── PRD.md                    # 产品需求
│   └── roadmap.md                # 路线图
│
├── build-*.ps1                   # 构建脚本
└── README.md                     # 项目说明
```

---

## 6. 实施路线图

### Phase 1: Claude Runner 核心功能

| 任务 | 优先级 | 状态 |
|------|--------|------|
| TerminalExecutor 接口定义 | P0 | 待开始 |
| UnixExecutor 实现 | P0 | 待开始 |
| WindowsExecutor 实现 | P0 | 待开始 |
| ClaudeRunner 实现 | P0 | 待开始 |
| 前端 Terminal 组件 | P0 | 待开始 |

### Phase 2: Android Termux 集成

| 任务 | 优先级 | 状态 |
|------|--------|------|
| Termux 检测与安装引导 | P1 | 待开始 |
| Termux Command API | P1 | 待开始 |
| AndroidExecutor 实现 | P1 | 待开始 |
| proot-distro 容器支持 | P1 | 待开始 |
| 移动端 Terminal 适配 | P1 | 待开始 |

### Phase 3: 通知拦截功能

| 任务 | 优先级 | 状态 |
|------|--------|------|
| NotificationListenerService | P1 | 待开始 |
| DND 权限丢失检测与恢复 | P1 | 待开始 |
| AccessibilityService 备选方案 | P2 | 待开始 |
| Shizuku 集成（高级用户） | P2 | 待开始 |
| LSPosed 模块（Root 用户） | P2 | 待开始 |

### Phase 4: Agent 自动化

| 任务 | 优先级 | 状态 |
|------|--------|------|
| Agent 生命周期管理 | P1 | 待开始 |
| 输入输出流式处理 | P1 | 待开始 |
| 多会话管理 | P1 | 待开始 |
| 会话保存/恢复 | P2 | 待开始 |

---

## 7. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品需求 | `pm/PRD.md` | 产品定义 |
| 路线图 | `pm/roadmap.md` | 迭代计划 |
| 长期记忆 | `pm/memory/long-term.md` | 开发历史 |
| 7层架构 | `docs/ARCHITECTURE_7LAYER.md` | 架构详解 |
| SignalPool | `docs/specs/SPEC-201-SignalPool.md` | 信号系统 |

---

*文档创建时间：2026-02-03*
*版本：v1.0*
