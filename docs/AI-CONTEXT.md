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

注意：`architecture/overview.md` 是全局分层架构背景；Reticulum/ENS 当前网络路线以本文件“当前阶段”指向的 handoff、SignalEvent 迁移计划和双实例验收手册为准。

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

本工作树的活跃主线是 Reticulum/ENS：让 Reticulum 成为 ExoMind RT 之间唯一的跨 RT 网络网关，并最终在已授权设备之间同步 EventLog、Task、TimeBlock 与 Proposal。无上下文 Agent 接手时先读 [Reticulum 下一阶段无上下文 Agent 交接](plans/2026-06-08-reticulum-next-agent-handoff.md)，再读 [Reticulum SignalEvent 数据面与 Interface/local-link 迁移计划](plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md)。

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

Reticulum/ENS 是当前工作树的首要活跃工作：

1. 接手入口：[docs/plans/2026-06-08-reticulum-next-agent-handoff.md](plans/2026-06-08-reticulum-next-agent-handoff.md)。
2. 长期目标与契约：[docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md](plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md)。
3. 人工/自动验收：[docs/development/reticulum-dual-instance-verification.md](development/reticulum-dual-instance-verification.md)。
4. 质量规则：[docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md](plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md)。

`docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md` 只作为历史实施记录和纵切索引；不要把它当成当前权威计划。

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
| 源码工作目录 Agent 合同 | [AGENTS.md](../AGENTS.md) |
| 用户侧 runtime agent 契约 | [docs/agents/runtime-agent-contract.md](agents/runtime-agent-contract.md) |
| 前端 UI 统一规范 | [docs/development/ui-spec.md](development/ui-spec.md) |
| Git / worktree / PR / 发布操作 | [docs/development/repo-agent-workflow.md](development/repo-agent-workflow.md) |
| Git / worktree 权威规范 | [docs/development/git-spec.md](development/git-spec.md) |
| 多 worktree 端口与联调 | [docs/development/port-env-configuration.md](development/port-env-configuration.md) |
| Reticulum 双实例/双设备验收 | [docs/development/reticulum-dual-instance-verification.md](development/reticulum-dual-instance-verification.md) |
