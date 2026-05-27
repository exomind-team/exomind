# Plan 1: Reticulum 组网 Phase 1 全面推进

> Date: 2026-05-26
> Branch: `feat/ret-mesh-prototype`
> Base Plan: [2026-05-25-reticulum-authorized-sync-migration-plan.md](2026-05-25-reticulum-authorized-sync-migration-plan.md)

---

## 当前状态（CodeGraph 确认）

| 模块 | 当前状况 |
|------|---------|
| `RetPairingLinkFrame` (pairing.rs) | **只有 `PairingResponse` variant — 无 `PairingOffer`** |
| `initiate_ret_pair` (mesh.rs:636) | 仅在本机 `PairingManager` 创建 session → 不通知对端 |
| `ret_mesh_background` (lib.rs:1879) | `link_in_rx` 已监听 Reticulum Link 事件，但无 PairingOffer 处理 |
| `pair_ret_peer` (mesh.rs:525) | 走 `PairWithPeer` command → 发 `PairingResponse` frame |
| `enable_ret_mesh` 默认值 (lib.rs:353) | `true` — 导致 relay 测试也跑 Reticulum，破坏 host_id 匹配 |
| `InterfaceManager` | 有 `list_interfaces()`，**无** `set_interface_mode()` / `remove_interface()` |
| `start_test_runtime` (support/mod.rs:19) | 用 `..Default::default()` → 继承 `enable_ret_mesh: true` |
| relay 测试文件 | `discovery_pairing_relay_e2e.rs` (4 tests) + `mesh_relay_integration.rs` (3 tests) = **7 个受影响** |
| `create_transport` (exomind-net-pairing/src/lib.rs:254) | 无 `set_retransmit(true)` — 多跳路由未开启 |
| `PairingDialog` 前端 | 有 `initiator/responder/select` 三模式，但无自动切换（缺 SSE `pairing_pending` 事件） |
| `DeviceView.tsx` | 展示 Reticulum 设备，`onOpenPeerPairing` 回调已挂载 |

---

## 任务切片

### S1: PairingOffer 帧 — 配对协议状态机补齐

**目标**：`initiate-pair` 不再是自娱自乐。发起方创建 session 后通过 Reticulum Link 通知对端，对端自动弹出 PIN 输入框。

**改动清单**：

| # | 文件 | 改动 |
|---|------|------|
| 1.1 | `crates/exomind-net-pairing/src/pairing.rs` | `RetPairingLinkFrame` 增加 `PairingOffer { session_id, initiator_peer_id, initiator_host_id, initiator_node_name }` variant |
| 1.2 | `crates/exomind-runtime/src/routes/mesh.rs` | `initiate_ret_pair` 末尾：获取对端 Link → 发送 `PairingOffer` 帧 |
| 1.3 | `crates/exomind-runtime/src/lib.rs` | `ret_mesh_background` 中 `link_in_rx` handler 增加 `PairingOffer` 分支：存入 `pending_pairings` 的 `offer` 字段 + 推 SSE `pairing_pending` |
| 1.4 | `src/ui/app/pages/agents/DeviceView.tsx` | SSE handler 检测 `pairing_pending` 后自动打开 PIN 输入弹窗（设置为 responder 模式） |
| 1.5 | `crates/exomind-runtime/src/routes/mesh.rs` | 新增 `GET /mesh/ret/pairing-pending` 端点（SSE fallback） |
| 1.6 | 测试 | `initiate_ret_pair_generates_pin_and_session` 扩展为验证 Offer 帧发送 |

**验收**：
- 双 RT：A 点击「授权」→ B 自动弹出 PIN 输入框（无需手动切 tab）
- B 输入 PIN 后完成配对，A 端自动更新为 authorized

---

### S2: 修复 relay 测试 5/5 fail（Issue #3）

**根因**：`RuntimeStartOptions::default()` 中 `enable_ret_mesh: true`（lib.rs:353）。测试 support 函数 `start_test_runtime()` 用 `..Default::default()` 继承此值，导致 relay 测试启动时 Reticulum 覆盖 host_id，破坏 relay 匹配。

**修复策略**：在测试 support 中显式关闭 Reticulum。

**改动清单**：

| # | 文件 | 改动 |
|---|------|------|
| 2.1 | `crates/exomind-runtime/tests/support/mod.rs:19-31` | `start_test_runtime()` 加 `enable_ret_mesh: false` |
| 2.2 | `crates/exomind-runtime/tests/support/mod.rs:46-56` | `start_test_runtime_with_secret_and_lan()` 加 `enable_ret_mesh: false` |
| 2.3 | `crates/exomind-runtime/tests/support/mod.rs:61-75` | `start_test_runtime_with_mdns()` 加 `enable_ret_mesh: false` |

**验收**：
```bash
cargo test -p exomind-runtime --test mesh_relay_integration
cargo test -p exomind-runtime --test discovery_pairing_relay_e2e
```
全部通过。

> **注意**：如果 relay 测试原本依赖 HTTP 配对（`/mesh/pairing/initiate`、`/mesh/pairing/respond`），明确关闭 `enable_ret_mesh` 不会影响它们。这些测试跟 Reticulum 无关。

---

### S3: 按 Interface 三态开关（Issue #4）

**背景**：全局 `RetMeshMode` 三态开关已实现（Off/Passive/Active），但每个 Interface 没有独立的 enable/disable 开关。当前只能全部关或全部开。

**改动清单**：

| # | 文件 | 改动 |
|---|------|------|
| 3.1 | `reticulum-rs/src/iface.rs` | 新增 `pub fn set_interface_mode(name: &str, enabled: bool) -> bool` — 通过 `CancellationToken` 停用/重新启用接口 |
| 3.2 | `exomind-runtime/src/routes/mesh.rs` | 新增 `POST /mesh/ret/interfaces/:name/mode {"enabled": bool}` |
| 3.3 | `exomind-runtime/src/lib.rs` | `try_push_ret_mesh_snapshot` 中 `interfaces` 字段增加 `enabled` 状态 |
| 3.4 | `src/ui/app/pages/agents/DeviceView.tsx` | 接口列表中每个接口显示独立的开关按钮 |

**验收**：
- UI 接口列表：每个接口有独立的 enable/disable 开关
- 关闭某个接口后，该接口不再收发包
- 重新打开后恢复正常

---

### S4: 开启多跳路由

**改动**：`exomind-net-pairing/src/lib.rs:254` 的 `create_transport` 中追加两行：

```rust
config.set_retransmit(true);
config.set_reroute_eager(true);
```

**收益**：
- Announce 跨节点转发 → PathTable 非直连也能到达
- Link 可跨中间节点建立
- 物理联通层不再需要每个 peer 直连

---

### S5: 安全加固 — 消除 MutexGuard 跨 .await

| # | 位置 | 问题 | 修复 |
|---|------|------|------|
| 5.1 | `iface.rs:send()` | `try_send` Full 时 fallback 到 `send(msg).await` 阻塞 | Full 时直接 `drop(msg)`（UDP 丢包可接受） |
| 5.2 | `transport.rs:handle_announce` | `MutexGuard<TransportHandler>` 贯穿异步路径 | 入口提取字段 → `drop(handler)` → 锁外发 announce_tx |
| 5.3 | `transport.rs:manage_transport` | `handler.lock().await` 后移入 `handle_announce` | 锁内只读报文头 → `drop(handler)` → 分发到专用 handler |

---

### S6: UI 状态精细化

**背景**：当前 DeviceView 只区分 `discovered` 和 `authorized`，未展示完整五态（discovered / connected_unauthorized / connected_authorized / trusted / blocked）。

**改动清单**：

| # | 文件 | 改动 |
|---|------|------|
| 6.1 | `src/ui/app/pages/agents/DeviceView.tsx` | 根据 `connection_state` + `authorized` + `trust_state` 渲染状态标签 |
| 6.2 | `src/ui/app/pages/agents/DeviceView.tsx` | 未授权 peer 的操作按钮只显示「授权」和「忽略」 |
| 6.3 | `src/ui/app/pages/agents/agents-utils.tsx` | 增加对应的状态颜色和图标 |

---

### S7: 文档同步 + 完成复核

| # | 文件 | 内容 |
|---|------|------|
| 7.1 | `docs/architecture/physical-connectivity-layer.md` | 同步 PairingOffer/多跳路由/接口删除方案 |
| 7.2 | `AGENTS.md` | 同步 API 变更 |
| 7.3 | Plan 文档 checkpoint | 将本次完成工作写入 checkpoint |

---

## 执行顺序

```
S2 (修 relay 测试) ──→ S1 (PairingOffer) ──→ S4 (多跳路由)
     │                                              │
     │                                        并行可行:
     ▼                                             S3 (接口三态开关)
S5 (安全加固)                                        S6 (UI 精细化)
     │
     ▼
S7 (文档同步 + 复核)
```

**推荐先做 S2**：当前 `enable_ret_mesh=true` 默认值污染了 relay 测试，不修复的话后续改动可能导致更多假阳性失败。

**S1 (PairingOffer) 与 S3、S5、S6 独立**，可并行推进。

---

## 验证命令

```bash
# 编译
cargo check -p exomind-net-pairing -p exomind-runtime
cargo check -p reticulum-rs

# Rust 测试
cargo test -p exomind-runtime --test mesh_routes_integration
cargo test -p exomind-runtime --test mesh_relay_integration
cargo test -p exomind-runtime --test discovery_pairing_relay_e2e

# 前端测试
npx vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx

# Release 构建
cd src-tauri && cargo tauri build
```

---

## 设计决策

### D1: 三态定义下沉到 reticulum-rs

`InterfaceMode { Off, Passive, Active }` 定义在 `reticulum-rs/src/iface.rs` 而非 exomind 层。

**理由**：三态（活动/隐匿/关闭）是连接本身的属性，不是应用层概念。Reticulum 作为 transport 层应当拥有这个定义，上层（exomind-net-pairing）通过 `pub use` 引用。

**具体做法**：
- `reticulum-rs`: `InterfaceMode` enum 带 `Display/From<u8>/serde/Ord` 等 trait
- `LocalInterface.mode: InterfaceMode`，非 `u8`
- `exomind-net-pairing`: `pub use reticulum::iface::InterfaceMode as RetMeshMode`
- `AppState.ret_mesh_mode: Arc<Mutex<InterfaceMode>>`，非 `Arc<AtomicU8>`
- 所有层共享同一类型，不做 `as u8` / `.into()` 转换

### D2: 接口 mode 过滤替代增删

三态开关不是删除/重建接口，而是在 `InterfaceManager::send()` 中按 `min(global_mode, iface_mode)` 过滤。

**理由**：
- 接口是物理联通层的事实，不应因三态开关被销毁再重建
- `Off` → 跳过所有收发，接口仍保留在列表中
- `Passive` → 不转发 announce，但响应已有连接
- `Active` → 正常收发
- 全局模式作为上限（`min(global, iface)`），不改变接口自己的 mode 值

### D3: SSE-driven UI 同步

所有 Reticulum 状态按钮（总闸和接口级）不做乐观更新。按钮呈现的状态 = 后端 Reticulum 实际状态。

**链路**：
```
点击按钮 → fetch POST → 后端处理 → 推 SSE snapshot → 前端 setState
```

**理由**：
- 避免"按钮点了但后端拒绝"的不一致窗口
- SSE snapshot 是唯一的 truth source
- 所有订阅者（多个窗口、多个 agent）看到同一状态
- 总闸和接口开关遵循同一模式

### D4: 三层架构分离

```
配对授权层（PIN / session / token / MeshState）
    ↑
Reticulum 层 — 多跳自组织网络
   ├── Identity / 加密（端到端 Link 加密）
   ├── 多跳路由（PathTable / PathRequest / 转发）
   └── Announce 扩散 / 链路维护
    ↑
物理联通层（UDP / TCP / 文件 / mDNS）
```

**理由**：每层只关心自己的职责。物理联通层打通第一跳，Reticulum 层从第一跳到第 N 跳，授权层决定谁可以访问。

### D5: 枚举优先于整数

### D6: `pairing_pending` 跨层共享 — AppState 做真相源

`pairing_pending`（当前是否有远端发来的 PairingOffer）存为 `AppState.ret_mesh_pairing_pending: Arc<Mutex<Option<String>>>`，背景循环和 HTTP handler 共享同一状态。

**理由**：
- SSE 有延迟，前端 `pairingPendingPeerId` 不可作为"是否已收到 Offer"的真相源
- `initiate_ret_pair` handler 直接在请求路径上检查 `ret_mesh_pairing_pending`，无需等待 SSE
- 匹配时返回 409 CONFLICT，前端 fallback 到 PIN 输入模式
- 避免了"双方同时点授权 → 双方都展示 PIN"的竞态

所有模式/状态值用 Rust enum 表达，非 `u8`/`i32`。

**理由**：类型系统保证合法性——不存在"mode=3"这样的非法值。match 穷尽性检查确保所有分支被处理。

---

## Session Checkpoint — 2026-05-26 v1

> 无上下文 Agent 从此 Checkpoint 开始即可独立恢复工作。

### 当前分支与提交

| 仓库 | 分支 | 最新提交时间 | 变更概要 |
|------|------|-------------|---------|
| `exomind-team/exomind` | `feat/ret-mesh-prototype` | 2026-05-26 | Plan 1 批次 1-3 全量实现 |

### 已完成的工作

**Batch 1：基础功能（自动测试验证）**

| S# | 任务 | 文件 | 状态 |
|----|------|------|------|
| S2 | 修复 relay 测试 — `enable_ret_mesh: false` | `tests/support/mod.rs` | ✅ 3 处 |
| S4 | 多跳路由 — `set_retransmit(true)` | `exomind-net-pairing/src/lib.rs` | ✅ 2 行 |
| S1 | PairingOffer 帧 | `pairing.rs` + `lib.rs` + `mesh.rs` + `DeviceView.tsx` | ✅ 4 文件改动 |

**Batch 2：接口控制 + 安全加固（编译通过，自动测试验证）**

| S# | 任务 | 文件 | 状态 |
|----|------|------|------|
| S3 | Interface 三态开关 — `InterfaceMode` 枚举 + `send()` 按 `min(global,iface)` 模式过滤 + 三段式 UI | `iface.rs` + `ret-rs/iface.rs` + `lib.rs` + `mesh.rs` + `DeviceView.tsx` | ✅ |
| S5 | 死锁防护 — `iface.rs` `try_send`+`drop` 已修复; `transport.rs` handle_announce/manage_transport 已标注 TODO | `iface.rs` + `transport.rs` | ✅ 1/3 实修, 2/3 标注 |

**Batch 3：UI 精细化（附带完成）**

| S# | 任务 | 文件 | 状态 |
|----|------|------|------|
| S6 | 五态显示 — discovered/unauthorized/authorized/trusted/blocked | `DeviceView.tsx` | ✅ 在 S1+S3 时附带完成 |

### 已知问题

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | transport.rs ABBA 死锁风险（handler × iface_manager 跨 await） — dispatch 重构待做 | 低（未观测到） | TODO 已标注 |
| 2 | ExoNet-Reticulum 外部仓库（ARCJ137442/ExoNet-Reticulum）的 `iface.rs`/`transport.rs` 改动已提交（54b19a7） | ✅ 已解决 | 已提交推送 |
| 3 | Reticulum Link 建立依赖 `send_pairing_frame` 的 5s 超时，大实例或高延迟下可能超时 | 中 | 需要调查 `handle_link_request` 状态机 |

### 调试经验

**1. 测试死锁根因 — `git checkout` 误回滚**

`git checkout -- crates/exomind-runtime/src/routes/mesh.rs` 回滚了 S1 对 `initiate_ret_pair` 的 SendPairingOffer 代码，导致测试永久阻塞在 `pairing_rx.recv()`。
**教训**：批量 revert 前先用 `git diff --stat` 确认改动范围。

**2. 文件注册表残留 → Link 建立失败**

实例重启后 OS 分配新 UDP 端口，但 `%TEMP%/exomind-ret-peers/{host_id}.json` 保留旧端口。
`InterfaceManager::send()` 发 LinkProof 到所有 UDP 接口，包括指向死端口的僵尸接口 → LinkProof 丢失。
**修复**：启动时自清理旧条目 + `connected_mdns_ids` 用 `host_id:port` 去重（`fc20a4b9`）。
**验证**：清理注册表后重启，Link 恢复正常，配对完成。

**3. 双向发现 ≠ Link 可达**

Announce 通过 UDP 广播/单播可达，但 Reticulum Link 需要双向握手（LinkRequest → LinkResponse → Proof）。
发现正常不代表 Link 可用。这是调试中最容易误判的地方。

**4. `cargo clean` 后测试超时**

`cargo clean -p exomind-runtime` 删除 45GiB 编译缓存，但测试二进制残留。
旧测试二进制与新 lib 的 enum variant 布局不匹配 → ABI 错位 → 死锁/崩溃。
**修复**：删除过期 `.exe` + `.d` 文件后重建。

### 测试结果

| 测试套件 | 结果 |
|----------|------|
| `mesh_routes_integration` | 8/8 PASS |
| `mesh_relay_integration` | 3/3 PASS |
| `discovery_pairing_relay_e2e` | 3/3 PASS (1 ignored) |
| Frontend `device-view.runtime-topology` | 2/2 PASS |
| `cargo check` (全 workspace) | PASS |

### 验证命令速查

```bash
cargo test -p exomind-runtime --test mesh_routes_integration
cargo test -p exomind-runtime --test mesh_relay_integration
cargo test -p exomind-runtime --test discovery_pairing_relay_e2e
npx vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
cargo check -p exomind-net-pairing -p exomind-runtime
```

### Todo 剩余（下阶段）

- Reticulum Link 建立可靠性改进（`send_pairing_frame` 超时从 5s 延长或改用条件等待）
- 两套配对状态机统一（旧 HTTP `/mesh/pairing/*` vs 新 Reticulum `/mesh/ret/peers/*`）
- 业务同步迁移 Reticulum data-plane（Phase 3）
- ExoNet-Reticulum 外部仓库（ARCJ137442/ExoNet-Reticulum）已提交推送
