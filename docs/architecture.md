# ExoMind 架构总览

> **版本**: v2.0
> **更新日期**: 2026-02-05
> **状态**: 已重构（合并自 3 个源文档）

---

## 1. 项目概述

### 1.1 核心定位

ExoMind 是一个 **以 Claude Code 为核心的跨平台自主生命体系统**，帮助用户主动地掌控自己的生命过程。

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
│     · 本地 CLI 工具，可配置 API 端点                                │
│     · 兼容 OpenAI 协议，支持本地/云端模型                           │
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

## 2. 7 层架构概览

ExoMind 采用 7 层架构模型，从 UI 展示层到平台适配层，实现跨平台的生命成长助手系统。

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

### 2.1 层间通信

| 层级 | 通信方式 | 说明 |
|------|----------|------|
| L7 ↔ L6 | Tauri IPC | invoke/handle |
| L6 ↔ L5 | 直接调用 | Rust 函数调用 |
| L5 ↔ L4 | 信号触发 | 异步消息 |
| L4 ↔ L3 | 系统 API | 平台特定接口 |

---

## 3. 各层详解

### 3.1 L7 - UI 前端展示层

**技术栈**: React + TypeScript + Tailwind CSS + shadcn/ui

**职责**:
- 用户界面渲染
- 用户交互处理
- 状态展示与反馈

**核心组件**:
- Terminal - 终端界面
- Chat - 对话界面
- Settings - 设置界面

### 3.2 L6 - 核心业务逻辑层

**职责**:
- Agent 调度与管理
- 跨平台通信协调
- 业务规则执行

#### 架构组件

| 组件 | Desktop | Mobile | 说明 |
|------|---------|--------|------|
| **WebSocket Server** | Rust (Tauri Backend) | - | 桌面端作为服务端 |
| **WebSocket Client** | - | Rust (Tauri Plugin) | 移动端作为客户端 |
| **Sync Protocol** | 统一消息格式 | 统一消息格式 | 跨设备消息同步 |
| **Agent Runner** | Claude API | Claude API | AI Agent 执行 |
| **Governor** | 调控中枢 | 调控中枢 | 输出治理与权限控制 |

#### 多端通信架构

```
┌─────────────────┐                      ┌─────────────────┐
│   Desktop App   │ ◄──── WebSocket ───► │   Mobile App    │
│  (Server Mode)  │                      │  (Client Mode)  │
│                 │                      │                 │
│ ┌─────────────┐ │                      │ ┌─────────────┐ │
│ │ WS Server   │ │                      │ │ WS Client   │ │
│ │ (Rust)      │ │                      │ │ (Tauri)     │ │
│ └─────────────┘ │                      │ └─────────────┘ │
│        │        │                      │        │        │
│        ▼        │                      │        ▼        │
│ ┌─────────────┐ │                      │ ┌─────────────┐ │
│ │ Sync Engine │ │                      │ │ Sync Engine │ │
│ └─────────────┘ │                      │ └─────────────┘ │
└─────────────────┘                      └─────────────────┘
```

### 3.3 L5 - SignalPool（发布-订阅信号系统）

**职责**:
- 解耦生产者与消费者
- 事件总线管理
- 信号路由与分发

**核心功能**:
- 信号注册与订阅
- 信号发布与广播
- 信号过滤与转换

**信号类型**:

```typescript
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

### 3.4 L4 - 终端执行器

**职责**:
- 跨平台命令执行
- 进程管理
- 输出捕获

**支持平台**:
- Windows (PowerShell/CMD)
- macOS/Linux (Bash/Zsh)
- Android (Termux proot)

### 3.5 L3 - 平台适配层

**职责**:
- 操作系统 API 抽象
- 平台特定功能实现
- 权限管理

**适配器**:
- Windows Adapter
- macOS Adapter
- Linux Adapter
- Android Adapter

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
│  │  npm install -g @anthropic-ai/claude-code                    │ │
│  │       ↓                                                       │ │
│  │  claude (本地运行)                                             │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 通知拦截备选方案

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

---

## 5. 数据流向

### 5.1 完整数据流（读取 MiniMax 额度）

```
┌─────────────────────────────────────────────────────────────────────┐
│                     完整数据流 - 读取 MiniMax 额度                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User        L7-UI       L6-Agent      L5-Signals    L2-Storage    │
│   │           │            │              │              │          │
│   │ 点击刷新   │            │              │              │          │
│   │──────────→│            │              │              │          │
│   │           │ GET        │              │              │          │
│   │           │───────────→│              │              │          │
│   │           │            │              │              │          │
│   │           │            │ emit         │              │          │
│   │           │            │RefreshSignal │              │          │
│   │           │            │─────────────→│              │          │
│   │           │            │              │              │          │
│   │           │            │              │ handle()     │          │
│   │           │            │              │─────────────→│          │
│   │           │            │              │              │          │
│   │           │            │              │              │ load()   │
│   │           │            │              │              │─────────→│
│   │           │            │              │              │          │
│   │           │            │              │              │←─────────│
│   │           │            │              │  返回缓存    │          │
│   │           │            │              │              │          │
│   │           │            │              │ cache_hit   │          │
│   │           │            │              │─────────────│          │
│   │           │            │              │              │          │
│   │           │            │ return       │              │          │
│   │           │←───────────│──────────────│              │          │
│   │           │            │              │              │          │
│   │ 返回数据  │            │              │              │          │
│   │←──────────│            │              │              │          │
│   │           │            │              │              │          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 资源获取数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                  资源获取数据流 - 通用模式                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  L6-Agent          Resource Fetcher        外部资源                  │
│   │                    │                     │                      │
│   │ fetch()            │                     │                      │
│   │───────────────────→│                     │                      │
│   │                    │                     │                      │
│   │                    │ 1. 验证输入          │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 2. 认证处理          │                      │
│   │                    │ (Cookie/Token)      │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 3. HTTP 请求         │                      │
│   │                    │─────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 4. 接收响应          │                      │
│   │                    │◀────────────────────│                      │
│   │                    │                     │                      │
│   │                    │ 5. 解析数据          │                      │
│   │                    │                     │                      │
│   │                    │ 6. 返回结果          │                      │
│   │←───────────────────│                     │                      │
│   │                    │                     │                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **前端框架** | React | 18.3.1 | UI 框架 |
| **前端语言** | TypeScript | 5.6.2 | 类型安全 |
| **构建工具** | Vite | 6.0.3 | 快速构建 |
| **UI 库** | shadcn/ui + Tailwind CSS | - | 现代化组件库 |
| **状态管理** | zustand | 5.0+ | 轻量状态管理 |
| **图标库** | lucide-react | - | 现代化图标 |
| **路由** | @tanstack/react-router | 1.0+ | 类型安全路由 |
| **桌面框架** | Tauri | 2.0 | 跨平台桌面 |
| **后端语言** | Rust | 2021 Edition | 高性能核心逻辑 |
| **包管理器** | Bun | - | JS 包管理 |

---

## 7. 核心模块设计

### 7.1 Claude Runner 模块

**职责**: 管理本地 Claude Code CLI 的生命周期

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

### 7.2 终端执行器核心接口

```rust
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

---

## 8. 统一消息格式（Sync Protocol）

```typescript
interface SyncMessage {
  id: string;           // 消息唯一标识
  type: MessageType;    // 消息类型
  timestamp: number;    // 时间戳
  payload: unknown;     // 消息内容
  source: DeviceType;   // 来源设备
  signature?: string;   // 签名验证
}

type MessageType =
  | 'chat'      // 对话消息
  | 'task'      // 任务状态
  | 'signal'    // 信号通知
  | 'presence'  // 在线状态
  | 'command';  // 控制命令

type DeviceType = 'desktop' | 'mobile' | 'web';
```

---

## 9. 实施路线图

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

## 10. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品愿景 | `docs/overview.md` | 产品定义 |
| 技术栈 | `docs/stack.md` | 技术选型理由 |
| 快速上手 | `docs/quickstart.md` | 开发入门 |
| 产品需求 | `pm/PRD.md` | 产品定义 |
| 路线图 | `pm/roadmap.md` | 迭代计划 |
| Git 规范 | `pm/git-spec.md` | Git 使用规范 |
| SignalPool 规格 | `docs/specs/modules/SPEC-201-SignalPool.md` | 信号系统 |

---

## 11. 文件结构

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
│   │   │   ├── executor/         # 终端执行器 (核心)
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
├── docs/                          # 文档
│   ├── overview.md              # 产品愿景
│   ├── architecture.md         # 7 层架构总览
│   ├── quickstart.md           # 快速上手
│   ├── stack.md                # 技术栈
│   ├── specs/                  # 详细规格
│   │   ├── architecture/       # 架构决策（ADR）
│   │   └── modules/            # 模块规格
│   ├── plans/                  # 计划文档
│   │   └── archive/           # 已归档计划
│   └── README.md               # 文档导航
│
├── pm/                           # 项目管理
│   ├── long-term.md              # 长期记忆
│   ├── PRD.md                    # 产品需求
│   ├── roadmap.md                # 路线图
│   └── memory/                   # 执行记忆
│
├── modules/                      # 可独立部署模块
│   └── ExoMind-NLS-Guardian/     # Android 通知权限守护模块
│
├── build-*.ps1                   # 构建脚本
└── README.md                     # 项目说明
```

---

*文档版本: v2.0*
*更新: 2026-02-05*
*合并源文档:*
- `// ARCHITECTURE.md` (v1.0, 2026-02-03)
- `// ARCHITECTURE_7LAYER.md` (v1.0, 2026-01-29)
- `// architecture/7-LAYER.md` (v1.0, 2026-01-29)
