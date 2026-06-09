# Changelog

## [0.3.4] - 2026-03-05

### Added
- **SignalPool 全链路**: 实现 SignalPool 核心引擎 (bus/route/journal/window)、Signal HTTP API (7 endpoints)、前端 Signal SDK + Agent Shell + Echo Agent
- **SignalPool Phase 2**: Classifier Agent + Task/EventLog Actors + Reviewer Agent
- **时间块 Agent 自动反馈**: timeblock.completed → Reviewer Agent 自动生成反馈 (#323)
- **嵌入式 Runtime**: 内嵌 exomind-runtime 到 Tauri (lib 化 + setup 自动启动 + invoke 快速通道) (#328)
- **Agent Hub**: signal routes list + React Flow 拓扑视图 (#327), 多主机聚合 + AgentsPage 真实 runtime 数据 (#293)
- **M4 集成**: 嵌入式 RT、Agent Hub、信号链全链路集成 (#330)
- **ClaudeAgent**: 多轮会话持久化与流式测试 (#296), stream-json 对话接入 (#294), 会话生命周期管理 (#302), Token 成本统计 (#301)
- **RuntimeAggregatorService**: 多主机数据聚合服务
- **桌面端适配**: 响应式桌面 Shell + 设置桌面化 (#252), Agent 设备视图适配
- **语音交互**: 权限状态视觉反馈 (toast + 颜色区分)
- **CI/CD**: macOS/Linux 云端构建, build-tag 统一脚本, Black Hat Critic 双模型 PR 评审
- **Website**: 暗色模式切换 + 持久化主题, macOS/Linux 下载卡片
- **环境变量**: EXOMIND_RT_BIND 指定绑定地址

### Fixed
- **时间块同步** (issue-104): 同步排序加固、存储切换序列化、sync 启动失败恢复、active-block 冲突裁剪、倒计时 overtime 恢复 (#321)
- **反馈对话框**: 锁定状态、空提交拦截、重新打开逻辑
- **聊天**: 刷新本地启动事件、可关闭反馈对话框
- **CI**: bun install 挂起修复 (#329), self-hosted runner 稳定性提升
- **SignalPool QA**: 3 个核心问题修复 (F1/F2/F3)
- **更新检查**: 版本比较逻辑修正, R2 binding 统一
- **UI**: 系统状态栏重叠修复, 版本号重复 v 前缀

### Changed
- **同步层重构**: 集中化时间块同步生命周期协调器
- **ECS 架构文档**: Axon 通信栈设计, 双层原则命名规范
- **SignalPool 架构**: 升级 ARCH 到 v0.2

---

## [0.4.15] - 2026-05-20

### Added
- **Sync 自动化控制**: Runtime-local 自动化开关 + 设备网络视图集成, Peer 暂停/恢复进度 UI
- **Paired RT Model**: Phase 1 设计文档, 配对模型当前状态总结

### Fixed
- **内存修复**: 解决 OOM crash (#942) + SSE signal stream leaks (#944)
- **Sync**: 自动化开关关闭时禁用配对入口, 暂停 peer 保持暂停状态
- **TS 清理**: 移除 eventlog.service.ts 和 cursor-agent.service.ts 中的未使用 import

### Changed
- **RT Access 规范化**: 去硬编码, 所有 `http://127.0.0.1:9124` 和 `profile-argon` 替换为占位符, 新增"设备配置优先"规则
- **Chore**: 移除 server 目录 (PouchDB sync server 已废弃)

## [0.4.14] - 2026-04-22

### Added
- **EventLog Markdown Mirror**: 设置中可开关 EventLog Markdown 镜像

### Changed
- **性能优化**: Runtime 热路径收紧 + EventLog/TimeBlock tracing 埋点

### Fixed
- **Sync**: 硬化 reconciliation, 暴露 runtime 请求详情

## [0.4.13] - 2026-04-21

### Added
- **Task DAG 区间折叠**: 区间折叠核心逻辑 + TaskDagPreferencesConfig 持久化 + 控制面板折叠状态汇总
- **Proposal 重构**: 重构 proposal executor/store/intent mapping
- **Task DAG Page**: 集成折叠偏好与状态汇总至 TaskDagPage, 详情面板清除节点

### Fixed
- **UI**: 补齐 dialog 多行输入 Ctrl/Cmd+Enter 提交语义

## [0.4.12] - 2026-04-20

### Added
- **External Agent Await API**: 实现外部 agent await SSE endpoint + runtime 外部 await endpoint
- **Text Selection**: Tauri 文本选择与右键菜单策略
- **Task Proposal Surface Pilot**: 任务提案表面试运行

### Changed
- **Await Contract**: 持续精化 await API contract naming、payloads 和边界定义

## [0.4.11] - 2026-04-16

### Added
- **Android Focus Keepalive**: 保持屏幕唤醒, TimeBlock 结束时自动提醒
- **Runtime Plugins Module**: Runtime 插件模块暴露

### Changed
- **文档整理**: RT curl access skill, mobile continuity plan, sqlite-json-bridge 交接决策

### Fixed
- **Runtime Auth**: 对无效 peer token 返回 401
- **Task DAG**: 硬化 interval collapse 归一化

## [0.4.0] - 2026-04-08 (Major Release)

### Added
- **Agent Hub v0.3.5**: T1-T9 全量实现 — Tab 结构重构、路由表格、Signal History Tab、节点连接状态 badge、PTY 路由、Terminal Dialog
- **ECS-3 组网层**: mDNS LAN 自动发现, PIN 配对协议, Bearer Token Auth Middleware, Peer Pairing UI, Signal Mesh Relay
- **Agent System Phase 1**: Agent 身体骨架 (#438), PR Lock 协调机制
- **Task DAG Wave 1-3**: 交互式画布, 详情面板, Sugiyama 布局控制, TimeBlock Task 绑定
- **RT CLI Shell**: RT-native connect-first CLI, Cursor Port + HTTP Adapter 多光标集成
- **ASR**: Volcano Engine ASR 测试页 + Rust 后端 Tauri command
- **Dev Route Agent**: 开发航线 Agent 系统——章程、提示词与交互式 DAG 模板
- **Devlog 公开发布**: 开发日志公开发布系统, 自动解析班次标题
- **EventLog Permalinks**: 引用与永久链接, 引用导航增强
- **Android RT Background Service**: RT 后台保活 Foreground Service

### Fixed
- **Runtime稳定性**: 大面积修复, 覆盖 eventlog/timeblock/sync/proposal/agent-session 等核心路径
- **UI 一致性**: 修复多页面交互/主题收口问题
- **Sync Reconciliation**: 多处硬化

### Changed
- **架构演进**: 从 PouchDB 迁移到 SQLite-backed EDS interface (进行中)
- **Runtime IPC**: 全面规范化, 准备无头外心架构

### Deprecated
- **PouchDB Sync Server**: `server/` 目录标记废弃, 迁移至 EDS/RT 新架构
