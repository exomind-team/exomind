# ExoMind 项目概览

> 生成日期: 2026-03-13 | 当前版本: v0.3.6 | 分支: dev

---

## 1. 项目定位

ExoMind（外心）是一个**个人/集体的生命成长助手**，探索人如何主动掌控自己的生命力量，以及如何在计算机上实现生命/思维机器。采用 Tauri 2.0 + React + Rust 技术栈，支持 Windows/macOS/Linux/Android 全平台。

---

## 2. 代码规模

| 类别 | 文件数 | 行数（约） |
|------|--------|-----------|
| TypeScript/TSX（src/） | 282 | ~30,000 |
| Rust（src-tauri/src/） | 14 | - |
| Rust（crates/） | 76 | - |

---

## 3. 分层架构实现进度

### L1 Adapters（具体实现层）

**位置**: `src/adapters/` + `src/lib/adapters/`

| 模块 | 文件 | 状态 |
|------|------|------|
| 加密适配器 | `adapters/crypto-adapter.ts` | 已实现 |
| PouchDB 同步 | `adapters/pouch-sync.ts` | 已实现 |
| Agent Web 适配器 | `lib/adapters/agent-web-adapter.ts` | 已实现 |
| ASR 适配器（3种） | `lib/adapters/asr/` (moss, volcano-engine, volcano-http) | 已实现 |
| 剪贴板适配器（Web/Tauri） | `lib/adapters/clipboard-*-adapter.ts` | 已实现 |
| Cursor HTTP 适配器 | `lib/adapters/cursor-http-adapter.ts` | 已实现 |
| Me 适配器（Web/Mock） | `lib/adapters/me-*-adapter.ts` | 已实现 |
| Reminder PouchDB 适配器 | `lib/adapters/reminder-pouch-adapter.ts` | 已实现 |
| Task 适配器（PouchDB/RT/Mock） | `lib/adapters/task-*-adapter.ts` | 已实现 |
| EventLog 存储适配器（Tauri/Web） | `lib/adapters/tauri-eventlog-storage.ts`, `web-eventlog-storage.ts` | 已实现 |
| Runtime 适配器 | `lib/adapters/tauri-runtime-adapter.ts` | 已实现 |
| Web Speech ASR | `lib/adapters/web-speech-asr.ts` | 已实现 |
| Web 存储 | `lib/adapters/web-storage.ts` | 已实现 |

### L2 Environment（共享物理世界）

**位置**: `src/environment/` + `src/lib/environment/`

| 模块 | 文件 | 状态 |
|------|------|------|
| Port 接口定义（旧） | `environment/interfaces/` (crypto, cursor, sync) | 部分实现 |
| Port 接口定义（新，lib/） | `lib/environment/interfaces/` (agent, asr, clipboard, eventlog, me, reminder, runtime, storage, task) — 共 9 个 Port | 已实现 |
| Environment 实现 | `lib/environment/environment.ts` | 已实现 |
| Bootstrap 引导 | `lib/environment/bootstrap.ts` | 已实现 |

**说明**: 实际 Port 接口主要在 `src/lib/environment/interfaces/` 下，已定义 9 个 Port。旧的 `src/environment/interfaces/` 保留 3 个（crypto, cursor, sync）。资源池（resource-pool）和消息缓冲（message-buffer）尚未独立实现。

### L3 Services / Agents（业务逻辑层）

**位置**: `src/services/` + `src/lib/services/`

| 服务 | 文件 | 功能 |
|------|------|------|
| Agent Hub | `agent-hub.service.ts` | Agent 集市与运行时管理 |
| Clipboard | `clipboard.service.ts` | 剪贴板操作 |
| Command Palette | `command-palette.service.ts` + `command-registry.service.ts` | 命令面板系统 |
| Cursor Agent | `cursor-agent.service.ts` | Cursor 集成 |
| ECS Replication (2个) | `ecs-active-block-replication.service.ts`, `ecs-eventlog-replication.service.ts` | 跨设备数据同步 |
| EventLog | `eventlog.service.ts` | 事件日志核心 |
| Me | `me.service.ts` | 用户身份 |
| Reminder | `reminder.service.ts` + `reminder-scheduler.service.ts` | 提醒系统 |
| Runtime (4个) | `runtime-aggregator/control/host/mesh-sync.service.ts` | Agent 运行时管控 |
| Signal Pool (4个) | `signal-handlers/http-sse-transport/route/stream.service.ts` | 信号池通信系统 |
| Task (3个) | `task.service.ts`, `task-backup.service.ts`, `task-timer.service.ts` | 任务系统 |
| Timeblock | `timeblock.service.ts` | 时间块系统 |
| Update | `update.service.ts` | 应用更新 |
| Voice (2个) | `voice-chat.service.ts`, `voice-signal.service.ts` | 语音交互 |
| Settings Data | `services/impl/settings-data-service.ts` | 设置数据管理 |
| Now Workbench Overlay | `services/now-workbench-overlay.service.ts` | 桌面浮窗覆盖层 |
| Voice Shortcut | `services/voice-shortcut.service.ts` | 语音快捷键 |
| Runtime Client/Manager | `services/runtime-client.ts`, `runtime-manager.ts` | 运行时客户端 |

### L4 UI（前端展示层）

**位置**: `src/ui/` + `src/components/` + `src/pages/`

#### 页面

| 页面 | 文件 |
|------|------|
| Focus（专注） | `ui/app/pages/FocusPage.tsx` |
| Tasks（任务） | `ui/app/pages/TasksPage.tsx` + TaskDetailPage + TaskDagPage |
| Agents（Agent 集市） | `ui/app/pages/AgentsPage.tsx` (2393 行，协调入口) + 子模块 `ui/app/pages/agents/`：`agents-utils.ts`, `SignalFlowNode.tsx`, `TopologyView.tsx`, `DeviceView.tsx`, `agents-sheets.tsx`, `RoutesTabView.tsx`, `NodesTabView.tsx`, `SignalHistoryTabView.tsx` |
| Me（我的） | `ui/app/pages/MePage.tsx` |
| Settings（设置） | `ui/app/pages/SettingsPage.tsx` |
| Reminders（提醒） | `ui/app/pages/RemindersPage.tsx` |
| Legal Support | `ui/app/pages/LegalSupportPage.tsx` |
| Update（更新） | `ui/app/pages/UpdatePage.tsx` |
| Voice Overlay | `src/pages/VoiceOverlayPage.tsx` |
| Now Workbench Overlay | `src/pages/NowWorkbenchOverlayPage.tsx` |
| ASR 测试页（MOSS/Volcano） | `src/pages/MOSSASRTestPage.tsx`, `VolcanoASRTestPage.tsx` |
| Sync 测试页 | `ui/pages/SyncTestPage.tsx` |
| User Manage | `ui/pages/UserManagePage.tsx` |

#### 核心组件

- 命令面板 (CommandPalette)
- 专注计时器 (FocusTimerWidget)
- BGM 协调器 (FocusBgmCoordinator)
- 任务 DAG 图 / 时间块视图
- 设备配对对话框 (PeerPairingDialog)
- 终端 (PtyTerminal + PtySpawnDialog)
- 提醒通知 (ReminderNotifier)
- 设置组件 (settings/)
- 用户卡片 (UserCard / SwitchAccountSheet)
- 聊天组件 (Chat/)
- 语音输入 (VoiceInputButton / VoiceMessageInput)
- 时间块 (TimeBlockWidget)

#### 状态管理 (zustand)

| Store | 位置 |
|-------|------|
| timeblock store（当前） | `lib/timeblock/store.ts` |
| reminder-ui-store | `ui/stores/reminder-ui-store.ts` |
| sync-store | `ui/stores/sync-store.ts` |
| update-store | `ui/stores/update-store.ts` |

> 注：`lib/stores/chat-store.ts` 和 `lib/stores/timeblock-store.ts` 已删除（后者已废弃，由 `lib/timeblock/store.ts` 替代）。

---

## 4. Rust 后端

### Tauri 应用层（src-tauri/）

| 模块 | 文件 | 功能 |
|------|------|------|
| 入口 | `main.rs`, `lib.rs` | 应用启动、插件注册 |
| ASR 命令 | `commands/asr_commands.rs` | 语音识别 Tauri 命令 |
| 设备命令 | `commands/device_commands.rs` | 设备信息 |
| EventLog 命令 | `commands/eventlog_commands.rs` | 事件日志操作 |
| 文件命令 | `commands/file_commands.rs` | 文件操作 |
| Now Workbench Overlay | `commands/now_workbench_overlay_commands.rs` | 桌面浮窗命令 |
| Runtime 命令 | `commands/runtime_commands.rs` | 运行时管理 |
| 快捷键命令 | `commands/shortcut_commands.rs` | 全局快捷键 |
| 工作区命令 | `commands/workspace_commands.rs` | 工作区操作 |
| WebSocket 命令 | `commands/ws_commands.rs` | WS 通信 |
| 同步 | `sync/mod.rs` | 数据同步 |

### exomind-runtime Crate（crates/exomind-runtime/）

独立的 Agent 运行时引擎，76 个 Rust 源文件。

| 模块 | 功能 |
|------|------|
| `agent/` | Agent 生命周期管理 |
| `auth.rs` | 认证 |
| `discovery.rs` | mDNS 服务发现 |
| `energy.rs` | 能量系统 |
| `eventlog.rs` | 事件日志 |
| `mesh/` | 网格同步 |
| `pairing.rs` | 设备配对 |
| `pty/` | 伪终端（非 Android） |
| `routes/` | HTTP API 路由 |
| `signal/` | 信号池 |
| `task/` | 任务管理（SQLite） |
| `tick.rs` | 定时 Tick 驱动 |

**关键依赖**: axum, tokio, rusqlite, mdns-sd, portable-pty, reqwest

---

## 5. 子包

### packages/mcp（MCP Server）

MCP（Model Context Protocol）服务端，为 LLM 工具调用提供接口。

| 组成 | 说明 |
|------|------|
| `mcp-server.ts` | MCP 服务器入口 |
| `ports/` | 端口定义 |
| `tools/` | 工具实现 |

### packages/ts-agent-cli（TS Agent CLI）

TypeScript Agent 命令行工具，包含多个开发计划版本（v1-v4）。

| 组成 | 说明 |
|------|------|
| `src/agent.ts` | Agent 核心 |
| `src/sse/` | SSE 通信 |
| `scripts/` | 辅助脚本 |
| `agents/` | 具体 Agent 定义 |
| `test/` | 测试 |

---

## 6. 服务端

**位置**: `server/`

| 文件 | 功能 |
|------|------|
| `pouchdb-server.js` | PouchDB 同步服务器（端口 6984） |
| `agent-runtime-server.js` | Agent 运行时服务 |
| `config.js` / `config.json` | 服务配置 |
| `startup-guard.js` | 启动守护 |

---

## 7. 技术栈版本

### 前端

| 技术 | 版本 |
|------|------|
| React | 18.3.1 |
| TypeScript | ~5.6.2 |
| Vite | ^6.0.3 |
| Tailwind CSS | 3 |
| zustand | ^5.0.11 |
| @tanstack/react-router | ^1.158.0 |
| @tauri-apps/api | ^2 |
| PouchDB | ^9.0.0 |
| lucide-react | ^0.563.0 |
| @xyflow/react | ^12.10.1 |
| Vitest | ^4.0.18 |
| Playwright | ^1.58.1 |

### 后端（Rust）

| 技术 | 版本 |
|------|------|
| Tauri | 2 |
| tokio | 1 |
| axum | 0.7 |
| rusqlite | 0.32 |
| reqwest | 0.12 |
| serde | 1 |
| mdns-sd | 0.11 |
| portable-pty | 0.8 |

### 工具链

| 工具 | 用途 |
|------|------|
| Bun | JS 包管理 & 脚本运行 |
| Vite | 前端构建 |
| Tauri CLI | 桌面应用构建 |

---

## 8. 测试体系

**位置**: `tests/`

| 类别 | 路径 | 说明 |
|------|------|------|
| 单元测试 | `tests/unit/` | Vitest |
| 集成测试 | `tests/integration/` | 多模块协作 |
| E2E 测试 | `tests/e2e/` | Playwright，覆盖大量 Issue 场景 |
| 适配器测试 | `tests/adapters/` | L1 适配器 |
| 组件测试 | `tests/components/` | UI 组件 |
| 数据库测试 | `tests/db/` | 存储层 |
| 存储测试 | `tests/storage/` | 存储适配器 |
| 同步测试 | `tests/sync/` | PouchDB 同步 |
| CI 配置 | `tests/ci/` | CI 辅助 |

E2E 测试脚本覆盖了 issue-27, 77, 82, 120, 198, 201, 204, 205, 213, 215, 243, 245f 等多个 Issue。

---

## 9. 文档完整度

### docs/ 目录（85+ 文件）

| 子目录 | 文件数 | 内容 |
|--------|--------|------|
| `docs/architecture/` | 12 | 系统架构设计（ECS、MVP、同步、信号池等） |
| `docs/specs/` | 14 | 模块规格（同步、加密、认证、存储、WebSocket 等） |
| `docs/plans/` | 70+ | 功能计划（按日期归档，2026-01 至 2026-03） |
| `docs/development/` | 9 | 开发指南（团队协作、E2E 运行、端口配置等） |
| `docs/agents/review-agent/` | 9 | Review Agent 设计文档 |
| `docs/fixes/` | 4 | 修复记录 |
| `docs/pr/` | 8 | PR 相关文档 |
| `docs/research/` | 1 | 技术调研 |

### docs/ 迁移后目录（当前结构）

> 注：以下为迁移前的 pm/ 结构描述，文档已于 2026-03 迁移至 docs/ 目录。

| 原 pm/ 路径 | 迁移后路径 |
|------------|-----------|
| `pm/PRD.md` | `docs/product/PRD.md` |
| `pm/roadmap.md` | `docs/product/roadmap.md` |
| `pm/git-spec.md` | `docs/development/git-spec.md` |
| `pm/memory/` | `docs/memory/` |

---

## 10. 最近开发动态（2026-03）

基于最近 30 条 commit 分析：

| 方向 | 代表性 commit | 状态 |
|------|---------------|------|
| **Now Workbench Overlay** | 桌面浮窗覆盖层（idle task bubble, hover 交互, 多屏支持） | 活跃开发 |
| **Focus BGM Player** | 专注背景音乐播放器 (#513, issue-136) | 刚完成 |
| **Settings Registry** | 设置页面注册表驱动重构（registry layouts, grouped controls） | 已合并 |
| **ASR 安全加固** | ASR endpoint 认证, CSP 配置 (#452) | 已完成 |
| **Phase 3 Lifecycle** | 生命周期与信号流 (#444, #487) | 已完成 |
| **Review Agent** | 自动代码审查 Agent | 设计+实现中 |
| **Tauri Dev Manager** | 开发实例安全管理 | 刚提交 |

### 当前版本里程碑

- 版本: **v0.3.6**
- 重点: 桌面体验（overlay 浮窗）、语音交互增强、设置系统重构、Agent 运行时完善

---

## 11. 核心模块状态总结

| 模块 | Phase | 状态 |
|------|-------|------|
| Port 接口层 | Phase 1 | **基本完成**（9 个 Port 已定义） |
| Adapter 实现层 | Phase 1 | **基本完成**（ASR/Storage/Task/EventLog 等全覆盖） |
| Environment | Phase 1-3 | **部分完成**（bootstrap 和 environment 已实现，资源池未独立） |
| Service 层 | Phase 1-2 | **大量实现**（25+ 服务） |
| EventBus / Signal Pool | Phase 2-3 | **已实现**（signal-route, signal-stream, SSE transport） |
| Actor / Agent Model | Phase 4 | **进行中**（runtime-host, agent-hub 已有，完整 Actor 模型未完成） |
| ECS 数据同步 | Phase 3 | **已实现**（ECS replication services） |
| 能量系统 | Phase 5 | **原型阶段**（energy.rs in runtime crate） |

---

## 12. 配置文件索引

| 文件 | 用途 |
|------|------|
| `package.json` | 前端依赖 + 脚本 |
| `src-tauri/Cargo.toml` | Rust 主应用依赖 |
| `crates/exomind-runtime/Cargo.toml` | 运行时引擎依赖 |
| `tsconfig.json` | TypeScript 配置 |
| `vite.config.ts` | Vite 构建配置 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置 |
| `tailwind.config.js` (如有) | Tailwind 配置 |
| `src/config/` | 前端运行时配置（25+ 配置模块） |
