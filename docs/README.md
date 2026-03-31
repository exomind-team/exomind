# ExoMind 文档导航

> 本索引覆盖 docs/ 下所有文档。人类和 AI Agent 共用。

---

## 架构与设计

- [架构总览](architecture/overview.md) -- 分层模型、Port/Service、Phase 路线（唯一权威）
- [Agent Workbench 共享工作图谱](architecture/agent-workbench-shared-graph-spec.md) -- Agent Workbench 长期架构规格与实施阶段
- [信号池架构](architecture/ARCH-signal-pool-agent-process.md) -- SignalPool 进程模型与信号流
- [同步架构](architecture/ARCH-SYNC.md) -- 多设备同步模块架构分析
- [ECS 通信栈](architecture/ECS-communication-stack.md) -- ExoMind Communication Stack 协议栈架构
- [ECS MVP 规格](architecture/ECS-mvp-spec.md) -- ECS 最小可行产品规格
- [ECS/EDS 讨论记录](architecture/ECS-EDS-discussion-2026-03-04.md) -- ECS/EDS 架构讨论草稿
- [Agent Hub UI 规范](architecture/agent-hub-ui-spec.md) -- Agent Hub 拓扑视图 UI 规范
- [CI 无 Artifact 方案](architecture/ci-artifact-free-design.md) -- CI 无 Artifact 存储设计

### 决策记录 (ADR)

- [ADR-003](architecture/DECISIONS/ADR-003-why-refactor-storage.md) -- 重构 FileStorage 模块决策
- [ADR-004](architecture/DECISIONS/ADR-004-why-refactor-websocket.md) -- 重构 WebSocket 模块决策

---

## 模块规格

- [ADR-003 架构统一](specs/ADR-003-architecture-unification.md) -- 统一 Tauri IPC + Rust 后端架构决策
- [SPEC-401](specs/SPEC-401.md) -- 移动端 WebSocket 客户端规格
- [SPEC-501 用户身份](specs/SPEC-501-UserIdentity.md) -- 用户身份系统设计
- [SPEC-502 配对系统](specs/SPEC-502-PairingSystem.md) -- 设备配对系统设计
- [SPEC-503 加密通信](specs/SPEC-503-EncryptedCommunication.md) -- 端到端加密通信设计
- [SPEC-901 存储重构](specs/SPEC-901-FileStorage.md) -- FileStorage 存储模块重构
- [SPEC-902 WebSocket 重构](specs/SPEC-902-WebSocket.md) -- WebSocket 模块重构
- [PR 锁机制](specs/SPEC-pr-lock-mechanism.md) -- PR Lock Mechanism 规格
- [任务 MCP API](specs/SPEC-task-mcp-api.md) -- 任务系统 MCP API 设计
- [认证模块](specs/auth.md) -- 用户认证模块规格（合并自 SPEC-302/304）
- [同步模块](specs/sync.md) -- 多设备数据同步模块规格（合并自 SPEC-301/303）
- [规格模板](specs/TEMPLATE.md) -- 新功能规格文档模板

---

## 产品方向

- [PRD](product/PRD.md) -- 功能需求文档（全自动 Agent + 个人生命成长双核心）
- [路线图](product/roadmap.md) -- 自主生命体路线图（Phase 0-5）
- [已完成功能](product/completed-features.md) -- 已完成功能需求拆分清单

---

## 开发指南

- [快速上手](development/quickstart.md) -- 开发环境搭建指南
- [设备配对流程](development/device-pairing-flow.md) -- node-first 配对、地址解析、Android 模拟器特殊规则
- [Git 规范](development/git-spec.md) -- Git 工作流规范（权威版）
- [Runtime Agent API](development/exomind-runtime-agents-api.md) -- Runtime Agent HTTP/SSE 接口说明
- [Issue 追踪罗盘](development/issue-tracking-compass.md) -- Issue 去重/决策/新建/追加流程
- [Playwright E2E](development/playwright-e2e-runtime.md) -- Playwright E2E 测试运行指南
- [端口环境配置](development/port-env-configuration.md) -- 多 Worktree 端口配置指南
- [PR 审核证据模板](development/pr-review-evidence-template.md) -- 每轮提交后 PR 评论模板
- [信号池时间块反馈](development/signal-pool-timeblock-feedback.md) -- 时间块结束 Agent 自动反馈
- [团队协作规范](development/team-collaboration.md) -- 多角色团队协作流程
- [团队调度经验](development/team-scheduling.md) -- 多 Agent 团队调度实践
- [Termux 环境](development/termux-environment.md) -- Android Termux 环境编译运行指南

---

## 研究

- [ASR 提供商调研](research/asr-providers-2026-03.md) -- ASR 方案选型调研报告 (2026-03)

---

## Agent 文档

### Review Agent

- [索引](agents/review-agent/index.md) -- 审核 Agent 文档入口
- [公共契约](agents/review-agent/common-contract.md) -- 审核 Agent 公共契约
- [发现循环](agents/review-agent/discovery-loop.md) -- PR/Issue 发现循环
- [审阅循环](agents/review-agent/review-loop.md) -- 审阅执行循环
- [Router 与恢复](agents/review-agent/router-and-recovery.md) -- Router 与重启恢复
- [状态文件与 Worktree](agents/review-agent/state-files-and-worktrees.md) -- 状态文件与工作树管理
- [评论策略与模板](agents/review-agent/comment-policy-and-templates.md) -- PR 评论策略与模板
- [统一入口 Prompt](agents/review-agent/review-agent.prompt.md) -- 审阅 Agent 统一入口 Prompt

### 开发航线

- [开发航线](agents/dev-route/) -- Issue 聚类分析与批次实施规划航线图

---

## 活跃计划

> 以下文件均为进行中的计划，已完成的计划已移至 [ARCHIVE-INDEX.md](ARCHIVE-INDEX.md)。

- [产品规划](plans/product-plan.md) -- 外心产品规划与实施计划
- [Agent Workbench Phase 1 平铺工作台](plans/2026-03-30-agent-workbench-phase1-flat-workbench-design.md) -- Agent Workbench 第一阶段设计
- [任务 MCP 集成](plans/task-mcp-integration.md) -- 任务系统通过 MCP 接入 Agent
- [同步服务器统一数据架构](plans/2026-03-01-sync-server-unified-data-architecture.md) -- 讨论稿
- [Agent Hub Claude/Codex 调研](plans/2026-03-06-agent-hub-claude-codex-runtime-research.md) -- Agent Runtime 对接调研
- [Agent Hub 拓扑布局设计](plans/2026-03-06-agent-hub-topology-layout-design.md) -- Topology Layout 设计
- [Agent Hub 拓扑布局计划](plans/2026-03-06-issue-382-agent-hub-topology-layout-plan.md) -- Issue #382 实现计划
- [Agent Runtime 编排计划](plans/2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md) -- Issue #385 实现计划
- [Agent Runtime 编排设计](plans/2026-03-07-issue-385-agent-runtime-orchestration-design.md) -- Issue #385 设计
- [个人成长到文明路线图](plans/2026-03-07-personal-growth-to-civilization-roadmap.md) -- 远期愿景路线
- [混合身份架构](plans/2026-03-07-user-system-hybrid-identity-architecture.md) -- 用户系统架构方案
- [Volcano 原生流式实现](plans/2026-03-10-volcano-native-streaming-implementation-plan.md) -- Volcano Native Streaming
- [RT EventLog SQLite 计划](plans/2026-03-11-issue-484-rt-eventlog-sqlite-plan.md) -- Issue #484 实现计划
- [RT TimeBlock SQLite 设计](plans/2026-03-11-issue-485-rt-timeblock-sqlite-design.md) -- Issue #485 设计
- [RT TimeBlock SQLite 计划](plans/2026-03-11-issue-485-rt-timeblock-sqlite-plan.md) -- Issue #485 实现计划
- [Review Agent B2 实现](plans/2026-03-11-review-agent-b2-implementation.md) -- Phase B2 实现计划
- [Review Agent C Prompt 设计](plans/2026-03-11-review-agent-phase-c-prompt-loading-design.md) -- Phase C Prompt Loading 设计
- [Review Agent C Prompt 计划](plans/2026-03-11-review-agent-phase-c-prompt-loading-plan.md) -- Phase C 实现计划
- [Review Agent C2/C3 修复](plans/2026-03-11-review-agent-phase-c2-c3-fixes-plan.md) -- Phase C2/C3 修复计划
- [Review Agent B2 后续修复](plans/2026-03-11-review-agent-post-b2-fixes-plan.md) -- Post-B2 修复计划
- [语音输入体验设计](plans/2026-03-11-voice-input-experience-design.md) -- Voice Input UX 设计
- [语音输入体验计划](plans/2026-03-11-voice-input-experience-implementation-plan.md) -- Voice Input UX 实现计划
- [语音悬浮卡片设计](plans/2026-03-11-voice-overlay-soft-floating-card-design.md) -- Soft Floating Card 设计
- [语音悬浮卡片计划](plans/2026-03-11-voice-overlay-soft-floating-card-implementation-plan.md) -- Soft Floating Card 实现
- [语音+任务+成长 MVP 摘要](plans/2026-03-11-voice-task-growth-mvp-brief.md) -- 周五可发布版本需求
- [语音+任务+成长 MVP 计划](plans/2026-03-11-voice-task-growth-mvp-implementation-plan.md) -- MVP 实现计划
- [Agent Session 统一抽象](plans/2026-03-13-agent-session-unified-abstraction-design.md) -- Agent Session 统一抽象设计
- [Focus BGM 播放器](plans/2026-03-13-issue-136-focus-bgm-player-plan.md) -- Issue #136 实现计划
- [语音输入规范化](plans/2026-03-13-issue-511-voice-input-normalization-plan.md) -- Issue #511 实现计划
- [Now Workbench Overlay v2](plans/2026-03-12-now-workbench-overlay-v2-design.md) -- Issue #516 双层气泡设计
- [文档体系重组设计](plans/2026-03-14-docs-reorganization-design.md) -- Issue #529 文档重组方案
- [文档体系重组计划](plans/2026-03-14-docs-reorganization-plan.md) -- Issue #529 实施计划

### 归档计划

- [ExoBuffer Connector 技术需求](plans/archive/01_ExoBufferConnector技术需求报告.md) -- ExoBuffer 连接器技术需求报告
- [API 设计](plans/archive/API.md) -- 早期 API 设计文档
- [自主生命体规格](plans/archive/AUTONOMOUS_LIFE_SPEC.md) -- 自主生命体原始规格
- [开发流程](plans/archive/DEVELOPMENT_PROCESS.md) -- 早期开发流程定义
- [通知权限守护](plans/archive/ExoMind-Notification-Permission-Guard.md) -- 通知权限守护设计

---

## 记忆系统

- [记忆系统说明](memory/README.md) -- 记忆系统使用指南
- [执行日志](memory/logs.md) -- Ralph Loop 每轮执行记录
- [项目概览](memory/project-overview.md) -- 项目概览快照
- [知识点：Git 工作流](memory/知识点-Git工作流.md) -- 双轨制 Git 工作流核心原则
- [知识点：文档分层](memory/知识点-文档分层.md) -- 架构设计/模块规格/其他文档区分

---

## Superpowers 工具生成

- [Settings Registry 设计](superpowers/specs/2026-03-11-settings-registry-design.md) -- Schema-Driven 设置项注册表设计
- [Settings Registry 演化记录](superpowers/specs/2026-03-14-settings-registry-evolution.md) -- 注册表从设计到实现的演化差异

---

## 项目根目录文档

> 以下文档位于项目根目录（非 docs/ 内），此处提供交叉引用。

- [src/docs/user-guide.md](../src/docs/user-guide.md) -- 用户指南，包含设备配对与多端互联说明
- [README.md](../README.md) -- 项目介绍、快速上手、**多实例管理器用法（tauri:manager）**
- [CLAUDE.md](../CLAUDE.md) -- Claude Code 专用指令
- [AGENTS.md](../AGENTS.md) -- Codex 专用指令
- [BUILD.md](../BUILD.md) -- 构建说明（CI/CD、跨平台构建）
- [CHANGELOG.md](../CHANGELOG.md) -- 版本历史
- [QUICK-START.md](../QUICK-START.md) -- 快速上手指南
- [scripts/CLAUDE.md](../scripts/CLAUDE.md) -- **开发脚本文档（tauri-dev-manager、端口管理）**

---

## 通用 AI 上下文

- [AI-CONTEXT.md](AI-CONTEXT.md) -- AI 工具通用项目上下文
- [ARCHIVE-INDEX.md](ARCHIVE-INDEX.md) -- 已删除文档的历史索引

---

> 最后更新: 2026-03-31
> 导航版本: v4.2
