# 文档归档索引

已删除文档的历史记录。原文件可通过 git 历史查看（`git log --all -- <原路径>`）。

## 计划文档（已完成）

| 原路径 | 摘要 | 关联 Issue/PR | 删除提交 |
|--------|------|---------------|----------|
| docs/plans/2026-03-14-unified-logger-logpanel-redesign.md | 双写日志接口 + LogPanel 新 UI 重设计。**关键决策**: 双写模式（内存 listener + console + Tauri plugin-log），LogPanel 迁移到暖石色系设计 token | #525, PR #526 | 3998871b |
| docs/plans/2026-03-14-legacy-data-migration-design.md | PouchDB/IndexedDB → RT SQLite 一次性迁移 Modal 设计。**关键决策**: Bootstrap 层一次性迁移（不留 fallback）、Modal 对话框提示（弹一次）、失败保守回退 legacy 模式、旧数据保留不删除、三域统一迁移（EventLog+Task+TimeBlock）、merge 策略幂等安全 | PR #524 | 3998871b |
| docs/plans/2026-03-13-issue-514-instance-diagnostics-plan.md | Issue #514 实例诊断功能实现计划 | #514 | (本次提交) |
| docs/plans/2026-03-13-pr-506-closeout-plan.md | PR #506 收尾验收实现计划 | PR #506 | (本次提交) |
| docs/plans/2026-03-12-settings-inline-enum-alignment-plan.md | Settings 内联枚举对齐实现计划 | - | (本次提交) |
| docs/plans/2026-03-12-settings-group-overlay-plan.md | Settings 分组覆盖层对齐实现计划 | - | (本次提交) |
| docs/plans/2026-03-12-settings-dialog-alignment-plan.md | Settings 对话框对齐实现计划 | - | (本次提交) |
| docs/plans/2026-03-12-settings-danger-action-plan.md | Settings 危险操作按钮实现计划 | - | (本次提交) |
| docs/plans/2026-03-11-settings-registry-implementation-plan.md | Settings Registry 模块实现计划 | - | (本次提交) |
| docs/plans/2026-03-11-pr499-review-regressions.md | PR #499 Review 回归问题修复计划 | PR #499 | (本次提交) |
| docs/plans/2026-03-11-review-agent-b1-implementation.md | Review Agent Phase B1 实现计划 | - | (本次提交) |
| docs/plans/2026-03-11-issue-481-rt-task-sqlite-plan.md | RT Task SQLite 迁移实现计划 | #481 | (本次提交) |
| docs/plans/2026-03-10-review-agent-unified-entry-plan.md | Review Agent 统一入口实现计划 | - | (本次提交) |
| docs/plans/2026-03-10-voice-overlay-live-preview-design.md | 语音悬浮窗实时预览设计 | - | (本次提交) |
| docs/plans/2026-03-09-review-agent-prompts-and-loop-plan.md | Review Agent 提示词 + 执行循环实现计划 | - | (本次提交) |
| docs/plans/2026-03-09-review-agent-discovery-plan.md | Review Agent 服务发现实现计划 | - | (本次提交) |
| docs/plans/2026-03-09-review-agent-bootstrap-plan.md | Review Agent 启动恢复实现计划 | - | (本次提交) |
| docs/plans/2026-03-09-phase1-agent-body-plan.md | Phase 1 Agent 身体骨架执行计划 | #438 | (本次提交) |
| docs/plans/2026-03-08-life-demo-energy-tick.md | 认知生命 Demo 能量系统 + Tick 心跳实现计划 | - | (本次提交) |
| docs/plans/2026-03-07-embedded-runtime-agent-host-sync-plan.md | 内嵌 Runtime Agent Host 同步实现计划 | - | (本次提交) |
| docs/plans/2026-03-07-ecs-381-acceptance-report.md | ECS #381 验收报告 | #381 | (本次提交) |
| docs/plans/2026-03-07-ecs-381-remaining-work-plan.md | ECS #381 剩余工作实现计划 | #381 | (本次提交) |
| docs/plans/2026-03-06-ecs-data-sync-mvp-plan.md | ECS 数据同步 MVP 实现计划 | - | (本次提交) |
| docs/plans/2026-03-06-ecs-phase3-test-baseline-plan.md | ECS Phase 3 测试基线实现计划 | - | (本次提交) |
| docs/plans/2026-03-06-release-v0.3.5-finalization-plan.md | ExoMind v0.3.5 发版收尾计划 | - | (本次提交) |
| docs/plans/2026-03-06-agent-hub-voice-signal-integration.md | Agent Hub 语音信号集成实现计划 | - | (本次提交) |
| docs/plans/2026-03-06-ecs-phase2-mesh-relay-plan.md | ECS Phase 2 Mesh 中继实现计划 | - | (本次提交) |
| docs/plans/2026-03-06-ecs-phase1-transport-plan.md | ECS Phase 1 传输层实现计划 | - | (本次提交) |
| docs/plans/2026-03-05-m4-agent-soft-skills-evaluation-pr-comment.md | M4 Agent 软技能（Classifier + Reviewer）评选 PR 评论 | - | (本次提交) |
| docs/plans/2026-03-04-m4-rt-agent-hub-review-comment.md | M4 RT Agent Hub 最终评审结果（自检） | - | (本次提交) |
| docs/plans/2026-03-04-m4-rt-agent-hub-progress-comment.md | M4 RT Agent Hub 阶段 2 整合进展更新 | - | (本次提交) |
| docs/plans/2026-03-04-m4-rt-agent-hub-pr-body.md | M4 RT 内嵌 + Agent Hub 整合 PR 描述 | - | (本次提交) |
| docs/plans/2026-03-04-m4-rt-agent-hub-plan-comment.md | M4 方案与验收链路审批版 PR 评论 | - | (本次提交) |
| docs/plans/2026-03-04-m4-rt-agent-hub-integration-plan.md | M4 RT 内嵌 + Agent Hub 整合实现计划 | - | (本次提交) |
| docs/plans/2026-03-04-ci-bun-install-selfhosted-stabilization.md | Self-Hosted Bun Install CI 稳定化实现计划 | - | (本次提交) |
| docs/plans/2026-03-04-m1-review-followup-comment.md | M1 评审闭环补充（子代理 Review Follow-up） | - | (本次提交) |
| docs/plans/2026-03-04-m1-final-pr-comment.md | M1 完成汇报：exomind-runtime 内嵌 Tauri | - | (本次提交) |
| docs/plans/2026-03-04-m1-embedded-runtime-tauri-plan.md | M1 Tauri 内嵌 Runtime 实现计划 | - | (本次提交) |
| docs/plans/2026-03-04-m1-embedded-runtime-pr-comment.md | M1 exomind-runtime 内嵌 Tauri 方案确认 PR 评论 | - | (本次提交) |
| docs/plans/2026-03-04-issue-245f-m2-agent-hub-signal-routes-plan.md | Agent Hub 信号路由 + React Flow 拓扑实现计划 | #245 | (本次提交) |
| docs/plans/2026-03-04-issue-245f-m2-agent-hub-followup-fix-plan.md | Agent Hub 信号路由 / 拓扑 Follow-up 修复计划 | #245 | (本次提交) |
| docs/plans/2026-03-04-v034-milestone-plan.md | v0.3.4 里程碑计划 | - | (本次提交) |
| docs/plans/2026-03-01-issue-104-timeblock-multi-device-sync-plan.md | Issue #104 多设备时间块同步行动方案 | #104 | (本次提交) |
| docs/plans/2026-03-01-signal-pool-sse-runtimehost-mvp-mlp-plan.md | SignalPool SSE RuntimeHost Relay MVP/MLP 实现计划 | - | (本次提交) |
| docs/plans/2026-02-27-issue-205-p0-runtimehost-acceptance-plan.md | Issue #205 P0 RuntimeHost 验收实现计划 | #205 | (本次提交) |
| docs/plans/2026-02-27-build-artifact-r2-update-system.md | 构建产物 R2 存储 + 全链路自动更新系统设计 | #262 | (本次提交) |
| docs/plans/2026-02-26-issue-198-desktop-settings-plan.md | Issue #198 桌面端 Settings 实现计划 | #198 | (本次提交) |
| docs/plans/2026-02-23-settings-iteration.md | Settings 页 More/Legal Section + 测试数据开关迭代计划 | - | (本次提交) |
| docs/plans/2026-02-23-issue-213-task-ui-mock-plan.md | Issue #213 Task UI + Mock 架构实现计划 | #213 | (本次提交) |
| docs/plans/2026-02-23-issue-204-agent-hub-implementation-plan.md | GH #204 Agent Hub 全视图实现计划 | #204 | (本次提交) |
| docs/plans/2026-02-19-semver-beta-versioning-proposal.md | ExoMind 版本治理方案（SemVer + Beta + Hash） | - | (本次提交) |
| docs/plans/2026-02-18-android-asr-minimal-diff-plan.md | Android ASR 权限最小 Diff 实现计划 | - | (本次提交) |
| docs/plans/2026-02-12-issue-65-eventlog-lazy-loading.md | Issue #65 EventLog 懒加载方案 B 实现计划 | #65 | (本次提交) |
| docs/plans/2026-02-11-issue-79-port-env-config.md | Issue #79 端口环境变量配置实现计划 | #79 | (本次提交) |
| docs/plans/2026-02-11-issue-77-import-export-plan.md | Issue #77 导入/导出功能实现计划 | #77 | (本次提交) |
| docs/plans/2026-02-11-issue-27-eventlog-sync-mvp-plan.md | Issue #27 EventLog 多设备同步 MVP 实现计划 | #27 | (本次提交) |
| docs/plans/2026-02-10-multi-device-sync-fix.md | 多设备同步修复实现计划 | - | (本次提交) |
| docs/plans/2026-02-09-event-log-scroll-direction.md | 事件日志消息刷新方式调整（滚动方向） | - | (本次提交) |
| docs/plans/2026-02-05-event-log-lan-mvp-plan.md | Event Log LAN MVP 实现计划 | - | (本次提交) |
| docs/plans/2026-02-04-multi-device-e2e-testing.md | 多端消息同步系统构建与 E2E 测试计划 | - | (本次提交) |
| docs/plans/2026-02-04-chat-ui-integration.md | 聊天 UI 集成计划 | - | (本次提交) |
| docs/plans/460-eventlog-http-prompt.md | RT 新增 EventLog HTTP 端点 + MCP 迁移 | #460 | (本次提交) |
| docs/plans/304-voice-global-shortcut-spec.md | 语音输入全局快捷键 + EventLog 双写实现规范 | #304 | (本次提交) |

## 计划文档（已废弃）

| 原路径 | 摘要 | 关联 Issue/PR | 删除提交 |
|--------|------|---------------|----------|
| docs/plans/2026-03-07-user-system-hybrid-identity-implementation-plan.md | 用户系统混合身份实现计划（方向已变更） | - | (#529) |
| docs/plans/2026-03-06-tasks-today-timeblock-view.md | 今日任务时间块视图设计（未推进） | - | (#529) |
| docs/plans/2026-02-27-issue-205-p1-split-plan.md | Issue #205 P1 拆分计划（已完成父 Issue） | #205 | (#529) |
| docs/plans/2026-02-27-issue-198-settings-ia-legal-support.md | Issue #198 设置 IA 法律支持计划（已废弃） | #198 | (#529) |
| docs/plans/2026-02-27-issue-198-settings-ia-legal-support-pr-comment.md | Issue #198 PR 评论草稿（已废弃） | #198 | (#529) |
| docs/plans/2026-02-26-issue-205-agent-hub-backend-plan.md | Issue #205 Agent Hub 后端计划（已废弃） | #205 | (#529) |
| docs/plans/2026-02-23-issue-215-me-ui-plan.md | Issue #215 Me UI 计划（已废弃） | #215 | (#529) |
| docs/plans/2026-02-11-issue-25-epic-subtasks-plan.md | Issue #25 Epic 子任务分解计划（已废弃） | #25 | (#529) |
| docs/plans/2026-02-21-user-management-ui.md | 用户管理 UI 计划（已废弃） | - | (#529) |
| docs/plans/2026-02-21-mcp-auth-impl-plan.md | MCP 认证实现计划（已废弃，被新方案替代） | - | (#529) |
| docs/plans/2026-01-30-ralph-loop-enhanced.md | Ralph Loop 增强计划（早期草稿，已废弃） | - | (#529) |

## 架构文档（已合并）

| 原路径 | 摘要 | 合并去向 | 删除提交 |
|--------|------|----------|----------|
| docs/architecture.md | 旧版架构总览 (v2) | architecture/overview.md | (本次提交) |
| docs/architecture/UNIFIED-ARCHITECTURE-v3-DRAFT.md | 统一架构 v3 草稿（最全面） | architecture/overview.md | (本次提交) |
| docs/architecture/MVP-ARCHITECTURE.md | MVP 架构设计 | architecture/overview.md | (本次提交) |
| docs/architecture/MVP.md | 原始 MVP 文档 | architecture/overview.md | (本次提交) |

## 模块规格（已合并）

| 原路径 | 摘要 | 合并去向 | 删除提交 |
|--------|------|----------|----------|
| docs/specs/SPEC-301-多设备数据同步.md | 多设备数据同步规格（68K） | docs/specs/sync.md | (本次提交) |
| docs/specs/SPEC-303-sync模块架构.md | Sync 模块架构规格 | docs/specs/sync.md | (本次提交) |
| docs/specs/SPEC-302-密码哈希模块.md | 密码哈希模块规格 | docs/specs/auth.md | (本次提交) |
| docs/specs/SPEC-304-用户认证模块重构.md | 用户认证模块重构规格 | docs/specs/auth.md | (本次提交) |

## 设计文档（已过时）

| 原路径 | 摘要 | 删除提交 |
|--------|------|----------|
| docs/plans/2026-03-12-settings-inline-enum-alignment-design.md | 设置页 inline enum 对齐设计（功能已实现） | (#529) |
| docs/plans/2026-03-12-settings-group-overlay-design.md | 设置页分组 overlay 设计（功能已实现） | (#529) |
| docs/plans/2026-03-12-settings-dialog-alignment-design.md | 设置 dialog 对齐设计（功能已实现） | (#529) |
| docs/plans/2026-03-12-settings-danger-action-design.md | 设置危险操作设计（功能已实现） | (#529) |
| docs/plans/2026-03-10-review-agent-unified-entry-design.md | Review Agent 统一入口设计（功能已实现） | (#529) |
| docs/plans/2026-02-21-mcp-auth-design.md | MCP 认证架构设计（已被新方案替代） | (#529) |
| docs/plans/2026-02-05-event-log-design.md | 事件日志设计（功能已实现，早期草稿） | (#529) |

## 项目管理文档（已迁移或删除）

| 原路径 | 摘要 | 迁移去向 | 删除提交 |
|--------|------|----------|----------|
| docs/overview.md | 项目概览（内容已并入 docs/README.md） | DELETED | (#529) |
| docs/stack.md | 技术栈说明（内容已并入 docs/README.md） | DELETED | (#529) |
| docs/quickstart.md | 快速上手指南 | docs/development/quickstart.md | (#529) |
| pm/PRD.md | 产品需求文档 v2.0（生命判据、功能清单） | docs/product/PRD.md | e9d548b |
| pm/roadmap.md | 产品路线图 v2.0（Phase 0-5 里程碑） | docs/product/roadmap.md | e9d548b |
| pm/COMPLETED_FEATURES.md | 已完成特性清单（v0.1 阶段，PR #20） | docs/product/completed-features.md | e9d548b |
| pm/git-spec.md | Git 工作流规范 v1.0 | MERGED → docs/development/git-spec.md | c96d95a |
| pm/GIT_WORKTREE_SPEC.md | Git+Worktree 整合规范 v1.0 | MERGED → docs/development/git-spec.md | c96d95a |
| pm/memory/README.md | 记忆系统使用指南 | docs/memory/README.md | (本次提交) |
| pm/memory/project-overview.md | 项目概览记忆 | docs/memory/project-overview.md | (本次提交) |
| pm/memory/logs.md | 执行日志 | docs/memory/logs.md | (本次提交) |
| pm/memory/知识点-Git工作流.md | Git 工作流知识点 | docs/memory/知识点-Git工作流.md | (本次提交) |
| pm/memory/知识点-文档分层.md | 文档分层知识点 | docs/memory/知识点-文档分层.md | (本次提交) |
| pm/memory.md | 记忆系统索引 v3.0（内容已合并/重复） | DELETED | (本次提交) |
| pm/memory/phase3-plan.md | Phase 3 计划（已过期） | DELETED | (本次提交) |
| pm/memory/signal-pool-phase2-plan.md | SignalPool Phase 2 计划（已完成） | DELETED | (本次提交) |
| pm/memory/日报-2026-02-09.md | 2026-02-09 日报（历史归档） | DELETED | f97ec04 |
| pm/lock-mechanism-design.md | 锁机制设计（已实现，内容过期） | DELETED | (本次提交) |
| pm/PR20-REVIEW.md | PR #20 Review 记录（已合并归档） | DELETED | (本次提交) |
| pm/issue-120-plan.md | Issue #120 计划（已完成） | DELETED | (本次提交) |
| pm/issue-40-dark-mode-plan.md | Issue #40 暗色模式计划（已完成） | DELETED | (本次提交) |
| pm/issue-95-plan.md | Issue #95 计划（已完成） | DELETED | (本次提交) |
| pm/input.md | 任务输入队列（已废弃） | DELETED | (本次提交) |
| pm/tasks_plan.md | Phase 任务计划（已废弃） | DELETED | (本次提交) |
| pm/plans/issue-73-meditation-countdown-end-sound.md | Issue #73 计划（已完成） | DELETED | (本次提交) |

## 临时文档（已删除）

| 原路径 | 摘要 | 删除提交 |
|--------|------|----------|
| docs/fixes/concurrent-lock-overwrite-fix.md | PR #436 并发锁覆盖问题修复报告（PR 特定，已合并） | (#529) |
| docs/fixes/pr-436-merge-checklist.md | PR #436 合并检查清单（PR 特定，已合并） | (#529) |
| docs/fixes/pr-436-status-report.md | PR #436 状态报告（PR 特定，已合并） | (#529) |
| docs/fixes/pr-lock-renew-hint.md | PR 锁续期提示功能设计文档（PR 特定，已实现） | (#529) |
| docs/pr/issue-205-p1-pr-body.md | Issue #205 P1 PR 描述草稿 | (#529) |
| docs/pr/issue-205-p1-split-plan-comment.md | Issue #205 P1 拆分计划 PR 评论草稿 | (#529) |
| docs/pr/issue-205-plan-comment.md | Issue #205 方案 PR 评论草稿 | (#529) |
| docs/pr/issue-205-progress-comment.md | Issue #205 进度 PR 评论草稿 | (#529) |
| docs/pr/issue-205-review-comment.md | Issue #205 Review PR 评论草稿 | (#529) |
| docs/pr/issue-245f-m2-plan-comment.md | Issue #245 M2 方案 PR 评论草稿 | (#529) |
| docs/pr/issue-245f-m2-pr-body.md | Issue #245 M2 PR 描述草稿 | (#529) |
| docs/pr/issue-245f-m2-progress-comment.md | Issue #245 M2 进度 PR 评论草稿 | (#529) |
| docs/pr/issue-245f-m2-review-comment.md | Issue #245 M2 Review PR 评论草稿 | (#529) |
