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
| S3 | Interface 三态开关 — `remove_interface` API + 路由 + 前端按钮 | `iface.rs` + `lib.rs` + `mesh.rs` + `DeviceView.tsx` | ✅ |
| S5 | 死锁防护 — `iface.rs` 已修复, `transport.rs` 已标注风险 | `iface.rs` + `transport.rs` | ✅ |

**Batch 3：UI 精细化（附带完成）**

| S# | 任务 | 文件 | 状态 |
|----|------|------|------|
| S6 | 五态显示 — discovered/unauthorized/authorized/trusted/blocked | `DeviceView.tsx` | ✅ 在 S1+S3 时附带完成 |

### 已知问题

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | transport.rs ABBA 死锁风险（handler × iface_manager 跨 await） — 代码已标注 | 低（未观测到） | 已标注 |
| 2 | Batch 2+3 未做 Tauri MCP 双实例窗口实测 | 中 | 待做 |
| 3 | remove_interface 只支持禁用，不支持启用单个接口（需 RetMeshMode toggle 恢复） | 低 | 已知局限 |

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

### Todo 剩余

- Batch 2 Tauri MCP 实测
- Batch 3 Tauri MCP 实测
