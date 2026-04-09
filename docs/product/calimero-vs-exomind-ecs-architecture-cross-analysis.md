# Calimero vs ExoMind ECS/EDS 架构对照分析报告

> **版本**: v1.0
> **日期**: 2026-04-09
> **分析依据**: Cali 调研报告 v4.0（1152行）、ExoMind ECS/EDS 架构文档、ECS-mesh 交叉分析
> **分析目标**: 形成对 ExoMind ECS/EDS 后续演进有实际指导价值的架构对照报告

---

## 执行摘要

| 维度 | Calimero | ExoMind |
|------|-----------|---------|
| **核心哲学** | "让多方无需中央协调者即可协作" | "让认知生命体持续协作并共享记忆" |
| **架构范式** | Local-First + CRDT 状态收敛 + WASM 隔离执行 | Signal-Driven + Event Sourcing + LLM Agent |
| **核心抽象** | Context（隔离执行环境）+ Group（治理边界） | SignalPool（信号路由）+ Agent（认知参与者） |
| **数据模型** | CRDT（DAG + 5种内置类型） | EventLog + Journal + 规划中 CRDT |
| **网络模型** | P2P（libp2p gossipsub + Kademlia） | 星型中继（HTTP/SSE + 规划中 iroh） |
| **隐私模型** | TEE + ECDH 密钥包裹 + 加密 GroupOps | Bearer Token + 规划中 E2EE |
| **执行模型** | WASM Runtime（50+ host functions） | 进程内 Rust Actor + 进程外 CLI Agent |
| **当前成熟度** | 生产级（v0.10.1-rc，活跃开发） | MVP 级（SignalPool 已实现，EDS 未实现） |
| **目标规模** | WAN 多方联盟（任意设备） | 个人多设备（PC/手机/手环）+ 未来多人联邦 |

**核心结论**：
1. **Cali 是状态收敛系统，外心是信号路由系统**——两者在架构哲学层面有根本分歧，不能简单相互替代
2. **Cali 的 CRDT 类型体系和 Governance DAG 对外心 EDS 有极高借鉴价值**，可直接参考设计
3. **Cali 的 WASM Runtime 对外心没有直接价值**，外心的 Agent 执行模型与 WASM 隔离执行哲学不同
4. **Cali 的网络层（libp2p）与外心规划中的 iroh 网络栈处于同一技术生态位**，可以互相印证设计思路

---

## 一、Cali 的架构哲学

### 1.1 核心哲学立场

Calimero 的架构哲学可以概括为：**"让状态自己在多端收敛，无需中央权威"**。

这一定立场包含以下子命题：

**① Local-First 优先**
数据的主人永远是用户的设备，网络是可选的附加设施。这直接回答了"当网络不可用时，应用还能不能用"这个问题——Cali 的答案是：不仅能用，而且一旦网络恢复，所有离线期间的操作会自动合并，不丢数据。

**② CRDT 作为冲突处理的唯一答案**
Cali 没有引入任何中央协调者（无论是服务器还是共识协议）。冲突的解决不在"谁说了算"，而在"CRDT 数学保证所有副本最终收敛到相同状态"。这是拜占庭容错（BFT）之外的另一条路——不需要共识，只需保证操作满足交换律和幂等性。

**③ 代码即协议，WASM 确保确定性**
"同一个应用在所有节点运行相同的逻辑"是 CRDT 状态收敛的前提。Cali 用 WASM Runtime（Wasmer）作为执行层，确保应用代码在所有设备上的执行结果是确定性的（给定相同输入）。

**④ 治理也是一种 DAG**
所有群组操作（成员增删、角色变更、策略更新）都记录在一棵不可篡改的 DAG 中，形成可审计的治理历史。这使"谁在什么时候对群组做了什么"完全透明，且无需第三方背书。

### 1.2 Cali 试图回答的五个核心问题

| # | 核心问题 | Cali 的答案 |
|---|---------|------------|
| **Q1** | 多方同时编辑同一份数据，谁的修改优先？ | CRDT 数学保证最终收敛，无"优先"概念，只有"合并" |
| **Q2** | 如何在不信任任何中央服务器的情况下实现隐私？ | ECDH 密钥包裹 + 加密 GroupOps + TEE 静态加密 |
| **Q3** | 如何确保没有网络时各端仍能独立工作？ | Local-First——所有数据本地存储，重连后自动 sync |
| **Q4** | 如何让多方在没有任何协调者的情况下形成共识？ | Governance DAG + Namespace 身份模型，无需共识协议 |
| **Q5** | 如何确保应用逻辑在所有节点完全一致？ | WASM Runtime——确定性执行，相同的 WASM 字节码在所有节点产生相同结果 |

### 1.3 Cali 的架构回答路径

Cali 的每一层技术选择都服务于上述五个问题：

```
Q1（冲突处理）    → mero-storage（10种CRDT类型） + DAG合并算法
Q2（隐私）        → ECDH密钥包裹 + 加密GroupOps + TEE
Q3（离线支持）    → RocksDB本地存储 + Delta Sync
Q4（无协调共识）  → Namespace Governance DAG（Ed25519签名）
Q5（逻辑一致性）  → Wasmer WASM Runtime（确定性执行）
```

**Cali 的设计取舍**：
- 取：**强隐私 + 强离线 + 零共识**（隐私敏感的多方协作场景）
- 舍：**无中心意味着无强制执行**（Group 策略无法强制执行，只能靠节点自律）
- 取：**WASM 带来多语言开发体验**（Rust/JS/Python 均可）
- 舍：**WASM 运行时开销**（约 3-5 MB 二进制增量，但已高度优化）

---

## 二、外心 ECS/EDS 的架构哲学

### 2.1 认知生命科学的哲学立场

外心的架构哲学建立在一个截然不同的本体论上：**认知生命不是数据处理，而是过程性存在**。

这体现在三个核心判断中：

**① 信号是连续的 API，API 是离散的信号**
生命体实时感知、实时反应，这个过程是不可中断的连续流。API（请求-响应）是人类设计的计算模式，适合工具调用，但不适合描述"活着"的状态。外心选择信号模式（SignalPool pub/sub），因为只有连续信号流才能承载认知生命的"活着"。

**② Agent 是参与者，不是服务**
传统软件中，服务是被动的——被调用、返回值、可随时重启。Agent 有自己的生命周期（生老病死）、自己的记忆、自己的决策能力。这对应认知生命的"能动性"判据（C4）：Agent 主动发起行为，不只是被动响应。

**③ 记忆是分布式的事件日志，不是集中的状态快照**
外心的记忆系统是 EventLog + Journal（事件流），而不是传统数据库的状态快照。这意味着：记忆可以被重放（replay）、可以被审计、可以跨设备同步而不丢中间状态——就像生物体的神经网络留下的可追溯活动记录。

### 2.2 信号驱动 vs. 状态收敛的根本分歧

这是两份架构对照中**最核心、最需要首先厘清的分歧**：

| 维度 | Cali（状态收敛型） | 外心（信号路由型） |
|------|------------------|------------------|
| **数据单位** | CRDT 状态（最终一致的副本） | SignalEvent（瞬态信号） |
| **同步目标** | 多端状态最终相同 | 信号从 A 到达 B |
| **丢失容忍** | 不可丢失（持久化 CRDT） | 有限容忍（WindowCache 1000条） |
| **一致性模型** | 最终一致（CRDT数学保证） | 因果顺序 + at-most-once 投递 |
| **持久性** | 所有操作持久化为 CRDT | Journal Ring Buffer（有窗口） |
| **典型应用** | 协作文档、多人聊天 | 实时认知处理、生命日志 |
| **冲突语义** | 合并（merge），操作可交换 | 丢弃或重试，无合并概念 |

**关键含义**：Cali 和外心在工程上最根本的差异不是"谁的功能更强大"，而是"它们在解决不同种类的问题"。

- **Cali** 解决的是"**分布式状态一致性**"问题——当多个节点需要对同一个数据集达成一致时怎么办
- **外心** 解决的是"**实时认知协作**"问题——当多个认知参与者需要实时共享感知、处理信息时怎么办

这两个问题有交叉（都涉及多端协调），但本质上是不同的。外心未来如果引入多用户联邦，CRDT 状态收敛是有价值的；但外心的核心（SignalPool 驱动的认知流）不需要 CRDT——因为信号本身就是瞬态的，过去了就过去了。

### 2.3 外心 ECS/EDS 的架构回答路径

| 认知生命问题 | 外心 ECS/EDS 的答案 |
|------------|-------------------|
| 实时感知（C1 能量依赖） | SignalPool 持续运行，信号流永不断 |
| 身体边界（C2） | 每个 Node 有独立进程边界、存储命名空间、网络身份 |
| 自主表征（C3） | Agent memory/state.json + Journal |
| 能动性（C4） | Agent daemon 主动订阅信号、自主决策、发布新信号 |
| 选择性注意力 | RouteTable 路由表——不是全量感知，是选择性订阅 |
| 分布式记忆 | Source Chain（规划中）——blake3 hash chain 的事件日志 |

**外心的设计取舍**：
- 取：**实时信号流 + RouteTable 注意力路由**（认知生命核心）
- 取：**进程内 Actor + 进程外 Agent 双轨模型**（兼顾性能和跨语言）
- 舍：**CRDT 状态收敛**（ECS 层不需要，EDS 层需要时再引入）
- 取：**双栈并行（ECS 神经信号 + EDS 记忆存储）**（信号与数据解耦）

---

## 三、Cali 架构到外心系统的对照映射

### 3.1 整体架构对照表

```
Cali 架构                              外心对应模块
─────────────────────────────────────────────────────────────
┌─────────────────────┐    ┌─────────────────────────────┐
│ mero-server          │    │ exomind-rt (Axum HTTP/SSE)   │
│ (Admin API / JSON-RPC)│    │ ECS-4 连接管理 + ECS-6 信号契约│
└──────────┬──────────┘    └──────────────┬──────────────┘
           │                                  │
┌──────────▼──────────┐    ┌──────────────────▼──────────────┐
│ NodeManager Actor    │    │ SignalPool                        │
│ (事件/Blob/心跳)      │    │ ECS-5 信号路由                   │
│                     │ ←→ │ ECS-4 连接管理                   │
│ ContextManager Actor │    │ ECS-6 信号契约                   │
│ (30+ 处理器/DAG/治理) │    │ ECS-3 组网层 (MeshRelayManager) │
│                     │    │                                  │
│ SyncManager Actor   │ ←→ │ EDS-2 同步层 (规划中)            │
│ (4种同步协议)        │    │ Source Chain + iroh             │
└──────────┬──────────┘    └──────────────────┬──────────────┘
           │                                  │
┌──────────▼──────────┐    ┌──────────────────▼──────────────┐
│ NetworkManager Actor │    │ ECS-3 组网层                      │
│ (libp2p gossipsub/   │ ←→ │ iroh (QUIC/NAT/relay)            │
│  Kademlia/mDNS)      │    │ + MeshRelayManager (HTTP/SSE)    │
└──────────┬──────────┘    └──────────────────┬──────────────┘
           │                                  │
┌──────────▼──────────┐    ┌──────────────────▼──────────────┐
│ WASM Runtime         │    │ Agent 执行环境                     │
│ (Wasmer 6.x)        │ ←→ │ 进程内 Rust Actor                 │
│                     │    │ 进程外 CLI Agent (SSE/HTTP)        │
│ VMLogic (50+ hosts) │    │                                  │
│ CRDT 宿主函数        │    │                                  │
└──────────┬──────────┘    └──────────────────┬──────────────┘
           │                                  │
┌──────────▼──────────┐    ┌──────────────────▼──────────────┐
│ mero-storage         │    │ EDS-1 存储层                     │
│ (RocksDB 11 列族)    │ ←→ │ PouchDB + IndexedDB             │
│ CRDT 集合类型(15种)   │    │ SQLite (规划中)                 │
│                      │    │ Source Chain (blake3, 规划中)   │
└──────────┬──────────┘    └──────────────────┬──────────────┘
           │                                  │
┌──────────▼──────────┐    ┌──────────────────▼──────────────┐
│ Namespace DAG        │    │ Identity / Auth                  │
│ (治理操作 DAG)       │ ←→ │ Bearer Token / 未来 E2EE        │
│ Ed25519 签名         │    │ 规划中: 多人联邦身份系统          │
│ Subgroup 树形结构    │    │                                  │
└─────────────────────┘    └──────────────────────────────────┘
```

### 3.2 各子系统详细映射

#### 3.2.1 核心抽象对照

| Cali 核心概念 | 外心对应 | 本质异同 |
|-------------|---------|---------|
| **Context**（隔离执行环境 + 应用实例） | **RT Node**（独立进程 + 独立信号命名空间） | 本质不同：Cali 的 Context 是"状态容器"，外心的 RT 是"信号路由器" |
| **Group**（治理边界 + 成员管理） | **Future: 多用户联邦**（规划中） | 未来外心引入联邦时，可直接借鉴 Group 模型 |
| **Namespace**（命名空间 = Group 集合 + 身份密钥） | **RT 节点身份**（host_id） | 本质相同：都是"身份+权限的边界" |
| **Application**（WASM 字节码） | **Agent Logic**（Rust 代码或 LLM 提示词） | 本质不同：Cali 跑 WASM，外心跑 Agent |
| **DAG（状态/治理）** | **EventLog / Journal**（事件流） | 本质相似但语义不同：Cali DAG 是"不可变操作日志"，外心 Journal 也是 |

#### 3.2.2 执行层对照

| Cali 层 | 技术实现 | 外心对应 | 技术实现 |
|--------|---------|---------|---------|
| **执行引擎** | Wasmer 6.x JIT | Agent Runtime | Rust 原生执行 + CLI Agent |
| **宿主函数** | 50+（存储/CRDT/事件/Blob/身份/xcall） | Agent Interface | SSE + HTTP POST（进程外），直接调用（进程内） |
| **执行隔离** | WASM VMLogic 沙箱 | 进程隔离 | OS 进程边界 |
| **多语言支持** | Rust/JS/Python → WASM | 跨语言 | CLI Agent（语言无关） |
| **应用打包** | `.mpk` 包（含多个 service） | Agent 打包 | 独立进程 + 配置文件 |

**关键洞察**：外心没有 WASM Runtime，因为外心的"Agent"不需要确定性执行（确定性对 CRDT 收敛是必要的，但对外心的 LLM Agent 是不必要的——LLM 本身就有随机性）。外心用进程隔离替代了 WASM 隔离。

#### 3.2.3 存储层对照

| Cali 层 | 设计 | 外心对应 | 设计 |
|--------|------|---------|------|
| **存储引擎** | RocksDB（11 列族，26+ 组前缀） | EDS-1 | PouchDB（前端）+ SQLite（规划） |
| **CRDT 存储** | UnorderedMap/Vector/Counter/RGA/LWWRegister 等 10 种 | EDS-2 | 规划中（计划用 iroh-docs CRDT） |
| **私有存储** | `private::` 列族（不同步） | Agent 私有存储 | `/agents/{id}/cache/`（不同步） |
| **Blob 存储** | `blob::` 列族（内容寻址） | EDS-2 文件同步 | 规划中（计划用 iroh-blobs） |
| **治理存储** | `group::*` 列族（26+ 子前缀） | 未来：联邦治理 | 规划中 |

#### 3.2.4 网络层对照

| Cali 层 | 技术 | 外心层 | 技术 | 对照结论 |
|--------|------|--------|------|---------|
| **P2P 传输** | libp2p（QUIC/TCP/WebRTC） | ECS-1/2 | iroh（规划）+ TCP | 处于同一技术生态位 |
| **节点发现** | mDNS（LAN）+ Kademlia（WAN） | ECS-3a | 规划中 mDNS | Cali 已有，外心规划中 |
| **广播协议** | gossipsub（mesh + fanout） | ECS-5 | SignalPool pub/sub | 语义根本不同：gossipsub 是状态广播，SignalPool 是信号路由 |
| **中继** | Circuit V2 relay（AutoRelay） | ECS-3c | HTTP relay（当前）+ iroh-relay（规划） | 功能对应，成熟度差异大 |
| **NAT 穿透** | DCUtR hole punching | ECS-1 | iroh 自动打洞（规划） | iroh 比 libp2p DCUtR 更适合外心 |
| **身份认证** | Ed25519 签名 + Signed Peer Record | ECS-3b | Bearer Token（当前）+ 规划中 E2EE | Cali 更成熟，外心需追赶 |
| **流复用** | Yamux | ECS-2 | HTTP/2 multiplexing（规划） | 功能对应 |

---

## 四、可借鉴设计：Cali 对外心 ECS/EDS 的具体价值

### 4.1 CRDT 类型体系 → EDS-2 同步层（最高优先级）

**借鉴价值**：★★★★★（直接可用）

**Cali 的 CRDT 设计亮点**：

Cali 的 `mero-storage` crate 实现了 15 种 CRDT 集合，是本报告中最值得直接参考的设计之一：

```
可借鉴的 Cali CRDT 类型 → 外心 EDS-2 适用场景：
─────────────────────────────────────────────────────
LwwRegister<T>         → 用户配置的 Last-Write-Wins（如"最后修改的目标"）
GCounter              → 事件计数（只增不减）
PnCounter             → Token 余额（有增有减）
RGA                   → 协同文本编辑（知识库条目）
UnorderedMap<K,V>     → 键值状态同步
UnorderedSet<T>       → 标签集合（user.tags）
Vector<T>             → 有序列表（任务顺序）
UserStorage           → Per-user state（每个用户的本地状态）
FrozenStorage         → 不可变数据（系统常量）
Custom (用户定义)       → 未来扩展
```

**实施建议**：
1. **不要自己造轮子**：直接参考 `mero-storage` 的 CRDT 实现，或评估是否可直接引入 `calimero-storage` crate
2. **优先实现 LwwRegister 和 GCounter**：覆盖最常见场景（配置同步 + 计数）
3. **参考 Cali 的 merge registry 模式**：统一的 CRDT 注册表，所有类型在同一个系统中注册和管理
4. **Cali 的 CRDT 都在 WASM VM 内作为宿主函数暴露**，设计时考虑外心 Agent 调用方式

**与 iroh-docs 的选择**：iroh-docs 也有内置 CRDT，但 Cali 的 CRDT 类型更丰富（15 种 vs iroh-docs 的基本类型）。对于EDS-2 同步层，Cali 的类型体系是更完整的参考。

### 4.2 Namespace Governance DAG → 多人联邦审计系统（高优先级）

**借鉴价值**：★★★★☆（设计思路可迁移）

**Cali 的 DAG 设计亮点**：

Cali 用两套 DAG 分别处理治理和状态：

| DAG | 节点内容 | 签名 | 可见性 |
|-----|---------|------|--------|
| **Namespace Governance DAG** | RootOps（明文）+ GroupOps（加密 skeleton） | Ed25519 | Namespace 成员可见 |
| **Context State DAG** | CausalDelta（状态变更 diff） | Ed25519 | Context 成员可见 |

**关键创新**：Cali 的 GroupOps 对非成员呈现为"不透明的 skeleton"，保留了因果结构但不暴露内容。这是隐私保护的关键设计。

**对外心多人联邦的启示**：

外心未来引入多人联邦时，需要解决的核心问题与 Cali 高度相似：
- 多人场景下，群组操作（成员加入/退出、角色变更）如何记录？
- 如何保证群组操作不可篡改、可审计？
- 如何在非成员节点上存储操作历史，但不暴露隐私内容？

**实施建议**：
1. 借鉴 Cali 的"明文 RootOps + 加密 GroupOps"分层设计
2. 借鉴"skeleton"模式——对无权限节点只存储操作结构，不存储内容
3. 参考 `SignedGroupOp` 结构设计外心的联邦操作格式

### 4.3 RocksDB 11 列族存储架构 → EDS-1 存储层设计（中优先级）

**借鉴价值**：★★★★☆（架构思路可借鉴）

**Cali 的存储设计亮点**：

```
Cali RocksDB 11 列族 → 外心 EDS-1 对应设计：
─────────────────────────────────────────────────────
meta::                    → system metadata
config::                  → RT 配置
identity::                → 每命名空间密钥对      → host_id 密钥
state::                   → 共享状态 KV          → Agent 共享状态
private::                 → 私有 KV（不同步）   → Agent cache
delta::                   → 因果 Delta（DAG）   → EventLog DAG（规划中）
blobs::                   → 内容寻址二进制      → EDS-2 文件存储
app::                     → WASM 应用元数据     → Agent 配置
alias::                   → 人类可读名称→ID     → future: 联邦别名
group::*                  → 治理操作（26+前缀） → future: 联邦治理
Generic                   → 未分类数据          → 通用存储
```

**关键洞察**：Cali 的列族前缀命名体系（`meta::`/`config::`/`identity::`/`state::`/`delta::` 等）形成了一个**命名空间前缀规范**，对外心设计 EDS-1 存储层有直接参考价值。

**实施建议**：
1. 外心 EDS-1 参考 Cali 的前缀命名规范，设计自己的命名空间前缀体系
2. 外心 EDS-1 不需要 11 个列族（前端 IndexedDB 和 SQLite 不支持列族），但可以用**键前缀约定**模拟同一效果
3. 重点借鉴：`private::` 不同步机制（Agent cache）和 `delta::` 的因果 DAG 存储

### 4.4 SyncManager 四层协议 → EDS-2 同步协议设计（中优先级）

**借鉴价值**：★★★★☆（协议设计可借鉴）

**Cali 的同步协议亮点**：

Cali SyncManager 根据 delta 大小自适应选择同步协议：

```
心跳（30s interval）
  → 比较 StateHeartbeat { context_id, root_hash }
      ├── Hash 相等           → 无需同步
      ├── 小差异 (Hash 比较)   → Hash Comparison Protocol
      ├── 中等差异 (Level)    → Level-wise Protocol
      ├── 大差异 (Snapshot)    → Snapshot Sync（全量传输）
      └── 直接缺失            → Delta Exchange（点对点流）
```

**实施建议**：
1. **事件层同步（Journal/EventLog）**：优先参考心跳 + Delta Exchange 模式（小增量、低延迟）
2. **文件层同步（EDS-2）**：参考 Snapshot + Delta 组合（覆盖冷启动和增量更新）
3. **Cali 自适应协议选择是极有价值的设计**——外心同步层应按数据量/网络状况动态选择协议

### 4.5 存储 trait 可插拔设计 → Port/Adapter 模式（中优先级）

**借鉴价值**：★★★☆☆（架构思路一致）

Cali 的 `Storage` trait 和 `Database` trait 允许替换后端：

```rust
// Cali 的可插拔存储设计
pub trait Storage: Send + Sync {
    fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>>;
    fn put(&self, key: &[u8], value: &[u8]) -> Result<()>;
    fn delete(&self, key: &[u8]) -> Result<()>;
    // ...
}

pub trait Database {
    type Storage: Storage;
    fn storage(&self) -> &Self::Storage;
}
```

**外心已有对应设计**：外心 EDS-1 的 Port interface 设计（`IStoragePort`）与 Cali 的 trait 可插拔哲学一致。区别在于：
- **Cali** 的可插拔是"替换底层引擎（RocksDB→SQLite）"
- **外心** 的可插拔是"按运行时替换（Web IndexedDB ↔ Tauri SQLite）"

两者方向不同，但都是正确的架构选择。

### 4.6 App SDK Proc-Macro → Agent Contract 声明（中优先级）

**借鉴价值**：★★★☆☆（开发者体验可借鉴）

Cali 提供 proc-macro 简化 WASM 应用开发：

```rust
#[app::init]      // 应用初始化
#[app::state]     // 声明 CRDT 状态类型
#[app::event]     // 声明事件处理器
#[app::migrate]   // 状态迁移
#[app::log]       // 日志输出
#[app::private]   // 私有加密存储
#[app::emit]      // 事件广播
```

**对外心的启示**：外心 Agent 开发者目前缺少类似的声明式契约。外心可以考虑设计一套 Agent SDK proc-macro，让 Agent 开发者用声明式方式定义：
- 订阅哪些信号 topic
- 发布哪些信号 topic
- 需要哪些 Port 能力
- 生命周期钩子（init/shutdown）

---

## 五、集成可行性评估：外心能否基于 Cali 做开发

### 5.1 网络层：能否基于 Cali 网络栈开发？

**结论：不能直接用，但可以深度参考**

| Cali 网络组件 | 外心能否直接用 | 理由 |
|-------------|-------------|------|
| `mero-network`（libp2p 封装） | ❌ 不建议 | Cali 的网络是给 WASM Runtime 服务的，外心的 ECS-3 网络层需要与 SignalPool 深度绑定 |
| libp2p gossipsub | ⚠️ 参考思路 | gossipsub 的 mesh + fanout 双路径设计值得借鉴，但外心的信号路由语义完全不同 |
| Cali 的 sync 协议 | ⚠️ 参考设计 | 四层自适应同步协议是很好的参考，但需要针对外心信号特征重新设计 |
| `mero-context`（DAG 管理） | ✅ 未来可考虑 | 如果外心引入 Governance DAG，可参考其架构 |

**外心的正确路径**：
- **继续用 iroh**（ECS-mesh 交叉分析已确认），而不是引入 Cali 的 libp2p 封装
- **Cali 的 SyncManager 四层协议设计**作为 EDS-2 同步层的重要参考
- **Cali 的 Governance DAG** 作为多人联邦治理设计的参考

### 5.2 CRDT 层：能否直接引入 Cali CRDT 实现？

**结论：可以直接参考/引入，是最具可行性的集成方向**

**支持直接引入的理由**：
1. **Cali 的 CRDT 实现是生产级的**：`mero-storage` 有 15 种 CRDT 类型，已在生产中验证
2. **两者都是 Rust 项目**：技术栈一致，引入成本低
3. **外心 EDS-2 恰好需要 CRDT**：这正是 Cali 最成熟的部分
4. **比 iroh-docs 的 CRDT 更丰富**：iroh-docs 的 CRDT 类型较基本，Cali 的更完整

**引入方案**：

```rust
// 方案 A：直接依赖 calimero-storage（推荐评估）
[dependencies]
calimero-storage = { git = "https://github.com/calimero-network/core" }

// 方案 B：fork 并定制（如果需要修改）
// fork calimero-storage 到 exomind 组织，按需定制

// 方案 C：纯参考实现（如果不想引入外部依赖）
// 参考 mero-storage 的 CRDT 接口设计，自行实现核心类型
```

**风险**：
- Cali v0.10.1-rc.8 尚未发布正式版，API 可能变更
- 引入 Cali crate 会带来 wasmer（~3-5 MB）依赖，需要确认是否愿意承担

### 5.3 WASM Runtime：能否用于外心 Agent 执行？

**结论：不适合直接用**

| 维度 | Cali WASM Runtime | 外心 Agent Runtime | 评估 |
|------|-----------------|------------------|------|
| **执行确定性** | ✅ 必需（WASM 天然确定性） | ❌ 不需要（LLM Agent 有随机性） |
| **多语言支持** | ✅ Rust/JS/Python → WASM | ✅ CLI Agent（语言无关） | 各有优势 |
| **隔离粒度** | ✅ WASM 沙箱（细粒度） | OS 进程隔离（粗粒度） | OS 进程更简单 |
| **性能开销** | WASM JIT 额外开销 | 原生执行，无额外开销 | 外心更优 |
| **与 LLM 集成** | 困难（WASM 内不能直接跑 LLM） | ✅ 自然（进程外 CLI 直接跑 LLM） | 外心更适合 |

**根本原因**：Cali 设计 WASM Runtime 是为了解决"多方运行相同代码"（CRDT 收敛的前提），外心的 LLM Agent 不需要也不应该确定性执行——LLM 的随机性是其核心特性，而非缺陷。

### 5.4 存储层：能否直接用 Cali RocksDB 实现？

**结论：部分可借鉴，不建议直接用**

| Cali 存储组件 | 可借鉴程度 | 理由 |
|-------------|----------|------|
| **列族 + 前缀命名体系** | ✅ 高度可借鉴 | 这是设计思路，不是代码，直接学 |
| **CRDT 集合存储** | ✅ 可借鉴 | EDS-2 需要，与 CRDT 评估一致 |
| **Blob 存储（`blob::`）** | ✅ 可借鉴 | EDS-2 文件存储，与 iroh-blobs 比较 |
| **Governance 存储（`group::*`）** | ✅ 未来可借鉴 | 多人联邦场景 |
| **RocksDB 引擎本身** | ❌ 不适合前端 | 前端用 IndexedDB，Tauri 用 SQLite，不需要 RocksDB |

### 5.5 治理/身份层：能否借鉴 Cali Namespace 模型？

**结论：未来多人联邦时的首选参考**

Cali 的 Namespace + Group + Subgroup 树形结构形成了完整的治理层级：

```
Namespace（独立 Ed25519 密钥对）
  └── Group（共享治理 DAG）
        └── Context（独立状态 DAG）
              └── Role（Admin/Member/ReadOnly）
                    └── Capability（5位比特掩码）
```

**外心未来的多人联邦设计**可以直接以此为蓝本：
- **Namespace** → 外心的"用户域"（每人一个身份根）
- **Group** → 外心的"协作组"（多用户共享上下文）
- **Context** → 外心的"共享 SignalPool"（组内共享的信号空间）
- **Capability** → 外心的"权限位掩码"（精细权限控制）

---

## 六、综合结论

### 6.1 核心判断

| 判断 | 依据 |
|------|------|
| **Cali 和外心是互补的，不是竞争的** | 两者解决不同层面的问题：Cali 管状态收敛，外心管实时信号路由 |
| **Cali 对外心 EDS 价值远高于 ECS** | EDS（数据层）需要 CRDT/存储/同步，正是 Cali 最成熟的部分 |
| **外心 ECS（通信栈）与 Cali 网络层处于同一技术生态位** | 两者都依赖 P2P 网络，但外心用 iroh，Cali 用 libp2p，设计思路可互相印证 |
| **Cali 的 WASM Runtime 对外心没有价值** | LLM Agent 不需要确定性执行，进程隔离更简单 |
| **Cali 的 Governance DAG 是外心多人联邦的最佳参考** | Namespace/Group/Subgroup/Capability 模型完整且生产验证 |

### 6.2 分优先级行动建议

| 优先级 | 行动 | 依据 |
|--------|------|------|
| **P0** | **评估引入 calimero-storage CRDT 实现到 EDS-2** | 外心 EDS-2 正好需要 CRDT，Cali 最成熟且 Rust 栈一致 |
| **P0** | **参考 Cali 的 SyncManager 四层协议设计 EDS-2 同步协议** | 自适应协议选择是EDS-2 的核心设计问题 |
| **P1** | **参考 Cali 11列族前缀命名规范设计 EDS-1 存储前缀体系** | 命名规范是低成本高价值的借鉴 |
| **P1** | **参考 Cali Governance DAG 设计多人联邦治理模型** | Namespace/Group/Subgroup/Capability 完整且可迁移 |
| **P2** | **参考 Cali 的 App SDK proc-macro 设计外心 Agent SDK** | 改善 Agent 开发者体验 |
| **P2** | **保持 ECS-3 走 iroh 路线，用 Cali 网络设计印证架构** | iroh 比 libp2p 更适合外心（轻量 + BLE 支持） |
| **P3** | **探索 calimero-client-js 作为外心 JS Agent SDK 的参考** | 外心未来可能需要 JS/TS Agent SDK |

### 6.3 不可做的判断

| 判断 | 理由 |
|------|------|
| ❌ 不要试图把 Cali 当作外心的后端 | Cali 是 P2P 状态收敛系统，外心是信号路由系统，架构哲学根本不同 |
| ❌ 不要引入 Cali 的 WASM Runtime | 外心 Agent 不需要确定性执行，LLM 的随机性是特性 |
| ❌ 不要在 ECS（通信栈）层引入 CRDT | ECS 是信号路由，信号本身是瞬态的，不需要 CRDT 收敛 |
| ❌ 不要放弃 iroh 路线改走 libp2p | iroh 更轻量、BLE 支持、NAT 穿透更简单；Cali 的网络层设计应作为参考而非替代 |

### 6.4 长期架构启示

Cali 的存在给了外心一个重要的信心：**Local-First + CRDT + P2P 网络这套技术栈已经在生产中被验证是可行的**。外心不需要重复造这个轮子，只需要：
1. **自建 ECS**（SignalPool + RouteTable，这是外心的核心竞争力）
2. **借鉴 EDS**（Cali 的 CRDT/存储/同步设计，这是可以直接复用的）

这与外心 CLAUDE.md 中的"三自建 + 三借用"原则完全一致，只是"借用"的参考对象从单纯的 iroh 扩展到了包括 Cali 在内的整个 Local-First 技术生态。

---

## 附录：关键技术对照速查

### A.1 CRDT 类型对照

| Cali CRDT | 外心对应 | 备注 |
|-----------|---------|------|
| LwwRegister | 规划中 LWWRegister | EDS-2 配置同步 |
| GCounter | 规划中 GCounter | 事件计数 |
| PnCounter | 规划中 PnCounter | Token 余额 |
| RGA | 规划中 RGA | 知识库文本 |
| UnorderedMap | 规划中 UnorderedMap | 键值同步 |
| UnorderedSet | 规划中 UnorderedSet | 标签集合 |
| Vector | 规划中 Vector | 有序列表 |
| UserStorage | 无直接对应 | Per-user state |
| FrozenStorage | 无直接对应 | 不可变数据 |

### A.2 网络能力对照

| 能力 | Cali | 外心（当前/规划） |
|------|------|----------------|
| LAN 发现 | mDNS ✅ | 规划中（P0） |
| WAN 发现 | Kademlia ✅ | iroh-dns ✅ |
| P2P 传输 | libp2p QUIC/TCP ✅ | iroh QUIC（规划） |
| Pub/Sub 广播 | gossipsub ✅ | SignalPool（ECS-5）|
| 中继 | Circuit V2 relay ✅ | HTTP relay（当前）+ iroh-relay（规划）|
| NAT 穿透 | DCUtR ✅ | iroh 自动打洞（规划）|
| 身份认证 | Ed25519 + Signed Peer Record ✅ | Bearer Token（当前）|
| 流复用 | Yamux ✅ | HTTP/2 multiplexing（规划）|

### A.3 存储能力对照

| 能力 | Cali | 外心 |
|------|------|------|
| 存储引擎 | RocksDB ✅ | PouchDB + SQLite |
| CRDT 类型 | 15种 ✅ | 规划中 |
| Blob 存储 | 内容寻址 ✅ | 规划中 iroh-blobs |
| 治理存储 | DAG + Ed25519 ✅ | 规划中 |
| 私有存储 | `private::` 列族 ✅ | Agent cache |

---

*文档版本: v1.0*
*分析日期: 2026-04-09*
*分析依据: Cali 调研报告 v4.0、ExoMind 架构文档（overview.md / ECS-EDS-discussion / ECS-mvp-spec / ECS-mesh-cross-analysis）*
