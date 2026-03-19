---
title: ExoMind-Net 技术规范
version: 0.1.0-draft
created: 2026-03-19
tags: [exomind, networking, protocol-stack, P2P, libp2p, distributed, rust]
---

# ExoMind-Net 技术规范

> ExoMind 分布式认知网络协议栈完整设计文档
>
> 版本：0.1.0-draft
>
> 作者：HailayLin
>
> 日期：2026-03-19

> [!NOTE]
> 本文档定义 ExoMind 的**软件协议栈**（七层 P2P 网络设计）。
> 物理基础设施部署方案见星云网络文档（个人知识库）。
> 星云网络阶段一二用 WireGuard Mesh，阶段三迁移到本文档定义的 libp2p 协议栈。

---

## 目录

1. [概述](#1-概述)
2. [设计哲学](#2-设计哲学)
3. [七层协议栈总览](#3-七层协议栈总览)
4. [L1 承载层 Bearer](#4-l1-承载层-bearer)
5. [L2 连接链路层 Link](#5-l2-连接链路层-link)
6. [L3 路由寻址层 Routing](#6-l3-路由寻址层-routing)
7. [L4 服务传输层 Service](#7-l4-服务传输层-service)
8. [L5 会话管理层 Session](#8-l5-会话管理层-session)
9. [L6 编码表示层 Representation](#9-l6-编码表示层-representation)
10. [L7 认知应用层 Cognitive](#10-l7-认知应用层-cognitive)
11. [安全体系](#11-安全体系)
12. [DHT 自发现原理](#12-dht-自发现原理)
13. [任务迁移机制](#13-任务迁移机制)
14. [sing-box 集成与代理承载](#14-sing-box-集成与代理承载)
15. [组件拆分与 Crate 结构](#15-组件拆分与-crate-结构)
16. [实现路线图](#16-实现路线图)
17. [与现有方案对比](#17-与现有方案对比)

---

## 1. 概述

### 1.1 ExoMind-Net 是什么

ExoMind-Net 是 ExoMind 分布式认知操作系统的网络协议栈，负责将用户的所有设备——从嵌入式传感器、手机、电脑到云端服务器——组成一个无中心的 P2P 网络。

它参照 OSI 七层模型设计，在 P2P 网络之上承载信号传输、文件传输、流式推送、代理服务、分布式计算、分布式存储和认知循环同步。

### 1.2 核心目标

- **全分布式**：无中心依赖，节点平等，任何节点挂掉网络自愈
- **异构设备覆盖**：从 BLE 手表到云端服务器，统一协议栈
- **认知承载**：不只是网络通信，最高层承载认知循环和 AI Agent
- **代理承载**：网络本身可承载代理流量，集成 sing-box 管理
- **安全自主**：自证明身份，端到端加密，不依赖任何第三方 CA

### 1.3 技术栈选择

- **语言**：Rust（从嵌入式到服务器统一）
- **底层网络库**：rust-libp2p（L1-L2 基础，不重复造轮子）
- **传输协议**：QUIC（UDP 基础，打洞友好，多路复用，内置加密）
- **序列化**：MessagePack（高效二进制，Rust/TS 两端成熟）
- **前端集成**：通过 Tauri Command 暴露给前端

### 1.4 与星云网络的关系

```
星云网络（基础设施层）          ExoMind-Net（软件协议层）
━━━━━━━━━━━━━━━━━━━━         ━━━━━━━━━━━━━━━━━━━━━━━
VPS 采购 / ISP 选择            协议栈设计 / Rust 实现
WireGuard Mesh（阶段一二）      libp2p P2P（阶段三替代）
sing-box 手动配置               SingBoxManager 自动管控
mihomo 分流规则                 TrafficPolicyEngine 动态策略
手动运维                       Agent 自动管理

星云网络是"骨骼+皮肤"
ExoMind-Net 是"神经系统+大脑"
```

---

## 2. 设计哲学

### 2.1 生命原理

ExoMind-Net 的设计基于认知生命科学的理论框架，用生命的组织原理指导网络设计：

| 生命特征                      | 网络实现               |
| ------------------------- | ------------------ |
| 自创生（Autopoiesis）          | 节点自发现、自连接、自修复网络拓扑  |
| 自我边界（Self-distinction）    | 密钥身份、设备配对、权限系统     |
| 稳态调节（Homeostasis）         | 认知循环持续运行，网络健康自监控   |
| 内在驱力（Intrinsic drive）     | 主动维持连通性、数据完整性、资源均衡 |
| 结构耦合（Structural coupling） | 任务迁移、网络自愈、策略学习     |
| 分布式认知                     | 无"大脑"节点，每个节点参与认知   |

### 2.2 节点平等

没有"服务器"和"客户端"之分，只有节点能力的差异：

```rust
enum NodeClass {
    /// 随身设备：手机、手表，电池敏感，随时可能离线
    Portable { battery_aware: bool },
    /// 桌面设备：电脑，算力强但会关机
    Desktop { gpu: Option<GpuInfo> },
    /// 常驻节点：VPS/服务器，7×24 在线，带宽稳定
    Persistent { guaranteed_uptime: f64 },
    /// 嵌入式：手表、传感器，极低功耗，能力受限
    Embedded { power_budget_mw: u32 },
}
```

所有节点都跑完整的 ExoMind 协议栈（嵌入式跑精简版）。广州 VPS 不是"服务器"，只是一个"比较稳定的节点"。

### 2.3 渐进复杂度

```
单机可用 → 两台设备同步 → 多设备组网 → 社区互联
每一步都是完整可用的产品状态
```

---

## 3. 七层协议栈总览

```
OSI 参照            ExoMind 协议栈 (EPS)         职责
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
L7 应用层     →    认知应用层 Cognitive         认知循环 / Agent 协作
L6 表示层     →    编码表示层 Representation    序列化 / 压缩 / 加密信封
L5 会话层     →    会话管理层 Session           认证 / 权限 / 会话生命周期
L4 传输层     →    服务传输层 Service           信号/文件/流/代理/计算/存储
L3 网络层     →    路由寻址层 Routing           DHT / 寻址 / 路由 / 流量策略
L2 数据链路层  →    连接链路层 Link             QUIC / 多路复用 / 打洞 / 中继
L1 物理层     →    承载层 Bearer               UDP / TCP / BLE / USB / LoRa
```

数据流转示例（手机远程让电脑跑 Agent）：

```
手机                                           电脑
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
L7  AgentCommand("重构函数")           →   L7  收到，启动 Agent
L6  MessagePack 序列化 + zstd 压缩     →   L6  解压 + 反序列化
L5  验证会话(OwnDevice) + 签名         →   L5  验签 + 检查权限
L4  封装为 Compute 消息                →   L4  路由到 Agent 执行器
L3  查路由表 → 对端虚拟IP              →   L3  接收
L2  选 QUIC stream(STREAM_AGENT)       →   L2  stream 解复用
L1  UDP 发送                           →   L1  UDP 接收
```

---

## 4. L1 承载层 Bearer

适配不同的底层网络环境，对上层暴露统一的发包/收包接口。

### 4.1 承载类型

```rust
enum BearerType {
    // ---- 互联网承载 ----
    /// 主力：UDP socket，QUIC 跑在上面
    Udp { socket: UdpSocket },
    /// 降级：某些网络封 UDP（企业防火墙、部分运营商）
    TcpWebSocket { stream: TlsStream<TcpStream> },
    /// 极端环境：HTTP/2 伪装，过严格 DPI
    Http2Tunnel { h2_connection: H2Connection },

    // ---- 近场承载 ----
    /// 传统蓝牙，带宽高（~2Mbps）
    BluetoothClassic { rfcomm_channel: u8 },
    /// BLE，功耗极低，MTU 小（23-517 bytes）
    BluetoothLowEnergy { service_uuid: Uuid, mtu: u16 },

    // ---- 本地承载 ----
    /// 同机进程间通信
    UnixSocket { path: PathBuf },
    /// 同机高速通道
    SharedMemory { region: ShmRegion },

    // ---- 未来扩展 ----
    /// 超远距离低速
    LoRa { frequency_mhz: f32, spreading_factor: u8 },
    /// USB 有线直连
    UsbSerial { port: String, baud_rate: u32 },
}
```

### 4.2 多承载并存与自动降级

```rust
struct BearerLayer {
    /// 同时持有多种 bearer，自动选最优
    bearers: Vec<ActiveBearer>,
    /// 网络探测器：启动时检测 UDP 是否可用、MTU、是否受限网络
    probe: NetworkProbe,
}

impl BearerLayer {
    /// 对上层暴露统一接口
    async fn send(&self, packet: &[u8], dest: Endpoint) -> Result<()> {
        let bearer = self.select_best_bearer(dest).await;
        bearer.send(packet).await
    }

    /// 网络切换时（WiFi→4G）自动迁移
    async fn on_network_change(&mut self, new_interface: NetworkInterface) {
        // 重新探测，切换 bearer，通知 L2 做连接迁移
    }
}
```

### 4.3 BLE 适配

BLE 包小（MTU 通常 23-517 字节）、带宽低（~100-200 kbps），需要特殊处理：

```rust
struct BleAdapter {
    mtu: u16,
    /// BLE 上不跑 QUIC（太重），用轻量可靠传输
    transport: LightReliableTransport,
}

/// 轻量传输协议（替代 QUIC，用于 BLE）
struct LightReliableTransport {
    window_size: u8,       // 1-4 即可
    retransmit_ms: u32,
    fragmenter: Fragmenter, // 大帧 → BLE 小包
}
```

---

## 5. L2 连接链路层 Link

在两个节点之间建立可靠、加密、多路复用的连接。

### 5.1 核心结构

```rust
struct LinkLayer {
    /// QUIC endpoint
    quic: quinn::Endpoint,
    /// 活跃连接池
    connections: HashMap<NodeId, PeerConnection>,
    /// 打洞引擎
    hole_puncher: HolePunchEngine,
    /// 中继管理
    relay_manager: RelayManager,
}

struct PeerConnection {
    node_id: NodeId,
    quic_conn: quinn::Connection,
    path: ConnectionPath,
    streams: StreamMultiplexer,
    metrics: ConnectionMetrics,
}

enum ConnectionPath {
    Direct,                                      // 直连
    HolePunched { technique: PunchTechnique },   // 打洞
    Relayed { via: Vec<NodeId> },                // 中继
    Tunneled { bearer: BearerType },             // 伪装隧道
}
```

### 5.2 Stream 多路复用

一条 QUIC 连接上通过 stream 类型 ID 区分不同服务：

```rust
// 预定义 stream 类型
const STREAM_CONTROL: u16   = 0x0000;  // 控制信道
const STREAM_SIGNAL: u16    = 0x0001;  // 信号消息
const STREAM_FILE: u16      = 0x0002;  // 文件传输
const STREAM_AGENT: u16     = 0x0003;  // Agent IO
const STREAM_COMPUTE: u16   = 0x0004;  // 分布式计算
const STREAM_STORAGE: u16   = 0x0005;  // 分布式存储
const STREAM_PROXY: u16     = 0x0006;  // 代理流量
const STREAM_TERMINAL: u16  = 0x0007;  // 终端 PTY
const STREAM_TUNNEL: u16    = 0x0008;  // 通用隧道（sing-box）

/// 开一个新 stream 时，第一个字节标识类型
async fn open_typed_stream(
    conn: &quinn::Connection,
    stream_type: u16,
) -> Result<(SendStream, RecvStream)> {
    let (mut send, recv) = conn.open_bi().await?;
    send.write_all(&stream_type.to_be_bytes()).await?;
    Ok((send, recv))
}
```

### 5.3 NAT 打洞

```rust
struct HolePunchEngine {
    strategies: Vec<Box<dyn PunchStrategy>>,
}
```

国内运营商 NAT 环境下的策略：

| 双方 NAT 类型 | 策略 | 成功率 |
|-------------|------|-------|
| 双方锥形 NAT | 简单 UDP 打洞 | >90% |
| 一方对称 NAT | 端口预测 + 生日攻击 | ~40% |
| 双方对称 NAT | 基本不可能 | <5% |
| 运营商级 CGNAT | 打洞困难 | ~20% |

打洞失败时自动降级为中继。**任何节点都可以做中继**，不只是固定服务器。

### 5.4 连接建立时的能力协商

```rust
struct NodeCapabilities {
    can_relay: bool,
    relay_bandwidth_mbps: u32,
    storage_available_gb: u64,
    compute_cores: u32,
    gpu_vram_mb: u32,
    protocol_version: u32,
    supported_streams: Vec<u16>,
    available_models: Vec<ModelAvailability>,
}
```

### 5.5 使用 libp2p 的最小实现

```toml
[dependencies]
libp2p = { version = "0.54", features = [
    "tokio", "noise", "yamux", "quic",
    "mdns",               # 局域网发现
    "relay", "dcutr",     # 中继 + 打洞
    "kad",                # DHT
    "identify",           # 身份交换
    "request-response",   # 请求-响应
] }
```

---

## 6. L3 路由寻址层 Routing

全局寻址与路由决策。

### 6.1 节点身份与地址

```rust
struct NodeIdentity {
    /// 公钥即身份，不依赖任何中心分配
    public_key: Ed25519PublicKey,
    /// 节点 ID = 公钥的 SHA-256 前 20 字节
    node_id: [u8; 20],
    /// 人类可读名字（可选）
    alias: Option<String>,
}

struct ExoAddress {
    node_id: [u8; 20],
    /// 虚拟 IP（overlay 网络中的地址，便于 sing-box 路由）
    /// 从 NodeId 确定性生成：10.{id[0]}.{id[1]}.{id[2]}
    virtual_ip: Ipv4Addr,
}
```

### 6.2 节点发现：三层机制并行

| 机制 | 范围 | 依赖 |
|------|------|------|
| mDNS | 局域网 | 无，零配置 |
| BLE 广播 | 近场（~10m） | 蓝牙硬件 |
| Kademlia DHT | 广域网 | 至少知道一个 bootstrap 节点 |

节点启动流程：

```rust
async fn bootstrap(&mut self) {
    // 1. mDNS 发现局域网节点
    let local_peers = self.mdns_discover().await;

    // 2. BLE 扫描近场设备
    let ble_peers = self.ble_discover().await;

    // 3. 如果本地没找到，连 bootstrap 节点
    if local_peers.is_empty() && ble_peers.is_empty() {
        self.dht.add_contact("gz-node.exomind.net:9900").await;
    }

    // 4. DHT 查找自己，填充路由表
    self.dht.find_node(self.node_id).await;

    // 5. 定期刷新路由表
    self.dht.start_refresh_loop().await;
}
```

### 6.3 Kademlia DHT 详解

**核心概念**：

- 每个节点有 160-bit ID，距离 = ID 异或（XOR）
- 路由表分 160 个桶，第 i 桶存距离在 2^i ~ 2^(i+1) 的节点，每桶最多 K=20 个
- 查找节点：O(log N) 轮迭代逼近，20 轮可在百万节点中找到目标

**DHT 存储三种数据**：

```
1. 节点位置：key=NodeId, value=公网地址
   → 节点发现

2. 服务声明：key=hash("service:proxy:hk"), value=提供该服务的节点列表
   → 服务发现（"谁有香港代理出口？"）

3. 内容索引：key=文件hash, value=持有该文件的节点列表
   → 分布式存储寻址
```

**路由表维护**：

```rust
fn on_seen_node(&mut self, node: NodeContact) {
    let bucket = &mut self.buckets[self.bucket_for(node.id)];
    if bucket.contains(node.id) {
        bucket.move_to_tail(node.id); // 标记为最近活跃
    } else if bucket.len() < K {
        bucket.push(node);
    } else {
        // 桶满了，ping 最老的节点
        // 活着就保留（长寿节点更可靠），死了就替换
        if !bucket.head().ping().await {
            bucket.replace_head(node);
        }
    }
}
```

### 6.4 流量策略引擎

决定流量怎么走，是代理承载的核心：

```rust
struct TrafficPolicyEngine {
    rules: Vec<TrafficRule>,
}

struct TrafficRule {
    matcher: TrafficMatcher,
    action: TrafficAction,
    priority: u32,
}

enum TrafficMatcher {
    IntraNetwork { dest_node: Option<NodeId> }, // ExoMind 内部
    ExternalDomain { domain_rules: Vec<DomainRule> }, // 外部域名
    ExternalIp { cidr: IpNetwork },             // 外部 IP 段
    Protocol { protocol: ProtocolType },         // 协议类型
    All,
}

enum TrafficAction {
    Direct,                                 // 直连
    ProxyVia { exit_node: NodeId },         // 经出口节点代理
    LoadBalance { exit_nodes: Vec<NodeId> }, // 负载均衡
    Chain { hops: Vec<NodeId> },            // 链式代理
    Reject,                                 // 拒绝
}
```

---

## 7. L4 服务传输层 Service

把 L2 的原始 stream 封装为具体服务。

### 7.1 服务注册

每个节点声明自己提供的服务：

```rust
enum ServiceType {
    Signal,                  // 信号传输（轻量消息）
    FileTransfer,            // 文件传输（大数据，断点续传）
    Stream,                  // 流式推送（Agent 输出、终端流）
    Proxy(ProxyService),     // 代理服务
    Compute(ComputeService), // 分布式计算
    Storage(StorageService), // 分布式存储
    Terminal,                // 终端 PTY
}
```

### 7.2 信号传输

小数据、低延迟，用于指令、状态同步、事件通知：

```rust
struct Signal {
    id: u64,
    timestamp: u64,
    from: NodeId,
    to: SignalTarget,
    payload: SignalPayload,
}

enum SignalTarget {
    Node(NodeId),    // 点对点
    Group(GroupId),  // 组播
    Broadcast,       // 广播（DHT 洪泛，慎用）
}

enum SignalPayload {
    Awareness(AwarenessEvent),
    Choice(ChoiceEvent),
    Action(ActionEvent),
    Record(RecordEvent),
    Feedback(FeedbackEvent),
    AgentCommand(AgentCommand),
    AgentOutput(AgentOutput),
    Custom { topic: String, data: Bytes },
}
```

### 7.3 文件传输

大数据、高吞吐，支持断点续传和多源并行下载：

```rust
struct FileMetadata {
    name: String,
    size: u64,
    blake3_hash: [u8; 32],
    chunk_size: u32,            // 默认 256KB
    chunk_hashes: Vec<[u8; 32]>, // 每块哈希，用于校验和断点续传
}
```

### 7.4 流式推送

Agent 输出、终端流等实时场景：

```rust
struct StreamFrame {
    sequence: u64,
    frame_type: FrameType,
    data: Bytes,
}

enum FrameType {
    Data,
    Heartbeat,
    FlowControl { window: u32 },
    End,
}
```

### 7.5 代理服务

```rust
struct ProxyService {
    is_exit_node: bool,
    exit_info: Option<ExitNodeInfo>,
    singbox_manager: Option<SingBoxManager>,
}

struct ExitNodeInfo {
    line_type: LineType,     // Direct / IPLC / IEPL / BGP
    region: String,
    bandwidth_mbps: u32,
    supported_protocols: Vec<ProxyProtocol>, // SS / VMess / VLESS / Trojan / Hysteria2
}
```

### 7.6 分布式计算

```rust
struct ComputeTask {
    task_id: u64,
    task_type: ComputeType,
    input: TaskInput,
    requirements: ResourceReq,
}

enum ComputeType {
    /// Agent 推理
    AgentInference { model: String, messages: Vec<Message>, stream: bool },
    /// 代码执行
    CodeExecution { runtime: Runtime, code: String, sandbox: SandboxConfig },
    /// WASM 沙箱任务
    WasmTask { wasm_module_hash: [u8; 32], entry: String, args: Vec<Value> },
}

struct ResourceReq {
    min_memory_mb: u32,
    needs_gpu: bool,
    min_gpu_vram_mb: u32,
    max_duration_secs: u32,
}
```

### 7.7 分布式存储

内容寻址 + DHT 索引：

```rust
struct Block {
    hash: Blake3Hash,     // blake3(data)，内容即地址
    data: Bytes,          // 最大 256KB
    links: Vec<BlockLink>, // 引用其他 block（组合大文件/目录）
}

/// 可变数据：签名指针
struct MutableRecord {
    publisher: NodeId,
    path: String,              // "/exomind/events/latest"
    content_hash: Blake3Hash,
    sequence: u64,             // 单调递增，防回滚
    signature: Ed25519Signature,
}
```

存储/获取流程：

```
存储：本地写入 → DHT 宣告 "我有这个 block" → 按策略复制到其他节点
获取：查本地 → DHT 查 provider → 从最快节点拉取 → 校验哈希 → 本地缓存
```

---

## 8. L5 会话管理层 Session

管理认证、权限、会话生命周期。

### 8.1 会话类型与权限

```rust
enum SessionType {
    OwnDevice,                              // 自己的设备，最高权限
    TrustedPeer { trust_level: TrustLevel }, // 受信任的朋友/同事
    ProxyClient,                            // 只能用代理服务
    ComputeWorker,                          // 只能在沙箱内执行
    Anonymous,                              // 匿名/临时
}

struct Permissions {
    can_execute_code: bool,
    can_access_filesystem: bool,
    can_use_proxy: bool,
    can_use_compute: bool,
    can_access_storage: bool,
    allowed_paths: Vec<PathBuf>,
    bandwidth_limit: Option<u64>,
    proxy_permissions: ProxyPermissions,
}
```

### 8.2 设备配对流程

```
1. 两台设备在近距离（同WiFi / 扫码 / 输入配对码）
2. 用 PAKE（SPAKE2）协议交换密钥：
   - 配对码作为共享秘密
   - 派生出共享密钥
   - 中间人无法破解（不知道配对码）
3. 交换公钥，签名验证
4. 双方存储对方公钥，标记为 OwnDevice
5. 此后通信只认公钥，不需要第三方
```

---

## 9. L6 编码表示层 Representation

统一处理序列化、压缩、加密信封。

### 9.1 帧格式

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Magic(2) │ Flags(1) │ Nonce(8) │ Len(4)   │ TypeId(2)│ Payload  │
│ 0xEE 0x4D│          │ 防重放   │ 负载长度  │ 消息类型  │ 序列化数据│
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
  "EM" = ExoMind

Flags (bitflags):
  bit 0: COMPRESSED   负载已压缩（zstd）
  bit 1: ENCRYPTED    端到端加密（默认开启，所有设备间通信均加密）
  bit 2: FRAGMENTED   大消息分片
  bit 3: STREAM       流式消息
  bit 4: PRIORITY     高优先级
```

### 9.2 编解码流程

```
编码：上层消息 → MessagePack序列化 → zstd压缩(>1KB时) → E2E加密（默认开启） → 组帧
解码：拆帧 → 解密 → 解压 → MessagePack反序列化 → 上层消息
```

---

## 10. L7 认知应用层 Cognitive

ExoMind 特有的应用语义，协议栈最高层。

### 10.1 认知循环事件

```rust
struct CognitiveEvent {
    id: EventId,               // ULID，时间有序+全局唯一
    timestamp: u64,
    origin_node: NodeId,
    phase: CognitivePhase,
    content_ref: ContentRef,   // 内容哈希（存在分布式存储中）
    caused_by: Vec<EventId>,   // 因果链
    vector_clock: VectorClock, // 多设备因果序
}

enum CognitivePhase {
    Awareness(AwarenessData),  // 觉察
    Choice(ChoiceData),        // 选择
    Action(ActionData),        // 行动
    Record(RecordData),        // 记录
    Feedback(FeedbackData),    // 反馈
}
```

设备间同步用 **CRDT（无冲突复制数据类型）** 保证多设备并发不冲突。

### 10.2 Agent 管理

```rust
struct AgentSession {
    id: SessionId,
    execution_node: NodeId, // Agent 在哪个节点执行
    control_node: NodeId,   // 控制端在哪
    config: AgentConfig,
}

struct AgentConfig {
    model: String,
    api_backend: ApiBackend,
    workspace: PathBuf,
    tools: Vec<ToolConfig>,
    sandbox: SandboxConfig,
}
```

### 10.3 节点编排

```rust
struct NodeOrchestrator {
    node_capabilities: HashMap<NodeId, NodeCapabilities>,
}

impl NodeOrchestrator {
    fn select_node(&self, task: &TaskRequirements) -> NodeId {
        // 评分：资源匹配 × 网络延迟 × 当前负载 × 信任等级 × API key 可用性
        self.node_capabilities.iter()
            .filter(|(_, cap)| cap.satisfies(task))
            .max_by_key(|(_, cap)| cap.score_for(task))
            .map(|(id, _)| *id)
            .unwrap_or(self.local_node_id)
    }
}
```

---

## 11. 安全体系

### 11.1 核心原则

**不依赖任何第三方 CA。** 安全性来自密码学原语，不来自外部权威。

```
传统 CA 体系：第三方说你是你 → 中心化 → 他创生
ExoMind：    你自己证明你是你 → 去中心化 → 自创生
```

### 11.2 身份体系

```
节点启动 → 生成 Ed25519 密钥对
公钥 = 身份（NodeId = SHA-256(公钥) 前20字节）
私钥 = 证明能力
```

### 11.3 威胁防御

| 威胁 | 防御 | 需要 CA |
|------|------|--------|
| 中间人攻击（首次连接） | PAKE/SAS 配对码验证 | 不需要 |
| 中间人攻击（后续连接） | 公钥绑定 Key Pinning | 不需要 |
| 重放攻击 | QUIC 序列号 + 消息层 nonce + 业务幂等 | 不需要 |
| 身份冒充 | 挑战-签名验证 | 不需要 |
| 节点被劫持 | 自签名密钥吊销 + DHT 广播 | 不需要 |
| Eclipse 攻击（DHT） | 路由表多样性 + 签名验证 + 多路径查询 | 不需要 |

### 11.4 中间人防御详解

**首次配对**（PAKE 协议）：

```
1. 手机生成随机 6 位配对码，显示在屏幕上
2. 用户在电脑上输入配对码
3. 双方用配对码运行 SPAKE2 协议
4. 配对码正确 → 双方得到相同共享密钥
5. 中间人不知道配对码 → 无法得到正确密钥
6. 用共享密钥加密公钥交换
```

**后续连接**（Key Pinning）：

```
手机收到连接请求 → 对方出示公钥
→ 检查：这个公钥是配对时存的那个吗？
→ 是 → 通过
→ 不是 → 拒绝（有人冒充）
```

### 11.5 重放防御详解

三层防御：

```
第一层：QUIC/TLS 包序列号 + AEAD
  → 重复序列号自动丢弃

第二层：ExoMind 帧 nonce（8字节随机数）
  → 接收方维护已见 nonce 集合
  → 重复 nonce 丢弃
  → 超时窗口（5分钟）后清除旧 nonce

第三层：业务层幂等
  → 认知事件有全局唯一 ID（ULID），相同 ID 只处理一次
  → Agent 指令有 request_id，执行过的返回缓存结果
```

### 11.6 密钥吊销

```
设备被盗/被黑 → 在其他设备上操作"移除此设备"
→ 将该公钥加入黑名单
→ 用主密钥签名吊销声明
→ 通过 DHT 广播
→ 网络中其他节点拒绝该公钥
```

---

## 12. DHT 自发现原理

### 12.1 核心思想

每个节点只存一小部分信息，大家合作拼出全局。离自己近的区域知道得详细，远的区域只知道几个代表。

### 12.2 XOR 距离

```
距离(A, B) = A.node_id XOR B.node_id
```

不是物理距离，是数学距离。对任意目标，ID 空间可按距离逐层减半划分。

### 12.3 K-桶路由表

```
160 个桶，第 i 个桶存距离在 [2^i, 2^(i+1)) 的节点，每桶最多 K=20 个

效果：
  桶0:   距离 1       （最多1个可能的ID）  存 ≤20 个
  桶1:   距离 2-3     （2个可能）          存 ≤20 个
  ...
  桶159: 距离 2^159+  （一半的ID空间）     存 ≤20 个
```

### 12.4 查找过程

```
想找节点 T：
1. 从路由表找离 T 最近的 α=3 个节点
2. 并行问它们："你知道谁离 T 更近？"
3. 拿到结果，继续问更近的
4. 重复，直到找到 T 或不能更近
→ O(log N) 轮，20 轮找遍百万节点
```

### 12.5 数据存储

```
存：找到离 key 最近的 K 个节点，把数据交给它们保管
取：找到离 key 最近的节点，问它们要数据
```

---

## 13. 任务迁移机制

### 13.1 可迁移任务

```rust
struct MigratableTask {
    task_id: TaskId,
    spec: TaskSpec,         // 任务定义（不可变）
    state: TaskState,       // 可序列化的 checkpoint
    migration_policy: MigrationPolicy,
}

struct TaskState {
    conversation: Vec<Message>, // Agent 上下文
    execution_step: u64,
    artifacts: Vec<ContentRef>, // 工作产物
    checkpoint_at: u64,
}

enum MigrationPolicy {
    Manual,
    AutoOnShutdown { prefer: Vec<NodeClass>, timeout_secs: u32 },
    FollowBest { scoring: ScoringCriteria, cooldown_secs: u32 },
}
```

### 13.2 关机自动迁移流程

```
1. 检测到关机信号（OS shutdown hook）
2. 遍历本地任务，检查 migration_policy
3. 对每个需要迁移的任务：
   a. 序列化 TaskState → checkpoint
   b. 上传 checkpoint 到分布式存储
   c. DHT 查找合适目标节点（优先 Persistent 节点）
   d. 发送迁移请求
   e. 目标节点确认接收
4. 全部迁移完成（或超时），正常关机

目标节点（如广州 VPS）：
1. 收到迁移请求
2. 从分布式存储拉取 checkpoint
3. 恢复 TaskState，继续执行
4. 产出结果同步到分布式存储

用户次日开机：
1. 节点上线，通知网络
2. 查看任务状态
3. 可选择迁移回本地或继续远端执行
```

---

## 14. sing-box 集成与代理承载

### 14.1 代理流量路径

```
┌─ 本地设备 ─────────────────────────────────────────┐
│                                                     │
│  App → tun:exomind0 → sing-box(本地) → 路由判断     │
│                          │                          │
│              ┌───────────┼───────────┐              │
│              ▼           ▼           ▼              │
│          直连出去     ExoMind代理   ExoMind代理      │
│         (国内网站)    (走HK节点)    (走US节点)       │
└──────────────┼───────────┼──────────────────────────┘
               │           │
  QUIC 隧道 (L2)          QUIC 隧道 (L2)
               │           │
        ┌──────▼──┐  ┌─────▼───┐
        │ HK 节点  │  │ US 节点  │
        │sing-box │  │sing-box  │
        │  出口    │  │  出口    │
        └────┬────┘  └────┬────┘
             ▼            ▼
          互联网        互联网
```

### 14.2 sing-box 管理器

```rust
struct SingBoxManager {
    binary_path: PathBuf,
    instance: Option<SingBoxInstance>,
    config_builder: SingBoxConfigBuilder,
}

impl SingBoxManager {
    /// ExoMind 流量策略 → sing-box 配置
    fn build_config(&self,
        traffic_policy: &TrafficPolicyEngine,
        exit_nodes: &[ExitNodeInfo],
    ) -> SingBoxConfig { ... }

    /// 运行时热更新（新节点加入/退出时）
    async fn hot_reload(&self, new_config: SingBoxConfig) -> Result<()> { ... }
}
```

### 14.3 远程 sing-box 管控

通过 L4 Compute 服务远程操作任意节点上的 sing-box：

```rust
enum SingBoxCommand {
    Deploy { binary_hash: Blake3Hash },
    UpdateConfig { config: SingBoxConfig },
    AddUser { user_id: String, quota_gb: f64 },
    RemoveUser { user_id: String },
    GetStatus,
    GetTrafficStats { user_id: Option<String> },
    Start, Stop, Restart,
}
```

---

## 15. 组件拆分与 Crate 结构

```
exomind/                          # 顶层 workspace
│
├── exomind-core/                 # 公共基础
│   ├── identity.rs               #   NodeId, 密钥, 签名
│   ├── types.rs                  #   公共枚举, 错误类型
│   └── config.rs                 #   配置结构
│
├── exomind-net/                  # 网络协议栈 (L1-L3)
│   ├── bearer/                   #   L1 承载层
│   │   ├── udp.rs
│   │   ├── bluetooth.rs
│   │   ├── ble.rs
│   │   └── local.rs
│   ├── link/                     #   L2 连接层
│   │   ├── quic.rs
│   │   ├── punch.rs
│   │   ├── relay.rs
│   │   ├── multiplex.rs
│   │   └── light.rs              #     BLE 轻量传输
│   ├── routing/                  #   L3 路由层
│   │   ├── dht.rs
│   │   ├── mdns.rs
│   │   ├── ble_discover.rs
│   │   └── traffic.rs
│   └── repr/                     #   L6 表示层
│       ├── frame.rs
│       ├── codec.rs
│       └── envelope.rs
│
├── exomind-session/              # L5 会话层
│   ├── auth.rs
│   ├── pairing.rs
│   ├── acl.rs
│   └── session.rs
│
├── exomind-svc/                  # L4 服务层
│   ├── signal/
│   ├── file/
│   ├── proxy/
│   │   └── singbox.rs
│   ├── compute/
│   │   ├── scheduler.rs
│   │   ├── migration.rs
│   │   └── sandbox.rs
│   ├── storage/
│   │   ├── block.rs
│   │   ├── provider.rs
│   │   └── mutable.rs
│   └── terminal/
│
├── exomind-rt/                   # L7 认知运行时（已有）
│   ├── cognitive/
│   ├── agent/
│   ├── orchestrator/
│   └── crdt/
│
├── exomind-embedded/             # 嵌入式精简版 (no_std)
│   ├── ble_node.rs
│   ├── sensor.rs
│   └── light_cognitive.rs
│
├── exomind-app/                  # Tauri 桌面/移动端
├── exomind-node/                 # 完整节点程序
│   ├── desktop.rs
│   ├── server.rs
│   └── mobile.rs
│
└── exomind-cli/                  # 命令行工具
```

### Feature Flags

```toml
# exomind-net/Cargo.toml
[features]
default = ["quic", "mdns"]
quic = ["quinn"]
bluetooth = ["btleplug"]
ble-only = ["bluetooth"]     # 纯 BLE 嵌入式
full = ["quic", "bluetooth", "mdns"]

# exomind-svc/Cargo.toml
[features]
default = ["signal", "file"]
proxy = ["singbox-api"]
compute = ["wasmtime"]
storage = []
all = ["signal", "file", "proxy", "compute", "storage", "terminal"]
```

### 层间依赖关系

```
exomind-rt（L7 认知运行时）
    │ 依赖
    ▼
exomind-svc（L4 服务层）
    │ 依赖
    ▼
exomind-session（L5 会话层）
    │ 依赖
    ▼
exomind-net（L1-L3 + L6 网络栈）
    │ 依赖
    ▼
exomind-core（基础类型）
```

---

## 16. 实现路线图

### 第一阶段：最小组网（2周）

```
目标：两台设备通过 P2P 传消息

Week 1 - 局域网
├── rust-libp2p 集成（QUIC + mDNS + request-response）
├── 同 WiFi 下自动发现并传消息
└── 接入 Tauri 前端

Week 2 - 广域网
├── 广州 VPS 跑 relay + bootstrap 节点
├── 加入 Kademlia DHT + dcutr 打洞
└── 不同网络下的两台设备能通信
```

### 第二阶段：功能上网（2周）

```
目标：已有功能通过网络同步

├── 认知事件通过 P2P 同步到对端
├── CRDT 合并多设备事件
├── 任务管理 + 时间块跨设备可见
```

### 第三阶段：远程 Agent（2周）

```
目标：手机操控电脑跑 Agent

├── Agent IO stream 实现
├── 手机发指令 → 电脑执行 → 流式结果回传
├── 终端 PTY 远程访问
```

### 第四阶段：任务迁移（2周）

```
目标：关机 → 任务转移 → 恢复

├── TaskState checkpoint 序列化
├── 迁移协议实现
├── 广州 VPS 接收并继续执行
```

### 第五阶段：代理与存储（持续）

```
├── sing-box 集成
├── 分布式存储 block store
├── BLE 嵌入式支持
```

---

## 17. 与现有方案对比

| 维度 | libp2p | Tailscale | Nebula | ZeroTier | IPFS | ExoMind-Net |
|------|--------|-----------|--------|----------|------|-------------|
| 定位 | P2P 网络库 | Mesh VPN | Mesh VPN | L2 虚拟网络 | 分布式文件系统 | 认知网络协议栈 |
| 去中心化程度 | 完全 | 需要协调服务器 | 需要 lighthouse | 需要控制器 | 完全 | 完全 |
| 认知/应用层 | 无 | 无 | 无 | 无 | 无 | 有（L7） |
| Agent 支持 | 无 | 无 | 无 | 无 | 无 | 有 |
| 任务迁移 | 无 | 无 | 无 | 无 | 无 | 有 |
| BLE/嵌入式 | 有限 | 无 | 无 | 无 | 无 | 有 |
| 代理承载 | 无 | 有（exit node） | 无 | 无 | 无 | 有（sing-box） |
| 语言 | Rust/Go/JS | Go | Go | C++ | Go | Rust |
| 与 ExoMind 关系 | L1-L2 基础 | 参考 | 参考 | — | L4 存储参考 | 核心组件 |

**ExoMind-Net 基于 rust-libp2p 构建 L1-L2，在其上实现 L3-L7 的独创部分。**

---

## 附录 A：术语表

| 术语 | 含义 |
|------|------|
| NodeId | 节点身份标识，Ed25519 公钥的 SHA-256 前 20 字节 |
| Bearer | L1 承载类型（UDP/TCP/BLE 等） |
| Stream | QUIC 连接内的多路复用通道 |
| DHT | 分布式哈希表（Kademlia），用于节点发现和数据索引 |
| PAKE | 密码认证密钥交换，用于设备配对 |
| CRDT | 无冲突复制数据类型，用于多设备状态同步 |
| TOFU | Trust On First Use，首次使用时建立信任 |
| Key Pinning | 公钥绑定，将对端身份绑定到已知公钥 |
| Checkpoint | 任务状态的可序列化快照，用于迁移 |
| Block | 分布式存储的基本单位，内容寻址（hash=地址） |

## 附录 B：命名约定

- **项目全名**：exomind-（如 exomind-net, exomind-rt）
- **代码内部模块缩写**：exm（如 exm::net::Link）
- **协议栈缩写**：EPS（ExoMind Protocol Stack）
- **帧魔数**：0xEE 0x4D（"EM" = ExoMind）

---

> 本文档基于认知生命科学的理论框架设计。
> ExoMind 是一个开源项目，代码属于所有人。
