# ExoMind-Net 能力特性 DAG 概念设计（Capability Trait DAG）

> 版本：v0.1-concept
> 日期：2026-03-20
> 性质：概念探索，替代 v3 八层模型的新组织范式
> 前置阅读：PR #595 启发性分析评论 · Issue #594 RT 间连接案例

---

## 一、核心思想

### 1.1 传统协议是"能力捆绑包"

TCP = 可靠传输 + 有序交付 + 流控 + 拥塞控制。你不能只取其中一部分——它们被打包成一个不可分割的整体。QUIC 更甚——在 TCP 的基础上捆绑了加密、多路复用、连接迁移。

这种捆绑在标准化时代是优势（降低协商复杂度），但在 ExoMind 的异构设备场景中成了障碍：
- BLE 手表不需要拥塞控制（BLE 带宽本就极低）
- 同机进程不需要加密（物理安全）
- 已有 HTTPS 通道不需要再套一层 TLS

### 1.2 新范式：拆包为特性，用 DAG 管理依赖

把协议的能力拆解为原子化的**特性（Trait）**，用有向无环图表达它们之间的依赖关系。每次连接只启用需要的特性子集，系统自动推导依赖、计算封装顺序、生成帧结构。

```
传统："我们用 QUIC 通信"（名词，固定协议）
新范式："我们用一个 {可靠+加密+多路复用} 的通道通信"（形容词集合）
```

协议不再是名词，而是形容词的集合。

### 1.3 与生命科学的统一

这个思路与 ExoMind 的「适应性发育」理念同构——同一基因组（能力特性 DAG）在不同环境（BLE / QUIC / Unix Socket）下发育出不同形态（启用不同特性子集）。协议栈不再是预制件，而是从能力基因组中按环境发育出来的。

---

## 二、特性 DAG 定义

### 2.1 特性节点

每个特性是 DAG 中的一个节点，表达一个**可感知的能力意图**。粒度为粗粒度——表达"我要加密"而不是"用 AES-256-GCM"。

```rust
struct TraitNode {
    id: TraitId,              // 如 "encryption", "reliable", "compression"
    priority: u32,            // 全局固定优先级（封装顺序的唯一决定因素）
    affects_framing: bool,    // true = 影响帧结构（参与拓扑排序）
                              // false = 只影响传输行为（如 reliable, flow_ctrl）
    dependencies: Vec<TraitId>, // DAG 中的入边（我依赖谁）
    estimated_cost: TraitCost,  // 协商阶段可参考的成本估算
}

struct TraitCost {
    cpu_overhead: f32,        // 相对 CPU 开销（0.0-1.0）
    latency_us: u32,          // 增加的延迟（微秒）
    bandwidth_overhead: f32,  // 带宽膨胀率（如加密约 1.02）
}
```

特性成本在**协商阶段可用**（帮助决策是否启用 preferred 特性），一旦确定协议就直接执行，运行时不再评估成本。

### 2.2 完整特性 DAG

```
                         addressing
                        /    |     \
               port_mux   checksum  encryption ← 独立分支！
                  |                    |
              datagram            authentication
             / |  |  \
   reliable  stream  fragment  nat_traversal
       |      mux
    ordered
       |
   flow_ctrl
       |
   congestion_ctrl
```

**关键拓扑特征**：`encryption` 不依赖 `datagram`——加密只需要知道对端身份（addressing），不需要先有可靠传输。这打破了 OSI 中 TLS 必须在 TCP 之上的假设。

### 2.3 特性分类

不使用层号分类。DAG 的自然连通子图就是「族」——这些族自动涌现，不需要人工标注：

| 族 | 包含的特性 | 涌现方式 |
|---|---------|--------|
| **寻址族** | addressing, port_mux | 图的根节点区域 |
| **可靠族** | datagram, reliable, ordered, flow_ctrl, congestion_ctrl | addressing → datagram 的下游链 |
| **安全族** | encryption, authentication, integrity, chained_signature | addressing → encryption 的独立分支 |
| **优化族** | compression, delta_encoding, deduplication | 无依赖或弱依赖的独立节点 |
| **传输族** | stream_mux, connection_migration, nat_traversal, fragmentation | datagram 的平行分支 |

开发者通过查看图结构就能理解系统全貌，不需要记忆层号。

### 2.4 互斥与约束

互斥关系不在 DAG 中表达（DAG 保持纯依赖图），而在协商逻辑中用约束规则检查：

```rust
fn validate_trait_set(traits: &TraitSet) -> Result<(), ConstraintViolation> {
    if traits.contains("reliable") && traits.contains("best_effort") {
        return Err(ConstraintViolation::Conflict("reliable", "best_effort"));
    }
    Ok(())
}
```

---

## 三、优先级拓扑排序算法

### 3.1 问题定义

DAG 中的依赖边给出了合法的偏序关系，但数据最终要线性封装为字节流。需要从偏序中确定性地生成唯一全序。

```
输入：
  - 启用的封装特性集合 S（affects_framing = true）
  - 依赖边 E（功能依赖 + 语义约束）
  - 全局优先级函数 P: S → Z（优先级全局唯一）

输出：
  - S 的唯一线性顺序 L
  - 满足：若 (a,b) ∈ E，则 a 在 L 中排在 b 前面
  - 优先级小的排前面（越小 = 越靠近原始数据 = 内层）
```

### 3.2 算法：Kahn + MinHeap

```python
def priority_toposort(traits, edges, priority):
    in_degree = {t: 0 for t in traits}
    adj = {t: [] for t in traits}
    for a, b in edges:
        adj[a].append(b)
        in_degree[b] += 1

    heap = MinHeap()
    for t in traits:
        if in_degree[t] == 0:
            heap.push((priority[t], t))

    result = []
    while heap:
        _, trait = heap.pop()  # 每次取优先级最小的
        result.append(trait)
        for neighbor in adj[trait]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                heap.push((priority[neighbor], neighbor))

    assert len(result) == len(traits), "DAG has cycle"
    return result
```

**唯一性保证**：优先级全局唯一 → MinHeap 每次弹出的节点确定 → 结果唯一。

**复杂度**：O(V + E)，V = 特性数，E = 依赖边数。一次协商计算一次，后续零开销。

### 3.3 全局优先级表

优先级编码了封装语义——什么在内层，什么在外层：

```
原则                          优先级段    理由
内容变换 (Content Transform)   100 段     最靠近原始数据
体积优化 (Size Optimization)   200 段     压缩必须在加密前（加密后高熵不可压缩）
完整性证明 (Integrity Proof)   300 段     签名覆盖压缩后内容（对端先验签再解压）
保密屏障 (Confidentiality)     400 段     最外层加密（攻击者看不到内容和签名）
传输封装 (Transport Framing)   500 段     分片、帧头在最外层
```

具体赋值：

| 特性 | 优先级 | 段 |
|------|-------|---|
| content_transform | 100 | 内容变换 |
| delta_encoding | 110 | 内容变换 |
| compression | 200 | 体积优化 |
| deduplication | 210 | 体积优化 |
| checksum | 300 | 完整性 |
| integrity | 310 | 完整性 |
| chained_signature | 320 | 完整性 |
| encryption | 400 | 保密 |
| authentication | 410 | 保密 |
| fragmentation | 500 | 传输封装 |
| framing | 510 | 传输封装 |

### 3.4 语义约束边

除了功能依赖边，还有语义约束边：

```
功能依赖：encryption → addressing       （加密需要知道对端身份）
语义约束：compression → encryption      （压缩在加密前，否则无效）
语义约束：integrity → encryption        （签名在加密内，否则泄露）
```

两种边在算法中同等对待。区分只是为了文档可读性。

### 3.5 执行示例

```
cognitive profile 启用 = {compression, integrity, chained_signature, encryption, framing}

Kahn + MinHeap 执行：
  Round 1: 堆 = {(200, compression), (310, integrity)} → 弹出 compression
  Round 2: 堆 = {(310, integrity)} → 弹出 integrity
  Round 3: 堆 = {(320, chained_signature)} → 弹出 chained_signature
  Round 4: 堆 = {(400, encryption)} → 弹出 encryption
  Round 5: 堆 = {(510, framing)} → 弹出 framing

结果 L = [compression, integrity, chained_signature, encryption, framing]

封装：data → compress → sign → chain_sign → encrypt → frame
解码：unframe → decrypt → verify_chain → verify_sign → decompress → data
```

---

## 四、协商协议

### 4.1 信号 Profile

```rust
struct SignalProfile {
    name: String,                      // "cognitive", "sensor", "file_transfer"
    required_traits: Vec<TraitId>,     // 必须启用
    preferred_traits: Vec<TraitId>,    // 希望启用
}
```

### 4.2 协商流程

```
发起方 → ConnectRequest:
  · node_id, public_key, pairing_proof
  · signal_profiles[]
  · baseline_traits (底层已有)
  · device_capabilities (L0, 独立管理)
  · protocol_version (含特性表版本)
  （用 PAKE 配对密钥签名保护）

响应方 → ConnectResponse:
  · negotiated_profiles[] { name, enabled_traits, transport_type }
  · rejected_profiles[] { name, reason }
  · pairing_confirmation
```

### 4.3 依赖推导

协商时自动推导缺失的依赖：

```
需要 = {reliable, encryption}
baseline = {addressing, port_mux, checksum}
推导：reliable → datagram → addressing ✓ → 需要额外启用 datagram
      encryption → addressing ✓ → 无需额外
最终 enabled = {datagram, reliable, encryption}
```

### 4.4 协商失败

required 不满足 → 拒绝该 profile，明确原因可追溯。其他 profile 不受影响。

### 4.5 传输方式选择（特性驱动）

```
reliable 启用? → QUIC stream
只有 datagram? → QUIC DATAGRAM 帧 (RFC 9221)
不需要 encryption 且同机? → 裸 Unix Socket
```

### 4.6 安全性

协商消息用 PAKE 配对密钥保护。中间人无法伪造 → 无法降级攻击。

### 4.7 版本管理

协议版本号包含特性表版本。不兼容 → 拒绝连接。

### 4.8 动态重协商

支持但 MVP = 断开重连。

---

## 五、帧结构生成

### 5.1 原则

帧结构从特性 DAG + 优先级表**自动生成**，不手工定义。

### 5.2 封装特性 vs 传输特性

```
affects_framing = true：compression, integrity, chained_signature,
                        encryption, fragmentation, framing
  → 参与拓扑排序，决定帧结构

affects_framing = false：reliable, ordered, flow_ctrl, congestion_ctrl,
                         stream_mux, connection_migration, nat_traversal
  → 只决定传输通道类型
```

### 5.3 帧格式

```
[Magic(2)][Flags(1)][Nonce(8)][Len(4)][Payload]
 0xEE4D
```

Flags 由拓扑排序结果自动生成。对端按逆序解码。协商确定后运行时不携带处理序列。

---

## 六、多跳模型

A 和 C 端到端协商特性。B 只负责路由转发，不解封装。类似数据链路层（逐跳）与网络层（端到端）的分离，在特性 DAG 框架内重建。

---

## 七、传统协议的特性分解

| 协议 | 解锁的特性 | 特性数 |
|------|---------|-------|
| UDP | addressing, port_mux, checksum, datagram | 4 |
| TCP | UDP + reliable, ordered, flow_ctrl, congestion_ctrl, connection_state | 9 |
| QUIC | TCP + encryption, authentication, stream_mux, connection_migration | 12 |
| BLE | addressing, fragmentation, checksum | 3 |

---

## 八、与 v3 八层模型的关系

### 替代映射

| 原八层 | 特性 DAG 中的对应 |
|-------|----------------|
| L0 设备层 | 独立管理（NodeCapabilities），作为协商约束 |
| L1 承载层 | 底层承载检测 → baseline traits |
| L2 连接层 | 传输特性 + QUIC |
| L3 路由层 | 独立子系统（DHT + Spanning Tree） |
| L4 服务层 | Signal Profile 定义 |
| L5 会话层 | 安全族特性 + PAKE 配对 |
| L6 编码层 | 封装特性 + 拓扑排序 |
| L7 认知层 | DAG 的消费者和控制者（双向） |

### 保留的 v3 设计

- PAKE 设备配对、签名事件链 / Source Chain、帧 Magic 0xEE4D
- Kademlia DHT + Spanning Tree、E2E 加密

### 新增概念

- 能力特性 DAG、优先级拓扑排序、Signal Profile
- 特性协商、affects_framing 属性
- 信号代谢网络、适应性发育

---

## 九、开放问题

1. 特性 DAG 的精确完整列表：~16 个特性是否足够？
2. L3 路由与特性 DAG 的边界：路由是否完全独立？
3. 动态重协商的 in-place 切换方案
4. 多跳场景中继节点的路由信息暴露方式
5. 特性成本的自适应优化（协议达尔文主义）
6. 公共域（非配对节点）的特性协商方式
7. 与白皮书/论文的整合方式

---

*本文档是概念探索的阶段性整理。所有设计决策均来自对话讨论，不代表最终实现方案。*
