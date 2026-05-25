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

Phase 2 完成（SignalPool L3-L5），Phase 3 待启动（资源管控 + 可观测性）。

ECS-1~3 的组网理论 / 路线暂名 **ExoNet / 外心网络**；工程实现暂名 **ENS / ExoNet Network Stack / 外心网络栈**。Reticulum 是当前关键参考对象与实验基座，详见 [Reticulum 组网配对模型设计](plans/2026-05-24-ret-mesh-pairing-model-design.md)、[三阶段迁移计划](plans/2026-05-25-reticulum-authorized-sync-migration-plan.md)、[物理联通层](architecture/physical-connectivity-layer.md) 与 [ECS 通信栈](architecture/ECS-communication-stack.md)。

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
| 源码工作目录 Agent 合同 | [AGENTS.md](../AGENTS.md) |
| 用户侧 runtime agent 契约 | [docs/agents/runtime-agent-contract.md](agents/runtime-agent-contract.md) |
| 前端 UI 统一规范 | [docs/development/ui-spec.md](development/ui-spec.md) |
| Git / worktree / PR / 发布操作 | [docs/development/repo-agent-workflow.md](development/repo-agent-workflow.md) |
| Git / worktree 权威规范 | [docs/development/git-spec.md](development/git-spec.md) |
| 多 worktree 端口与联调 | [docs/development/port-env-configuration.md](development/port-env-configuration.md) |
