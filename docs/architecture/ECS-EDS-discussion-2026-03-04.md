# ECS / EDS 架构讨论记录 — 2026-03-04

> **状态**: 讨论草稿，未定稿
> **日期**: 2026-03-04
> **参与者**: @HailayLin (用户) + @ARCJ137442 (开发伙伴) + Architect Agent
> **关联文档**: [[ECS-communication-stack|ECS 通信协议栈 v1.0]]、[[ARCH-SYNC|同步模块架构分析]]、[[holochain-agent-centric-research-2026-03-04|Holochain 调研报告]]
> **讨论模式**: 只读+讨论，不修改现有文档，等架构稳定后再改

---

## 目录

- [第一轮：ECS 架构反馈](#第一轮ecs-架构反馈)
- [第二轮：认知生命网络愿景](#第二轮认知生命网络愿景)
- [第三轮：存储与分布式记忆](#第三轮存储与分布式记忆)
- [第四轮：iroh 发现与技术组合修订](#第四轮iroh-发现与技术组合修订)
- [综合演进路线图](#综合演进路线图)

---

## 第一轮：ECS 架构反馈

> 用户对 [[ECS-communication-stack|ECS v1.0 文档]] 的评价：80-90 分。七层架构有必要，路线图非常好。

### 1.1 Layer 4 命名：会话管理 → 连接管理

**问题**：用户困惑 "会话管理" 容易跟业务层的"用户对话会话"混淆。

**TCP 类比解释**：

ECS-4 对标的是 TCP 连接管理（OSI Layer 5 的一部分），不是 HTTP Session 那种业务会话：

| TCP 概念 | ECS-4 对应 | 解释 |
|----------|-----------|------|
| TCP 三次握手 | Agent SSE 连接建立 | Agent 连上 RT，注册身份 |
| TCP keepalive | SSE 心跳 (`event: heartbeat`) | 每隔 N 秒确认对方还活着 |
| TCP RST/FIN | SSE 断开检测 | 连接断了，RT 把 Agent 标记为 offline |
| TCP 重连 | Last-Event-ID 重放 | 断了重连时，从上次位置续传 |
| TCP 窗口 | WindowCache | 缓存最近 1000 条消息，支持重放 |

ECS-4 做的事：**谁连着、谁断了、断了能续上、活着有心跳。**

**命名方案对比**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **连接管理层 (Connection Management)** | 最直观，不跟业务层混淆 | OSI 传统上 "连接管理" 放 L4 |
| 存活感知层 (Liveness / Presence) | 突出在线/离线语义 | 覆盖面窄，还有 Last-Event-ID 重放等 |
| 链路会话层 (Link Session) | 加限定词区分 | 两个字限定词不够清晰 |

**推荐**：改为 **"连接管理层 (Connection Management)"**。理由：
- 一说 "连接管理"，大家就知道管连接的建立/维持/断开
- 跟 TCP 连接管理是同一心智模型
- "会话" 留给 ECS-7 的业务概念（Agent 与用户的对话会话）

---

### 1.2 组网层 vs libp2p（初始分析，后被 iroh 修订，见第四轮）

**libp2p 模块与 ECS 分层的映射**：

| libp2p 模块 | 能力 | ECS 层 |
|-------------|------|--------|
| `libp2p-tcp`, `libp2p-quic`, `libp2p-websocket` | 传输层 | ECS-1 + ECS-2 |
| `libp2p-noise`, `libp2p-tls` | 加密认证 | ECS-2（安全） |
| `libp2p-mdns` | 局域网发现 | ECS-3a |
| `libp2p-kad` (Kademlia DHT) | 分布式发现 | ECS-3a（广域） |
| `libp2p-identify` | 节点身份交换 | ECS-3b |
| `libp2p-gossipsub` | 基于 topic 的 pub/sub | ECS-5 |
| `libp2p-relay` | 中继/NAT 穿越 | ECS-3c |
| `libp2p-swarm` | 连接管理 | ECS-4 |

**三种策略**：

1. **全面采用 libp2p** — 工程量省，但重量级、BLE 不支持、gossipsub 跟 SignalPool 语义不匹配
2. **选择性引入 libp2p**（初始推荐）— 取精华去糟粕
3. **自研一切** — 完全控制但工程量大

> **注意**：Holochain 调研后发现 iroh 可能比 libp2p 更适合 ExoMind，详见 [第四轮](#第四轮iroh-发现与技术组合修订)。

---

### 1.3 物理链路优先级调整

**用户反馈要点**：
- BLE 必须（手环连接刚需）
- WiFi 必须（基础通信）
- 星闪 NearLink 先不管
- Mesh 远期
- USB/串口有意思但不急
- IPC 进程内+进程外都有意思
- 核心理念：跨设备跨运营商万物互联，不是华为单一生态

**调整后的优先级**：

```
P0 (已完成)     WiFi TCP       — 基础通信 ✅
P1 (近期)       BLE            — 手环/手表连接 🔺 从 P2 提升
P1 (近期)       IPC            — 同机优化（Named Pipe/Unix Socket）
P2 (中期)       WebSocket      — 替代 SSE，双向通信
P3 (中期)       USB/Serial     — 嵌入式调试 🔻 从 P2 降级
P4 (远期)       WiFi Mesh      — 嵌入式自组网
P5 (观望)       NearLink       — 等生态成熟 🔻 从 P4 降级
P5 (远期)       LoRa           — 特殊场景
```

---

### 1.4 MVP 阶段实施方案

**MVP（v0.3.x → v0.4.x）**：
1. 保持现有架构不动（SignalPool + HTTP/SSE + localhost）
2. ECS-4 改名：会话管理 → 连接管理（纯文档改动）
3. 不急着实现 ECS-3（单 RT 单机够用）
4. BLE 调研先行（确认技术可行性）

**中期（v0.5.x+）**：引入 Transport trait、ECS-3 组网层 MVP、评估 iroh

**长期（v1.0+）**：iroh 组网层、多传输层、端到端加密

---

## 第二轮：认知生命网络愿景

### 2.1 用户核心愿景

**路由模式演进**：
- **当前 MVP**：单个 ExoMind 程序内是中心化 broker（SignalPool + RouteTable）
- **未来**：单程序内部仍是中心化 broker，但多个程序/设备之间是分布式路由

**核心定位**：不是"像生物体"的隐喻，而是**就是要做群体生命**。每个节点就是一个生命（或半生命）节点。分为有生命的（自主运行、有记忆和决策的 Agent）和非生命的（被动运行的程序/服务）。

**单人多设备需求**：
1. 互联互通 — 所有设备组成网络
2. 容错 — 任何设备断了不影响整体
3. 弹性扩展 — 设备越多功能越强
4. 不挑硬件 — 嵌入式也能跑
5. 节点可生可死 — 任意上下线不影响整体
6. 分布式记忆 — 每个节点有自己的记忆
7. 群体涌现 — 所有设备组成统一"认知生命群体"

---

### 2.2 双层路由统一抽象：Overlay Router

```
┌──────────────────────────────────────────────────────────┐
│                      SignalPool (不变)                     │
│                                                          │
│  publish("user.input.text", payload)                     │
│       │                                                  │
│       ▼                                                  │
│  RouteTable.match_routes("user.input.text")              │
│       │                                                  │
│       ├──→ TargetType::Actor  → tokio::broadcast (进程内) │
│       ├──→ TargetType::Agent  → SSE push (本地进程外)     │
│       ├──→ TargetType::Frontend → SSE push (本地前端)     │
│       │                                                  │
│       └──→ TargetType::Remote → ★ 新增 ★                │
│                │                                          │
│                ▼                                          │
│         OverlayRouter                                     │
│                │                                          │
│                ├──→ PeerA (WiFi/TCP)  → 发送              │
│                ├──→ PeerB (BLE)       → 发送              │
│                └──→ PeerC (通过PeerA中继) → 发送           │
└──────────────────────────────────────────────────────────┘
```

**Interest-based Auto-routing**：远端节点声明兴趣 topic，本地自动生成虚拟路由。对标 ROS 2 SEDP、NATS SUB 传播。

**代码影响**：`SignalEvent` 已有 `origin_host_id` + `hop` 字段，完美支持。`TargetType` 加 `Remote` 变体即可。应用层 API 零变化。

**控制平面**：用户确认需要 `system.*` 控制平面处理握手/发现。

---

### 2.3 容错与自愈

**架构原则：每个 RT 都是对等的（peer），没有 master/slave 区分。**

```
                    ┌─────────────┐
                    │  RT-PC      │ ← 断了
                    │  (offline)  │
                    └─────────────┘
                          ✕

    ┌─────────────┐              ┌─────────────┐
    │  RT-Phone   │ ─── WiFi ─── │  RT-Watch   │
    │  (online)   │              │  (online)    │
    └─────────────┘              └─────────────┘

    手机和手表继续正常工作
    PC 上线后自动重新加入网络
```

**分布式记忆同步策略**：

| 记忆类型 | 同步策略 | 优先级 |
|---------|---------|--------|
| 信号事件流 | Event Sourcing (Journal) | P3 |
| 路由表/能力表 | Gossip 协议 | P3 |
| Agent 状态/记忆 | CRDT (Automerge) | P4 |
| 用户数据/文件 | CRDT 或 CRR | P4 |
| 配置/设置 | Last-Write-Wins CRDT | P5 |

---

### 2.4 异构设备能力发现

```rust
pub struct NodeCapabilities {
    pub host_id: String,
    pub device_type: DeviceType,       // Desktop/Mobile/Wearable/Embedded/Vehicle
    pub compute: ComputeCapabilities,  // GPU/RAM/CPU/can_run_llm
    pub sensors: Vec<SensorType>,      // Heartrate/SpO2/GPS/Camera/Microphone...
    pub actuators: Vec<ActuatorType>,  // Display/Speaker/Vibration/Motor/LED...
    pub agents: Vec<AgentCapability>,
}
```

能力驱动智能路由：Agent 有 Requirements（`requires: [gpu]`），OverlayRouter 匹配 Capabilities。对标 K8s Node Labels + Scheduler。

---

### 2.5 多人场景：联邦模式

推荐 Matrix 联邦模式：每人一个 ExoMind 域，通过 Federation Gateway + ACL 选择性互联。

```
@HailayLin 的 ExoMind 域
    RT-PC ←→ RT-Phone ←→ RT-Watch
         │ (Federation Link, ACL)
@ARCJ137442 的 ExoMind 域
    RT-Laptop ←→ RT-Phone
```

---

### 2.6 对标工程参考

| 项目 | 可借鉴层 | 适用度 |
|------|---------|--------|
| **iroh** | ECS-1/2/3 (QUIC/NAT/relay/gossip) | ★★★★★ (新推荐) |
| **libp2p** | ECS-1/2/3 (tcp/noise/mdns/kad) | ★★★★ |
| **Matrix** | 联邦层 (Federation API, E2EE) | ★★★★ |
| **NATS** | ECS-3/5 (gossip, subject routing) | ★★★★ |
| **ROS 2 DDS** | ECS-3/5 (SPDP/SEDP) | ★★★ |
| **Kubernetes** | 能力发现 (Node labels, scheduler) | ★★★ |
| **Holochain** | 分布式记忆 (agent-centric, DHT) | ★★★ |

---

## 第三轮：存储与分布式记忆

### 3.1 ECS + EDS 双栈并行

**信号 vs 文件**：

```
信号 (Signal)                         文件 (File)
──────────────                        ──────────
即时的、瞬态的                         持久的、有版本的
小数据 (<10KB)                         大小不定 (1KB ~ 数GB)
广播式                                 点对点或选择性同步
对标: 神经信号                          对标: 记忆、长期存储
```

**方案**：不在 ECS 中间插层，新建 **EDS (ExoMind Data Stack)**：

```
┌─────────────────────────────────────────────────────────────┐
│                    ExoMind Node                              │
│                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │   ECS (通信栈)       │    │   EDS (数据栈)            │   │
│  │   ExoMind Comm Stack │    │   ExoMind Data Stack     │   │
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
│  ECS 和 EDS 共享 ECS-3 组网层的 PeerRegistry 和传输通道       │
│  EDS-2 的同步事件通过 ECS-5 发布信号通知（如 file.synced）     │
└─────────────────────────────────────────────────────────────┘
```

**关键原则：ECS 管"实时通信"（神经信号），EDS 管"持久数据"（记忆）。**

---

### 3.2 EDS 三层设计

#### EDS-1: 存储层 (Storage)

```rust
#[async_trait]
pub trait NodeStorage: Send + Sync {
    async fn read_file(&self, path: &str) -> Result<Vec<u8>>;
    async fn write_file(&self, path: &str, data: &[u8]) -> Result<()>;
    async fn list_files(&self, prefix: &str) -> Result<Vec<FileInfo>>;
    async fn kv_get(&self, namespace: &str, key: &str) -> Result<Option<Vec<u8>>>;
    async fn kv_set(&self, namespace: &str, key: &str, value: &[u8]) -> Result<()>;
    fn capabilities(&self) -> StorageCapabilities;
}
```

| 设备 | EDS-1 实现 | 容量 |
|------|-----------|------|
| PC/Mac | 文件系统 + SQLite | TB级 |
| 手机/平板 | 应用沙箱 + SQLite | GB级 |
| 手环/手表 | SPIFFS/LittleFS | 16MB |
| ESP32 | SPIFFS + SD 卡 | 16MB~16GB |

#### EDS-2: 同步层 (Sync)

```rust
pub enum SyncStrategy {
    FullBidirectional,               // PC ↔ 手机
    Selective { include_paths, exclude_paths, max_file_size },  // 手环
    ReadOnlyMirror { mirror_paths }, // 只读镜像
    WriteOnlyUpload { upload_paths }, // 传感器上传
}
```

**文件同步协议：信号通知 + 按需拉取**（对标 Git fetch/pull 分离）

#### EDS-3: 知识层 (Knowledge)

面向 Agent 的知识管理抽象（Obsidian 知识库），PC/手机完整实现，手环上不存在。

---

### 3.3 节点存储拓扑

```
ExoMind Node Storage
├── /system/          系统配置（RT 可写，Agent 可读）
├── /shared/          共享文件系统（多设备同步）
│   ├── knowledge/    知识库（Obsidian）
│   ├── diary/        日记
│   └── projects/     项目资料
├── /agents/          Agent 专属存储
│   ├── {agent}/state.json    私有状态
│   ├── {agent}/memory/       记忆（CRDT）
│   └── {agent}/cache/        缓存（不同步）
├── /journal/         事件日志（持久化）
│   ├── local.journal
│   └── synced/       从其他节点同步的事件
└── /temp/            临时数据（不同步）
```

---

### 3.4 三级存储策略

```
Tier 1: 嵌入式微控制器 (手环, ESP32 无 SD)
  存储: 1-4 MB | 策略: 极简（缓冲+上传+清空）

Tier 2: 嵌入式 Linux (ESP32+SD, 树莓派)
  存储: 100MB-1GB | 策略: 选择性同步

Tier 3: 完整设备 (PC, 手机)
  存储: 10GB+ | 策略: 全量同步
```

---

### 3.5 三种 Journal 的区分

| 维度 | 人的 Journal | Agent Journal | 系统 Journal |
|------|-------------|---------------|-------------|
| 订阅 topic | `user.*`, `timeblock.*`, `diary.*` | Agent 自身 topic | `*`（全部） |
| 留存 | **永久** | 中期（数月） | 短期热区+长期冷存 |
| 同步 | 全量同步 Tier 3 | 按需 | PC 全量，其他 Hub |
| 对标 | Obsidian 日记 / EventLog | 应用日志 | syslog |

**核心洞见：Journal 就是一个 Agent** — 人的 journal、Agent 的 journal、系统 journal 都是 SignalPool 的订阅者，用 topic 过滤区分。

**当前代码已有雏形**：

| 已有 | 目标 |
|------|------|
| WindowCache (信号热区) | SystemJournal 热区 |
| Journal (投递审计) | SystemJournal 审计 |
| EventLog Actor (用户事件) | HumanJournal |
| 无 | AgentJournal (新增) |

---

## 第四轮：iroh 发现与技术组合修订

> 基于 [[holochain-agent-centric-research-2026-03-04|Holochain 调研报告]] 的关键发现。

### 4.1 iroh：比 libp2p 更适合 ExoMind 的 P2P 网络栈

[iroh](https://github.com/n0-computer/iroh)（n0-computer 开发，v0.96.0，2026-01 发布）是一个模块化的 Rust P2P 网络库。**Holochain 自己也在从 libp2p 迁移到 iroh**，这是一个强信号。

#### iroh 核心模块

| 模块 | 功能 | ECS 层 |
|------|------|--------|
| `iroh` | QUIC 连接 + 自动 NAT 穿透 + 中继回退 | ECS-1/2/3 |
| `iroh-relay` | 生产级中继服务器 | ECS-3c |
| `iroh-gossip` | 基于 topic 的 pub/sub (HyParView + PlumTree) | ECS-5 (可选) |
| `iroh-blobs` | 内容寻址的大文件传输 | EDS-2 |
| `iroh-docs` | CRDT 文档同步 | EDS-2 |
| `iroh-base` | 共享类型（Hash, Key, RelayUrl） | 基础设施 |
| `iroh-dns-server` | EndpointId 的 DNS 发现 | ECS-3a |

#### iroh vs libp2p 对比

| 维度 | iroh | libp2p |
|------|------|--------|
| **协议基础** | 纯 QUIC（UDP），单一高效协议 | 多协议支持（TCP/QUIC/WebSocket/...） |
| **NAT 穿透** | **内置自动打洞** + relay 回退，零配置 | 需要手动配置 relay + DCUtR |
| **加密** | QUIC 内置 TLS 1.3，默认加密 | 需要单独选择 noise/tls |
| **节点标识** | Ed25519 公钥（"dial by key, not IP"） | 类似（PeerId = multihash of pubkey） |
| **Pub/Sub** | `iroh-gossip`：HyParView + PlumTree，eager/lazy 集 | `gossipsub`：更成熟但更复杂 |
| **文件传输** | `iroh-blobs`：内容寻址大文件传输 | `libp2p-bitswap`（IPFS 的） |
| **CRDT 同步** | `iroh-docs`：内置 CRDT 文档同步 | 无（需要外部库） |
| **体量** | **轻量**，模块化，编译时间短 | 重量级，依赖多，编译时间长 |
| **BLE 支持** | 无（纯 QUIC/UDP） | 无 |
| **成熟度** | 较新（v0.96，490 依赖者） | 非常成熟（IPFS/Filecoin/Substrate） |
| **社区** | 中等，n0-computer 公司维护 | 大型，Protocol Labs 生态 |

#### 为什么 iroh 更适合 ExoMind

1. **更轻量**：ExoMind 不需要 libp2p 的全部协议栈。iroh 只用 QUIC 一种协议，简单高效
2. **NAT 穿透零配置**：iroh 的核心卖点就是"任何网络环境下都能连通"，这对跨设备的 ExoMind 至关重要
3. **内置 CRDT + 文件传输**：`iroh-docs` 和 `iroh-blobs` 直接覆盖了 EDS-2 同步层的需求，不需要额外引入 Automerge
4. **Holochain 的背书**：Holochain 从 libp2p 迁移到 iroh，说明在 agent-centric 场景下 iroh 更优
5. **gossip 协议适合手机**：`iroh-gossip` 基于 HyParView，专门为资源受限设备（手机）设计

#### iroh 的局限

1. **不支持 BLE**：iroh 只走 QUIC/UDP，手环等 BLE-only 设备无法直接用 iroh。ECS-2 Transport trait 仍然需要，BLE 走独立通道
2. **不支持非 IP 网络**：LoRa、串口等非 IP 传输同样不走 iroh
3. **相对较新**：v0.96（未到 1.0），API 可能还有变化
4. **无 mDNS 局域网发现**：iroh 用 DNS-based 发现（`iroh-dns-server`），LAN 发现可能需要补充 `mdns-sd`

---

### 4.2 修订后的技术组合推荐

| 层级 | 原推荐 | 修订推荐 | 理由 |
|------|--------|---------|------|
| ECS-1/2 传输 | TCP (tokio) | **iroh** (QUIC) + TCP 兼容层 | QUIC 更高效，内置加密 |
| ECS-3a 发现 | `mdns-sd` | **iroh-dns-server** + `mdns-sd`(LAN) | iroh DNS 覆盖 WAN，mdns 覆盖 LAN |
| ECS-3b 握手 | 自研 | **iroh 内置**（Ed25519 公钥握手） | 零配置 |
| ECS-3c 中继 | 自研 | **iroh-relay** | 生产级，开放生态 |
| ECS-5 跨设备 pub/sub | 自研 | **iroh-gossip**（可选） | HyParView 对手机友好 |
| EDS-2 文件同步 | Automerge | **iroh-blobs** + **iroh-docs** | 内置内容寻址 + CRDT |
| BLE 传输 | `btleplug` | `btleplug`（不变） | iroh 不支持 BLE |
| 分布式记忆 | Automerge | **iroh-docs**（内置 CRDT） | 减少依赖 |

---

### 4.3 Source Chain：分布式 EventLog 的基石

Holochain 调研发现的 Source Chain 概念与 ExoMind 的 EventLog 高度匹配：

```
Source Chain = 每个节点维护的不可变行为链

Node-A 的 Source Chain:
  [genesis] ← hash → [event-1] ← hash → [event-2] ← hash → [event-3]

  每个条目:
  {
      seq: u64,                    // 序列号
      hash: blake3::Hash,          // 本条目的哈希
      prev_hash: blake3::Hash,     // 前一条目的哈希（链式）
      timestamp: u64,
      author: Ed25519PublicKey,     // 产生者的公钥
      entry_type: String,          // "signal" / "file_change" / "agent_state"
      payload: Vec<u8>,
  }
```

**与 ExoMind 的映射**：

| Source Chain 概念 | ExoMind 对应 |
|------------------|-------------|
| Source Chain | PersistentJournal（持久化事件日志） |
| genesis entry | 节点首次启动 |
| chain head | 最新事件 |
| blake3 hash chain | 事件完整性验证 |
| author (公钥) | origin_host_id（信号源） |

**实现建议**：几百行 Rust 即可自建，不需要引入 Holochain 框架：

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
    }
}
```

---

### 4.4 Arc-based 数据分片

Holochain 的 Arc（Archinaut，存储弧度）概念：每个节点负责 DHT 空间的一段弧。弧的大小根据存储能力动态调整。

```
DHT 哈希空间 (0 ~ 2^256):

  ┌────────────────────────────────────────┐
  │            完整哈希空间环               │
  │                                        │
  │  PC: ████████████████████ (大弧, 80%)   │
  │  手机: ██████████ (中弧, 40%)            │
  │  手环: ██ (小弧, 5%)                     │
  │                                        │
  │  所有设备的弧覆盖 100% → 全局数据可达    │
  └────────────────────────────────────────┘
```

**与 EDS 三级存储的完美对应**：

| EDS Tier | Arc 大小 | 存储 | 策略 |
|----------|---------|------|------|
| Tier 1 (手环) | 小弧 (~5%) | 1-4 MB | 只存本地产生的 + 极少量热数据 |
| Tier 2 (树莓派) | 中弧 (~30-50%) | 100MB-1GB | 选择性存储 |
| Tier 3 (PC/手机) | 大弧 (~80-100%) | 10GB+ | 近全量存储 |

**优势**：不需要手动配置"同步哪些文件"，Arc 大小根据设备能力自动调整。存储空间不够时自动缩小弧度，多余空间自动扩大弧度。

---

### 4.5 修订后的推荐技术栈

综合 Holochain 调研结果，修订推荐的技术组合为：

```
┌─────────────────────────────────────────────────────────────┐
│                ExoMind 技术栈（修订版）                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 应用层                                               │   │
│  │ SignalPool (自研) + Agent Framework                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 数据层                                               │   │
│  │ Source Chain (自建, ~300行) + iroh-docs (CRDT)        │   │
│  │ + iroh-blobs (文件传输)                               │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 网络层                                               │   │
│  │ iroh (QUIC + NAT + relay) + iroh-gossip (pub/sub)    │   │
│  │ + btleplug (BLE) + mdns-sd (LAN 发现)                │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 存储层                                               │   │
│  │ 文件系统 + SQLite + blake3 (hash chain)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  不引入 Holochain 框架本身，只借鉴其思想 + 用 iroh 网络栈    │
└─────────────────────────────────────────────────────────────┘
```

**三不引入原则**：
1. 不引入 Holochain 框架（太重，且是 dApp 框架而非个人系统）
2. 不引入 libp2p（iroh 更轻量更适合）
3. 不引入 IPFS（不需要内容寻址文件系统）

**三自建原则**：
1. 自建 SignalPool（核心路由能力，已实现）
2. 自建 Source Chain（几百行，不需要共识）
3. 自建 Agent Framework（ECS-7 应用语义层）

**三借用原则**：
1. 借用 iroh（P2P 网络 + NAT + relay）
2. 借用 iroh-docs（CRDT 文档同步）
3. 借用 btleplug（BLE 通信）

---

## 综合演进路线图

### 四层抽象

```
┌─────────────────────────────────────────────────────────┐
│  L4: 联邦层 (Federation)                                  │
│      多人 ExoMind 域间互联 | 对标: Matrix | P6+            │
├─────────────────────────────────────────────────────────┤
│  L3: 组网层 (Mesh)                                       │
│      单人多设备 | 对标: iroh (QUIC+NAT+relay) | P3         │
├─────────────────────────────────────────────────────────┤
│  L2: 能力层 (Capability)                                  │
│      设备能力注册+智能路由 | 对标: K8s | P3                 │
├─────────────────────────────────────────────────────────┤
│  L1: 信号层 (Signal)                                      │
│      SignalPool + RouteTable + Journal | 对标: NATS | P0 ✅ │
└─────────────────────────────────────────────────────────┘
```

### 时间线

```
现在 (v0.3.x)           中期 (v0.5-0.7)             长期 (v1.0+)
─────────────            ─────────────────            ─────────────────
单 RT, 单机               多 RT, LAN 组网              多人联邦
中心化 broker             + iroh (QUIC P2P)            + 广域网 DHT
HTTP/SSE                 + BLE (btleplug)             + Federation Gateway
                         + iroh-gossip                + E2EE
                         + Source Chain               + Arc-based 分片
                         + iroh-docs (CRDT)           + ACL/权限
                         + 能力注册表
                         + Journal 持久化
                         + interest-based routing
```

### 对当前代码的影响

**好消息——当前代码架构决策正确，不需要大改**：

1. `SignalEvent.origin_host_id` + `hop` 已预留跨设备路由字段
2. `RouteTable.match_routes()` 可自然扩展到 Remote 路由
3. `TargetType` 枚举加 `Remote` 变体即可
4. `WindowCache.since()` 天然支持断线重连信号补发
5. `Journal` ring buffer 可扩展为 Source Chain（持久化 + hash chain）

**需要新增的核心模块（中期）**：

| 模块 | 职责 | 依赖 |
|------|------|------|
| `OverlayRouter` | 跨设备信号转发 | iroh |
| `PeerRegistry` | 对端节点管理 | iroh |
| `CapabilityRegistry` | 设备能力注册 | 自研 |
| `InterestSync` | 订阅兴趣传播 | iroh-gossip |
| `SourceChain` | 持久化事件日志 + hash chain | blake3 |
| `SyncEngine` | EDS-2 文件同步 | iroh-blobs + iroh-docs |
| `BleTransport` | BLE 通信 | btleplug |

这些都是新模块，不影响现有 SignalPool 代码。

---

*文档版本: 讨论草稿 v2（含 iroh 修订）*
*日期: 2026-03-04*
*状态: 未定稿，等架构讨论稳定后合并到正式文档*
