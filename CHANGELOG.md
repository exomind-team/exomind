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
