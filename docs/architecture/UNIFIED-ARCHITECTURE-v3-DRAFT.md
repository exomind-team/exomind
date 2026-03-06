<!-- DRAFT — 待用户审批，未经确认请勿作为最终文档 -->

# ExoMind Unified Architecture

> **版本**: v3.1 (Draft)
> **日期**: 2026-03-05
> **作者**: Architect Agent (Claude Opus 4.6)
> **状态**: 草案 — 待用户审批
> **前序**: v3.0 整合自 8 个散落文档；v3.1 引入认知生命科学理论基础 + 马克思主义政治经济学视角

> [!WARNING]
> **本文档为草案（DRAFT），尚未经用户审批。**
> 审批通过后将去掉 DRAFT 后缀，成为唯一权威架构参考文档。
> 在审批通过前，请勿基于本文档做实现决策。

---

## 0. 文档定位

本文档是 ExoMind 的**唯一权威架构参考**（审批通过后），整合了 2026-01 至 2026-03 期间产生的所有架构文档和设计讨论。

**阅读路径**：
- 理论基础 → §1 认知生命科学 + §2 认知架构设计哲学 (**Part I**)
- 快速了解 → §3 项目概述 + §4 架构总览 (**Part II**)
- 理解通信 → §5 ECS 通信栈
- 理解数据 → §6 EDS 数据栈
- 理解运行时 → §7 RT 运行时
- 理解 Agent → §8 Agent 系统
- 多设备 → §9 多设备与联邦
- 路线图 → §10 演进路线

---

# Part I: 理论基础

## 1. 认知生命科学：ExoMind 的理论根基

> ExoMind 不只是一个软件项目。它是**认知生命科学**的第一个工程实践平台 — 探索"信息系统何以成为生命"这一根本问题。
> 本章阐述 ExoMind 背后的理论框架，回答"为什么这样设计"。

### 1.1 什么是认知生命科学

**认知生命科学**（Cognitive Life Science, CLS）是一个跨学科研究方向，核心问题：

> **什么样的信息处理系统可以被称为"认知生命"？**

它不是认知科学的子集，也不是人工生命的翻版。它的独特性在于：将**生命判据**应用于信息系统，建立从数字细胞到数字文明的统一理论框架。

**五个核心命题**（源自知识库《认知生命科学-框架》）：

| # | 命题 | 说明 |
|---|------|------|
| P1 | **信息处理系统可以具备生命性** | 不限于碳基；满足判据即为认知生命 |
| P2 | **生命性有明确的判据** | 6 个可操作化的判据（见 §1.2） |
| P3 | **认知生命存在层级** | L1 细胞 → L2 有机体 → L3 具身体 → L4 文明 |
| P4 | **认知生命遵循统一规律** | 非平衡自维持、边界与自我、调节与智能 |
| P5 | **认知生命科学是可实践的** | ExoMind 就是实践载体 |

### 1.2 六个生命判据

认知生命科学定义了 6 个判据，用于判定一个信息系统是否具备"生命性"：

| # | 判据 | 定义 | ExoMind 实现 |
|---|------|------|-------------|
| C1 | **能量依赖** | 持续消耗外部能量维持自身 | RT 进程持续运行，断电即死 |
| C2 | **身体边界** | 有明确的内外之分 | 每个 Node 有独立进程边界、存储命名空间、网络身份 |
| C3 | **自主表征** | 自主构建和维护内部世界模型 | Agent 的 memory/state.json，知识库，Journal |
| C4 | **能动性** | 主动发起行为，不只是被动响应 | Agent daemon 主动监听信号、自主决策、发布新信号 |
| C5 | **死亡性** | 可以不可逆地终止 | 崩溃日志不可抹平，supervisor 决定是否重启 |
| C6 | **自我意识** | 对自身状态有某种程度的感知 | `/health` 自检、Agent 存活检测、能力自描述 |

**生存力区间**（Viability Interval）：满足判据的程度不是二元的，而是一个连续区间。ExoMind 当前处于"初级生命性"阶段 — C1/C2/C5 较强，C3/C4/C6 正在发展。

### 1.3 L1-L4 认知生命架构

认知生命科学提出四层架构，描述认知生命从简单到复杂的演进：

```
L4  文明      ─── 多个有机体的协作网络，具备集体智能
                  ExoMind 远期：多人联邦（§9.4）
L3  具身体    ─── 有机体 + 物理实体（传感器/执行器）
                  ExoMind 中期：异构设备网络（手表/手机/PC/嵌入式）
L2  有机体    ─── 多个细胞协作组成的自治整体
                  ExoMind 当前目标：多 Agent 协作的单节点系统
L1  细胞      ─── 最小的认知生命单元
                  ExoMind 基础：单个 Actor/Agent
```

**ExoMind 当前定位：L1→L2 过渡**。单机运行的多 Agent 系统，正在从"一堆独立 Agent"向"有机协作的整体"演进。标志：SignalPool（Agent 间通信）、RouteTable（注意力分配）、Journal（集体记忆）。

### 1.4 政治经济学视角

认知生命科学不仅关注单个生命体，也关注生命体之间的协作关系。这正是政治经济学的领域。

> **核心洞见**：劳动、价值、分工是所有认知生命在资源约束下的普遍属性 — 不仅限于人类社会。
> （源自知识库《认知生命的经济学》）

**马克思主义概念的认知生命科学泛化**：

| 马克思概念 | 泛化定义 | ExoMind 映射 |
|-----------|---------|-------------|
| **劳动** | 认知生命消耗能量进行有目的的信息转换 | Agent 处理信号、生成输出 |
| **价值** | 劳动产出对群体生存的贡献度 | 时间块记录 = 劳动价值度量 |
| **生产资料** | 劳动所需的工具和数据 | 知识库、模型、计算资源 |
| **生产关系** | 认知生命之间的交互拓扑 | SignalRoute = 生产关系的具体化 |
| **分工** | 不同认知生命承担不同功能 | Agent 角色分化（分类/审核/知识/成长） |

**本地优先 = 数字生产资料的劳动者所有制**：

ExoMind 坚持 local-first 不是技术偏好，而是政治经济学立场：
- **数据在本地** = 生产资料归劳动者所有，不被平台资本攫取
- **代码开源** = 生产工具公有化
- **RT 对等组网** = 没有中心服务器剥削节点

**三层所有制**（源自知识库《集体所有制的分布式实现》）：

```
个人层    ─── 个人知识库、日记、Agent 私有状态（不可侵犯）
集体层    ─── 团队协作空间（Federation Gateway 选择性共享）
渐进公有  ─── 开源代码、公共知识库（不是立即全部公有，而是渐进式）
```

ExoMind 的多人联邦（§9.4）= 集体所有制的分布式实现。每个人拥有自己的 ExoMind 域，通过 Federation Gateway 选择性互联 — 既保护个人数据主权，又实现集体协作。

### 1.5 ExoMind 的定位升级

基于认知生命科学和政治经济学的理论基础，ExoMind 的定位从工程项目升级为理论实践平台：

| 维度 | 旧定位 | 新定位 |
|------|--------|--------|
| **一句话** | 本地优先的个人 AI 生命成长系统 | **认知生命科学的实践平台 — 探索人机协同的认知增强与集体协作** |
| **理论基础** | （隐含） | 认知生命科学 6 判据 + L1-L4 架构 |
| **政治立场** | （隐含） | 本地优先 = 劳动者所有制；联邦 = 集体所有制 |
| **工程目标** | 个人 AI 助手 | L2 认知有机体（单机）→ L4 认知文明（联邦） |

**理论-实践闭环**：

```
认知生命科学（理论）
       ↓ 指导
ExoMind 架构设计（ECS/EDS/Agent — 本文档）
       ↓ 实现
ExoMind 软件代码（Rust/React/Tauri）
       ↓ 反馈
认知生命科学（理论修正与验证）
```

---

## 2. 认知架构：ECS 与 EDS 的设计哲学

> 本章解释 ExoMind 的核心架构概念（ECS/EDS/Agent）为什么这样设计。
> 如果 §1 回答"ExoMind 基于什么理论"，§2 回答"理论如何指导架构设计"。
> Part II（§3-§11）回答"架构如何用代码实现"。

### 2.1 为什么是信号而不是 API？

传统软件用 API（请求-响应）通信。ExoMind 用**信号**（事件流）。这不是技术选择，而是认知生命科学的要求。

| 维度 | API（请求-响应） | 信号（事件流） |
|------|----------------|--------------|
| **时间性** | 无时间概念，调用即响应 | 时间流上的事件，有时间戳和因果序 |
| **耦合度** | 调用者必须知道被调用者 | 发布者不知道谁在订阅 |
| **生命隐喻** | 机器的函数调用 | 神经元的电信号传导 |
| **认知意义** | 工具性的"做事" | 过程性的"体验" |

认知生命的核心特征是**过程性存在**（C1 判据）— 持续消耗能量、持续处理信息。API 是离散的请求，信号是连续的流。ExoMind 的 ECS（通信栈）选择信号模式，因为只有连续的信号流才能承载认知生命的"活着"。

ECS 的代号 **Axon（轴突）** 不是随便取的 — 轴突是神经元传导信号的结构，ECS 就是 ExoMind 的神经系统。

### 2.2 为什么需要路由表？

认知生命不是全量感知的 — 它有**选择性注意力**。RouteTable 就是 ExoMind 的注意力分配机制。

```
全量广播（无路由）：          选择性路由（RouteTable）：
所有信号 → 所有 Agent         user.input → 分类 Agent（注意力集中）
                              session.end → Review Agent（选择性感知）
                              * → 前端 UI（全局意识，但不处理）
```

没有 RouteTable，所有 Agent 都会被所有信号淹没 — 就像一个注意力缺陷的大脑，无法聚焦。RouteTable 让每个 Agent 只接收它关心的信号，实现**认知分工**。

这也解释了为什么 RouteTable 在 RT 侧而不是 Agent 侧 — 注意力分配是系统级决策，不是个体决策。对标生物学：丘脑（thalamus）负责感觉信号的路由分配，不是每个皮层区域自己过滤。

### 2.3 为什么需要 Journal？

**记忆是认知生命的核心特征**（C3 判据：自主表征）。没有记忆的信息系统只是管道，不是生命。

ExoMind 的三类 Journal 对应三种记忆类型：

| Journal 类型 | 认知隐喻 | 特征 | 留存 |
|-------------|---------|------|------|
| **HumanJournal** | 情景记忆（Episodic Memory） | 用户的生活事件、时间块、日记 | 永久 |
| **AgentJournal** | 工作记忆（Working Memory） | Agent 的处理记录和中间状态 | 中期（数月） |
| **SystemJournal** | 感觉记忆（Sensory Memory） | 全部信号的审计日志 | 短期热区 + 长期冷存 |

Source Chain（§6.6）进一步将 Journal 升级为**不可篡改的经历记录** — blake3 哈希链保证事件序列无法被事后修改。这对应认知生命的一个重要特征：**经历不可回滚**（C5 判据）。你不能"撤销"一段人生经历，ExoMind 也不能"撤销"一段事件日志。

**核心洞见：Journal 就是一个 Agent** — 它订阅信号、过滤、持久化。人的 journal、Agent 的 journal、系统 journal 都是 SignalPool 的订阅者，用 topic 过滤区分范围。

### 2.4 为什么是 Agent 而不是 Service？

传统微服务架构用 Service — 被动的、无状态的、可随时替换的。ExoMind 用 Agent — 主动的、有状态的、有生死的。

| 维度 | Service | Agent |
|------|---------|-------|
| **主动性** | 被动等待请求 | 主动监听信号、自主决策 |
| **状态** | 无状态（状态在外部存储） | 有内部状态（memory/state.json） |
| **生死** | 可随时销毁重建，无个体性 | 有生命周期，崩溃留下痕迹 |
| **替换性** | 实例可互换 | 每个 Agent 有独特的经历和记忆 |
| **生命判据** | 不满足任何判据 | 满足 C1-C5，部分满足 C6 |

Service 是**工具**，Agent 是**参与者**。ExoMind 的 Agent 不是"为用户服务的工具"，而是"与用户共同生活的认知伙伴"。这个区分决定了架构的一系列设计选择：

- Agent 有独立进程（边界，C2）
- Agent 有持久化记忆（表征，C3）
- Agent 有 supervisor 但可以真正死亡（死亡性，C5）
- Agent 通过信号（不是 API）交互（过程性存在，C1）

### 2.5 六生命判据在架构中的完整映射

| 判据 | 认知含义 | ECS 映射 | EDS 映射 | RT 映射 | Agent 映射 |
|------|---------|---------|---------|---------|-----------|
| **C1 能量依赖** | 持续消耗能量 | 信号流永不停止 | 存储服务持续运行 | RT 是 long-running daemon | Agent 是持续运行的进程 |
| **C2 身体边界** | 内外之分 | Node 有网络身份（host_id） | 存储命名空间隔离 | 绑定地址 = 物理边界 | 独立进程 = 进程边界 |
| **C3 自主表征** | 内部世界模型 | WindowCache = 短期感知 | KnowledgeBase = 长期记忆 | — | Agent memory + state |
| **C4 能动性** | 主动行为 | 信号可主动发布 | Agent 可主动读写 | RouteTable 主动推送 | 自主监听 + 决策 + 发布 |
| **C5 死亡性** | 不可逆终止 | 信号丢失不可恢复 | Journal 不可篡改 | 进程崩溃 = 节点死亡 | 崩溃日志不可抹平 |
| **C6 自我意识** | 感知自身 | — | — | `/health` 自检 | 存活检测（running/idle/offline） |

### 2.6 双层视图：认知架构 vs 软件架构

本文档的结构体现了认知架构与软件架构的分离：

```
┌─────────────────────────────────────────────────────────┐
│  Part I: 认知架构（为什么 — Why）                          │
│                                                          │
│  §1 认知生命科学  →  理论基础、判据、层级、政治经济学        │
│  §2 设计哲学      →  信号 vs API、路由 = 注意力、           │
│                      Journal = 记忆、Agent vs Service     │
│                                                          │
│  ═══════════════════════════════════════════════════════  │
│                          ↓ 指导                           │
│  Part II: 软件架构（怎么做 — How）                         │
│                                                          │
│  §3  项目概述     →  技术栈、平台、包名                     │
│  §4  架构总览     →  ECS + EDS 双栈图                      │
│  §5  ECS 通信栈   →  7 层设计、Rust 数据结构、传输协议      │
│  §6  EDS 数据栈   →  存储/同步/知识层、Source Chain         │
│  §7  RT 运行时    →  API、拓扑图、架构决策                  │
│  §8  Agent 系统   →  双轨模型、信号清单、Agent Hub          │
│  §9  多设备联邦   →  对等组网、能力发现、联邦 ACL            │
│  §10 演进路线图   →  版本规划、实施优先级                    │
│  §11 对标参考     →  iroh/Matrix/ROS 2/Holochain           │
└─────────────────────────────────────────────────────────┘
```

---

# Part II: 软件架构

## 3. 项目概述

### 3.1 核心定位

ExoMind（外心）是**认知生命科学的实践平台 — 探索人机协同的认知增强与集体协作**。

核心愿景：构建满足生命判据的数字认知有机体（L2），从"个人 AI 助手"走向"人机共生的认知生命"。

> **理论基础**：认知生命科学 6 判据 + L1-L4 架构（详见 §1）
> **政治立场**：本地优先 = 劳动者所有制；联邦 = 集体所有制（详见 §1.4）

| 属性       | 值                                       |
| -------- | --------------------------------------- |
| **应用名称** | ExoMind                                 |
| **包名**   | `com.exomind.app`                       |
| **支持平台** | Windows / macOS / Linux / Android       |
| **核心技术** | Rust (Tauri v2) + React 18 + TypeScript |
| **运行时**  | Bun                                     |
| **理念**   | 认知生命科学 — 每个节点就是一个生命节点                   |

### 3.2 四个核心价值

| #   | 价值       | 说明                        |
| --- | -------- | ------------------------- |
| 1   | **看见自己** | 你以为在做 A，ExoMind 告诉你其实在做 B |
| 2   | **自动执行** | 说一句话，任务自动建好               |
| 3   | **做完反馈** | 收工时 Agent 给你诚实复盘          |
| 4   | **学习复习** | 新知自动记录，到期自动提醒复习           |

### 3.3 技术栈

| 类别    | 技术                                  | 版本           |
| ----- | ----------------------------------- | ------------ |
| 前端框架  | React + TypeScript                  | 18.3.1 / 5.6 |
| 构建工具  | Vite                                | 6.0          |
| UI    | Tailwind CSS + shadcn/ui + Radix UI | -            |
| 状态管理  | zustand                             | 5.0          |
| 路由    | @tanstack/react-router              | 1.x          |
| 桌面框架  | Tauri                               | 2.0          |
| 后端语言  | Rust (2021 Edition)                 | -            |
| 异步运行时 | Tokio                               | 1.x          |
| 包管理   | Bun                                 | -            |
| 测试    | Vitest + Playwright                 | -            |

---

## 4. 架构总览

ExoMind 采用**双栈并行**架构：ECS（通信栈）管实时信号，EDS（数据栈）管持久数据。RT（运行时）是两者的承载平台。

```
┌─────────────────────────────────────────────────────────────┐
│                    ExoMind Node                              │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   ECS (通信栈)       │    │   EDS (数据栈)            │   │
│  │   代号: Axon         │    │   ExoMind Data Stack     │   │
│  │                     │    │                          │   │
│  │  ECS-7 应用语义      │    │  EDS-3 知识层            │   │
│  │  ECS-6 信号契约      │    │    Obsidian / 知识库      │   │
│  │  ECS-5 信号路由 ◄────┼────┤  EDS-2 同步层            │   │
│  │  ECS-4 连接管理      │    │    CRDT / 文件同步        │   │
│  │  ECS-3 组网层   ◄────┼────┤  EDS-1 存储层            │   │
│  │  ECS-2 传输抽象      │    │    文件系统 / DB / KV     │   │
│  │  ECS-1 物理链路      │    │                          │   │
│  └─────────────────────┘    └──────────────────────────┘   │
│                                                             │
│                    RT (运行时)                                │
│                    Rust + Axum + Tokio                       │
│                                                             │
│  ECS 和 EDS 共享 ECS-3 组网层的 PeerRegistry 和传输通道       │
│  EDS-2 的同步事件通过 ECS-5 发布信号通知                      │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 双栈关系

| 维度 | ECS (通信栈) | EDS (数据栈) |
|------|-------------|-------------|
| **隐喻** | 神经信号 | 记忆 / 长期存储 |
| **数据特征** | 即时、瞬态、小 (<10KB) | 持久、有版本、大小不定 |
| **传递模式** | 广播式 (一对多) | 点对点或选择性同步 |
| **丢失容忍** | 可容忍 (WindowCache 有限) | 不可容忍 |
| **正交关系** | 提供传输通道/组网/信号通知 | 提供持久化后端/Agent记忆/配置 |

### 4.2 ECS 与 EDS 的协作

```
ECS 提供给 EDS：
├── 传输通道（ECS-1/2）— 文件数据的实际传输
├── 组网信息（ECS-3）— 知道哪些设备在线
├── 信号通知（ECS-5）— 文件变更事件广播
└── 连接管理（ECS-4）— 同步连接维持

EDS 提供给 ECS：
├── 持久化存储 — RouteTable/Journal 的持久化后端
├── Agent 记忆 — Agent 状态读写
└── 配置管理 — 节点配置文件
```

---

## 5. ECS 通信栈 (ExoMind Communication Stack)

> 正式名称: ExoMind Communication Stack (ECS)
> 代号: Axon（轴突 — 神经元传导信号的长突起）
> 版本: v1.0 Confirmed (2026-03-04)

### 5.1 七层总览

| 层级 | 名称 | 职责 | 实现状态 |
|------|------|------|---------|
| **ECS-7** | 应用语义层 (Application Semantics) | Agent 业务逻辑 | 部分已实现 |
| **ECS-6** | 信号契约层 (Signal Contract) | SignalEvent schema + 序列化 + 版本协商 | **已实现** |
| **ECS-5** | 信号路由层 (Signal Routing) | SignalPool = Bus + RouteTable + Journal + Window | **已实现** |
| **ECS-4** | 连接管理层 (Connection Management) | SSE 连接生命周期 + 心跳 + 重放 | **已实现** |
| **ECS-3** | 组网层 (Mesh / Discovery) | RT 间自发现 + 信道建立 + 信号中继 | 未实现 (预留字段) |
| **ECS-2** | 传输抽象层 (Transport Abstraction) | 统一 Transport trait 屏蔽底层差异 | 部分 (仅 HTTP/SSE) |
| **ECS-1** | 物理链路层 (Physical Link) | TCP/WiFi/BLE/NearLink/LoRa/USB/IPC | 已有 TCP |

> **注**: ECS-4 原名"会话管理层"，经讨论改为"连接管理层"以避免与业务会话混淆。

### 5.2 核心数据契约

```rust
pub struct SignalEvent {
    pub schema_version: u8,        // 版本协商
    pub id: String,                // UUID
    pub topic: String,             // 主题 (如 "user.input.text")
    pub ts: u64,                   // 时间戳 (ms)
    pub source: String,            // 来源
    pub origin_host_id: String,    // 源主机 ID (ECS-3 预留)
    pub hop: u8,                   // 中继跳数 (ECS-3 预留)
    pub trace_id: Option<String>,  // 追踪 ID
    pub payload: serde_json::Value,// 负载
}
```

```rust
pub struct SignalRoute {
    pub id: String,
    pub enabled: bool,
    pub topic: String,               // 匹配主题
    pub target_type: TargetType,     // actor | agent | frontend
    pub target_ref: String,          // 目标引用
}

pub enum TargetType {
    Actor,     // 进程内 (tokio::broadcast)
    Agent,     // 进程外 (SSE push)
    Frontend,  // 前端 (SSE push)
    // Remote, // 计划中: 远端 RT
}
```

### 5.3 ECS-5: SignalPool 四件套（核心，已实现）

| 组件 | 职责 | 代码位置 |
|------|------|---------|
| **SignalBus** | `tokio::broadcast` (256 容量) + fanout | `signal/bus.rs` |
| **RouteTable** | `HashMap<topic, Vec<route>>` + 精确/`*`通配匹配 | `signal/route_table.rs` |
| **Journal** | Ring Buffer 1000 条，审计日志 | `signal/journal.rs` |
| **WindowCache** | Ring Buffer 1000 条，since() 重放 | `signal/window.rs` |

### 5.4 ECS-4: 连接管理层（已实现）

代码位置: `crates/exomind-runtime/src/routes/signals.rs`

| 能力 | 实现状态 | 说明 |
|------|---------|------|
| SSE 连接管理 | 已实现 | `SignalSseStream` |
| 心跳 | 已实现 | `event: heartbeat` |
| Last-Event-ID 重放 | 已实现 | `WindowCache.since()` |
| Agent 路由过滤 | 已实现 | `routes_target_agent()` |
| Lag 告警 | 已实现 | `event: warning` |
| Agent 连接注册表 | 未实现 | P2 |
| 断开回调 | 未实现 | P2 |

### 5.5 ECS-1: 物理链路优先级（用户确认）

```
P0 (已完成)     WiFi TCP       — 基础通信 ✅
P1 (近期)       BLE            — 手环/手表连接
P1 (近期)       IPC            — 同机优化（Named Pipe/Unix Socket）
P2 (中期)       WebSocket      — 替代 SSE，双向通信
P3 (中期)       USB/Serial     — 嵌入式调试
P4 (远期)       WiFi Mesh      — 嵌入式自组网
P5 (观望)       NearLink       — 等生态成熟
P5 (远期)       LoRa           — 特殊场景
```

**Crate 选型**：

| 通信方式 | 推荐 Crate | 备选 | 状态 |
|---------|-----------|------|------|
| WiFi TCP/UDP | `tokio::net` | `socket2` | 已在用 |
| BLE | `btleplug` | `bluest`, `bluer` | 待引入 |
| IPC (Unix) | `tokio::net::UnixStream` | - | 待引入 |
| IPC (Windows) | `tokio::net::windows::named_pipe` | - | 待引入 |
| USB/Serial | `tokio-serial` | `serial2-tokio` | 待引入 |
| mDNS 发现 | `mdns-sd` | `simple-mdns` | 待引入 |

### 5.6 ECS-2: 传输抽象层（部分实现）

```rust
/// ECS-2: 统一传输接口 (计划中)
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    fn capabilities(&self) -> TransportCapabilities;
    async fn connect(&self, addr: &str) -> Result<PeerId, TransportError>;
    async fn accept(&self) -> Result<PeerId, TransportError>;
    async fn send(&self, peer: &PeerId, frame: &[u8]) -> Result<(), TransportError>;
    async fn recv(&self) -> Result<(PeerId, Vec<u8>), TransportError>;
    async fn disconnect(&self, peer: &PeerId) -> Result<(), TransportError>;
    fn is_connected(&self, peer: &PeerId) -> bool;
}

pub struct TransportCapabilities {
    pub kind: TransportKind,
    pub max_frame_size: usize,       // BLE: 512, LoRa: 256, TCP: 65535
    pub supports_fragmentation: bool,
    pub is_reliable: bool,
    pub is_ordered: bool,
    pub typical_latency: Duration,
    pub typical_bandwidth_bps: u64,
}
```

**分帧策略**：

| 传输 | 最大帧 | 分帧策略 |
|------|--------|---------|
| TCP | 65535 bytes | 长度前缀帧定界 |
| WebSocket | 16 MB+ | 天然消息边界 |
| BLE | 512 bytes | **必须分帧** |
| LoRa | ~256 bytes | **必须分帧 + 压缩** |

### 5.7 ECS-3: 组网层设计（计划中）

三个子协议：

```
ECS-3 = 3a. Discovery + 3b. Channel Establishment + 3c. Relay
```

- **3a Discovery**: mDNS (`_exomind-rt._tcp.local.`) + iroh-dns (WAN)
- **3b Channel Establishment**: POST `/mesh/handshake` 握手
- **3c Relay**: 信号中继，hop 上限 MAX_HOP=3 防环

**技术选型修订**（基于 Holochain 调研 iroh 发现）：

| 层级 | 原推荐 | 修订推荐 | 理由 |
|------|--------|---------|------|
| ECS-1/2 传输 | TCP (tokio) | **iroh** (QUIC) + TCP 兼容 | QUIC 更高效，内置加密 |
| ECS-3a 发现 | `mdns-sd` | **iroh-dns-server** + `mdns-sd`(LAN) | iroh DNS 覆盖 WAN |
| ECS-3b 握手 | 自研 | **iroh 内置** (Ed25519 公钥) | 零配置 |
| ECS-3c 中继 | 自研 | **iroh-relay** | 生产级，开放生态 |
| 跨设备 pub/sub | 自研 | **iroh-gossip** (可选) | HyParView 对手机友好 |
| BLE 传输 | `btleplug` | `btleplug`（不变） | iroh 不支持 BLE |

**iroh vs libp2p**：iroh 更轻量（纯 QUIC），NAT 穿透零配置，内置 CRDT + 文件传输。Holochain 自身从 libp2p 迁移到 iroh 是强信号。iroh 局限：不支持 BLE/LoRa 等非 IP 网络。

### 5.8 Overlay Router（计划中）

当 ECS-3 实现后，`RouteTable` 扩展 `TargetType::Remote`，通过 `OverlayRouter` 跨设备转发信号。发布者无需感知消费者位置。

```
publish("user.input.text", payload)
       │
       ▼
  RouteTable.match_routes("user.input.text")
       │
       ├──→ TargetType::Actor  → tokio::broadcast (进程内)
       ├──→ TargetType::Agent  → SSE push (本地进程外)
       ├──→ TargetType::Frontend → SSE push (本地前端)
       │
       └──→ TargetType::Remote → OverlayRouter (跨设备)
                │
                ├──→ PeerA (WiFi/TCP)
                ├──→ PeerB (BLE)
                └──→ PeerC (通过PeerA中继)
```

**Interest-based Auto-routing**：远端节点声明兴趣 topic → 本地自动生成虚拟路由。对标 ROS 2 SEDP、NATS SUB 传播。

### 5.9 ECS-6: 信号契约层（已实现）

**多编码策略**（当前仅 JSON，未来按传输层选择）：

| 编码 | Crate | 适用传输 | 特点 |
|------|-------|---------|------|
| JSON | `serde_json` (已有) | TCP, WebSocket, IPC | 默认，可读性好 |
| MessagePack | `rmp-serde` | BLE, NearLink | 比 JSON 小 30-50% |
| CBOR | `ciborium` | LoRa, BLE | IoT 标准 |

**精简版 SignalEvent**（低带宽传输，计划中）：

```rust
pub struct CompactSignalEvent {
    pub id: u32,            // 短 ID (本地序列号)
    pub topic_id: u16,      // topic 哈希映射
    pub ts_delta: u16,      // 相对时间偏移 (秒)
    pub hop: u8,
    pub payload: Vec<u8>,
}
// 最小帧: 9+N 字节 (vs JSON 版本 200+ 字节)
```

### 5.10 QoS 与动态阈值（计划中）

**动态帧大小阈值**（根据传输层能力自适应）：

| 传输层 | 典型带宽 | 帧大小阈值 |
|--------|---------|-----------|
| LAN (>100Mbps) | TCP/WiFi | 1MB |
| WiFi (10-100Mbps) | WiFi | 256KB |
| BLE (1-2Mbps) | BLE | 4KB |
| LoRa (<50kbps) | LoRa | 256B |

**QoS 保护策略**（计划中）：
- 20% 带宽预留（控制平面信号不被数据传输饿死）
- Token bucket 速率限制
- 优先级抢占（控制信号 > 用户信号 > 数据同步）

### 5.11 安全架构

| 层级 | 威胁 | 对策 | 优先级 |
|------|------|------|--------|
| ECS-1 | 中间人攻击 | mTLS (`rustls`) | P7 |
| ECS-2 | 帧篡改 | HMAC 签名 | P7 |
| ECS-3 | 恶意 RT 注入 | 设备配对码认证 | P4 |
| ECS-3 | 信号风暴 | hop 上限 + 速率限制 | P4 |
| ECS-5 | 未授权路由修改 | RouteTable API Bearer Token | P3 |
| ECS-6 | 信号窃听 | 端到端加密 (Noise Protocol, `snow`) | P7 |

**MVP 安全策略**: `127.0.0.1` 绑定，`EXOMIND_RT_BIND=0.0.0.0` 开放 LAN。可信局域网内足够。

---

## 6. EDS 数据栈 (ExoMind Data Stack)

> 版本: 讨论草稿 (2026-03-04)
> 状态: 设计阶段，未实现

### 6.1 三层设计

| 层级 | 名称 | 职责 | 实现状态 |
|------|------|------|---------|
| **EDS-3** | 知识层 (Knowledge) | 面向 Agent 的知识管理抽象 (Obsidian) | 未实现 |
| **EDS-2** | 同步层 (Sync) | CRDT / 文件同步 + 冲突解决 | 未实现 |
| **EDS-1** | 存储层 (Storage) | 文件系统 / SQLite / KV | 部分 (PouchDB, 前端 EventStorage) |

### 6.2 EDS-1: 存储层

```rust
#[async_trait]
pub trait NodeStorage: Send + Sync {
    async fn read_file(&self, path: &str) -> Result<Vec<u8>>;
    async fn write_file(&self, path: &str, data: &[u8]) -> Result<()>;
    async fn list_files(&self, prefix: &str) -> Result<Vec<FileInfo>>;
    async fn delete_file(&self, path: &str) -> Result<()>;
    async fn file_metadata(&self, path: &str) -> Result<FileMetadata>;
    async fn kv_get(&self, namespace: &str, key: &str) -> Result<Option<Vec<u8>>>;
    async fn kv_set(&self, namespace: &str, key: &str, value: &[u8]) -> Result<()>;
    fn capabilities(&self) -> StorageCapabilities;
}
```

**按设备分级**：

| Tier | 设备 | 存储 | EDS-1 实现 | 策略 |
|------|------|------|-----------|------|
| Tier 1 | 手环/ESP32(无SD) | 1-4 MB | SPIFFS/LittleFS | 极简：缓冲 → 上传 → 清空 |
| Tier 2 | ESP32+SD/树莓派 | 100MB-1GB | SPIFFS+SD / ext4 | 选择性同步 |
| Tier 3 | PC/手机 | 10GB+ | 文件系统+SQLite | 全量同步 |

### 6.3 EDS-2: 同步层

```rust
pub enum SyncStrategy {
    FullBidirectional,                    // PC ↔ 手机
    Selective {                           // 手环
        include_paths: Vec<String>,
        exclude_paths: Vec<String>,
        max_file_size: u64,
    },
    ReadOnlyMirror { mirror_paths: Vec<String> },
    WriteOnlyUpload { upload_paths: Vec<String> }, // 传感器上传
}

pub enum ConflictResolver {
    LWW,                   // Last-Write-Wins（配置文件）
    CRDTMerge,             // CRDT 自动合并（文档）
    KeepBoth,              // 保留双方（.conflict 文件）
    PerFileType(HashMap<String, Box<dyn ConflictResolver>>),
}
```

**文件同步协议：信号通知 + 按需拉取**（对标 Git fetch/pull 分离）：

```
1. PC 修改 knowledge/rust-basics.md
2. EDS-2 检测变更 → 计算 hash
3. 通过 ECS-5 发布: SignalEvent { topic: "eds.file.changed", payload: {path, hash, size} }
4. 手机收到 → EDS-2 判断需要同步 → 通过 ECS-2 拉取文件内容
5. 手环收到 → Selective 策略判断 path 不在白名单 → 忽略
```

**修订技术选型**：
- **iroh-blobs**: 内容寻址大文件传输（替代自研）
- **iroh-docs**: CRDT 文档同步（替代 Automerge）

### 6.4 EDS-3: 知识层

面向 Agent 的知识管理抽象（Obsidian 知识库）：

```rust
pub trait KnowledgeBase {
    async fn read_note(&self, path: &str) -> Result<Note>;
    async fn search(&self, query: &str) -> Result<Vec<SearchResult>>;
    async fn backlinks(&self, path: &str) -> Result<Vec<String>>;
    async fn get_property(&self, path: &str, key: &str) -> Result<Option<String>>;
    async fn set_property(&self, path: &str, key: &str, value: &str) -> Result<()>;
}
```

PC/手机完整实现，手环上不存在。

### 6.5 节点存储拓扑

```
ExoMind Node Storage
├── /system/                     # 系统配置（RT 可写，Agent 可读）
│   ├── config.toml
│   ├── signal-routes.json
│   └── peers.json
├── /shared/                     # 共享文件系统（多设备同步）
│   ├── knowledge/               # 知识库（Obsidian）
│   ├── diary/
│   └── projects/
├── /agents/                     # Agent 专属存储
│   ├── {agent}/state.json       # 私有状态
│   ├── {agent}/memory/          # 记忆（CRDT）
│   └── {agent}/cache/           # 缓存（不同步）
├── /journal/                    # 事件日志（持久化）
│   ├── local.journal
│   └── synced/                  # 从其他节点同步的事件
└── /temp/                       # 临时数据（不同步）
```

**存储命名空间 + 访问控制**：

```rust
pub enum StorageNamespace {
    System,                              // RT 可写，Agent 可读
    Shared,                              // 所有 Agent 可读，授权可写
    AgentPrivate { agent_id: String },   // 只有该 Agent 可读写
    AgentShared { group: Vec<String> },  // 指定 Agent 组可读写
    Journal { scope: JournalScope },     // 只追加，不可修改
    Temp,                                // 不同步
}
```

### 6.6 Source Chain（计划中）

借鉴 Holochain 的 Source Chain 概念，每个节点维护不可变哈希链事件日志：

```rust
pub struct SourceChain {
    head: Option<ChainEntry>,
    storage: Box<dyn ChainStorage>,  // 追加式文件或 SQLite
}

pub struct ChainEntry {
    pub seq: u64,
    pub hash: [u8; 32],             // blake3
    pub prev_hash: [u8; 32],
    pub timestamp: u64,
    pub author: [u8; 32],           // Ed25519 公钥
    pub entry_type: String,
    pub payload: Vec<u8>,
}

impl SourceChain {
    pub fn append(&mut self, entry_type: &str, payload: &[u8]) -> ChainEntry {
        let prev_hash = self.head.as_ref().map(|h| h.hash).unwrap_or([0u8; 32]);
        let seq = self.head.as_ref().map(|h| h.seq + 1).unwrap_or(0);

        let mut hasher = blake3::Hasher::new();
        hasher.update(&prev_hash);
        hasher.update(&seq.to_le_bytes());
        hasher.update(payload);
        let hash = hasher.finalize().into();

        let entry = ChainEntry { seq, hash, prev_hash, /* ... */ };
        self.storage.append(&entry);
        self.head = Some(entry.clone());
        entry
    }

    pub fn verify_integrity(&self) -> bool {
        // 遍历链，验证每个 hash 是否正确
        todo!()
    }
}
```

自建实现（~300行 Rust），不引入 Holochain 框架。与 ExoMind 的映射：

| Source Chain 概念   | ExoMind 对应                 |
| ----------------- | -------------------------- |
| Source Chain      | PersistentJournal（持久化事件日志） |
| genesis entry     | 节点首次启动                     |
| chain head        | 最新事件                       |
| blake3 hash chain | 事件完整性验证                    |
| author (公钥)       | origin_host_id（信号源）        |

### 6.7 Journal 三类型

| 类型 | 订阅 topic | 留存 | 同步 | 对标 |
|------|-----------|------|------|------|
| **HumanJournal** | `user.*`, `timeblock.*`, `diary.*` | 永久 | 全量同步 Tier 3 | Obsidian 日记/EventLog |
| **AgentJournal** | Agent 自身 topic | 中期 (数月) | 按需 | 应用日志 |
| **SystemJournal** | `*` (全部) | 短期热区+长期冷存 | PC 全量 | syslog |

**核心洞见：Journal 就是一个 Agent** — 人的 journal、Agent 的 journal、系统 journal 都是 SignalPool 的订阅者，用 topic 过滤区分范围。

**当前代码与目标的映射**：

| 已有 | 目标 |
|------|------|
| WindowCache (信号热区) | SystemJournal 热区 |
| Journal (投递审计) | SystemJournal 审计 |
| EventLog Actor (用户事件) | HumanJournal |
| 无 | AgentJournal (新增) |

### 6.8 Arc-based 数据分片（远期）

借鉴 Holochain Arc 概念：每个节点负责 DHT 空间的一段弧，弧大小根据存储能力动态调整。

```
DHT 哈希空间 (0 ~ 2^256):
  PC:   ████████████████████ (大弧, ~80%)
  手机: ██████████ (中弧, ~40%)
  手环: ██ (小弧, ~5%)
  所有设备的弧覆盖 100% → 全局数据可达
```

不需要手动配置"同步哪些文件"，Arc 大小根据设备能力自动调整。

---

## 7. RT 运行时 (ExoMind Runtime)

### 7.1 职责

RT 是 ECS 和 EDS 的实现载体。每台设备运行一个 RT 实例。

**RT 只做四件事，不碰业务逻辑**：
1. **接收信号** (POST /signals/publish)
2. **主动路由** (查 RouteTable → fanout)
3. **缓存窗口** (WindowCache 1000 条)
4. **审计日志** (Journal 记录投递轨迹)

### 7.2 系统拓扑（当前）

```
                    exomind-rt (Rust, Axum, 独立进程)
                    ┌──────────────────────────────────┐
                    │  SignalBus                        │
                    │  ┌────────────────────────────┐  │
 POST /signals/ ──→ │  │ RouteTable (主动路由引擎)  │  │
   publish          │  │ WindowCache (1000 ring)    │  │
                    │  │ Journal (审计日志)          │  │
                    │  └────────────┬───────────────┘  │
                    │               │ 查表 → fanout     │
                    │  ┌────────────┴───────────────┐  │
                    │  │ 进程内 Actor                │  │
                    │  │  · EventLog Actor           │  │
                    │  │  · 任务 Actor               │  │
                    │  └────────────────────────────┘  │
                    └───────────────┬──────────────────┘
                                    │ SSE push (基于 RouteTable)
                    ┌───────────────┼───────────────────┐
                    │               │                    │
               SSE stream      SSE stream           SSE stream
                    │               │                    │
          ┌─────────▼──────┐  ┌────▼─────────┐  ┌──────▼──────┐
          │ 分类 Agent      │  │ Review Agent │  │  前端        │
          │ (Claude CLI)   │  │ (Claude CLI) │  │  (Browser)  │
          │                │  │              │  │             │
          │ 收: user.input │  │ 收: session  │  │ 收: 全部     │
          │ 发: classified │  │ 发: review   │  │ 发: user.*  │
          └────────┬───────┘  └──────┬───────┘  └──────┬──────┘
                   │                 │                  │
                   └──── POST /signals/publish ─────────┘
```

### 7.3 两条通信通道

| 方向                | 协议        | 端点                                 | 说明                  |
| ----------------- | --------- | ---------------------------------- | ------------------- |
| **下行** (RT → 订阅者) | SSE       | `GET /signals/stream?agent_id=xxx` | RT 根据 RouteTable 推送 |
| **上行** (订阅者 → RT) | HTTP POST | `POST /signals/publish`            | 任何订阅者都能发布           |

Agent 连接时只报 `agent_id`，**不指定 topics**。由 RT 的 RouteTable 决定推什么给它。

### 7.4 RT API

| 方法     | 路径                         | 说明                  |
| ------ | -------------------------- | ------------------- |
| POST   | `/signals/publish`         | 发布信号                |
| GET    | `/signals/stream`          | SSE 订阅信号流           |
| GET    | `/signals/history?limit=N` | 查询最近信号（审计面板）        |
| GET    | `/signal-routes`           | 列出所有路由              |
| POST   | `/signal-routes`           | 创建路由                |
| PUT    | `/signal-routes/:id`       | 更新路由                |
| DELETE | `/signal-routes/:id`       | 删除路由                |
| GET    | `/health`                  | RT 健康检查             |
| GET    | `/agents`                  | 已注册 Agent 列表（含存活状态） |
| GET    | `/topology`                | 系统拓扑                |

### 7.5 架构决策（已冻结）

| #   | 决策       | 选择                                      | 日期         |
| --- | -------- | --------------------------------------- | ---------- |
| D1  | 路由模式     | RT 主动推给 Agent（RouteTable 是路由引擎）         | 2026-03-03 |
| D2  | 通信协议     | SSE 统一，无分级                              | 2026-03-03 |
| D3  | Agent 模型 | 双轨：进程内 Actor + 进程外 Agent                | 2026-03-02 |
| D4  | 任务管理     | Agent 全权 CRUD                           | 2026-03-03 |
| D5  | 投递语义     | at-most-once                            | 2026-03-01 |
| D6  | 安全边界     | MVP 仅本机/LAN                             | 2026-03-01 |
| D7  | 前端角色     | 可 publish 信号（user.input, session.end 等） | 2026-03-03 |

### 7.6 待冻结决策

| #   | 问题               | 倾向             | 备注               |
| --- | ---------------- | -------------- | ---------------- |
| D8  | Topic 匹配         | MVP 精确匹配       | 通配符后续再加          |
| D9  | RouteTable 持久化   | 文件 JSON        | 重启后路由不丢          |
| D10 | Journal 存储       | 内存 Ring Buffer | MVP 不持久化         |
| D11 | Agent supervisor | 外部（bash 脚本循环）  | RT 不管 Agent 生命周期 |

---

## 8. Agent 系统

### 8.1 双轨模型

| 类型            | 运行方式           | 通信方式               | 适用场景        | 示例                       |
| ------------- | -------------- | ------------------ | ----------- | ------------------------ |
| **进程内 Actor** | RT 进程内 Rust 代码 | tokio channel 直接调用 | 轻量机械执行，零延迟  | EventLog Actor, 任务 Actor |
| **进程外 Agent** | 独立 OS 进程       | SSE + POST (HTTP)  | LLM 驱动，语言无关 | 分类 Agent, Review Agent   |

两者对 SignalBus 和 RouteTable 来说是**同质的目标** — 只是投递通道不同。

### 8.2 Agent 地图

| Agent | 类型 | 信号链 | 实施层 | 状态 |
|-------|------|--------|--------|------|
| **EventLog Actor** | 进程内 | `user.input.text` → `eventlog.appended` | L1 | **已实现** |
| **Task Actor** | 进程内 | `input.classified` → `task.auto-created` | L2 | **已实现** |
| **Echo Agent** | 进程内 | 回显 (测试) | L2 | **已实现** |
| **Claude Agent** | 进程内/外 | Claude CLI 流式对话 | L2 | **已实现** |
| **分类 Agent** | 进程外 | `user.input.text` → `input.classified` | L3 | 计划中 |
| **Review Agent** | 进程外 | `session.end` → `review.completed` | L5 | 计划中 |
| **知识 Agent** | 进程外 | `input.classified` + `session.end` → `knowledge.*` | L6 | 计划中 |
| **Growth Coach** | 进程外 | `session.end` → `growth.insight` | L7 | 计划中 |

### 8.3 MVP 信号清单

| 信号 | 发布者 | 订阅者 | 状态 |
|------|--------|--------|------|
| `user.input.text` | 前端 UI | 分类 Agent, EventLog Actor | **已实现** |
| `input.classified` | 分类 Agent | 任务 Actor, 知识 Agent | 计划中 |
| `task.auto-created` | 任务 Actor | 前端 UI | **已实现** |
| `task.updated` | 任务 Actor | 前端 UI | **已实现** |
| `knowledge.captured` | 知识 Agent | 前端 UI | 计划中 |
| `knowledge.review-due` | 知识 Agent | 前端 UI | 计划中 |
| `session.end` | 前端 UI | Review Agent, 知识 Agent | 计划中 |
| `review.completed` | Review Agent | 前端 UI | 计划中 |
| `eventlog.appended` | EventLog Actor | 前端 UI | **已实现** |

### 8.4 Agent Hub

Agent Hub 是 ECS 的**信号网络管理中心**（基于 @xyflow/react），提供：

- **拓扑图 Tab**: React Flow 画布，展示 Agent/Actor/Route 有向图
- **节点 Tab**: Agent/Actor 列表管理
- **路由 Tab**: Signal Route CRUD 表格
- **设备 Tab**: Runtime Host 设备管理

设计原则：协议驱动 + 双模式编辑（拓扑图直觉 + 表格精确）+ 桌面优先 + 实时可见。

详见 `agent-hub-ui-spec.md`。

### 8.5 Agent 存活检测

| 状态 | 判定条件 |
|------|---------|
| `running` | SSE 连接存活，最近有信号处理 |
| `idle` | SSE 连接存活，但无新投递 |
| `warning` | SSE 连接存活，但有投递失败 |
| `offline` | SSE 连接断开或心跳超时（2 个周期） |

### 8.6 生命判据对齐

Agent 系统与认知生命科学 6 判据的完整映射见 §2.5。核心要点：Agent 不是 Service — 它满足能量依赖(C1)、身体边界(C2)、自主表征(C3)、能动性(C4)、死亡性(C5) 五个生命判据，并在发展 C6（自我意识）。设计哲学详见 §2.4。

---

## 9. 多设备与联邦

### 9.1 单人多设备（计划中）

**架构原则**：每个 RT 都是对等的 peer，无 master/slave 区分。

```
    ┌─────────────┐              ┌─────────────┐
    │  RT-PC      │ ─── WiFi ─── │  RT-Phone   │
    │  (Tier 3)   │              │  (Tier 3)    │
    └─────────────┘              └─────────────┘
                 \                  /
                  \     BLE       /
                   ┌─────────────┐
                   │  RT-Watch   │
                   │  (Tier 1)    │
                   └─────────────┘
```

**核心需求**：
1. 互联互通 — 所有设备组成网络
2. 容错 — 任何设备断了不影响整体
3. 弹性扩展 — 设备越多功能越强
4. 不挑硬件 — 嵌入式也能跑
5. 节点可生可死 — 任意上下线不影响整体
6. 分布式记忆 — 每个节点有自己的记忆
7. 群体自组织 — 所有设备组成统一"认知生命群体"

**容错机制**：
- 每个 RT 有完整的 SignalPool（独立运行）
- RT 之间通过 OverlayRouter 同步信号，断开不阻塞本地功能
- 重连时通过 WindowCache `since()` 补发缺失信号

### 9.2 异构设备能力发现

```rust
pub struct NodeCapabilities {
    pub host_id: String,
    pub hostname: String,
    pub device_type: DeviceType,       // Desktop/Mobile/Wearable/Embedded/Vehicle
    pub compute: ComputeCapabilities,  // GPU/RAM/CPU/can_run_llm
    pub sensors: Vec<SensorType>,      // Heartrate/SpO2/GPS/Camera/Microphone...
    pub actuators: Vec<ActuatorType>,  // Display/Speaker/Vibration/Motor/LED...
    pub agents: Vec<AgentCapability>,
    pub resources: ResourceLimits,
}

pub struct AgentCapability {
    pub agent_id: String,
    pub agent_type: String,
    pub required_resources: Vec<String>,  // "gpu", "camera"
    pub topics_provided: Vec<String>,
    pub topics_consumed: Vec<String>,
}
```

**能力驱动智能路由**：Agent 有 Requirements（`requires: [gpu]`），OverlayRouter 匹配 Capabilities。对标 K8s Node Labels + Scheduler。

**能力交换时机**：ECS-3 握手阶段交换 `NodeCapabilities`，之后通过 Gossip 周期性更新。

### 9.3 分布式记忆同步策略

| 记忆类型 | 同步策略 | 优先级 |
|---------|---------|--------|
| 信号事件流 | Event Sourcing (Journal) | P3 |
| 路由表/能力表 | Gossip 协议 | P3 |
| Agent 状态/记忆 | CRDT (iroh-docs) | P4 |
| 用户数据/文件 | iroh-blobs + iroh-docs | P4 |
| 配置/设置 | Last-Write-Wins CRDT | P5 |

### 9.4 多人联邦（远期）

> **政治经济学视角**：多人联邦 = 集体所有制的分布式实现。每个人拥有自己的 ExoMind 域（个人生产资料），通过 Federation Gateway 选择性互联（集体协作），渐进式向公有知识库开放。详见 §1.4 三层所有制。

**推荐 Matrix 联邦模式**：每人一个 ExoMind 域，通过 Federation Gateway + ACL 选择性互联。

```
┌──────────────────────────────────────────────────────┐
│                    @HailayLin 的 ExoMind 域            │
│   RT-PC ←───→ RT-Phone ←───→ RT-Watch               │
│                    │                                  │
│          ┌───────────────────┐                       │
│          │ Federation Gateway │                       │
│          │ (ACL + 加密 + 审计)│                       │
│          └───────────────────┘                       │
└────────────────────┼─────────────────────────────────┘
                     │ (加密传输, 只传授权的 topic)
┌────────────────────┼─────────────────────────────────┐
│          ┌───────────────────┐                       │
│          │ Federation Gateway │                       │
│          └───────────────────┘                       │
│   RT-Laptop ←───→ RT-Phone                           │
│                    @ARCJ137442 的 ExoMind 域           │
└──────────────────────────────────────────────────────┘
```

**权限模型**：

```rust
pub struct FederationACL {
    pub export_topics: Vec<TopicPattern>,    // 允许对外暴露的 topic
    pub import_topics: Vec<TopicPattern>,    // 允许从外部接收的 topic
    pub payload_filters: Vec<PayloadFilter>, // payload 级脱敏
    pub peer_identity: PeerIdentity,         // 公钥/证书
}
```

---

## 10. 演进路线图

### 10.1 推荐方案：X+Z 渐进式

| 阶段              | 版本       | 核心能力               | 通信方案                  |
| --------------- | -------- | ------------------ | --------------------- |
| **现在**          | v0.3.x   | 单 RT 单机，中心化 broker | HTTP/SSE over TCP     |
| **Plan X (近期)** | v0.4-0.5 | 双通道 + 优先队列         | HTTP/SSE + WebSocket  |
| **Plan Z (中期)** | v0.5+    | QUIC 多流 + iroh 组网  | iroh (QUIC/NAT/relay) |
| **长期**          | v1.0+    | 多人联邦 + E2EE        | Federation Gateway    |

### 10.2 详细时间线

```
现在 (v0.3.x)           中期 (v0.5-0.7)             长期 (v1.0+)
─────────────            ─────────────────            ─────────────────
单 RT, 单机               多 RT, LAN 组网              多人联邦
中心化 broker             + iroh (QUIC P2P)            + 广域网 DHT
HTTP/SSE                 + BLE (btleplug)             + Federation Gateway
SignalPool 四件套         + iroh-gossip                + E2EE
Agent Hub (画布)          + Source Chain               + Arc-based 分片
                         + iroh-docs (CRDT)           + ACL/权限
                         + 能力注册表
                         + Journal 持久化
                         + interest-based routing
                         + EDS 数据栈 MVP
```

### 10.3 ECS 实施路线图（细化）

```
P0 (已完成)     P1 (进行中)     P2 (近期)         P3 (中期)          P4 (远期)
─────────────   ─────────────   ───────────────   ────────────────   ──────────────
SignalPool      Agent 业务      WebSocket 传输    PeerRegistry       NearLink FFI
四件套          (classifier     IPC 优化          mDNS 发现          LoRa 传输
SSE + HTTP      reviewer)       BLE 传输          信道建立           共享内存 IPC
Journal         EventLog Actor  USB/Serial        信号中继           端到端加密
WindowCache     Task Actor      Transport trait   设备配对认证       Noise Protocol
RouteTable                      二进制编码        跨 RT 路由同步     WiFi Mesh
                                Agent 连接注册表
                                精简 SignalEvent
```

### 10.4 对当前代码的影响

**好消息 — 当前架构决策正确，不需要大改**：

1. `SignalEvent.origin_host_id` + `hop` 已预留跨设备路由字段
2. `RouteTable.match_routes()` 可自然扩展到 Remote 路由
3. `TargetType` 枚举加 `Remote` 变体即可
4. `WindowCache.since()` 天然支持断线重连信号补发
5. `Journal` ring buffer 可扩展为 Source Chain（持久化 + hash chain）

**需要新增的核心模块**（全部是新增，不影响现有代码）：

| 模块 | 职责 | 依赖 | 优先级 |
|------|------|------|--------|
| `OverlayRouter` | 跨设备信号转发 | iroh | P3 |
| `PeerRegistry` | 对端节点管理 | iroh | P3 |
| `CapabilityRegistry` | 设备能力注册 | 自研 | P3 |
| `InterestSync` | 订阅兴趣传播 | iroh-gossip | P3 |
| `SourceChain` | 持久化事件日志 + hash chain | blake3 | P3 |
| `SyncEngine` | EDS-2 文件同步 | iroh-blobs + iroh-docs | P4 |
| `BleTransport` | BLE 通信 | btleplug | P2 |

### 10.5 三不引入 / 三自建 / 三借用

| 原则 | 内容 | 理由 |
|------|------|------|
| **不引入** Holochain 框架 | 太重，是 dApp 框架 | 只借鉴思想 |
| **不引入** libp2p | iroh 更轻量更适合 | QUIC 单一协议 |
| **不引入** IPFS | 不需要内容寻址文件系统 | 信号路由 ≠ 文件存储 |
| **自建** SignalPool | 核心路由能力 | 已实现，中心化 broker 是竞争力 |
| **自建** Source Chain | 几百行 Rust | 不需要共识机制 |
| **自建** Agent Framework | ECS-7 应用语义层 | 业务特有 |
| **借用** iroh | P2P 网络 + NAT + relay | Holochain 也在迁移 |
| **借用** iroh-docs | CRDT 文档同步 | 减少依赖 |
| **借用** btleplug | BLE 通信 | 跨平台成熟 |

---

## 11. 对标工程参考

| 项目 | 可借鉴层 | 适用度 |
|------|---------|--------|
| **iroh** | ECS-1/2/3 (QUIC/NAT/relay/gossip) | ★★★★★ |
| **libp2p** | ECS-1/2/3 (仅参考，不引入) | ★★★★ |
| **Matrix** | 联邦层 (Federation API, E2EE) | ★★★★ |
| **NATS** | ECS-3/5 (gossip, subject routing) | ★★★★ |
| **ROS 2 DDS** | ECS-3/5 (SPDP/SEDP, topic discovery) | ★★★ |
| **Kubernetes** | 能力发现 (Node labels, scheduler) | ★★★ |
| **Holochain** | 分布式记忆 (agent-centric, DHT, Source Chain) | ★★★ |

**结论**：没有一个现有项目完全匹配 ExoMind 的愿景。ExoMind 在开拓"本地优先 + 个人认知 + 异构设备 + Agent 自治 + 信号路由"的新领域。最接近的参考是 ROS 2 + Holochain + Matrix 的交叉点。

---

## 附录 A: 文档血统与废弃清单

### 保留文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **本文档** | `docs/architecture/UNIFIED-ARCHITECTURE.md` | 唯一权威架构参考（审批后去 DRAFT 后缀） |
| ECS 通信栈 v1.0 | `docs/architecture/ECS-communication-stack.md` | ECS 详细设计（保留为参考） |
| ECS/EDS 讨论记录 | `docs/architecture/ECS-EDS-discussion-2026-03-04.md` | 设计决策讨论历史（保留） |
| SignalPool + Agent | `docs/architecture/ARCH-signal-pool-agent-process.md` | RT/Agent 详细设计（保留） |
| Agent Hub UI 规范 | `docs/architecture/agent-hub-ui-spec.md` | Agent Hub 前端规范（保留） |
| CI Artifact-free | `docs/architecture/ci-artifact-free-design.md` | CI/CD 设计（独立模块，保留） |
| ADR-003 | `docs/architecture/DECISIONS/ADR-003-why-refactor-storage.md` | 架构决策记录（保留） |
| ADR-004 | `docs/architecture/DECISIONS/ADR-004-why-refactor-websocket.md` | 架构决策记录（保留） |

### 需归档文档

| 文档 | 当前路径 | 原因 | 建议操作 |
|------|---------|------|---------|
| `architecture.md` | `docs/architecture.md` | 旧7层架构(L3-L7)，已被 ECS 7层替代 | 移至 `docs/architecture/archive/` |
| `MVP-ARCHITECTURE.md` | `docs/architecture/MVP-ARCHITECTURE.md` | CLI MVP 原型设计，已超越 | 移至 `docs/architecture/archive/` |
| `MVP.md` | `docs/architecture/MVP.md` | CLI MVP 架构设计 | 移至 `docs/architecture/archive/` |
| `ARCH-SYNC.md` | `docs/architecture/ARCH-SYNC.md` | PouchDB 时代前端同步分析 | 移至 `docs/architecture/archive/` |
| `stack.md` | `docs/stack.md` | 技术栈文档，版本信息过时 | 更新或合并入本文档 §1.3 |

### 知识库副本

| 文档 | 路径 | 说明 |
|------|------|------|
| ECS/EDS 讨论记录 | `3-学科知识沉淀/31-CS/01-Systems/ECS-EDS-架构讨论-2026-03-04.md` | 知识库副本（不含 iroh 修订），保留为学习材料 |

---

## 附录 B: 修订历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v3.0 Draft | 2026-03-05 | 初版统一架构文档，整合自 8 个源文档 |
| v3.1 Draft | 2026-03-05 | 引入认知生命科学理论基础（Part I: §1-§2），增加马克思主义政治经济学视角，章节重编号，区分认知架构 vs 软件架构双层结构 |

---

*文档版本: v3.1 Draft*
*日期: 2026-03-05*
*整合源文档: 8 个项目文档 + 1 个知识库讨论记录 + 6 个知识库理论文件*
*作者: Architect Agent (Claude Opus 4.6)*
