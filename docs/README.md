# ExoMind 文档导航

> 本索引覆盖 docs/ 下所有文档。人类和 AI Agent 共用。

---

## 架构与设计

- [系统原则](architecture/principles.md) -- invariant / affordance、生命判据与命名语义
- [架构总览](architecture/overview.md) -- 全局分层模型与系统背景；Reticulum/ENS 当前网络路线以专项 handoff/plan 为准
- [Agent Workbench 共享工作图谱](architecture/agent-workbench-shared-graph-spec.md) -- Agent Workbench 长期架构规格与实施阶段
- [信号池架构](architecture/ARCH-signal-pool-agent-process.md) -- SignalPool 进程模型与信号流
- [同步架构](architecture/ARCH-SYNC.md) -- 历史 PouchDB/SyncServer 架构分析；Reticulum/ENS 当前路线不得以此为准
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
- [同步模块](specs/sync.md) -- RT-only 历史规格；Reticulum/ENS 当前跨 RT gateway 目标以专项 handoff/plan 为准
- [规格模板](specs/TEMPLATE.md) -- 新功能规格文档模板

---

## 产品方向

- [Vision](product/vision.md) -- 外心的产品使命、愿景与边界
- [PRD](product/PRD.md) -- 功能需求文档（全自动 Agent + 个人生命成长双核心）
- [路线图](product/roadmap.md) -- 自主生命体路线图（Phase 0-5）
- [已完成功能](product/completed-features.md) -- 已完成功能需求拆分清单

---

## 开发指南

- [Repo Agent Workflow](development/repo-agent-workflow.md) -- 源码工作目录 Agent 的技术操作细节、评论/验证/jj/发布规则
- [快速上手](development/quickstart.md) -- 开发环境搭建指南
- [前端设计规范](development/ui-spec.md) -- ExoMind 前端 UI 统一规范，含 token、页面分类、例外边界与评审清单
- [UI 文本选中白名单](development/ui-text-selection-whitelist.md) -- 落地 #503 时必须显式恢复可选中的正文、日志、终端、JSON 与技术内容面，并定义 Tauri/Web 默认右键菜单分流
- [设备配对流程](development/device-pairing-flow.md) -- legacy node-first/HTTP mesh 配对资料；不代表 Reticulum identity 授权闭环
- [Tauri Android Windows Playbook](development/tauri-android-windows-playbook.md) -- Windows 宿主机下的 AVD / APK / adb / Tauri MCP / 系统层验收经验
- [ExoMind CLI](development/exomind-cli.md) -- RT client shell（RT 客户端外壳）使用说明，含 connect-first 规则与命令样例
- [RT curl / Agent 接入 Skill](../skills/exomind-rt-agent-access/SKILL.md) -- raw RT curl/HTTP 联调唯一真源
- [Git 规范](development/git-spec.md) -- Git 工作流规范（权威版）
- [Runtime Agent API](development/exomind-runtime-agents-api.md) -- Runtime Agent HTTP/SSE 接口说明
- [悬浮工作台 release/debug 诊断](development/now-workbench-overlay-release-debug-diagnosis.md) -- 0.4.16 overlay 端口、RT readiness、release smoke 证据、已止血边界与后续根治计划
- [Issue 追踪罗盘](development/issue-tracking-compass.md) -- Issue 去重/决策/新建/追加流程
- [Playwright E2E](development/playwright-e2e-runtime.md) -- Playwright E2E 测试运行指南
- [端口环境配置](development/port-env-configuration.md) -- 多 Worktree 端口配置指南
- [Reticulum 双实例/双设备验收](development/reticulum-dual-instance-verification.md) -- Reticulum/ENS 自动测试、双 runtime、本机双窗口与 LAN/mDNS 人工验收路径
- [PR 审核证据模板](development/pr-review-evidence-template.md) -- 每轮提交后 PR 评论模板
- [信号池时间块反馈](development/signal-pool-timeblock-feedback.md) -- 时间块停止/结束 Agent 自动反馈
- [团队协作规范](development/team-collaboration.md) -- 多角色团队协作流程
- [团队调度经验](development/team-scheduling.md) -- 多 Agent 团队调度实践
- [Termux 环境](development/termux-environment.md) -- Android Termux 环境编译运行指南

---

## 研究

- [ASR 提供商调研](research/asr-providers-2026-03.md) -- ASR 方案选型调研报告 (2026-03)

---

## Agent 文档

### Runtime / 用户侧 Agent

- [概览](agents/README.md) -- runtime agent 契约与专项 agent 文档入口
- [Runtime Agent Contract](agents/runtime-agent-contract.md) -- 用户侧人格、对话风格与 prompt 边界

### Review Agent

- [索引](../agents/review-agent/references/index.md) -- 审核 Agent 文档入口
- [公共契约](../agents/review-agent/references/common-contract.md) -- 审核 Agent 公共契约
- [发现循环](../agents/review-agent/references/discovery-loop.md) -- PR/Issue 发现循环
- [审阅循环](../agents/review-agent/references/review-loop.md) -- 审阅执行循环
- [Router 与恢复](../agents/review-agent/references/router-and-recovery.md) -- Router 与重启恢复
- [状态文件与 Worktree](../agents/review-agent/references/state-files-and-worktrees.md) -- 状态文件与工作树管理
- [评论策略与模板](../agents/review-agent/references/comment-policy-and-templates.md) -- PR 评论策略与模板
- [统一入口 Prompt](../agents/review-agent/references/review-agent.prompt.md) -- 审阅 Agent 统一入口 Prompt

### 开发航线

- [开发航线 Skill](../skills/dev-route/SKILL.md) -- Issue 聚类分析与批次实施规划 skill

---

## 计划索引

> 本节同时索引当前权威入口、仍活跃计划与历史资料。只有明确标注为“当前权威入口”或“仍活跃”的文件可作为下一步计划；历史记录只能作为考古材料，不代表当前实现状态。已完成且不再参与接手的计划移至 [ARCHIVE-INDEX.md](ARCHIVE-INDEX.md)。

### Reticulum/ENS 当前权威入口

- [Reticulum 无上下文交接](plans/2026-06-08-reticulum-next-agent-handoff.md) -- 当前 Reticulum/ENS 接手入口、核心契约、代码锚点与下一步顺序
- [Reticulum 双实例/双设备验收](development/reticulum-dual-instance-verification.md) -- 当前人工验收入口；冷启动 Agent 应只用 handoff + 本手册决定下一步，历史计划不得覆盖这两个入口

### Reticulum/ENS 仍活跃计划与规则

- [Reticulum SignalEvent 数据面迁移](plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md) -- Reticulum 作为跨 RT 唯一 gateway 的用户目标、分层契约与验收矩阵
- [Reticulum 代码质量规则](plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md) -- 旧分支质量审查与后续 Agent 必须遵守的实现规则
- [Reticulum 原型考古迁移清单](plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md) -- 旧分支可迁移行为资产与禁止迁移的代码形状

### Reticulum/ENS 历史索引

- [ENS/Reticulum 历史实施记录](plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md) -- 已完成纵切与历史 checkpoint 索引；不作为当前权威计划

### 其他活跃计划

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
- [Issue #807 UI 总览入口](plans/PLAN-ui-ux-unification.md) -- 前端 UI/UX 统一重构总览、评审摘要与文档跳转
- [Issue #807 UI 实施计划](plans/2026-04-02-issue-807-ui-unification-implementation-plan.md) -- 修订后的前端统一化实施计划

### 归档计划

- [ExoBuffer Connector 技术需求](plans/archive/01_ExoBufferConnector技术需求报告.md) -- ExoBuffer 连接器技术需求报告
- [API 设计](plans/archive/API.md) -- 早期 API 设计文档
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

- [README.md](../README.md) -- 项目介绍、快速上手、**多实例管理器用法（tauri:manager）**
- [AGENTS.md](../AGENTS.md) -- 源码工作目录 Agent 合同（单真源）
- [CLAUDE.md](../CLAUDE.md) -- 兼容入口，指向 AGENTS.md
- [BUILD.md](../BUILD.md) -- 构建说明（CI/CD、跨平台构建）
- [CHANGELOG.md](../CHANGELOG.md) -- 版本历史
- [QUICK-START.md](../QUICK-START.md) -- 快速上手指南
- [scripts/CLAUDE.md](../scripts/CLAUDE.md) -- **开发脚本文档（tauri-dev-manager、端口管理）**

---

## 通用 AI 上下文

- [AI-CONTEXT.md](AI-CONTEXT.md) -- AI 工具通用项目上下文与文档索引
- [ARCHIVE-INDEX.md](ARCHIVE-INDEX.md) -- 已删除文档的历史索引

---

> 最后更新: 2026-07-06
> 导航版本: v4.6
