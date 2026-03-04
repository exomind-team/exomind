# ExoMind Communication Stack (ECS) - 通信协议栈架构

> **Status**: v1.0 (Confirmed)
> **Date**: 2026-03-04
> **Author**: Architect Agent (Claude Opus 4.6)
> **Origin**: Starlin + 吴震宇 架构讨论 → 软总线 vs Pub/Sub 辩证分析 → 协议栈设计
> **命名**: ECS (正式) / Axon (代号)

---

## 0. 背景与动机

### 0.1 核心问题

ExoMind RT 当前实现了单进程内的 topic-based pub/sub 信号路由（SignalPool），但未来需要支持：
- 多个 RT 实例跨设备组网（桌面/手机/嵌入式）
- 异构传输层（WiFi/BLE/USB/LoRa）
- 去中心化发现与连接

### 0.2 "软总线"与"Pub/Sub"的关系

| 概念 | 定义 | ExoMind 对应 |
|------|------|-------------|
| **Pub/Sub** | 消息传递范式：publisher → topic → subscriber，broker 匹配投递 | SignalPool (ECS-5)，已实现 |
| **软总线** | 平台级 IPC 抽象：统一发现 + 连接 + 传输，屏蔽底层差异 | ECS-3 组网层，未来实现 |

**结论**：Pub/Sub 是软总线的一种通信模式，软总线是更大的平台抽象。ExoMind 两者都需要，分层设计，不二选一。

---

## 1. 命名

| 属性 | 值 |
|------|-----|
| **正式名称** | ExoMind Communication Stack (**ECS**) |
| **中文名** | 外心通信栈 |
| **项目代号** | **Axon**（轴突——神经元传导信号的长突起，负责长距离信号传递） |

> ECS 是工程架构名称，Axon 是项目代号。文档和代码中统一使用 ECS 层级编号（ECS-1 ~ ECS-7），组网协议模块代号 Axon。

---

## 2. 协议栈总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   ExoMind Communication Stack (ECS)                      │
│                                                                         │
│  ┌─────────┬───────────────────────────────────────────────────────┐   │
│  │ ECS-7   │  应用语义层 (Application Semantics)                    │   │
│  │ ≈OSI 7  │  Agent 业务逻辑: classifier / reviewer / knowledge    │   │
│  │         │  状态: 部分实现                                        │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-6   │  信号契约层 (Signal Contract)                          │   │
│  │ ≈OSI 6  │  SignalEvent schema + 序列化 + 版本协商                │   │
│  │         │  状态: 已实现                                          │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-5   │  信号路由层 (Signal Routing) ← "Pub/Sub"              │   │
│  │ ≈OSI 5  │  SignalPool = Bus + RouteTable + Journal + Window     │   │
│  │         │  状态: 已实现                                          │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-4   │  会话管理层 (Session Management)                       │   │
│  │ ≈OSI 5  │  SSE 连接生命周期 + Agent 注册/存活 + 心跳             │   │
│  │         │  状态: 已实现                                          │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-3   │  组网层 (Mesh / Discovery) ← "软总线"                  │   │
│  │ ≈OSI 3  │  RT 间自发现 + 信道建立 + 信号中继                     │   │
│  │         │  状态: 未实现 (预留: origin_host_id, hop)               │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-2   │  传输抽象层 (Transport Abstraction)                    │   │
│  │ ≈OSI 4  │  统一 Transport trait 屏蔽底层差异                     │   │
│  │         │  状态: 部分实现 (仅 HTTP/SSE)                           │   │
│  ├─────────┼───────────────────────────────────────────────────────┤   │
│  │ ECS-1   │  物理链路层 (Physical Link)                            │   │
│  │ ≈OSI1-2 │  TCP/WiFi/BLE/NearLink/LoRa/USB/IPC                  │   │
│  │         │  状态: 已有 TCP                                        │   │
│  └─────────┴───────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. ECS-1: 物理链路层 (Physical Link)

### 3.1 总览

ExoMind 的愿景是跨越各种设备和通讯方式。ECS-1 覆盖所有可能的物理通信手段。

**核心原则**：ExoMind 不实现物理层协议，而是依赖操作系统/硬件驱动提供的接口。ECS-2 (Transport Abstraction) 屏蔽这些差异。

### 3.2 通信方式全览

#### A. WiFi (TCP/UDP over 802.11)

| 属性 | 说明 |
|------|------|
| **适用场景** | 桌面↔桌面、桌面↔手机（同一局域网），ExoMind 当前主要通信方式 |
| **带宽** | 100 Mbps ~ 1 Gbps (WiFi 5/6) |
| **延迟** | 1-10 ms (局域网) |
| **功耗** | 中等（适合持续供电设备） |
| **范围** | 10-100m（室内） |
| **Rust 生态** | `tokio::net` (TCP/UDP，已使用)，`socket2` (底层 socket 控制) |
| **对 ECS 上层影响** | 无——当前架构就是基于 TCP 的，零适配成本 |
| **当前状态** | **已实现** — `tokio::net::TcpListener` (main.rs) |

#### B. WiFi Mesh (802.11s / ESP-MESH)

| 属性 | 说明 |
|------|------|
| **适用场景** | 无路由器的嵌入式组网，多个 ExoMind 边缘节点（如智能家居传感器）自组织 |
| **带宽** | 10-50 Mbps (取决于拓扑跳数) |
| **延迟** | 10-100 ms (多跳累积) |
| **功耗** | 中等 |
| **范围** | 单跳 10-100m，多跳理论无限 |
| **Rust 生态** | `esp-wifi` (ESP32 WiFi 驱动)，Ferris-on-Air (FoA) 项目正在实现 802.11s Rust 驱动（实验性） |
| **对 ECS 上层影响** | ECS-3 组网层需要感知 mesh 拓扑——mesh 网络本身提供了部分发现和路由能力，ECS-3 可以与之协作而非重复 |
| **当前状态** | 未实现。**远期需求**——当 ExoMind 进入嵌入式场景时考虑 |

#### C. 蓝牙 BLE (Bluetooth Low Energy 5.0+)

| 属性 | 说明 |
|------|------|
| **适用场景** | 手机↔手表/穿戴设备、手机↔IoT 传感器，低功耗短距通信 |
| **带宽** | 1-2 Mbps (BLE 5.0), 理论峰值 |
| **延迟** | 7.5 ms (连接间隔最小值) |
| **功耗** | **极低**——这是 BLE 的核心优势，穿戴设备可运行数月 |
| **范围** | 10-100m (BLE 5.0 增强范围) |
| **Rust 生态** | **`btleplug` v0.11.8** — 跨平台 BLE GATT 库（Windows/macOS/Linux/iOS/Android），async API，最成熟的选择。**`bluest`** — 备选跨平台 BLE 库。**`bluer`** — Linux BlueZ 官方 Rust 绑定 |
| **对 ECS 上层影响** | BLE MTU 限制（默认 23 字节，协商后最大 512 字节）要求 ECS-2 实现**分帧/重组**；ECS-6 可能需要二进制编码（MessagePack/CBOR）替代 JSON 以节省带宽 |
| **当前状态** | 未实现。**近期需求**——手机端 ExoMind 连接穿戴设备时需要 |
| **Tauri 集成** | `tauri-plugin-blec` 已有社区插件 |

#### D. 星闪 NearLink (华为)

| 属性 | 说明 |
|------|------|
| **适用场景** | 低延迟短距通信（车钥匙、人机交互、智能家居），华为 HarmonyOS 生态内设备互联 |
| **带宽** | 最高 920 Mbps (NearLink 2.0) |
| **延迟** | **<20 us 空口时延**——远超 BLE (7.5ms) 和 WiFi (1ms) |
| **功耗** | 低（介于 BLE 和 WiFi 之间） |
| **范围** | ~600m（是 BLE 的 2 倍） |
| **可靠性** | >99.999% 传输可靠性 |
| **连接数** | 最多 4096 设备（BLE 仅 8 个） |
| **Rust 生态** | **无原生 Rust crate**。目前仅有 `Nearlink Toolbox`（基于 Rust + Tauri 的调试工具，非协议栈实现）。NearLink 生态绑定海思芯片和官方 SDK，短期内不会有开源 Rust 协议栈 |
| **对 ECS 上层影响** | 如果接入 NearLink，需要通过 FFI 调用厂商 C SDK，ECS-2 的 Transport trait 实现会更复杂。但对 ECS-3 以上透明 |
| **当前状态** | 未实现。**观望**——等待 NearLink 生态成熟和开源 SDK 出现 |

**NearLink vs BLE 对比**：

```
                 BLE 5.0          NearLink 2.0
带宽            1-2 Mbps          920 Mbps
延迟            7.5 ms            <20 us
范围            10-100m           ~600m
连接数          8                 4096
功耗            极低              低
生态成熟度      非常成熟          早期（华为主导）
Rust 支持       btleplug          无
开放性          开放标准          联盟标准（渐进开放）
```

#### E. LoRa / LoRaWAN (长距离低功耗无线电)

| 属性 | 说明 |
|------|------|
| **适用场景** | 超长距离低带宽通信——户外传感器、野外作业节点、灾难应急通信 |
| **带宽** | **0.3 - 50 kbps**（极低，只适合小数据包） |
| **延迟** | 100 ms - 数秒（取决于配置） |
| **功耗** | **极低**——电池可运行数年 |
| **范围** | **2-15 km**（城市），**15-45 km**（开阔地带） |
| **Rust 生态** | **`lora-rs` 生态** — 包含 `lora-phy`（物理层驱动，支持 SX126x/SX127x 芯片）、`lorawan-device`（LoRaWAN 协议栈，异步）、`lorawan-encoding`（包编解码）。基于 `embedded-hal-async`，主要用于嵌入式（no_std） |
| **对 ECS 上层影响** | **极低带宽**要求：ECS-6 必须使用极度紧凑的编码（CBOR 或自定义二进制）；ECS-5 的 SignalEvent 需要精简版（只传关键字段）；ECS-3 的发现协议不能用 mDNS（无 IP 网络），需要 LoRa 自定义 beacon |
| **当前状态** | 未实现。**远期探索**——特殊场景（户外/应急）才需要 |

#### F. USB / Serial (有线直连)

| 属性 | 说明 |
|------|------|
| **适用场景** | 嵌入式设备调试、Android OTG 直连、树莓派等 SBC 有线通信 |
| **带宽** | Serial: 115200 bps ~ 921600 bps；USB 2.0: 480 Mbps；USB 3.0: 5 Gbps |
| **延迟** | <1 ms（有线直连） |
| **功耗** | 极低（USB 供电） |
| **范围** | 物理线缆长度（1-5m） |
| **Rust 生态** | **`tokio-serial`** — tokio 异步串口 I/O，跨平台（Windows/Linux/macOS）。**`serialport-rs`** — 底层跨平台串口库（阻塞式）。**`serial2-tokio`** — 备选异步串口，支持并发读写 |
| **对 ECS 上层影响** | 串口是字节流，需要 ECS-2 实现帧定界（如 COBS 编码或长度前缀）。USB 虚拟串口 (CDC) 对上层透明 |
| **当前状态** | 未实现。**近期需求**——嵌入式开发调试场景 |

#### G. IPC (进程间通信 — 同机)

| 属性 | 说明 |
|------|------|
| **适用场景** | 同一台机器上多个 ExoMind 进程间通信（RT ↔ Agent 进程、RT ↔ Tauri 前端） |
| **带宽** | 几乎无限（受内存带宽限制，通常 >10 Gbps） |
| **延迟** | **<1 us**（共享内存），**10-100 us**（Unix Socket / Named Pipe） |
| **功耗** | 极低（无网络 I/O） |
| **范围** | 同一台机器 |

**IPC 子类型**：

| 方式 | 平台 | Crate | 特点 |
|------|------|-------|------|
| **Unix Domain Socket** | Linux/macOS | `tokio::net::UnixStream` | 最成熟，与 TCP 接口一致，零配置 |
| **Named Pipe** | Windows | `tokio::net::windows::named_pipe` | Windows 等价物，API 略不同 |
| **Shared Memory** | Linux (主要) | `shmipc` (ByteDance)，`shmem-ipc`，`ipc-channel` (Servo) | 零拷贝，性能最高（10x vs socket），但安全性/恢复复杂 |
| **io_uring** | Linux 5.1+ | `tokio-uring` | 内核级异步 I/O，极低延迟 |

| 属性 | 说明 |
|------|------|
| **对 ECS 上层影响** | IPC 与 TCP 在 API 层面近乎一致（都是字节流），ECS-2 的 Transport trait 可以用同一接口覆盖。共享内存需要特殊处理（零拷贝语义） |
| **当前状态** | 未实现（当前 RT ↔ Agent 通过 HTTP/SSE over localhost）。**近期优化**——同机场景应优先用 Unix Socket/Named Pipe 替代 HTTP，减少序列化开销 |

**推荐 IPC 策略**：

```
同机 Agent (进程外):
  近期: Unix Domain Socket / Named Pipe (跨平台统一，tokio 原生支持)
  远期: 共享内存 (高频信号场景，如实时音视频)

同进程 Actor (进程内):
  当前: tokio::broadcast channel (已实现，零网络开销)
```

### 3.3 通信方式对比矩阵

```
            带宽         延迟        功耗    范围       Rust 成熟度  ExoMind 优先级
            ─────────    ────────    ─────   ─────────  ──────────  ─────────────
WiFi TCP    100M-1G      1-10ms     中      10-100m    已使用       P0 (当前)
IPC         >10 Gbps     <100us     极低    同机       成熟         P1 (近期)
USB/Serial  115k-5G      <1ms       极低    1-5m       成熟         P2 (近期)
BLE         1-2 Mbps     7.5ms      极低    10-100m    成熟         P2 (近期)
WebSocket   100M-1G      1-10ms     中      10-100m    成熟         P2 (近期)
WiFi Mesh   10-50M       10-100ms   中      多跳无限   实验性       P3 (中期)
NearLink    920 Mbps     <20us      低      600m       无           P4 (观望)
LoRa        0.3-50k      100ms+     极低    2-45km     嵌入式成熟   P5 (远期)
```

### 3.4 Crate 选型汇总

| 通信方式 | 推荐 Crate | 备选 | 备注 |
|---------|-----------|------|------|
| WiFi TCP/UDP | `tokio::net` | `socket2` | 已在用 |
| WiFi Mesh | `esp-wifi` | FoA (实验性) | 嵌入式 only |
| BLE | `btleplug` | `bluest`, `bluer` | 跨平台首选 |
| NearLink | 无 (FFI) | Nearlink Toolbox | 等待生态 |
| LoRa | `lora-phy` + `lorawan-device` | `radio-sx127x` | no_std 嵌入式 |
| USB/Serial | `tokio-serial` | `serial2-tokio` | 跨平台 |
| Unix Socket | `tokio::net::UnixStream` | - | Linux/macOS |
| Named Pipe | `tokio::net::windows::named_pipe` | - | Windows |
| Shared Memory | `ipc-channel` | `shmipc`, `shmem-ipc` | 高性能 IPC |
| mDNS 发现 | `mdns-sd` | `simple-mdns`, `libmdns` | 零配置 LAN 发现 |

---

## 4. ECS-2: 传输抽象层 (Transport Abstraction)

### 4.1 职责

屏蔽 ECS-1 物理层差异，为 ECS-3+ 提供统一的帧发送/接收接口。

### 4.2 核心 trait 设计

```rust
use std::time::Duration;

/// 对端标识
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub struct PeerId(pub String);

/// 传输类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TransportKind {
    /// TCP over WiFi/Ethernet (当前已有)
    Tcp,
    /// WebSocket (双向，替代 SSE)
    WebSocket,
    /// Unix Domain Socket / Named Pipe (同机 IPC)
    Ipc,
    /// Bluetooth Low Energy
    Ble,
    /// NearLink (华为星闪)
    NearLink,
    /// LoRa / LoRaWAN (长距无线电)
    LoRa,
    /// USB / Serial
    Serial,
}

/// 传输层能力声明
pub struct TransportCapabilities {
    pub kind: TransportKind,
    pub max_frame_size: usize,       // 最大帧大小 (BLE: 512, LoRa: 256, TCP: 65535)
    pub supports_fragmentation: bool, // 是否需要 ECS-2 帮忙分帧
    pub is_reliable: bool,            // 底层是否可靠传输 (TCP: true, LoRa: false)
    pub is_ordered: bool,             // 底层是否保序 (TCP: true, BLE: per-connection)
    pub typical_latency: Duration,    // 典型延迟
    pub typical_bandwidth_bps: u64,   // 典型带宽 (bits/sec)
}

/// ECS-2: 统一传输接口
#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// 传输能力声明
    fn capabilities(&self) -> TransportCapabilities;

    /// 连接到对端（主动建连）
    async fn connect(&self, addr: &str) -> Result<PeerId, TransportError>;

    /// 接受对端连接（被动监听）
    async fn accept(&self) -> Result<PeerId, TransportError>;

    /// 发送一帧数据
    async fn send(&self, peer: &PeerId, frame: &[u8]) -> Result<(), TransportError>;

    /// 接收一帧数据
    async fn recv(&self) -> Result<(PeerId, Vec<u8>), TransportError>;

    /// 关闭与对端的连接
    async fn disconnect(&self, peer: &PeerId) -> Result<(), TransportError>;

    /// 检查对端连接是否存活
    fn is_connected(&self, peer: &PeerId) -> bool;
}

/// 帧头 (ECS-2 在字节流传输上加的定界)
///
/// 对于字节流传输 (TCP, Serial, IPC)，需要帧定界：
/// [magic: 2B][version: 1B][flags: 1B][length: 4B][payload: NB][crc: 2B]
///
/// 对于消息传输 (BLE GATT, WebSocket)，天然是消息边界的，不需要帧头。
pub struct FrameHeader {
    pub magic: [u8; 2],        // 0xEX 0x0M ("EXoMind")
    pub version: u8,           // 帧协议版本
    pub flags: FrameFlags,     // 压缩/加密/分片标志
    pub length: u32,           // payload 长度
}

bitflags::bitflags! {
    pub struct FrameFlags: u8 {
        const COMPRESSED  = 0b0000_0001;  // payload 已压缩 (zstd)
        const ENCRYPTED   = 0b0000_0010;  // payload 已加密
        const FRAGMENTED  = 0b0000_0100;  // 这是分片帧
        const LAST_FRAG   = 0b0000_1000;  // 这是最后一个分片
    }
}
```

### 4.3 分帧策略

不同传输层的帧大小差异极大，ECS-2 需要处理分帧/重组：

| 传输 | 最大帧 | 分帧策略 |
|------|--------|---------|
| TCP | 65535 bytes | 长度前缀帧定界，无需分片 |
| WebSocket | 16 MB+ | 天然消息边界，无需分帧 |
| IPC | 同 TCP | 同 TCP |
| BLE | 512 bytes | **必须分帧**——超过 MTU 的 SignalEvent 需要拆分多个 GATT Write |
| NearLink | 待定 | 待定 |
| LoRa | ~256 bytes | **必须分帧** + **必须压缩**——250kbps 带宽，每字节都珍贵 |
| Serial | ~4096 bytes | COBS 编码或长度前缀，可能需要分帧 |

### 4.4 实施建议

**P0 (当前)**: 不需要 Transport trait。HTTP/SSE 直接用 Axum。

**P2 (WebSocket 加入时)**: 引入 Transport trait，实现 `TcpTransport` 和 `WsTransport`。

**P2+ (BLE 加入时)**: 实现 `BleTransport`，加入分帧/重组逻辑。

---

## 5. ECS-3: 组网层 (Mesh / Discovery)

### 5.1 职责

RT 实例间的自发现、信道建立、信号中继。**这就是"软总线"的核心所在。**

### 5.2 三个子协议

```
ECS-3 = 3a. Discovery + 3b. Channel Establishment + 3c. Relay
```

#### 3a. Discovery (自发现)

```
RT 启动 → 在局域网组播 mDNS 公告:

  服务类型: _exomind-rt._tcp.local.
  TXT 记录:
    host_id=<uuid>              ← 与 SignalEvent.origin_host_id 一致
    version=0.1.0               ← RT 版本
    port=3210                   ← HTTP 端口
    transports=tcp,ws           ← 支持的传输类型
    capabilities=pub,sub,relay  ← 能力声明

其他 RT 收到 → 记入 PeerRegistry
  → 发 unicast probe 确认存活
  → 交换 topology 信息
```

**技术选型**: `mdns-sd` crate — 纯 Rust mDNS/DNS-SD 实现，支持同步/异步，兼容 Avahi/Bonjour。

**非 IP 网络发现** (BLE/LoRa):
- BLE: 通过 GATT 广播自定义 Service UUID，扫描发现
- LoRa: 自定义 beacon 帧（周期性广播 host_id）

#### 3b. Channel Establishment (信道建立)

```
RT-A 发现 RT-B 后，发起握手：

RT-A → RT-B: POST /mesh/handshake
  {
    "host_id": "a-uuid",
    "version": "0.1.0",
    "supported_transports": ["tcp", "ws"],
    "topology": { "hostname": "starlin-pc", "os": "Windows 11", ... },
    "challenge": "<random-nonce>"    // 用于认证
  }

RT-B → RT-A: 200 OK
  {
    "host_id": "b-uuid",
    "selected_transport": "ws",      // 双方协商的传输方式
    "session_token": "<token>",      // 后续通信凭证
    "response": "<signed-nonce>"     // 认证响应
  }

→ 双向传输通道建立完成
→ 加入 PeerRegistry (status: Connected)
```

#### 3c. Relay (信号中继)

```rust
/// 中继决策逻辑
fn should_relay(event: &SignalEvent, self_host_id: &str, peers: &PeerRegistry) -> Vec<PeerId> {
    // 防环: 不回传给源 RT
    if event.origin_host_id == self_host_id {
        // 本地产生的信号 → 检查是否有远端 peer 订阅了此 topic
        return peers.interested_in(&event.topic);
    }

    // 来自远端的信号 → 不再中继（防止广播风暴）
    // 除非 hop < MAX_HOP 且是显式配置的中继路由
    if event.hop >= MAX_HOP {
        return vec![];
    }

    // 中继给其他 peer（排除源 peer）
    peers.interested_in(&event.topic)
        .into_iter()
        .filter(|p| p.host_id != event.origin_host_id)
        .collect()
}

const MAX_HOP: u8 = 3;  // 最大中继跳数
```

### 5.3 数据结构

```rust
/// RT 对端信息
pub struct PeerInfo {
    pub host_id: String,
    pub hostname: String,
    pub version: String,
    pub port: u16,
    pub transports: Vec<TransportKind>,
    pub last_seen: Instant,
    pub status: PeerStatus,
    pub session_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PeerStatus {
    Discovered,   // mDNS 发现，未握手
    Connecting,   // 握手中
    Connected,    // 已建立通道
    Stale,        // 超过 2 个心跳周期无响应
    Disconnected, // 主动断开
}

/// 对端注册表
pub struct PeerRegistry {
    peers: RwLock<HashMap<String, PeerInfo>>,
}

/// 中继策略 (可配置)
pub enum RelayPolicy {
    All,                         // 中继所有本地信号（默认）
    TopicFilter(Vec<String>),    // 只中继匹配的 topic
    None,                        // 单机模式，不中继
}
```

### 5.4 对标工程

| 案例 | 模型 | 可借鉴点 |
|------|------|---------|
| **NATS Cluster** | gossip 发现 + 路由转发 | 最务实参考——Phase 1 单节点，Phase 2 集群路由 |
| **ROS 2 DDS (SPDP/SEDP)** | 自动发现 topic 和节点 | 发现协议设计（Simple Participant Discovery Protocol） |
| **HarmonyOS 软总线** | CoAP 发现 + 传输抽象 + PIN 认证 | 设备配对认证机制 |
| **D-Bus** | session bus + system bus | signal 模式与 SignalEvent 同构 |

---

## 6. ECS-4: 会话管理层 (Session Management)

### 6.1 职责

管理 Agent/前端 与 RT 之间的连接生命周期。

### 6.2 当前实现

代码位置: `crates/exomind-runtime/src/routes/signals.rs`

| 能力 | 实现状态 | 代码 |
|------|---------|------|
| SSE 连接管理 | 已实现 | `SignalSseStream` (L255-351) |
| 心跳 | 已实现 | `Interval` + `event: heartbeat` (L318-321) |
| Last-Event-ID 重放 | 已实现 | `WindowCache.since()` (L117-121) |
| Agent 路由过滤 | 已实现 | `routes_target_agent()` (L246-252) |
| Lag 告警 | 已实现 | `event: warning` (L306-309) |

### 6.3 缺失能力

| 能力 | 说明 | 优先级 |
|------|------|--------|
| Agent 连接注册表 | 跟踪哪些 agent_id 在线 | P2 |
| 断开回调 | SSE 断开时标记 offline | P2 |
| Agent 状态 API | `GET /agents/{id}/status` 返回在线/离线 | P2 |
| 远端 Agent 感知 | 通过 ECS-3 中继连接的远端 Agent | P3 |

---

## 7. ECS-5: 信号路由层 (Signal Routing)

### 7.1 职责

Topic-based 信号路由。**这就是"Pub/Sub"。**

### 7.2 当前实现 (已完整)

| 组件 | 文件 | 核心能力 |
|------|------|---------|
| SignalPool | `signal/mod.rs` | Facade: Bus + RouteTable + Journal + Window |
| SignalBus | `signal/bus.rs` | `tokio::broadcast` (256 容量) + fanout |
| RouteTable | `signal/route_table.rs` | `HashMap<topic, Vec<route>>` + 精确/`*`通配匹配 |
| Journal | `signal/journal.rs` | Ring Buffer 1000 条，审计日志 |
| WindowCache | `signal/window.rs` | Ring Buffer 1000 条，since() 重放 |

### 7.3 未来增强

| 增强 | 说明 | 优先级 |
|------|------|--------|
| 层级通配符 | `user.*` 匹配 `user.input.text` | P2 |
| RouteTable 持久化 | 已有 `persist_path` 功能，需启用 | P2 |
| Journal 持久化 | 当前仅内存 | P3 |
| 跨 RT 路由同步 | 多个 RT 的 RouteTable 合并视图 | P4 |

---

## 8. ECS-6: 信号契约层 (Signal Contract)

### 8.1 职责

信号的序列化格式、schema 版本、编码协商。

### 8.2 当前实现

`signal/types.rs` 定义:

```rust
pub struct SignalEvent {
    pub schema_version: u8,        // 版本协商
    pub id: String,                // UUID
    pub topic: String,             // 主题
    pub ts: u64,                   // 时间戳 (ms)
    pub source: String,            // 来源
    pub origin_host_id: String,    // 源主机 ID (ECS-3 预留)
    pub hop: u8,                   // 中继跳数 (ECS-3 预留)
    pub trace_id: Option<String>,  // 追踪 ID
    pub payload: serde_json::Value,// 负载
}
```

### 8.3 多编码策略

不同传输层需要不同编码：

| 编码 | Crate | 适用传输 | 特点 |
|------|-------|---------|------|
| JSON | `serde_json` (已有) | TCP, WebSocket, IPC | 默认，可读性好，调试友好 |
| MessagePack | `rmp-serde` | BLE, NearLink | 二进制，比 JSON 小 30-50% |
| CBOR | `ciborium` | LoRa, BLE | IoT 标准，自描述二进制 |
| 自定义紧凑 | 手写 | LoRa (极端场景) | 只传必要字段，字段 ID 编码 |

**编码协商**: 在 ECS-3 握手阶段协商双方支持的编码格式，选择最优的。

### 8.4 精简版 SignalEvent (低带宽传输)

LoRa 场景下，完整 SignalEvent 太大。定义精简版：

```rust
/// 低带宽传输的精简信号 (LoRa/BLE)
pub struct CompactSignalEvent {
    pub id: u32,            // 短 ID (本地序列号，非 UUID)
    pub topic_id: u16,      // topic 的哈希映射 (预先协商)
    pub ts_delta: u16,      // 相对时间偏移 (秒)
    pub hop: u8,
    pub payload: Vec<u8>,   // 紧凑编码的 payload
}
// 最小帧: 4+2+2+1+N = 9+N 字节 (vs JSON 版本通常 200+ 字节)
```

---

## 9. ECS-7: 应用语义层 (Application Semantics)

### 9.1 职责

Agent 的业务逻辑，不影响通信架构。

### 9.2 当前实现

| Actor/Agent | 类型 | 信号链 |
|-------------|------|--------|
| EventLog Actor | 进程内 | `user.input.text` → `eventlog.appended` |
| Task Actor | 进程内 | `input.classified` (task) → `task.auto-created` |
| Echo Agent | 进程内 | 回显 (测试) |
| Claude Agent | 进程内/外 | Claude CLI 流式对话 |

---

## 10. 层间数据流

### 10.1 本地信号流 (当前)

```
ECS-7: Agent publish("user.input.text", payload)
  │
  ▼
ECS-6: serde_json::to_string(&SignalEvent) → JSON bytes
  │
  ▼
ECS-5: RouteTable.match_routes("user.input.text")
  │   → [classifier, eventlog, ui]
  │   → Journal.append(DeliveryRecord)
  │   → WindowCache.push(event)
  │
  ▼
ECS-4: SignalSseStream 推送到匹配的 SSE 连接
  │
  ▼
ECS-2: HTTP/SSE 帧 (text/event-stream)
  │
  ▼
ECS-1: TCP (127.0.0.1)
```

### 10.2 跨 RT 信号流 (未来)

```
RT-A (桌面):
  ECS-7: 用户输入 "今天要写文档"
    │
    ▼
  ECS-5: RouteTable 匹配 → 本地 Agent + 远端 RT-B
    │
    ├─→ 本地: eventlog actor (进程内)
    │
    └─→ 远端:
        ECS-3: Relay 决策 → RT-B 订阅了此 topic
          │   event.hop += 1
          ▼
        ECS-2: WebSocket 帧封装
          │
          ▼
        ECS-1: TCP → WiFi → RT-B

RT-B (手机):
  ECS-1: WiFi → TCP 接收
    │
    ▼
  ECS-2: 帧解析 → SignalEvent bytes
    │
    ▼
  ECS-3: 中继检查 (origin_host_id != self → 不再中继)
    │
    ▼
  ECS-5: 本地 RouteTable 匹配 → 手机端 Agent
    │
    ▼
  ECS-7: 手机端 Agent 处理 (如推送通知)
```

---

## 11. 安全架构

### 11.1 分层安全策略

| 层级 | 威胁 | 对策 | 实施时机 |
|------|------|------|---------|
| ECS-1 | 中间人攻击 | mTLS (`rustls` crate) | P7 |
| ECS-2 | 帧篡改 | HMAC 签名 | P7 |
| ECS-3 | 恶意 RT 注入 | 设备配对码认证 (类似蓝牙 PIN) | P4 |
| ECS-3 | 信号风暴/放大攻击 | hop 上限 (MAX_HOP=3) + 速率限制 | P4 |
| ECS-5 | 未授权路由修改 | RouteTable API Bearer Token | P3 |
| ECS-6 | 信号窃听 | 端到端加密 (`snow` crate, Noise Protocol) | P7 |

### 11.2 MVP 安全策略

当前: `127.0.0.1` 绑定，`EXOMIND_RT_BIND=0.0.0.0` 开放 LAN。可信局域网内足够。

### 11.3 推荐安全演进

| 阶段 | 能力 | Crate |
|------|------|-------|
| P3 | 设备配对码 (一次性 PIN) | 自实现 |
| P4 | PSK (Pre-Shared Key) 认证 | 自实现 |
| P7 | mTLS | `rustls` |
| P7 | Noise Protocol 端到端加密 | `snow` |

---

## 12. 实施路线图

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

---

## 13. 与已有文档的关系

| 文档 | 关系 |
|------|------|
| `ARCH-signal-pool-agent-process.md` | ECS-4/5/7 的详细设计，本文补充了 ECS-1/2/3 |
| `architecture.md` (7 层架构) | 本文重新定义通信协议栈分层，与 7 层架构互补 |
| `ARCH-SYNC.md` | 多设备同步的具体实现层面，本文是通信基础设施层面 |

---

*文档版本: v1.0*
*更新日期: 2026-03-04*
*参考来源:*
- [btleplug (Rust BLE)](https://github.com/deviceplug/btleplug)
- [lora-rs (Rust LoRa)](https://github.com/lora-rs/lora-rs)
- [mdns-sd (Rust mDNS)](https://github.com/keepsimple1/mdns-sd)
- [tokio-serial (Rust Serial)](https://github.com/berkowski/tokio-serial)
- [ipc-channel (Servo IPC)](https://github.com/servo/ipc-channel)
- [Nearlink Toolbox](https://nearlink.sgguo.com/)
- [ESP32 Open MAC / Ferris-on-Air](https://esp32-open-mac.be/posts/0011-mesh-networking/)
