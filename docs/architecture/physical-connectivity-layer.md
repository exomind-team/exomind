# 物理联通层 — Physical Connectivity Layer

> 日期：2026-05-25
> 状态：概念锁定版，设计进行中
> 关联：
> - [Reticulum 组网配对模型设计](../plans/2026-05-24-ret-mesh-pairing-model-design.md)
> - [Reticulum 授权配对与业务同步迁移计划](../plans/2026-05-25-reticulum-authorized-sync-migration-plan.md)
> - [ECS 通信栈](ECS-communication-stack.md)

---

## 1. 背景与动机

ExoMind 的 Reticulum 组网实践中发现，Reticulum 自身只解决“底层能连接后，怎样连得上并传输数据”的问题——它把物理介质（TCP、UDP、LoRa、蓝牙）一视同仁，统称为 Interface。但 **“用什么物理介质连接” 是一个独立的、可配置的、需要管理的层**，Reticulum 不负责、也不应该负责这一层的策略。

当前项目中已经出现了多个”打通物理层”的实践：

1. **UdpDiscoveryBridge（原 MdnsBridge）**：mDNS 或文件注册表作为发现源 → 创建 UDP Interface → Reticulum 通过 UDP 互发 Announce。产出总是 Reticulum UDP Interface，发现源可以是 mDNS、文件注册表、或未来的其他来源。
2. **RET_MESH_SEED（TcpClient）**：环境变量配置远程地址 → 创建 TcpClient Interface → Reticulum 通过 TCP 互连。这是另一条物理联通路径，不经过 UDP，有自己独立的发现源（用户配置）。
3. **本地文件作为物理联通方式（远期）**：文件系统本身就是一种可达介质（双方写入 JSONL 即可通信），不依赖于 UDP/TCP。本机文件注册表只是临时方案——文件本身可以直接承载 Reticulum 数据流，不限于”发现”。

两者本质上是同一种模式的不同“发现源”。需要一个新的概念来统摄它们：**物理联通层**。

---

## 2. 三层架构

```
┌──────────────────────────────────────────┐
│ 验证 / 授权 / 同步（应用层）              │ ← 不因联通方式变化
│ MeshState, PeerInfo, scope grants, relay │
├──────────────────────────────────────────┤
│ Reticulum（发现、传输、数据类型）          │ ← 把下层当物理层，一视同仁
│ Announce, Link, Packet, PathTable        │
│ identity_hex, destination                │
├──────────────────────────────────────────┤
│ 物理联通层（Physical Connectivity Layer） │ ← 新概念
│  发现源          │  连接管理             │
│  mDNS+UDP(局域网) │  远程地址表(互联网)    │
│  AutoInterface   │  RemotePeerManager   │
│  (动态发现)       │  (定点配置)           │
│                  │                      │
│  ←—— 打通物理链路，不验证，不传输业务数据 ——→ │
└──────────────────────────────────────────┘
```

### 2.1 职责边界

| 职责 | 属于物理联通层？ | 说明 |
|------|----------------|------|
| 发现局域网设备 | ✅ | mDNS 浏览 / UDP 广播 |
| 创建 Reticulum Interface | ✅ | `add_udp_interface`, `add_tcp_client` |
| 管理远程地址配置 | ✅ | 持久化、自动重连、健康检查 |
| 管理 Interface 生命周期 | ✅ | 创建/销毁/重建 |
| 流量计量（字节计数） | ✅ | 每个 Interface 的 tx/rx 统计 |
| 设备验证、配对 | ❌ | 属于 Reticulum 层（Link/PIN） |
| 授权、scope grant | ❌ | 属于应用层 |
| 业务数据同步 | ❌ | 属于应用层 |

### 2.2 设计原则

1. **发现源与连接机制分离**：mDNS、UDP 广播、远程地址表都是发现源，它们都产出同一件事——“有一个 peer 可连了”。至于连上后怎么交互，那是 Reticulum 的事。
2. **物理联通层不持久的密钥状态**：它只跟踪“连了什么地址”，不跟踪“这个地址是否被授权”。授权是 Reticulum/PIN 的事。
3. **不通则告警，不断重试**：远程地址连接断开时，物理联通层负责重试和状态上报，但不做降级授权（不能因为连不上就降低安全要求）。
4. **可配置、可扩展**：新的连接方式（蓝牙、I2P、中继）只要实现“发现源 → 创建 Interface”的模式，就能接入物理联通层。

---

## 3. 已实现的联通方式

### 3.1 UdpDiscoveryBridge（原 MdnsBridge）

**文件**：`crates/exomind-net-pairing/src/mdns_bridge.rs`

**流程**：
1. 发现源（mDNS TXT 或文件注册表）提供 peer 的 `ret_port`
2. `UdpDiscoveryBridge::on_peer_resolved()` 收到发现事件
3. 调用 `add_udp_interface(bind_addr, forward_addr=Some(peer_ip:ret_port))` 创建指向对端的 UDP 信道
4. Reticulum 通过该 UDP Interface 互发 Announce
5. 对端收到 Announce → 出现在 `/mesh/ret/peers`

**特点**：发现源可插拔（mDNS、文件扫描、未来的其他来源），但产出总是 Reticulum UDP Interface。不同的物理联通方式有各自独立的 Bridge，互不统属。

> **主 UDP 接口**（`try_start_ret_mesh` 中创建）不再使用固定端口偏移 `default_ret_udp_port(http_port)`。改为绑定 `0.0.0.0:0`（OS 自动分配），`forward_addr=None`（仅接收，不主动宣告）。主动宣告通过 mDNS/文件注册表发现后创建的*定向* UDP 接口进行。实际绑定端口在 `state.ret_udp_port`（`Arc<AtomicU16>`）中记录，并在 `try_push_ret_mesh_snapshot` 的 SSE `interfaces` 字段中暴露。

### 3.2 TCP 种子连接（RET_MESH_SEED）

**文件**：`crates/exomind-runtime/src/lib.rs`（`try_start_ret_mesh`）

**流程**：
1. 环境变量 `RET_MESH_SEED=ip:port` 传入远程地址
2. `add_tcp_client(&transport, &seed)` 创建 TcpClient Interface
3. 500ms 后 `node.announce()` 通过所有 Interface 传播
4. 远程 seed 收到 Announce → 双向发现

**特点**：需要手动配置，适合互联网定点连接。

---

### 3.3 本机文件注册表（Local Peer Registry）

**文件**：`crates/exomind-runtime/src/lib.rs`（`ret_mesh_background`）

**流程**：
1. 启动时写入 `%TEMP%/exomind-ret-peers/{host_id}.json`，含 `host_id`、`host`、`ret_port`（来自 `state.ret_udp_port`，即 OS 动态分配的 UDP 端口）
2. 每个后台 tick（10s）扫描该目录下的 JSON 文件
3. 发现新的 peer → `UdpDiscoveryBridge::on_peer_resolved()` → `add_udp_interface(forward=127.0.0.1:ret_port)`
4. Reticulum 通过该 UDP Interface 互发 Announce

**特点**：零配置，纯本机自动发现。绕过 Windows 回环接口不转发 UDP 广播的限制。

> **注意**：本机文件注册表是 UDP/mDNS 在本机跑不通时的**权宜方案**。文件系统本身是 Reticulum 底层可接上的天然介质——双方通过 JSONL 文件直接通信是完全可行的物理联通方式，不限于"发现"。当前仅用了文件的"发现"层面。"

**踩坑记录**：
- Windows 回环接口**不转发** `255.255.255.255` 的 UDP 广播到本地其他 socket，即使开启了 `SO_REUSEADDR`。这是纯 UDP 广播不能单独做本机发现的原因。`mDNS` 依赖组播（`224.0.0.251:5353`），Windows 回环同样不支持组播加组，因此 mDNS+UdpDiscoveryBridge 在本机场景下也无法工作。
- `SO_REUSEADDR` 用 `socket2` crate 替代 `std::net::UdpSocket` 在 Windows 上生效，允许多个实例绑定同一 UDP 端口。但它是 UDP 通道的**必要条件**而非充分条件——没有发现源对端的地址，UDP 广播收了也没人解析。
- `RET_MESH_SEED` 是在本文件注册表上线前唯一能跑通本机双实例的方式，但它依赖用户手动配置 TCP 地址，本质是 TCP 点对点连接而非广播发现。

## 4. 开关控制：三态暴露策略

> **2026-05-26 修正**：三态开关的附着点是**每个 Reticulum Interface**，而非抽象的「联通方式」概念。原因：
> 1. 联通方式没有 UI 呈现，开关无处放置；Interface 已在「下层接口」面板中展示，有实体的附着位置
> 2. Interface 是运行时真实的连接实体，开关可直接控制其行为（暂停/关闭/启用），不经过间接映射
> 3. 更细粒度 = 更灵活：可对特定 TCP seed 独立配置，不影响其他连接

每个 Reticulum Interface 使用一个**三态开关**控制其行为。全局也有一个总闸，二者取 min 为最终行为。

### 4.1 三态定义

| 状态 | 语义 | Interface 行为 |
|------|------|---------------|
| `Off` | 关闭该接口 | 从 `InterfaceManager` 中移除/停用 |
| `Passive` | 只收不发（隐匿） | Interface 保留但 TX 通道静默（不发送 announce/数据包） |
| `Active` | 完整宣告（默认） | Interface TX+RX 正常工作 |

### 4.2 控制模型

```
最终行为 = min(全局总闸, 该 Interface 的开关)
```

全局总闸也是三态：
- `Off` → Reticulum 完全不启动
- `Passive` → Reticulum 启动但不发 announce（隐匿模式：只有已知/已配对 peer 能连）
- `Active` → 完整模式（默认）

**不是独立的两层开关**——`enable=0` 且 `announce=1` 这种状态浪费不存在。三态是最少状态数表达完整语义的方案。

**实现要点（已落地的全局总闸）：** `ret_mesh_mode: Arc<AtomicU8>` 三态枚举已替换 `AtomicBool`，API、SSE snapshot、前端 UI 均已就绪。

**待实现（按 Interface 的开关）：**
- `InterfaceManager` 新增 `set_interface_mode(address, mode)` 方法，在 `LocalInterface` 中存储 `mode` 字段
- `InterfaceManager::send(TxMessage)` 中检查每个 iface 的 mode → Passive 模式下跳过 TX
- Off 模式下从 `ifaces` 中移除该接口并调用 `stop.cancel()`
- `InterfaceInfo` 新增 `mode` 字段
- 前端「下层接口」面板每行增加三段式按钮
- 接口的动态创建/销毁仍需保持：新发现 peer → 创建接口、metadata 变化 → 更新接口

### 4.3 后续：按 peer 的开关

按 Interface 粒度之后，进一步的方向是按 peer 粒度（对特定对端的 announce/数据流做单独控制）。这需要变动 `InterfaceManager::send()` 内部逻辑，工作量较大，暂存档不实现。

## 5. 待实现的联通方式

### 5.1 RemotePeerManager（远程地址表）

> **✅ 方向已决策 — 方向 B**：每配置一个远程地址，注册一个独立的 Reticulum Interface（`add_tcp_client` / 未来 `add_udp_interface`）。每个 Interface 独立应用三态开关。
>
> **不经过 UdpDiscoveryBridge**：远程连接是完全独立的物理联通路径，有自己的发现源（用户手动配置的地址表），不依赖、也不经过 UdpDiscoveryBridge 的 mDNS/文件发现逻辑。
>
> **客户端与服务端角色区分**：
>
> | 角色 | 含义 | 最大开关状态 | 原因 |
> |------|------|------------|------|
> | **Client** | 主动连接到已知对端地址 | **Active**（三态全可用） | 知道对端地址，可以发 announce |
> | **Server** | 被动接受远程连接的 TCP/UDP 服务端 | **Passive**（Off / Passive 二选一） | 不知道客户端地址，无法主动 announce；只有客户端连接后才知道，届时 Reticulum 层的 announce 才能到对端 |
>
> 后续 UI 上配置远程连接时需区分角色：
> - "连接到远程地址" → Client 角色，可设为 Active（完整宣告）
> - "开放连接端口" → Server 角色，最多设为 Passive（只收不发）

**命名**：`RemotePeerManager`，但管理的是**每地址独立 Interface**（方向 B），不是集中式地址表（方向 A）。

```rust
pub struct RemotePeerManager {
    transport: Transport,
    known: Arc<RwLock<HashMap<String, RemotePeerEntry>>>,
}

struct RemotePeerEntry {
    host_id: String,
    address: String,      // "192.168.1.100:5590" 或 "example.com:5590"
    transport_type: TransportType,  // Tcp | Udp
    added_at: Instant,
    last_seen: Option<Instant>,
    status: PeerReachability,
}
```

**功能**：
- 启动时加载持久化的远程地址列表
- 对每个地址调用 `add_tcp_client` 建立连接
- 周期性检查可达性（通过 Reticulum Announce 超时判断）
- UI 上可增删远程地址
- 类似 Minecraft 多人联机的“直接连接”

**不对称性处理**：远程连接通常由本端主动发起（`add_tcp_client`），对端作为 TCP Server 被动接受。UI 上需区分“本端主动连接”和“接受对端连接”。

### 5.2 Interface 流量计量

在每个 Interface 的 tx/rx 循环中添加 `AtomicU64` 计数器：

```rust
// 在 InterfaceManager 或每个 Interface 实例中
pub struct InterfaceStats {
    pub rx_bytes: AtomicU64,
    pub tx_bytes: AtomicU64,
    pub rx_packets: AtomicU64,
    pub tx_packets: AtomicU64,
}
```

当前未实现。预留点：`InterfaceManager::send()`（`iface.rs:182-200`）是增加 tx 计数的自然位置；每个 Interface 的接收循环是增加 rx 计数的位置。

**优先级**：低。作为未来与生命理论结合的潜在方向（网络连接作为一种资源消耗的计量与追踪），当前不急于实现。

---

## 6. 与 Reticulum Interface 的关系

物理联通层**不是** Reticulum Interface 的一种——它是 Interface 的管理者。类比：

```
物理联通层 = 接线员（决定谁跟谁连）
Reticulum Interface = 电话线（负责传输字节）
Reticulum Transport = 电话交换机（路由和转发）
```

UdpDiscoveryBridge 和 RemotePeerManager 都是物理联通层的具体实现——它们创建、管理、销毁 Reticulum Interface 实例。物理联通层本质是**介质桥接器**：利用现有物理介质（UDP/TCP/文件）做桥接，在 Reticulum 下层实现”可连通性”。每种联通方式有自己独立的 Bridge，不统一归一个”发现桥”管理。

> 这也是 Python RNS 中 `AutoInterface` 在做的事——但 Python 版本把自动发现和接口管理混在了一个类里。我们用 Rust 做，把“发现源”和“接口管理”拆开，每个发现源独立实现，共享同一个接口管理层。

---

## 7. 能耗与性能追踪（远期）

在移动端（Android / iOS），网络连接的电量消耗是核心关切的。当前没有任何感知手段。远期可在物理联通层中：

1. 每个 Interface 记录收发字节数（`InterfaceStats`）
2. 按 Interface 类型（UDP/TCP）统计连接时长和休眠比例
3. 在 UI 上展示预估能耗（基于每字节功耗系数）
4. 在电量低时主动断开非关键远程连接

这与生命理论高度相关——网络连接作为一种资源消耗，与生物体的能量代谢有类比价值。但当前阶段仅作为潜在思路存档，不纳入实施路线。

---

## 8. 当前阶段判断

| 联通方式 / 控制维度 | 状态 | 优先级 |
|---------|------|--------|
| mDNS+UDP 自动发现 | ✅ 已实现（UdpDiscoveryBridge） | 已交付 |
| 本机文件注册表 | ✅ 已实现 | 已交付 |
| TCP 种子连接 | ✅ 已实现（RET_MESH_SEED） | 已交付 |
| 全局三态开关（Off/Passive/Active） | ✅ 已实现 — `RetMeshMode` 枚举 + API + UI | 已交付 |
| 按 Interface 三态开关 | 🔲 待实现 — `InterfaceManager.set_interface_mode()` + UX（每接口三段式按钮） | 中 |
| RemotePeerManager | 🔲 待实现 | 中 |
| 本地文件直接通信 | 📝 待探索 | 远期 |
| Interface 流量计量 | 🔲 待实现 | 低 |
| 能耗追踪 | 📝 存档思路 | 远期 |

当前物理联通层的主要缺口是 **RemotePeerManager**——它使 Reticulum 能覆盖互联网场景，而不仅限于局域网。它和 MdnsBridge 共享同一套代码模式（外层协调器 + Interface 生命周期管理），实现成本可控。

---

## 10. 待研究：联通方式 × Reticulum Interface 的理论区分

### 10.1 背景

工程实践中发现「联通方式」（物理联通层的发现/连接策略）和「Reticulum Interface」（运行时链路实体）是两个不同层级的概念，但当前设计文档和实现中对二者的边界不清晰：

| 概念 | 层级 | 角色 |
|------|------|------|
| 联通方式（Connectivity Method） | 配置层 | 发现源/连接策略，决定"用什么介质找对端" |
| Reticulum Interface | 运行时层 | 实际链路，决定"数据走哪条通道" |

### 10.2 需要研究的问题

1. **Reticulum 协议在 Interface 层面的理论假设是什么？** 手册中 Interface 被设计为"对物理介质的一视同仁抽象"——但这个抽象背后隐含的假设（如所有链路带宽等同、默认 MTU 单一、TX/RX 对称）在 ExoNet 的局域网/互联网场景下是否成立？

2. **联通方式和 Interface 之间是否存在理论上的"多对多"映射？** 当前工程实现中一个联通方式（如 mDNS 浏览）可以产出多个 Interface，但反过来一个 Interface 是否能属于多个联通方式？这种映射关系在 CCC（连接可组合）理论框架下如何表达？

3. **三层架构（物理联通层 → Reticulum Transport → 应用层）中的每一层，其三态开关语义是什么？**
   - 联通方式三态：Off=不启动该发现源 / Passive=仅接收已有链路但不主动发现 / Active=完整发现
   - Interface 三态：Off=断开该链路 / Passive=仅接收（RX-only）/ Active=完整 TX+RX
   - 这两层开关的 `min()` 组合如何计算？

4. **UI 呈现上，联通方式和 Interface 应该如何分区？**
   - 联通方式 → 设置面板（配置层，控制开启哪些发现通道）
   - Interface → 网络状态卡片（运行时层，查看/控制每条实际链路）
   - 二者的视觉区分和交互边界在哪里？

5. **如果联通方式也需要三态开关，它的 UI 位置在哪里？** 当前联通方式（mDNS 浏览、文件注册表扫描、RET_MESH_SEED 配置）都没有 UI 表示——是先要有"联通方式列表"的 UI，还是等具体需求再设计？

### 10.3 建议方法

建议在 Reticulum-research 仓库的 ARA 中以研究课题形式展开，先读 Reticulum 手册中 Interface 设计哲学章节，再对照当前工程的 `InterfaceManager`/`UdpDiscoveryBridge`/文件注册表代码，形成理论对照表。产出可以是「联通方式与 Reticulum Interface 的理论区分」章节，补充到 `physical-connectivity-layer.md`。

---

## 9. 已知问题

### 9.1 ~~PIN 配对流程缺少发起方「显示配对码」UI~~ ✅ 已解决

**解决方案（2026-05-26）**：新增 `POST /mesh/ret/peers/:peer_id/initiate-pair` 端点，调用 `PairingManager::initiate()` 生成 6 位 PIN 与 session_id，返回 `{ session_id, pin, peer_id, peer_host_id }` 给前端。前端「授权」按钮点击后先调此端点，展示 PIN 数字弹窗（发起方视角），弹窗底部有「改为输入配对码」链接可切换至现有的 PIN 输入模式（响应方视角）。

**完整闭环**：
```
发起方（设备 A）                            响应方（设备 B）
  POST /initiate-pair → 生成PIN             (人眼读取 PIN)
  展示 PIN: 123456  ──── 看屏幕 ───────→    点击「授权」
                                            → 改为输入配对码
                                            → 输入 123456
                                            → POST /pair { pin }
                                            → 发送至 Reticulum Link
  ←── 验证 PIN ✓ ── PairingResult ──────→    ←── 已授权
  SSE 更新 → 已授权
```

**变更文件**：
- `crates/exomind-runtime/src/routes/mesh.rs` — 新增 `InitiateRetPairResponse` + `initiate_ret_pair` 处理器 + 路由
- `crates/exomind-runtime/tests/mesh_routes_integration.rs` — 2 个新测试：PIN 生成验证 + 联动 pair 验证
- `src/ui/app/pages/agents/DeviceView.tsx` — PIN 展示弹窗 + `handleInitiatePair` + 按钮逻辑
- `tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx` — 测试适配新流程

### 9.2 ~~mDNS 状态计数更新但节点列表不刷新（需页面重载）~~ ✅ 已解决

**根因**：`try_push_ret_mesh_snapshot` 读取 `state.ret_mesh_peers` 仅用于统计计数，未将 peer 数据转换为 JSON 写入 `payload.peers`。

**解决方案（2026-05-26）**：在 `try_push_ret_mesh_snapshot` 中，读取 peers map 后将其转换为 `connection_state`、`authorized` 等字段的 JSON 数组，写入 `payload.peers`。转换逻辑与 `GET /mesh/ret/peers` 端点（`ret_peer_state_public`）保持一致，前端 SSE handler 中已有的 `if (payload.peers) setPeers(payload.peers)` 可直接使用。

**变更文件**：
- `crates/exomind-runtime/src/lib.rs` — `try_push_ret_mesh_snapshot` 新增 peers 字段
- `crates/exomind-runtime/src/lib.rs` — 新增 `#[cfg(test)]` 测试验证 snapshot 含 peers
