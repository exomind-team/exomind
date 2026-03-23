# 架构评审报告：ExoMind 整体架构

> **评审人：** Architecture Critic
> **日期：** 2026-02-08
> **评审范围：** `docs/architecture/` 目录 + 7层架构模型

---

## 1. 架构概述

ExoMind 采用 **7 层架构模型**，从 L7-UI 到 L3-平台适配：

```
┌─────────────────────────────────────────────────────────────────────┐
│ L7-UI 前端展示层 (React + TypeScript)                               │
│      ↓ IPC (Tauri invoke)                                           │
│ L6 核心业务逻辑层 (Claude Runner, Agent Layer)                       │
│      ↓                                                              │
│ L5  SignalPool (发布-订阅信号系统)                                   │
│      ↓                                                              │
│ L4  终端执行器 (跨平台命令执行)                                       │
│      ↓                                                              │
│ L3  平台适配层 (Windows/macOS/Linux/Android)                         │
└─────────────────────────────────────────────────────────────────────┘
```

**核心定位：**
- 个人/集体的生命成长助手
- 认知生命科学原型（基于大模型 agent 的自主生命体）
- 本地优先（P2P 多设备同步，不依赖云服务器）

---

## 2. 优点分析

### ✅ 2.1 清晰的层间分离

| 优点 | 说明 |
|------|------|
| **职责清晰** | 每层有明确的职责边界，避免职责混淆 |
| **可测试性** | 层间通过接口通信，便于单元测试 |
| **可替换性** | 平台适配层使跨平台更容易 |

**参考对比：** Logseq 和 Obsidian 也采用类似的分层架构，但 ExoMind 的 7 层更细分。

### ✅ 2.2 本地优先设计

- **数据主权**：用户数据存储在本地，不依赖云服务
- **P2P 同步**：设备间直接同步，不经过中心服务器
- **离线可用**：核心功能在离线时仍可使用

**参考来源：**
> "本地优先软件是一种软件设计原则：让用户在使用软件过程中既能拥有云服务的协作性又能像使用传统本地软件那样拥有完整的数据所有权。" — [知乎：本地优先软件](https://zhuanlan.zhihu.com/p/568989946)

### ✅ 2.3 事件驱动架构

MVP 中的 Event/TimeBlock 模型设计合理：

```
Event → TimeBlock → ExoMindLogs
```

- Event 是原子单位，不可再分
- TimeBlock 是 Event 的聚合视图
- 便于查询、过滤、统计

**参考对比：** Logseq 的块级引用也是类似思想。

### ✅ 2.4 多 Agent 设计

四 Agent 架构（Supervisor + Governor + Growth Coach + Review）具有创新性：

```
┌─────────────────────────────────────────────────────────────────┐
│                    小荷 Supervisor                               │
│         消息路由 → 智能分流 → 场景模式匹配                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Governor    │    │ 任务系统    │    │ Growth Coach│
└─────────────┘    └─────────────┘    └─────────────┘
```

### ✅ 2.5 Tauri 跨平台方案

- **体积小**：比 Electron 小很多
- **性能高**：Rust 后端
- **安全**：Tauri 的权限系统
- **多平台**：Windows/macOS/Linux/Android

---

## 3. 缺点/风险

### ⚠️ 3.1 架构复杂度较高

| 问题 | 影响 |
|------|------|
| 7 层架构增加了学习成本 | 新开发者需要时间理解 |
| 层间通信开销 | L7 到 L3 的每次调用都有 IPC 开销 |
| 调试困难 | 问题可能在任意一层 |

**建议：** 考虑提供架构可视化文档，降低学习曲线。

### ⚠️ 3.2 P2P 同步的复杂性

**风险点：**

| 风险 | 严重程度 | 说明 |
|------|----------|------|
| 冲突解决 | 高 | 多设备同时编辑同一数据 |
| 网络发现 | 中 | 设备如何发现彼此 |
| 离线合并 | 高 | 离线期间的数据如何同步 |

**参考对比：** Logseq 使用 Git 作为同步方案（通过 GitHub），简化了 P2P 复杂性。ExoMind 需要自己实现 P2P 同步。

**参考来源：**
> Logseq 支持通过 Git 进行版本控制和同步，用户数据存储在本地 Git 仓库中。— [GitHub Topics: local-first](https://github.com/topics/local-first)

### ⚠️ 3.3 Web 端降级策略不完善

当前消息持久化在 Web 端失效（PR #15 Bug），说明：

- Web Storage Adapter 刚添加，未充分测试
- localStorage 有容量限制（通常 5MB）
- 没有优雅降级策略

### ⚠️ 3.4 Agent 协调机制缺失

四 Agent 架构缺少：

- Agent 间通信协议
- 决策冲突解决机制
- Agent 生命周期管理

---

## 4. 类似项目参考

### 4.1 Logseq

| 方面 | Logseq | ExoMind |
|------|--------|----------|
| **定位** | 隐私优先的知识管理 | 生命成长助手 + AI Agent |
| **存储** | Markdown 文件 + Git | JSONL + P2P |
| **同步** | Git | P2P |
| **架构** | Electron + ClojureScript | Tauri + React + Rust |
| **开源** | ✅ | ✅ |

**可借鉴点：**
- Git 同步方案的成熟度
- 块级引用的交互设计
- 离线优先的用户体验

**来源：** [Logseq 官网](https://github.com/logseq/logseq)

### 4.2 Obsidian

| 方面 | Obsidian | ExoMind |
|------|----------|----------|
| **定位** | Markdown 笔记工具 | 生命成长助手 |
| **存储** | 本地 Markdown 文件 | JSONL |
| **插件** | 丰富的插件生态 | Agent 可扩展性 |
| **同步** | Obsidian Sync（付费）| P2P |

**可借鉴点：**
- 插件架构设计
- 本地搜索体验
- 移动端适配

**来源：** [Obsidian 官网](https://obsidian.md/)

### 4.3 Trilium Notes

| 方面 | Trilium | ExoMind |
|------|----------|----------|
| **定位** | 自托管知识库 | 生命成长助手 |
| **技术栈** | TypeScript + Go | TypeScript + Rust |
| **同步** | 自己的同步协议 | P2P |
| **架构** | 单体 + 可拆分服务 | 7 层微服务化 |

**可借鉴点：**
- 自托管同步方案
- 知识图谱可视化
- 强大的笔记关联

**来源：** [Trilium Notes GitHub](https://github.com/zadam/trilium)

### 4.4 LocalAGI

| 方面 | LocalAGI | ExoMind |
|------|----------|----------|
| **定位** | 自托管 AI Agent 平台 | 生命成长 + AI |
| **本地模型** | 支持 Ollama 等 | Claude API |
| **隐私** | 完全本地 | 云端 API（可配置） |

**可借鉴点：**
- 本地 LLM 集成方案
- Agent 任务队列设计
- 自托管部署方案

**来源：** [LocalAGI GitHub](https://github.com/mudler/LocalAGI)

### 4.5 对比总结

| 项目 | ExoMind 相似点 | ExoMind 独特点 |
|------|----------------|----------------|
| Logseq | 隐私优先、本地存储 | AI Agent 集成、四 Agent 架构 |
| Obsidian | 插件生态、搜索 | P2P 同步、事件驱动 |
| Trilium | 自托管、笔记关联 | 生命科学概念、时间块 |
| LocalAGI | AI Agent | 生命成长、认知科学 |

---

## 5. 改进建议

### 5.1 短期改进（当前 Sprint）

1. **完善 Web 端降级策略**
   - 添加 IndexedDB 支持（比 localStorage 容量更大）
   - 添加同步状态指示器
   - 添加冲突提示

2. **简化 P2P 同步初始版本**
   - 限制：同一时间只允许一个设备编辑
   - 或：使用简单的"最后写入胜出"策略

### 5.2 中期改进（3-6 个月）

1. **添加架构文档可视化**
   - 层间通信图
   - 数据流向动画
   - 交互式架构探索

2. **实现 Git 同步作为备选**
   - 降低 P2P 同步的复杂度
   - 利用成熟的 Git 生态系统

3. **Agent 协调机制**
   - 定义 Agent 间消息格式
   - 实现简单的仲裁机制

### 5.3 长期改进（6 个月+）

1. **CRDT 同步**
   - 考虑使用 Yjs 或 Automerge
   - 实现真正的多设备协作编辑

2. **离线优先强化**
   - Service Worker 缓存策略
   - IndexedDB 全面应用

3. **插件系统**
   - 参考 Obsidian 插件 API
   - 允许用户扩展 Agent 能力

---

## 6. 结论

### 整体评估：**推荐，有条件通过**

### 优点
- ✅ 清晰的层间分离
- ✅ 本地优先，尊重数据主权
- ✅ 创新性的四 Agent 架构
- ✅ Tauri 跨平台方案成熟

### 风险
- ⚠️ P2P 同步复杂度高
- ⚠️ Web 端降级策略需完善
- ⚠️ Agent 协调机制缺失

### 建议优先级

| 优先级 | 改进项 | 工作量 |
|--------|--------|--------|
| P0 | 完善 Web 端持久化 | 小 |
| P0 | 简化 P2P 同步策略 | 中 |
| P1 | 架构可视化文档 | 小 |
| P1 | Git 同步备选方案 | 大 |
| P2 | CRDT 同步 | 大 |
| P2 | 插件系统 | 大 |

### 评审结论

**有条件通过**，建议在实现 P2P 同步前先完成 Web 端降级策略，确保基本功能稳定。

---

## 参考资料

1. [Logseq - Privacy-first, open-source knowledge management](https://github.com/logseq/logseq)
2. [Obsidian - A second brain, for you, forever.](https://obsidian.md/)
3. [Trilium Notes - Self-hosted personal knowledge base](https://github.com/zadam/trilium)
4. [LocalAGI - Self-hostable AI Agent platform](https://github.com/mudler/LocalAGI)
5. [Local-first software - 知乎](https://zhuanlan.zhihu.com/p/568989946)
6. [GitHub Topics: local-first](https://github.com/topics/local-first)
