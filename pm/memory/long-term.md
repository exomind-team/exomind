# ExoMind 长期记忆

> 本文档记录 ExoMind 项目的核心决策、开发历史和重要变更。

---

## 2026-02-03 - 架构设计定稿与核心需求明确

### 核心定位确认

**ExoMind 是以 Claude Code 为核心的跨平台自主生命体系统。**

| 核心功能 | 说明 |
|----------|------|
| **本地 Claude Code** | 本地 CLI 工具，可配置 API 端点，兼容 OpenAI 协议，支持本地/云端模型 |
| **多端 Agent 编程体验** | 自动运行的 Agent，获取输入输出流式处理 |
| **通知拦截聚合** | 移动端 + 桌面端通知统一管理，智能分类筛选 |

### 技术选型决策

| 决策 | 选项 | 最终选择 | 理由 |
|------|------|----------|------|
| 跨平台框架 | Tauri v2 / Electron / Flutter | **Tauri v2** | 包体积小、Native 性能、Rust 后端 |
| 后端语言 | Node.js / Rust / Go | **Rust** | 高性能、与 Tauri 深度集成 |
| 前端框架 | React / Vue / Svelte | **React** | 生态成熟、团队熟悉 |
| 包管理器 | npm / pnpm / Bun | **Bun** | 速度快 |

### 架构设计要点

| 模块 | 职责 | 优先级 |
|------|------|--------|
| **Claude Runner** | 本地 Claude Code CLI 管理与流式输出 | P0 |
| **Terminal Executor** | 跨平台命令执行抽象层 | P0 |
| **SignalPool** | 发布-订阅信号系统 | P0 |
| **Notification Interceptor** | 多方案通知拦截 | P1 |
| **Termux Integration** | Android 端 Termux 容器支持 | P1 |

### 通知拦截 - 多方案备选

**核心问题**: DND (免打扰) 模式会导致 `NotificationListenerService` 权限丢失。

**解决方案**:
1. **LSPosed** (Root 用户) - 权限最稳定，DND 不影响
2. **Shizuku** (高级用户) - ADB 授权或 Root 启动，无需 NLS 权限
3. **NotificationListenerService** (普通用户) - 用户手动授权，需处理权限丢失
4. **AccessibilityService** (备选) - DND 不影响，但 Google Play 审核更严格

### Android Termux 集成方案

```
Termux 环境:
  proot-distro alpine/debian
    → apt install nodejs npm
    → npm install -g @anthropic-ai/claude-code
    → claude (本地运行)

集成方式:
  1. Termux Tasker API
  2. SSH 到本地 proot 容器
  3. JNI 直接调用 (高级)
```

### 状态更新

| 模块 | 状态 | 说明 |
|------|------|------|
| L5-Signals | ✅ 已完成 | SignalPool 信号池 (SPEC-201) |
| L6-Agent | ✅ 已完成 | Agent 业务逻辑层 (SPEC-202) |
| Claude Runner | ⏳ 待开始 | Phase 1 |
| Terminal Executor | ⏳ 待开始 | Phase 1 |
| Android Termux | ⏳ 待开始 | Phase 2 |
| 通知拦截 | ⏳ 待开始 | Phase 3 |

### 文档更新
- 创建 `docs/ARCHITECTURE.md` - 完整架构设计文档
- 更新 `README.md` - 添加文档链接
- 旧架构文档归类到 `.archive/` 目录

---

## 2026-01-30 - L6-Agent 层开发

### 开发内容
- **SPEC-202**: 创建 L6-Agent 业务逻辑层规范文档
- **src/agent/**: 实现 Agent 协调器、ClaudeCode 适配器、MiniMax 适配器、任务调度器

### 核心组件
| 文件 | 功能 |
|------|------|
| `types.ts` | Agent 配置、任务定义、调度策略类型 |
| `coordinator.ts` | AgentCoordinator 核心协调器 |
| `claude-code.ts` | Claude Code CLI 适配器 |
| `minimax.ts` | MiniMax API 适配器 |
| `scheduler.ts` | 优先级任务调度器 |

### 测试结果
- 55/55 测试通过
- 新增 19 个 Agent 层单元测试

---

## 关键设计决策记录

### 1. Tauri 移动端架构

```
Tauri 移动端 = React WebView + Rust Core + Kotlin Native

数据流:
  Kotlin (NLS) → JNI → Rust (SignalPool) → IPC → React (UI)
```

### 2. 代码复用策略

| 层级 | 复用率 | 说明 |
|------|--------|------|
| 核心业务逻辑 | 100% | SignalPool、Agent、Storage 完全复用 |
| 平台 API 封装 | 0% | 每个平台独立，接口统一 |
| 原生层 | N/A | Kotlin/Swift 必要重复 |
| 前端 UI | ~90% | React 代码基本复用 |

### 3. 终端执行器设计

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
```

### 4. 通知拦截 DND 问题处理

```kotlin
// 检测 DND 权限状态
fun isDnDEnabled(): Boolean {
    val interruptionFilter = notificationManager.currentInterruptionFilter
    return interruptionFilter != INTERRUPTION_FILTER_ALL
}

// 权限丢失时自动检测并引导
fun monitorPermissionStatus() {
    if (!checkNotificationPermission()) {
        showReGrantDialog()
    } else if (isDnDEnabled()) {
        showDndWarning()
    }
}
```

---

## 实施路线图

```
Phase 1: Claude Runner 核心功能 (2-3 周)
├── TerminalExecutor 基础实现
├── ClaudeRunner 实现
├── 流式输出处理
├── 前端 Terminal 组件
└── Claude 配置管理

Phase 2: Android Termux 集成 (2-3 周)
├── Termux 检测与安装引导
├── Termux Command API
├── proot-distro 容器支持
├── Android 端 Claude 安装
└── 移动端 Terminal 适配

Phase 3: 通知拦截功能
├── NotificationListenerService 实现
├── DND 权限丢失检测与恢复
├── AccessibilityService 备选
├── Shizuku 集成
└── LSPosed 模块

Phase 4: Agent 自动化
├── Agent 生命周期管理
├── 输入输出流式处理
├── 多会话管理
└── 会话保存/恢复
```

---

## 项目结构

```
exomind/
├── src/                          # 前端 (React + TS)
├── src-tauri/                    # 后端 (Rust)
│   ├── src/
│   │   ├── core/
│   │   │   ├── executor/         # 终端执行器 (核心)
│   │   │   ├── signals/          # 信号池
│   │   │   └── storage/          # 存储层
│   │   ├── commands/             # Tauri 命令
│   │   └── platform/             # 平台特定代码
│   └── gen/android/              # Android 项目
├── docs/                         # 文档
│   ├── ARCHITURE.md              # 架构设计 (2026-02-03)
│   └── specs/                    # 详细规格
├── pm/                           # 项目管理
│   └── memory/                   # 长期记忆
└── README.md                     # 项目说明
```

---

*最后更新: 2026-02-03*
*维护者: Claude Code*
