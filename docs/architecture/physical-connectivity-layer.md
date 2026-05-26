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
│ Reticulum（多跳自组织网络）               │ ← 把下层当物理层，一视同仁
│ 路由: PathTable/PathRequest, 跳数择优    │
│ Announce 扩散, Link 跨节点建立, Packet 转发│
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
- **接口删除**：`udp.rs` `spawn()` 需改用 `context.channel.stop` 而非本地 `CancellationToken::new()`，使外部 `remove_interface(name)` 能永久停止接口循环（详见迁移计划 §11 接口删除章节）

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

### 9.3 ~~🔴 双实例 Reticulum 发现层不通~~ ✅ 已解决 — Transport 死锁

**现象**：同机双实例 Reticulum 互发现失败。API 返回 `mesh_enabled: true` 但 peer 列表始终为空。`ret_mesh_background` 的 tick 在 #16 后停止。

**根因（2026-05-26，经 tracing + CodeGraph + Wireshark 三重验证定位）**：

**死锁链**：
```
packet RX task (manage_transport)          ret_mesh_background (tick)
  handler.lock() ✅                          |
  → handle_announce()                        |  node.announce()
    → handler.send()                         |  → send_announce()
      → iface_mgr.lock() ✅                  |    → handler.lock() ❌ BLOCKED
        → for each iface:                    |      (锁被 RX task 持有)
            tx_send.send().await ⏳          |
              → channel full (cap=1)          → 永远阻塞
              → handler 锁 不释放              → tick 停止
              → iface_mgr 锁 不释放            → 无 announce 发出
```

**触发条件**：
1. 旧实例的 mDNS 条目 → 创建 10+ 定向 UDP 接口
2. WSAECONNRESET 杀死所有定向接口的 RX task
3. TX task 仍存活但 rx-only 接口无 TX task → tx_channel 满
4. `iface_mgr.send()` 在满 channel 上 `send().await` 阻塞
5. handler + iface_mgr 双重锁被持有 → background task 永远停在第 16 个 tick 附近

**修复**（`reticulum-rs/src/iface.rs`）：
```
- tx_send.send(message).await     // 阻塞 → 死锁
+ tx_send.try_send(message)       // 非阻塞 → 满则丢，不阻塞
```

Announce 是 10s 间隔的幂等操作，丢一个不影响整体发现。

**效果验证**：
- ✅ tick 从 #16（死锁上限）提升到 **#46+**（持续运行）
- ✅ 双向 Reticulum 互发现成功（`announce_rx` 双向命中）
- ✅ 跨实例 PIN 配对端到端通过（Tauri MCP 实测）
- ✅ `send_to` 正常发送 299 字节 announce 包
- ✅ rx-only 接口 channel-full warning 正常（预期行为，无 TX task）

### 9.4 🔴 危险模式：跨 await 持锁（MutexGuard 泄漏）

死锁的深层根因不是某一行代码，而是一种结构性问题：**持有 `MutexGuard` 时跨 `.await` 执行异步操作**。`tokio::Mutex` 的 guard 在 `.await` 时不释放，锁被"带入睡梦"。

#### 已确认的 3 处危险点

| # | 位置 | 锁 | 跨 await 操作 | 风险 |
|---|------|-----|-------------|------|
| 1 | `iface.rs:238` | iface_mgr | `tx_send.send(msg).await` | channel 满时永久阻塞 |
| 2 | `transport.rs:811` | handler | `handler.send(message).await` → 取 iface_mgr 锁 | 双层锁死锁 |
| 3 | `transport.rs:1245` | handler | 贯穿 match → `handle_announce` | 锁 A 被子函数继续持有 |

#### 判断标准

```
持锁 → await → 仍持锁    ❌ 危险
await → 持锁 → drop → await ✅ 安全
持锁 → drop → await       ✅ 安全
```

**核心认知**：`tokio::sync::MutexGuard` 不是一个普通的同步锁，它在 `.await` 时**不释放**。锁的不是代码区域，而是**持有 guard 的整个 async 栈帧**。只要 MutexGuard 在栈上，任何 `.await` 都可能成为死锁入口。

#### 修复方向

1. **iface.rs**：`try_send` 在 `Full` 时直接 `drop(msg)`，不走阻塞 fallback
2. **transport.rs handle_announce**：入口处提取所需配置字段，显式 `drop(handler)` 释放锁 A，锁外再发 announce_tx
3. **transport.rs manage_transport RX 循环**：锁内只读报文头确定类型，`drop(handler)` 后分发到专用 handler

#### 架构改进：接口发送并行化

当前 `iface_mgr.send()` 串行遍历所有接口逐个 `try_send`。该设计继承自 Python RNS 的同步心智——Python 版本也逐接口串行 `send()`。Rust 移植版直接沿用了同样的循环结构。

虽然 `try_send` 已解决阻塞问题，但串行遍历仍有两个弱点：
1. **一个僵尸接口拖慢全局发送延迟**（虽不阻塞，但累积延迟）
2. **缺乏接口健康度反馈**——无法识别哪些接口已死亡

改进方向：用 `futures::future::join_all` 并行发往所有接口，配合超时机制淘汰僵尸接口。详见迁移计划 §11 架构改进项。

详见迁移计划 §11 恢复入口/安全加固章节。

### 系统级缺失：Reticulum Transport 内部 tracing

本次排查暴露的最大瓶颈：Reticulum rust Transport 的 tracing 覆盖严重不足。以下是需要增补的关键 tracing 点：

#### Transport 层（`Reticulum/experiment/rs/src/transport.rs`）

| 追踪点 | 位置 | 用途 |
|--------|------|------|
| `announce_tx.send()` | announce handler | 确认 announce 是否被发送到广播通道 |
| `announce_rx.recv()` 结果 | 调用方 | 确认接收方是否收到了 announce |
| 接口数据接收（`RcMessage` / `RxMessage`） | iface 循环 → transport | 确认数据是否从 iface 进入 transport |
| announce packet 解码 | `handle_announce` | 确认收到的 packet 是否能被识别为 announce |
| TCP client/server 连接事件 | `tcp_client.rs` / `tcp_server.rs` | 确认连接建立和断开的完整生命周期 |
| 路径表更新 | `path_table.rs` | 确认 announce 是否更新了路径表 |

#### 应用层（`exomind-runtime/src/lib.rs`）

| 追踪点 | 位置 | 用途 |
|--------|------|------|
| `tokio::select!` 分支命中计数 | `ret_mesh_background` 循环 | 确认哪个分支被频繁选中（tick 饥渴验证） |
| `announce_rx.recv()` 返回值 | `ret_mesh_background` line 1995 | 确认是 `Ok` / `Lagged` / `Closed` |
| `tick.tick()` 实际触发 | `ret_mesh_background` line 2076 | 确认 tick 是否真的被 select 调度 |

#### 日志级别建议

关键追踪点使用 `tracing::info!` 或 `tracing::debug!`（可在运行时通过环境变量 `RUST_LOG` 打开）。高频路径（如 per-packet 处理）使用 `tracing::trace!`。

```bash
# 运行时打开 debug 级别 Reticulum 日志
RUST_LOG=reticulum=debug exomind

# 或针对特定模块
RUST_LOG=reticulum::transport=debug,reticulum::iface::udp=debug exomind
```
