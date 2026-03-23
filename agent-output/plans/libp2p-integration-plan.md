# libp2p P2P 通信整合方案

> 文档版本: v1.0
> 创建日期: 2026-02-04
> 作者: ExoMind AI Team
> 状态: 规划阶段

---

## 目录

1. [项目探索](#1-项目探索)
2. [示例代码分析](#2-示例代码分析)
3. [核心概念图解](#3-核心概念图解)
4. [整合方案](#4-整合方案)
5. [实施计划](#5-实施计划)
6. [参考资源](#6-参考资源)

---

## 1. 项目探索

### 1.1 仓库信息

| 项目 | 地址 | 版本 |
|------|------|------|
| libp2p 仓库 | `D:\project\rust-libp2p` | master 分支 (0.56+) |
| 目标项目 | `D:\project\exomind-dev-chat` | Tauri 2.0 |

### 1.2 示例目录结构

```
rust-libp2p/
├── examples/
│   ├── chat/                          # 聊天示例（重点参考）
│   │   ├── Cargo.toml
│   │   ├── README.md
│   │   └── src/
│   │       └── main.rs                # 完整聊天实现
│   │
│   ├── distributed-key-value-store/   # Kademlia DHT 示例
│   ├── file-sharing/                 # 文件分享示例
│   ├── mdns-passive-discovery/       # mDNS 发现示例
│   ├── ping/                         # Ping 协议示例
│   ├── rendezvous/                  # 中继示例
│   └── ...
│
├── libp2p/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── core/                     # 核心抽象
│   │   ├── swarm/                    # Swarm 实现
│   │   ├── identity/                 # 身份/密钥管理
│   │   ├── transport/                # 传输层
│   │   ├── noise.rs                  # Noise 加密
│   │   ├── gossipsub/               # Gossipsub 协议
│   │   ├── mdns/                    # mDNS 发现
│   │   ├── ping/                    # Ping 协议
│   │   ├── identify/                 # Identify 协议
│   │   ├── relay/                   # 中继协议
│   │   └── ...
│   └── Cargo.toml
│
└── Cargo.toml                        # 工作空间配置
```

### 1.3 关键依赖配置

```toml
# 完整依赖配置 (Cargo.toml)
[dependencies]
libp2p = { version = "0.56", features = [
  "tokio",           # Async 运行时支持
  "gossipsub",       # 消息广播协议
  "mdns",           # 局域网设备发现
  "noise",          # Noise 加密传输
  "tcp",            # TCP 传输
  "quic",           # QUIC 传输（更好的 NAT 穿透）
  "yamux",          # 多路复用
  "macros",         # NetworkBehaviour 派生宏
  "identify",       # 节点识别协议
  "ping",           # 心跳检测
  "relay",          # 中继支持
  "autonat",        # NAT 自动检测
  "dcutr",          # 直接连接测试
] }
tokio = { version = "1", features = ["full"] }
futures = "0.3"
tracing-subscriber = "0.3"  # 日志
```

---

## 2. 示例代码分析

### 2.1 Chat 示例完整代码

**文件**: `D:\project\rust-libp2p\examples\chat\src\main.rs`

```rust
// Copyright 2018 Parity Technologies (UK) Ltd.

use std::{
    collections::hash_map::DefaultHasher,
    error::Error,
    hash::{Hash, Hasher},
    time::Duration,
};

use futures::stream::StreamExt;
use libp2p::{
    gossipsub, mdns, noise,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux,
};
use tokio::{io, io::AsyncBufReadExt, select};
use tracing_subscriber::EnvFilter;

// 自定义网络行为：组合 Gossipsub 和 Mdns
#[derive(NetworkBehaviour)]
struct MyBehaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // 1. 初始化日志
    let _ = tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .try_init();

    // 2. 创建 Swarm（身份 + 传输 + 安全层）
    let mut swarm = libp2p::SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()  // QUIC 支持更好的 NAT 穿透
        .with_behaviour(|key| {
            // 2.1 配置 Gossipsub（消息广播）
            let message_id_fn = |message: &gossipsub::Message| {
                let mut s = DefaultHasher::new();
                message.data.hash(&mut s);
                gossipsub::MessageId::from(s.finish().to_string())
            };

            let gossipsub_config = gossipsub::ConfigBuilder::default()
                .heartbeat_interval(Duration::from_secs(10))
                .validation_mode(gossipsub::ValidationMode::Strict)
                .message_id_fn(message_id_fn)
                .build()
                .map_err(io::Error::other)?;

            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gossipsub_config,
            )?;

            // 2.2 配置 mDNS（设备发现）
            let mdns =
                mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?;

            Ok(MyBehaviour { gossipsub, mdns })
        })?
        .build();

    // 3. 创建消息 Topic
    let topic = gossipsub::IdentTopic::new("test-net");
    swarm.behaviour_mut().gossipsub.subscribe(&topic)?;

    // 4. 监听地址（TCP + QUIC）
    swarm.listen_on("/ip4/0.0.0.0/udp/0/quic-v1".parse()?)?;
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    println!("Enter messages via STDIN and they will be sent to connected peers using Gossipsub");

    // 5. 主事件循环
    let mut stdin = io::BufReader::new(io::stdin()).lines();

    loop {
        select! {
            // 用户输入
            Ok(Some(line)) = stdin.next_line() => {
                if let Err(e) = swarm
                    .behaviour_mut().gossipsub
                    .publish(topic.clone(), line.as_bytes()) {
                    println!("Publish error: {e:?}");
                }
            }

            // Swarm 事件
            event = swarm.select_next_some() => match event {
                // mDNS 发现新设备
                SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                    for (peer_id, _multiaddr) in list {
                        println!("mDNS discovered a new peer: {peer_id}");
                        // 将发现设备加入 gossipsub
                        swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                    }
                }
                // mDNS 设备离线
                SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                    for (peer_id, _multiaddr) in list {
                        println!("mDNS discover peer has expired: {peer_id}");
                        swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                    }
                }
                // 收到 gossipsub 消息
                SwarmEvent::Behaviour(MyBehaviourEvent::Gossipsub(gossipsub::Event::Message {
                    propagation_source: peer_id,
                    message_id: id,
                    message,
                })) => println!(
                        "Got message: '{}' with id: {id} from peer: {peer_id}",
                        String::from_utf8_lossy(&message.data),
                    ),
                // 新监听地址
                SwarmEvent::NewListenAddr { address, .. } => {
                    println!("Local node is listening on {address}");
                }
                _ => {}
            }
        }
    }
}
```

### 2.2 示例运行方式

```bash
# 终端 1 - 设备 A
cargo run

# 终端 2 - 设备 B
cargo run

# 输出示例:
# Local node is listening on /ip4/192.168.1.100/tcp/12345
# mDNS discovered a new peer: 12D3KooWHdk...
# Got message: 'Hello from peer' with id: xxx from peer: 12D3KooWHdk...
```

### 2.3 关键 API 总结

| API | 作用 | 位置 |
|-----|------|------|
| `SwarmBuilder::with_new_identity()` | 创建新身份（密钥对） | swarm builder |
| `.with_tcp(tcp::Config, noise::Config, yamux::Config)` | 配置 TCP + Noise + Yamux | swarm builder |
| `.with_quic()` | 添加 QUIC 传输支持 | swarm builder |
| `.with_behaviour(\|key\| { ... })` | 配置网络行为（自定义协议组合） | swarm builder |
| `gossipsub::Behaviour::new()` | 创建 gossipsub 实例 | gossipsub mod |
| `mdns::tokio::Behaviour::new()` | 创建 mDNS 实例 | mdns mod |
| `swarm.behaviour_mut()` | 获取行为对象以调用方法 | swarm |
| `swarm.listen_on(addr)` | 开始监听地址 | swarm |
| `swarm.dial(addr)` | 连接到对等节点 | swarm |
| `swarm.select_next_some()` | 异步获取下一个事件 | swarm |
| `publish(topic, data)` | 发布消息到 Topic | gossipsub |
| `add_explicit_peer(peer_id)` | 显式添加对等节点 | gossipsub |
| `subscribe(topic)` | 订阅 Topic | gossipsub |

---

## 3. 核心概念图解

### 3.1 libp2p 协议栈架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      libp2p 协议栈                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    应用层 (Application)                   │   │
│  │                    你的代码/聊天/文件分享                  │   │
│  └───────────────────────────┬───────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐   │
│  │              NetworkBehaviour (组合协议行为)               │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │   Gossipsub  │ │    mDNS      │ │   Identify   │     │   │
│  │  │  (消息广播)   │ │ (设备发现)   │ │ (节点识别)   │     │   │
│  │  │              │ │              │ │              │     │   │
│  │  │  PubSub 路由  │ │ 局域网广播   │ │ 交换信息     │     │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │    Ping      │ │   Relay     │ │   Autonat    │     │   │
│  │  │  (心跳检测)   │ │   (中继)     │ │ (NAT 检测)   │     │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  └───────────────────────────┬───────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────▼───────────────────────────────┐   │
│  │                 SwarmBuilder (构建器)                      │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │   Identity   │ │  Transport   │ │  Security    │     │   │
│  │  │  (密钥对)     │ │  (TCP/QUIC)  │ │  (Noise)     │     │   │
│  │  │              │ │              │ │              │     │   │
│  │  │ ED25519 签名  │ │ 可靠/不可靠  │ │ 握手加密     │     │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  │  ┌──────────────┐ ┌──────────────┐                       │   │
│  │  │   Yamux      │ │   QUIC      │                       │   │
│  │  │  (多路复用)   │ │  (传输协议)  │                       │   │
│  │  └──────────────┘ └──────────────┘                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                      网络层 (Network)                      │   │
│  │     TCP / UDP / QUIC / WebSocket / WebRTC / ...          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 设备发现机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    设备发现机制对比                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  mDNS (局域网自动发现)                                   │    │
│  │  ┌─────────┐     广播     ┌─────────┐                │    │
│  │  │ 设备 A   │ ───────────→│ 设备 B   │                │    │
│  │  │ .local  │             │ .local  │                │    │
│  │  └────┬────┘ ←────────── └────┬────┘                │    │
│  │       │           应答          │                      │    │
│  │       └─────────────────────────┘                      │    │
│  │                                                         │    │
│  │  ✅ 优点: 零配置，自动发现                               │    │
│  │  ❌ 局限: 仅限同一局域网                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  手动指定地址 (PeerID + Multiaddr)                       │    │
│  │                                                         │    │
│  │  Multiaddr 格式:                                        │    │
│  │  /ip4/192.168.1.100/tcp/4001                           │    │
│  │  /ip4/123.45.67.89/tcp/4001/quic-v1                    │    │
│  │  /dns4/example.com/tcp/443/wss                         │    │
│  │                                                         │    │
│  │  ✅ 优点: 可跨网段，可靠                                 │    │
│  │  ❌ 缺点: 需要手动配置                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  中继服务器 (Relay)                                      │    │
│  │  ┌─────────┐     ┌─────────┐     ┌─────────┐        │    │
│  │  │ 设备 A   │ ───→ │  Relay  │ ───→ │ 设备 B   │        │    │
│  │  └─────────┘     │  Server  │     └─────────┘        │    │
│  │                  └─────────┘                          │    │
│  │                                                         │    │
│  │  ✅ 优点: 穿透 NAT，跨网段                               │    │
│  │  ❌ 缺点: 需要中继服务器，中继点可能有延迟               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  NAT 穿透 (dcutr/autonat)                               │    │
│  │  ┌─────────┐     ┌─────────┐     ┌─────────┐        │    │
│  │  │ 设备 A   │ ───→ │  STUN   │ ───→ │ 设备 B   │        │    │
│  │  │ (NAT后)  │     │  Server │     │ (NAT后)  │        │    │
│  │  └─────────┘     └─────────┘     └─────────┘        │    │
│  │                                                         │    │
│  │  ✅ 优点: P2P 直连，无需中继                             │    │
│  │  ❌ 缺点: 不是 100% 成功，依赖 NAT 类型                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 消息广播机制 (Gossipsub)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gossipsub 消息广播                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Topic 订阅模型                                          │    │
│  │                                                         │    │
│  │              ┌─────────────┐                           │    │
│  │              │   Topic:    │                           │    │
│  │              │ "exomind-   │                           │    │
│  │              │  chat"     │                           │    │
│  │              └──────┬──────┘                           │    │
│  │                     │                                  │    │
│  │     ┌───────────────┼───────────────┐                 │    │
│  │     │               │               │                  │    │
│  │     ▼               ▼               ▼                  │    │
│  │  ┌──────┐       ┌──────┐       ┌──────┐             │    │
│  │  │设备 A │       │设备 B │       │设备 C │             │    │
│  │  │ ✅    │       │ ✅    │       │ ✅    │             │    │
│  │  │订阅   │       │订阅   │       │订阅   │             │    │
│  │  └──────┘       └──────┘       └──────┘             │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  消息传播流程                                             │    │
│  │                                                         │    │
│  │  1. 设备 A 发布消息到 Topic                              │    │
│  │                                                         │    │
│  │     A ───msg──→ B (直接邻居)                            │    │
│  │              │                                          │    │
│  │              ├──→ C (B 的邻居)                          │    │
│  │              │                                          │    │
│  │              └──→ D (Gossip 传播)                       │    │
│  │                                                         │    │
│  │  2. 设备 B 收到消息，转发给自己的邻居                     │    │
│  │  3. 设备 C 收到消息，转发给自己的邻居                    │    │
│  │  4. 依此类推，直到消息传播到整个网络                     │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  消息去重 (Message ID)                                   │    │
│  │                                                         │    │
│  │  MessageId = SHA256(消息内容)                           │    │
│  │                                                         │    │
│  │  设备 B 收到消息:                                        │    │
│  │  if (MessageId 已存在) -> 丢弃                          │    │
│  │  else -> 处理消息 + 标记 MessageId                       │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 整合方案

### 4.1 ExoMind P2P 设置页面设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    P2P 设备管理设置页面                           │
│                    【极简·黑白·科技感】                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  📱 我的设备                                            │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐                │    │
│  │  │ 💻 PC    │ │ 📱 手机 │ │ 🔧 ...  │                │    │
│  │  │ 在线 ✅   │ │ 离线 ⭕ │ │ 未配对 ⊕ │                │    │
│  │  └─────────┘ └─────────┘ └─────────┘                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🔗 配对新设备                                          │    │
│  │  ┌─────────────────────────┐ ┌─────────────────────┐  │    │
│  │  │ 🎫 配对码: 123456      │ │ ⏳ 剩余时间: 04:59   │  │    │
│  │  └─────────────────────────┘ └─────────────────────┘  │    │
│  │  ┌─────────────────────────────────────────────────┐  │    │
│  │  │ 或扫描二维码                                      │  │    │
│  │  └─────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⚙️ 连接设置                              [展开 ▼]      │    │
│  │  ┌─────────────────────────────────────────────────┐  │    │
│  │  │ 传输协议: ○ TCP  ● QUIC                         │  │    │
│  │  │ 监听端口: [  4001  ]                            │  │    │
│  │  │ [✓] 启用 mDNS 自动发现                          │  │    │
│  │  │ [✓] 启用中继服务器                              │  │    │
│  │  │ 中继地址: [ ws://... ]                          │  │    │
│  │  └─────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🔐 安全设置                                [展开 ▼]      │    │
│  │  ┌─────────────────────────────────────────────────┐  │    │
│  │  │ 加密方式: ● Noise  ○ NaCl                       │  │    │
│  │  │ [✓] 消息签名                                    │  │    │
│  │  │ [✓] 设备认证                                   │  │    │
│  │  └─────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 数据模型设计

#### 4.2.1 P2P 设备接口

```typescript
// src/lib/models/device.ts

interface P2PDevice {
  // === 现有字段（保留）===
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet';
  status: 'online' | 'offline' | 'pending' | 'rejected';

  // === P2P 新增字段 ===
  peerId: string;           // libp2p PeerID (base58 encoded)
  publicKey: string;        // ED25519 公钥 (hex encoded)
  addresses: string[];      // Multiaddrs 列表
  protocols: string[];       // 支持的协议 ['gossipsub', 'identify', 'ping']

  // === 配对信息 ===
  pairingCode?: string;       // 6位配对码
  pairedAt?: Date;          // 配对时间
  trustLevel: number;       // 信任等级 1-5

  // === 连接状态 ===
  lastSeen: Date;
  lastConnected?: Date;
  connectionQuality?: 'good' | 'medium' | 'poor';

  // === 统计 ===
  messagesSent: number;
  messagesReceived: number;
}
```

#### 4.2.2 设备设置接口

```typescript
// src/lib/models/settings.ts

interface DeviceSettings {
  // === 连接配置 ===
  transportProtocol: 'tcp' | 'quic' | 'both';
  listenPort: number;
  enableMdns: boolean;
  mdnsServiceName: string;
  enableRelay: boolean;
  relayAddresses: string[];
  enableRelayServer: boolean;  // 是否作为中继服务器

  // === 重连策略 ===
  autoReconnect: boolean;
  reconnectInterval: number;   // 秒
  maxReconnectAttempts: number;
  heartbeatInterval: number;  // 秒

  // === 安全配置 ===
  encryption: 'noise' | 'tls' | 'none';
  enableMessageSigning: boolean;
  signingAlgorithm: 'ed25519' | 'ecdsa';
  deviceAuthentication: boolean;
  newDevicePolicy: 'manual' | 'auto_trust' | 'open';

  // === 配对配置 ===
  pairingCodeExpiry: number;   // 秒
  autoAcceptPaired: boolean;
}
```

#### 4.2.3 配对协议消息

```typescript
// src/lib/p2p/pairing.ts

interface PairingRequest {
  type: 'pairing_request';
  version: number;
  senderPeerId: string;
  senderPublicKey: string;    // hex encoded
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  timestamp: number;
  nonce: string;              // 随机数，防重放
  signature: string;           // 用私钥签名
}

interface PairingResponse {
  type: 'pairing_response';
  version: number;
  accepted: boolean;
  responderPeerId?: string;
  sharedSecret?: string;       // DH 协商后的共享密钥
  errorMessage?: string;
  timestamp: number;
  signature: string;
}

// 配对码格式
interface PairingCode {
  code: string;               // 6位数字
  peerId: string;             // 设备 PeerID
  publicKey: string;          // 公钥（加密传输）
  expiresAt: Date;
  used: boolean;
}
```

### 4.3 文件结构规划

```
src/
├── components/
│   ├── Settings/
│   │   ├── SettingsPage.tsx           # 设置页面入口
│   │   ├── MyDevicesPanel.tsx         # 我的设备模块
│   │   ├── PairingPanel.tsx           # 配对新设备模块
│   │   ├── ConnectionSettings.tsx     # 连接设置模块
│   │   ├── SecuritySettings.tsx       # 安全设置模块
│   │   └── components/
│   │       ├── DeviceCard.tsx         # 设备卡片
│   │       ├── DeviceDetailModal.tsx  # 设备详情弹窗
│   │       ├── PairingCodeDisplay.tsx # 配对码显示
│   │       ├── QrCodeScanner.tsx      # 二维码扫描器
│   │       ├── ConnectionStatus.tsx   # 连接状态指示器
│   │       └── SettingsToggle.tsx     # 设置开关组件
│   │
│   └── Chat/
│       └── DevicePanel.tsx            # 现有，改造为使用新组件
│
├── lib/
│   ├── p2p/
│   │   ├── mod.rs                    # P2P 模块入口
│   │   ├── identity.rs               # 身份/密钥管理
│   │   ├── swarm.rs                  # Swarm 封装
│   │   ├── device.rs                 # P2P 设备管理
│   │   ├── pairing.rs                # 配对协议
│   │   ├── gossipsub.rs              # 消息广播
│   │   ├── discovery.rs              # mDNS 发现
│   │   ├── connection.rs             # 连接管理
│   │   └── security.rs               # 加密/签名
│   │
│   └── models/
│       ├── device.ts                 # 设备模型
│       └── settings.ts               # 设置模型
│
├── stores/
│   ├── useDeviceStore.ts            # 设备状态管理
│   └── useSettingsStore.ts           # 设置状态管理
│
└── hooks/
    ├── useP2PConnection.ts           # P2P 连接 Hook
    ├── useDeviceDiscovery.ts          # 设备发现 Hook
    └── usePairing.ts                 # 配对流程 Hook
```

### 4.4 Rust 后端集成

```
src-tauri/
├── src/
│   ├── lib.rs                        # 库入口
│   ├── main.rs                       # 程序入口
│   │
│   ├── p2p/
│   │   ├── mod.rs                    # P2P 模块入口
│   │   ├── swarm.rs                  # Swarm 管理
│   │   ├── behaviour.rs              # NetworkBehaviour 定义
│   │   ├── gossipsub.rs              # Gossipsub 处理
│   │   ├── mdns.rs                   # mDNS 处理
│   │   ├── relay.rs                  # 中继处理
│   │   └── events.rs                 # 事件定义
│   │
│   └── commands/
│       ├── p2p_commands.rs           # Tauri 命令
│       ├── device_commands.rs        # 设备管理命令
│       └── pairing_commands.rs       # 配对命令
│
└── Cargo.toml                        # 依赖配置
```

#### 4.4.1 NetworkBehaviour 定义 (Rust)

```rust
// src-tauri/src/p2p/behaviour.rs

use libp2p::{
    gossipsub, mdns, noise,
    identify::{self, Info},
    ping::{self, Ping},
    relay::{self, RelayConfig},
    swarm::{NetworkBehaviour, SwarmEvent},
};
use libp2p_identity::Keypair;

#[derive(NetworkBehaviour)]
#[behaviour(out_event = "P2PEvent")]
pub struct ExomindBehaviour {
    pub gossipsub: gossipsub::Behaviour,
    pub mdns: mdns::tokio::Behaviour,
    pub ping: ping::Behaviour,
    pub identify: identify::Behaviour,
    pub relay: relay::Behaviour,
}

pub enum P2PEvent {
    Message {
        peer_id: PeerId,
        data: Vec<u8>,
        topic: String,
    },
    DeviceDiscovered {
        peer_id: PeerId,
        addresses: Vec<Multiaddr>,
    },
    DeviceExpired {
        peer_id: PeerId,
    },
    DeviceConnected {
        peer_id: PeerId,
    },
    DeviceDisconnected {
        peer_id: PeerId,
    },
    Ping {
        peer_id: PeerId,
        result: Result<Duration, ping::Failure>,
    },
}

impl From<gossipsub::Event> for P2PEvent {
    fn from(event: gossipsub::Event) -> Self {
        match event {
            gossipsub::Event::Message {
                propagation_source,
                message_id: _,
                message,
            } => P2PEvent::Message {
                peer_id: propagation_source,
                data: message.data,
                topic: message.topic.into_string(),
            },
        }
    }
}

impl From<mdns::Event> for P2PEvent {
    fn from(event: mdns::Event) -> Self {
        match event {
            mdns::Event::Discovered(peers) => P2PEvent::DeviceDiscovered {
                peer_id: /* 第一个对等节点 */,
                addresses: /* 地址列表 */,
            },
            mdns::Event::Expired(peers) => P2PEvent::DeviceExpired {
                peer_id: /* 第一个对等节点 */,
            },
        }
    }
}

// ... 其他事件转换
```

---

## 5. 实施计划

### 5.1 阶段划分

| 阶段 | 任务 | 产出 | 依赖 |
|------|------|------|------|
| **Phase 1** | 基础设置页面框架 | 路由、布局、导航 | 无 |
| **Phase 2** | P2P 设备数据模型 | Typescript 接口、Rust 结构体 | Phase 1 |
| **Phase 3** | 我的设备模块 | UI 组件、设备卡片、状态显示 | Phase 2 |
| **Phase 4** | 配对新设备模块 | 配对码生成、QR 码、配对流程 | Phase 2 |
| **Phase 5** | 连接设置模块 | 协议选择、端口配置、mDNS 开关 | Phase 1 |
| **Phase 6** | 安全设置模块 | 加密选择、签名配置、认证策略 | Phase 1 |
| **Phase 7** | Rust 后端集成 | Swarm 管理、事件转发、Tauri 命令 | Phase 3-6 |
| **Phase 8** | E2E 测试 | 集成测试、用例测试 | Phase 7 |

### 5.2 Phase 1 详细设计

#### 文件: `src/components/Settings/SettingsPage.tsx`

```tsx
import { useState } from 'react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { MyDevicesPanel } from './MyDevicesPanel';
import { PairingPanel } from './PairingPanel';
import { ConnectionSettings } from './ConnectionSettings';
import { SecuritySettings } from './SecuritySettings';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'devices' | 'pairing' | 'connection' | 'security'>('devices');

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>设置</h1>
      </header>

      <nav className="settings-nav">
        <button
          className={activeTab === 'devices' ? 'active' : ''}
          onClick={() => setActiveTab('devices')}
        >
          📱 我的设备
        </button>
        <button
          className={activeTab === 'pairing' ? 'active' : ''}
          onClick={() => setActiveTab('pairing')}
        >
          🔗 配对
        </button>
        <button
          className={activeTab === 'connection' ? 'active' : ''}
          onClick={() => setActiveTab('connection')}
        >
          ⚙️ 连接
        </button>
        <button
          className={activeTab === 'security' ? 'active' : ''}
          onClick={() => setActiveTab('security')}
        >
          🔐 安全
        </button>
      </nav>

      <main className="settings-content">
        {activeTab === 'devices' && <MyDevicesPanel />}
        {activeTab === 'pairing' && <PairingPanel />}
        {activeTab === 'connection' && <ConnectionSettings />}
        {activeTab === 'security' && <SecuritySettings />}
      </main>
    </div>
  );
}
```

### 5.3 里程碑

| 里程碑 | 验收标准 | 预计工时 |
|--------|----------|----------|
| **M1: 基础框架** | 设置页面可显示，有基本导航 | 0.5 天 |
| **M2: 设备管理** | 显示设备列表，能添加/移除设备 | 1 天 |
| **M3: 配对功能** | 生成配对码，能接受配对请求 | 1.5 天 |
| **M4: 连接配置** | 能配置端口、协议、mDNS | 0.5 天 |
| **M5: 安全配置** | 能配置加密、签名策略 | 0.5 天 |
| **M6: Rust 集成** | 前端能通过 Tauri 调用 libp2p | 2 天 |
| **M7: E2E 测试** | 多设备消息互通 | 1 天 |

---

## 6. 参考资源

### 6.1 官方文档

| 资源 | 地址 | 说明 |
|------|------|------|
| libp2p 文档 | https://docs.rs/libp2p/latest/libp2p/ | Rust API 文档 |
| libp2p GitHub | https://github.com/libp2p/rust-libp2p | 源码仓库 |
| libp2p 官网 | https://libp2p.io/ | 概念文档 |
| Gossipsub 规范 | https://github.com/libp2p/specs/tree/master/pubsub/gossipsub | 协议规范 |
| mDNS 规范 | https://github.com/libp2p/specs/blob/master/discovery/mdns.md | 发现协议 |

### 6.2 示例项目

| 项目 | 地址 | 说明 |
|------|------|------|
| Chat 示例 | `D:\project\rust-libp2p\examples\chat` | 完整聊天实现 |
| File Sharing | `D:\project\rust-libp2p\examples\file-sharing` | 文件分享 |
| Distributed KV | `D:\project\rust-libp2p\examples\distributed-key-value-store` | Kademlia DHT |

### 6.3 关键依赖版本

```toml
# 当前 Cargo.toml 配置 (src-tauri)
libp2p = { version = "0.54", features = [
  "tcp", "dns", "noise", "yamux",
  "identify", "ping", "floodsub", "mdns",
] }

# 建议升级到
libp2p = { version = "0.56", features = [
  "tokio", "gossipsub", "mdns", "noise",
  "tcp", "quic", "yamux", "macros",
  "identify", "ping", "relay", "autonat",
] }
```

---

## 附录

### A. Multiaddr 格式说明

```
格式: /<protocol>/<address>/<protocol>/<address>...

示例:
  /ip4/192.168.1.100/tcp/4001
  /ip4/192.168.1.100/udp/5001/quic-v1
  /dns4/example.com/tcp/443/wss
  /dns4/relay.example.com/tcp/5001/p2p/12D3KooWHdk...
```

### B. PeerID 格式

```
格式: base58-encoded SHA-256 hash of public key

示例: 12D3KooWHdkJyV7eMA19xG3q3b8XwKd9h9xqW7Lm2QcZz1vZ
```

### C. 常见问题

| 问题 | 解决方案 |
|------|----------|
| mDNS 不工作 | 检查防火墙是否允许 UDP 5353 端口 |
| QUIC 连不上 | 检查是否启用 UDP 协议 |
| PeerID 冲突 | 重新生成密钥对 |
| 消息丢失 | 调整 gossipsub heartbeat_interval |

---

*文档版本: v1.0*
*最后更新: 2026-02-04*
