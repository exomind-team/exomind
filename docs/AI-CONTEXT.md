# ExoMind AI Context

> 通用项目上下文与文档索引。源码工作目录 Agent 的执行合同见项目根目录 [AGENTS.md](../AGENTS.md)；`CLAUDE.md` 仅为兼容入口。

## 默认进入顺序

1. [AGENTS.md](../AGENTS.md)
2. [docs/product/vision.md](product/vision.md)
3. [docs/architecture/principles.md](architecture/principles.md)
4. 本文件（先读摘要与目录，再按任务展开）

## 项目定位

ExoMind（外心）= 个人 / 集体的生命成长助手 + 认知生命科学原型。

探索：

- 人作为生命如何主动掌控自己的力量
- 如何在计算机上实现生命 / 思维机器

## 技术栈

Tauri 2.0 + React 18 + TypeScript + Rust | Zustand | Tailwind CSS + Radix UI | Bun | Vitest

## 核心架构

-> [docs/architecture/overview.md](architecture/overview.md)

快速参考：L1 Adapter -> L2 Environment -> L3 Service / Actor / Agent -> L4 UI

| 层级 | 职责 | 接口归属 |
|------|------|----------|
| L4 UI | React + Zustand，只调 Service | Service interface（L3 定义） |
| L3 Service / Actor / Agent | 业务逻辑，LLM Agent 驱动 | ActorContext（L3 定义） |
| L2 Environment | 共享物理世界，持有 Port 实例 | Port interface（L2 定义） |
| L1 Adapter | 具体实现，按运行时替换 | -- |

## 原则与语义

- 产品使命与长期方向： [docs/product/vision.md](product/vision.md)
- 命名、invariant / affordance、生命判据： [docs/architecture/principles.md](architecture/principles.md)
- 用户侧 runtime agent 契约： [docs/agents/runtime-agent-contract.md](agents/runtime-agent-contract.md)

## 当前阶段

2026-11-19追加EasyTier现场修复：Beta13旧路由仍指Wi-Fi，新邀请缺覆盖地址；平板peer TCP可达，缓存过期假设已撤回（现有2秒接口刷新）。Beta15源码`a9553d93`增加保持原邀请/TLS pin的备用拨号路由，网络11项、Web371项/Edge28场景、Native检查通过，固定Windows EXE构建及真实双窗9项通过，含消息自动显示/旧档案保留。物理平板加入未验，Android未构建。Luna调查T3连接/peer-link完成，区分远程环境视图与外心多主本地副本。全量进展见[Beta09以来盘点](plans/2026-11-19-beta09-beta14-work-audit.md)、[覆盖网络记录](plans/2026-11-19-beta15-overlay-network-routes.md)、[T3对照](research/2026-11-19-easytier-t3-connections-and-sync.md)。

2026-11-19 Beta14候选完成本机验证：Windows源码`4c72a0e5`，64MiB真实Native附件流程6项通过（12.601秒、56次UI进度、完整SHA、Ctrl+Enter提交及系统打开），双隔离Windows P2P9项通过；浮窗反馈有效稿输入147帧、零禁用切换。Android源码`b8d15ec6`另补独立FileProvider及显式依赖，APK69,736,066字节/6014/同Beta签名，15张品牌PNG和自适应引用核验通过；未装真机。类型/60文件369项、28个Edge场景及Native/TLS回归保留。旧档案第三来源5个时间块事实在PC有但无签名证明，平板缺失，未自动恢复；小原件错误历史门禁已解耦，设备名当前仅本机备注。平板已拔出，Android升级/剪贴板/系统打开/实际图标、原手机历史及能耗仍待。精确来源、哈希、失败批及后续入口见[Beta14记录](plans/2026-11-18-beta14-attachments-and-field-sync.md)。

2026-11-18 Beta13固定候选 `835d0620`：精确Beta12复现确认Native仍计时而浮窗快照过期，已改Native直接读取/执行、共享草稿CAS、浮窗档案独立于主窗，并收敛导航/输入/检索、消息语义及Windows图标。UI351项/Edge24场景、Host14+Native工作区3+浮窗9项通过；最终EXE真实双窗22项、PC/实物平板双向文字/块历史/8KiB原件13项、平板离线/后台到点/实际重启8项通过。6013实装哈希匹配，APK68,910,081B；原0.5.2保留，是Beta新装而非升级。首次配对间歇identity_mismatch根因、手机用户历史、大文件与能源仍开放；主PID短时CPU/内存不能代替功耗。见[本轮记录](plans/2026-11-18-beta13-shell-and-desktop-feedback.md)、[Native工作区](development/beta-native-workspace.md)、[需求原则](development/beta-ui-user-requirements.md)和[Astra xhigh 20项审阅](research/2026-11-18-beta-ui-astra-xhigh-adversarial-review.md)。

2026-11-18 Beta12已交本机构建候选：Beta11 EXE重启闪退定位为Host归属清单遗漏Native桌面偏好文件；Host14项、UI337项/20场景通过，Astra high盲审两项P1已落地。源码a244f567的Windows实际隔离启动/设置保存后重启、身份/记录/回执保值及错误对话框验证通过；同源ARM64 APK为6012并与Beta10同签名，未真机安装。文件/hash/边界见[Beta12记录](plans/2026-11-18-beta12-startup-and-ui.md)。

2026-11-18最新前端增量：用户恢复Web优先UI迭代，独立显隐/内联图片/反馈合同已实现，Beta前端328项、完整Web16场景及生产Beta Web构建通过；详见[工作区迭代](plans/2026-11-18-beta-ui-workspace-iteration.md)。实机/能源与完整Beta仍待，旧APK/EXE未包含本轮前端变更。

当前 0.6 的最新状态以 [Alpha 阶段收尾](plans/2026-11-13-v0.6-alpha-closeout.md) 和 [Beta 功能计划](plans/2026-11-13-v0.6-beta-feature-plan.md) 为准：Alpha05 阶段已完成，二进制来源 `99b6b648`，148 项相关测试、Windows 精确候选 73 项验收、四平台仅构建 CI 通过；Android 新装本机记录、重启、系统栏/全屏复验通过，用户已人工确认当下发送、系统栏避让与全屏效果。Android 卸载后新装不计入保留数据升级，新协议、完整跨端矩阵与后台恢复仍待 Beta。Beta 主链路已有实现与专项证据，完整验收尚未通过；当前状态见 [最新 Beta 全项盘点](plans/2026-11-17-v0.6-beta-progress-audit.md)；任务状态与后续验证以 [Beta 实施记录](plans/2026-11-13-v0.6-beta-execution.md) 为准。Alpha 手机与平板的局域网消息同步另获用户人工验收通过，但不代替 Beta 新协议与完整设备矩阵。[r3 计划](plans/2026-11-11-v0.6-migration-ui-tauri-validation-plan.md) 与 [27题审批决定](plans/2026-11-11-v0.6-approved-decisions.md) 保留需求来源。新版保留档案权限隔离、自定义标签、只增记录、通用原件和时间块轮转；配对单位为设备上的档案，同名档案不自动相连。小文件自动、大文件按需同步，以最终一致和恢复为准。UI 直接复用旧 React 组件/布局/字体/暖石主题，不复建任务/提案/终端会话管理，不要求迁移 0.5。未公开发布 0.6，未切换日用入口。

下述 0.5 阶段结论保留为历史背景；其中“恢复迭代从 0.5.3 开始”针对继续 0.5.x 的候选，不覆盖用户已明确授权的独立 0.6 路线。`v0.5.2` 失败标签仍不可移动或复用，长期产品愿景与既有架构资料不因本计划被重写。

Phase 2 完成（SignalPool L3-L5），Phase 3 待启动（资源管控 + 可观测性）。#555 内置 `timeblock_summary` Agent Harness：Phase 1 MVP（2026-06-03）+ Phase 3 AI Registry 桥接 + 设置页开关（2026-06-04）已完成，端到端验证通过。

当前产品迭代主线见 [v0.5.x 日常核心能力迭代计划](plans/2026-08-24-v0.5x-daily-core-iteration-plan.md)。本轮唯一完成产品验收的正向增量，是恢复悬浮工作台并解除桌面端长期锁定 `0.4.22` 的阻塞；用户确认 `Windows 0.5.1 ↔ Android 0.5.0` 可以正常同步。`v0.5.1` 未通过全平台发布 CI；`v0.5.2` 又在同版本 PC/Android 真机配对中暴露 `Failed to fetch` 与 mesh peer token 缺失，因此该轮迭代宣告失败并撤销发布。应用版本与运行代码已回退到 `v0.5.1@526db22e`，本阶段停止开发。

`v0.5.2` 是不可移动、不可复用的失败标签。未来恢复迭代时，下一个候选必须从 `v0.5.3` 开始，先修配对/认证连续性；任何 preview 必须同时通过精确候选四平台 CI，以及 PC/Android 在新装态与升级态下的发现、PIN 配对、EventLog live sync 和恢复性同步实测。近期仍保持现有 RT SQLite 与 Mesh/Signal，不引入 DSON、Reticulum 或插件平台。

[#906](https://github.com/exomind-team/exomind/issues/906) 是上述日常核心迭代之后的架构阶段和上位约束，不再作为当前 `0.5.x` 功能的实施前置条件。

## 文档索引

-> [docs/README.md](README.md)

## 关键目录

| 目录 | 内容 |
|------|------|
| `docs/architecture/` | 架构设计、原则、分层模型 |
| `docs/specs/` | 模块规格 |
| `docs/product/` | 产品方向、PRD、路线图 |
| `docs/development/` | 开发指南、Git 规范、Repo Agent 操作细节 |
| `docs/plans/` | 活跃实施计划（仅进行中） |
| `docs/memory/` | AI 对话记忆 |
| `docs/agents/` | 用户侧 / runtime agent 文档与专项 agent 契约 |
| `docs/research/` | 技术调研 |
| `docs/superpowers/` | Superpowers 工具生成规格 |

## 活跃工作

-> `docs/plans/` 中的所有文件均为进行中的计划。

## 源码结构

```text
src/
  adapters/       # L1：具体实现（llm, asr, tts, storage, terminal, crypto, platform）
  environment/    # L2：共享物理世界
  services/       # L3：业务逻辑层
  actor/          # L3：Actor/Agent 模型
  ui/             # L4：前端展示层
src-tauri/        # Rust 后端（Tauri 2.0）
```

## 常用文档入口

| 场景 | 文档 |
|------|------|
| Beta 根因回归、Agent-spec 试点与空间 GC | [迭代门禁](development/beta-iteration-guards.md)、[工业化路线图](plans/2026-11-19-v0.6-industrial-iteration-roadmap.md) |
| 源码工作目录 Agent 合同 | [AGENTS.md](../AGENTS.md) |
| 用户侧 runtime agent 契约 | [docs/agents/runtime-agent-contract.md](agents/runtime-agent-contract.md) |
| 前端 UI 统一规范 | [docs/development/ui-spec.md](development/ui-spec.md) |
| Alpha UI/UX 复用与 Beta 前端指导 | [Alpha UI/UX 参考](development/alpha-ui-ux-reference.md) |
| Beta 独立显隐/内联图片/完整Web交互迭代 | [前端工作区迭代](plans/2026-11-18-beta-ui-workspace-iteration.md) |
| Beta 当前核心缺陷/P1推进 | [核心缺陷优先迭代](plans/2026-11-17-v0.6-beta-core-first-iteration.md) |
| Beta11当前暂停交接/交付/未决项 | [暂停交接](plans/2026-11-17-beta11-paused-handoff.md) |
| Beta 多来源历史、证明、ACK与闲置判变 | [多来源复制合同](development/beta-multiorigin-sync.md) |
| Beta 本机性能/运行诊断面板 | [观测面板设计](plans/2026-11-17-beta-observability-ui-design.md) |
| Beta 性能实测、能耗边界与包体 | [性能调查与父代理续测](research/2026-11-17-beta-performance-investigation.md) |
| Git / worktree / PR / 发布操作 | [docs/development/repo-agent-workflow.md](development/repo-agent-workflow.md) |
| Git / worktree 权威规范 | [docs/development/git-spec.md](development/git-spec.md) |
| 多 worktree 端口与联调 | [docs/development/port-env-configuration.md](development/port-env-configuration.md) |
