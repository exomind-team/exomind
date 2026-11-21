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

上面的总览解释 0.5 主线。当前 0.6 Beta 的持久事实、命令、复制与窗口关系见
[Beta 维护入口](../src/beta/README.md)、
[Native 工作区](development/beta-native-workspace.md)和
[多来源复制合同](development/beta-multiorigin-sync.md)。共享 React 展示组件不意味着
复用旧 Runtime 的业务所有权；Alpha 与 Beta 的配置/数据/候选身份分别核对。

旧主线快速参考：L1 Adapter -> L2 Environment -> L3 Service / Actor / Agent -> L4 UI。
Beta 的 Core/Host/Native/UI 边界按上面的当前入口读取，不把下表当作其完整运行图。

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

2026-11-21 当前候选为 **Beta25／6025／Core11**。functional source
`5051a6bc` 修复 Beta24 的三个 P2：在途附件捕获的新稿隔离、非法自定义分钟，
以及取消导出文案；Source Contracts 与 versioned payload `97b642f9` 的独立
source gate 均通过。request-only recipe `bcabadaa` 的 Build Validation
`44866998175` 中 resolver、Windows、Linux、macOS、Android 全部成功。精确
Windows Root 真窗和两位独立 DeepSeek 用户已走 S01-S10；D01/D02/D03 两位均通过。

完整 Beta 仍未签收。两位用户都是 6 项本地路径 pass、S02/S04/S07/S08 等真实
外部路径 partial；B 的 S10 也为 partial。缺口是第二设备/网络矩阵、真实回顾
模型、持凭据外部 Agent、可交互系统保存框、物理 Android/麦克风与到期彻底清理。
这些不能由 source/CI/Root smoke 代替。候选 hash、逐故事证据、P3 观察和逐项恢复
条件见 [Beta25 frozen and blocked matrix](plans/2026-11-21-beta25-frozen-and-blocked-matrix.md)。

历史阶段：Beta20 source `6ad7869d` 的 Android job 曾发现 `E0425`，后以
**Beta21／6021** 修正平台分支。Beta20 的 source／recipe 和失败记录保留，不将
桌面通过当成 Android 通过。

2026-11-21 工作区已完成档案往返／选取内容导出的 Native 与 UI 接线，准备
**Beta20／6020／Core11**。733 项 Beta 前端、完整类型与生产 Web、90 项 Beta Native、
Host 导出 9 项及选择预算 5 项通过，本地源码合同门禁通过。个人 monitor Skill 的独立
真实 HTTP 驱动已读完 506 capture、更正与时间块历史，核对 4 件并查证 AgentNote。
尚未固定该候选 source／recipe 或签收其窗口／设备；下方 Beta19 仍是已冻结的旧候选。
入口见 [用户导出](development/beta-user-exports.md)和[持续完成计划](plans/2026-11-19-beta16-frozen-and-beta-completion.md)。

2026-11-20 的冻结候选为 **Beta19／6019／Core10**，payload `cc3bc937`、recipe
`5708e0ba`，四平台仅构建成功。平板全新安装由用户点击系统确认后完成；该次不算
保数据升级。隔离 PC 与平板经指定 EasyTier 地址双向记录、跨端计时与反馈已实测。
624 KiB 原件的自动开关与 8 MiB 上限均正常，但一次加入后接收端缺返拨地址；反向
管理操作后同一原件到达且 SHA 一致。代理连接的 Host 回归已取得对应行为红灯，修复
与新候选验收继续推进，不能宣称完整同步已通过。工作区 Core11 的窗口读取、更正
材料及精确来源合同见 [Core11 维护说明](development/beta-core11-history-and-review.md)。
档案往返包和 monitor 日用适配仍在实现；视频预览已延后，授权的视频原件字节读取
仍在本轮范围。完整剩余项以 [持续完成计划](plans/2026-11-19-beta16-frozen-and-beta-completion.md)为准。

2026-11-19 历史候选 **Beta18／6018／Core9**，冻结 payload `66124154`、recipe
`b8d896e9`；四平台仅构建与该 payload 的 Source Contracts 已通过。导出中断恢复在系统
选择器前记录任务，重启后可查证／重新选址；源码 591 项 Beta 回归、完整类型及 Windows
Native 检查通过。精确 Windows 候选已验证身份、既有记录／原件保值、真实 Ctrl+Enter
输入与正常退出；系统保存框受 Computer Use 原生管道不可用阻塞。双 ABI APK 的历史
Beta 签名、6018 与非签名包内容已核验；API35 x86_64 已验证保数据升级、8 KiB 正常导出、
选择器内进程回收后的中断／重新选址及重启保留，两个成功文件独立 SHA-256 一致。
物理平板已离场，真机恢复、真实能耗与 EasyTier 端点仍待。工作区 Core10 生命周期及
部分前端／授权增量不在该冻结候选中。
先读 [Beta18 结果](plans/2026-11-19-beta18-export-recovery-candidate.md)、
[导出恢复合同](development/beta-original-export-recovery.md)，完整剩余任务仍按
[持续完成计划](plans/2026-11-19-beta16-frozen-and-beta-completion.md)核对。

2026-11-19内部Beta16冻结来源`85f7df92`、6016：四平台仅构建已齐；Windows启动/持久化9项、独立浮窗11项、API35 x86_64自有AVD原生UI记录/重启等6项通过，双ABI APK身份/签名/hash已核验。物理设备、升级与完整叙事另验。冻结后的文本预览、来源/路由回归、诊断后台及单件附件恢复已提交推送，最新源码门禁CI成功；诊断34项、授权后台4项、Settings集成13项及媒体/授权前端60项分别通过。工作区Core9标签/只增更正已做合成Core8升级与严格peer schema拒绝验证，Native/完整UI续验；录音、回收/释放等继续由Luna实现。这些增量未进入Beta16二进制，不将源码与旧候选证据混用。精确产物、原始需求矩阵和剩余队列见[持续完成计划](plans/2026-11-19-beta16-frozen-and-beta-completion.md)。默认Alpha配置保留Alpha05是有意隔离；无物理设备不阻止模拟器、合成夹具及本地实现推进。

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
| `docs/plans/` | 活跃计划与历史验收/封存，以文档状态为准 |
| `docs/memory/` | AI 对话记忆 |
| `docs/agents/` | 用户侧 / runtime agent 文档与专项 agent 契约 |
| `docs/research/` | 技术调研 |
| `docs/superpowers/` | Superpowers 工具生成规格 |

## 活跃工作

-> `docs/plans/` 包含活跃计划和历史验收/封存记录；以文档内状态与本页当前阶段为准，
不能仅因目录名就把已完成计划重新执行。

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
| 0.6 历史/返工、反例与接管成本 | [历史与返工审计](research/2026-11-19-v0.6-history-and-rework-audit.md)、[当前维护入口](../src/beta/README.md) |
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
