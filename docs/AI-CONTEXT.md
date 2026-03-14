# ExoMind AI Context

> 通用项目上下文，供任何 AI 工具加载。具体 AI 指令见 CLAUDE.md / AGENTS.md。

## 项目定位

ExoMind（外心）= 个人/集体的生命成长助手 + 认知生命科学原型。
探索：人作为生命如何主动掌控自己的力量？如何在计算机上实现生命/思维机器？

## 技术栈

Tauri 2.0 + React 18 + TypeScript + Rust | Zustand | Tailwind CSS + Radix UI | Bun | Vitest

## 核心架构

-> [docs/architecture/overview.md](architecture/overview.md)

快速参考：L1 Adapter -> L2 Environment -> L3 Service/Actor/Agent -> L4 UI

| 层级 | 职责 | 接口归属 |
|------|------|----------|
| L4 UI | React + Zustand，只调 Service | Service interface（L3 定义） |
| L3 Service/Actor/Agent | 业务逻辑，LLM Agent 驱动 | ActorContext（L3 定义） |
| L2 Environment | 共享物理世界，持有 Port 实例 | Port interface（L2 定义） |
| L1 Adapter | 具体实现，按运行时替换 | -- |

## 生命判据

系统设计遵循 5 条否决式生命判据：可存活区间、边界归因、过程性存在、失败不可回滚、环境裁决。
详见 CLAUDE.md "项目概述" 部分。

## 当前阶段

Phase 2 完成（SignalPool L3-L5），Phase 3 进行中（资源管控 + 可观测性）。

## 文档索引

-> [docs/README.md](README.md)

## 关键目录

| 目录 | 内容 |
|------|------|
| `docs/architecture/` | 架构设计（权威） |
| `docs/specs/` | 模块规格 |
| `docs/product/` | PRD、路线图 |
| `docs/development/` | 开发指南、Git 规范 |
| `docs/plans/` | 活跃实施计划（仅进行中） |
| `docs/memory/` | AI 对话记忆 |
| `docs/agents/` | Agent 文档 |
| `docs/research/` | 技术调研 |
| `docs/superpowers/` | Superpowers 工具生成规格 |

## 活跃工作

-> `docs/plans/` 中的所有文件均为进行中的计划。

## 源码结构

```
src/
  adapters/       # L1：具体实现（llm, asr, tts, storage, terminal, crypto, platform）
  environment/    # L2：共享物理世界
  services/       # L3：业务逻辑层
  actor/          # L3：Actor/Agent 模型
  ui/             # L4：前端展示层
src-tauri/        # Rust 后端（Tauri 2.0）
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `bun dev` | 启动开发服务器 (Vite) |
| `bun build` | 构建前端 + 类型检查 |
| `bun test` | 运行单元测试 |
| `bun tauri dev` | 启动 Tauri 开发环境 |
| `bun tauri build` | 构建桌面应用 |
