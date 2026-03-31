# mDNS First Discovery + Pairing Link Proof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让桌面端与手机端在清空历史状态后，能够仅依赖 mDNS 完成首次发现、PIN 配对、自动双向互通验证，并把验证信号统一纳入设备验证结果与 Signal History（信号历史）。

**Architecture:** 保持现有 node-first 产品结构，不重做 Runtime host store、mesh peer 注册和设备页分层，只补上“首次发现后自动验证”的产品闭环。Runtime 侧新增最小 `link proof（链路验证）` 协议与 actor；前端新增 `RuntimeLinkProofService（运行时链路验证服务）` 统一驱动自动验证与手动复测；UI 只消费验证状态，不再各自拼协议细节。为避免拓扑图污染，proof 实时观察不走 UI SSE route，而是扩展 `/signals/history` 的可过滤短轮询能力。

**Tech Stack:** Rust Runtime、Axum、SignalPool / Mesh Relay、React 18、TypeScript、Vitest、Testing Library、Playwright、Tauri 多实例管理器、Android 模拟器 / 真机联调

## Latest Status（最新状态）

- 2026-03-31：Desktop + Android Emulator 已完成一轮 zero-state validation（零状态联调验证）
- 自动 `pairing_auto` 与设备页手动 `manual_retry` 都已成功回到 `已验证互通`
- 本轮真实成功 session：`2eae2f62-7143-452e-aea2-d1838cb79511`
- 详细记录见：`docs/testing/2026-03-30-mdns-link-proof-manual-checklist.md`

---

## Locked Product Decisions（已锁定产品决策）

- 只支持同一二层网络 / 同一局域网的首次发现；不做跨网段发现。
- discovery address（发现地址）继续只保留一个；沿用现有最优地址选择逻辑，不加多地址 UI。
- 首次配对的“完成”必须同时代表三件事都成功：
  - mDNS 发现成功
  - PIN 配对成功
  - 双向互通验证成功
- 自动验证在首次配对闭环里强制执行；验证失败时不能标记首次配对完成。
- 设备页保留手动 `测试互联 / Test Connectivity（测试互联）` 按钮。
- proof 信号进入：
  - `Signal History（信号历史）`
  - `设备验证结果 / Device verification result（设备验证结果）`
- proof 信号默认不进入拓扑图主视图。
- RTT 语义固定为“某一端发起时观测到的往返时延（round-trip time，往返时延）”，不宣称单向精确网络时延。

## Acceptance Criteria（验收标准）

1. 清空双方 persisted hosts、runtime peers、手工地址与 target cache 后，桌面端和手机端能仅依赖 `mDNS discovered（mDNS 已发现）` 在“响应配对”中互相看到对方。
2. 输入 PIN 后，配对弹窗必须进入 `连接验证 / Connection Verification（连接验证）` 阶段，而不是直接显示成功。
3. 自动验证成功时，双方都能拿到两份证据：
  - `本端发起 RTT / Local initiated RTT（本端发起 RTT）`
  - `对端发起 RTT / Peer initiated RTT（对端发起 RTT）`
4. 任一方向超时或失败时，首次配对不能标记完成；弹窗只能停留在失败态，允许 `重试验证 / 关闭`。
5. 设备页每个 `confirmed_peer` 都显示最近验证状态、两端 RTT、最近错误，并提供手动 `测试互联`。
6. `system.link_proof.request` 与 `system.link_proof.ack` 会出现在 Signal History，并带系统信号标识，但不会默认出现在拓扑图主视图。
7. 自动化测试至少覆盖：
  - Runtime actor + mesh bypass
  - filtered history polling（过滤历史轮询）
  - PairingDialog 发起方 / 响应方验证状态机
  - 设备页手动复测和状态优先级
  - Signal History 的系统信号展示与 filter 行为
8. 真实联调至少完成一次：
  - 从零状态启动桌面端 + Android 端
  - 纯 mDNS 首发
  - PIN 配对
  - 自动双向验证
  - 手动 `测试互联`
  - proof 信号进历史

---

## Protocol & State Machine（协议与状态机）

### 1. Roles（角色）

- `pairing initiator（配对发起方）`
  - 生成 PIN
  - 当前 UI 流程里是弹窗 `发起配对`
  - 现状通过轮询 `/mesh/peers` 感知“对方已完成 PIN 配对”
- `pairing responder（配对响应方）`
  - 扫描 mDNS / 已知在线设备
  - 输入 PIN
  - 当前 UI 流程里会在本地调用 `registerPeerLocally()`
- `proof local round（本端验证回合）`
  - 本端主动发 `system.link_proof.request`
  - 收到对端 runtime actor 回的 `ack(kind=receipt)`
  - 本端据此计算自己的 RTT
- `proof peer result（对端结果）`
  - 对端完成自己的 local round 后，再发 `ack(kind=result)`
  - 本端收到后，拿到“对端发起 RTT”

### 2. Topics（主题）

- `system.link_proof.request`
- `system.link_proof.ack`

这里保持两个 topic，不再新增 `result` topic；但 `ack` 会明确区分两种语义：

- `ack.kind = "receipt"`：Runtime actor 自动回执
- `ack.kind = "result"`：前端 `RuntimeLinkProofService` 在本端 RTT 计算完成后，主动发布的结果回执

### 3. Payload Contract（载荷契约）

`system.link_proof.request`

```json
{
  "proof_session_id": "uuid",
  "attempt_id": "uuid",
  "initiated_by_peer_id": "host-desktop",
  "target_peer_id": "host-phone",
  "trigger": "pairing_auto | manual_retry",
  "sent_at_ms": 1710000000000
}
```

`system.link_proof.ack`

```json
{
  "proof_session_id": "uuid",
  "attempt_id": "uuid",
  "initiated_by_peer_id": "host-desktop",
  "target_peer_id": "host-desktop",
  "ack_kind": "receipt | result",
  "acked_by_peer_id": "host-phone",
  "observed_rtt_ms": 48,
  "completed_at_ms": 1710000000048
}
```

约束：

- `target_peer_id` 一律表示“这条事件当前要送达给谁（current receiver，当前接收方）”。
  - `request.target_peer_id` = 本轮被探测的对端
  - `ack.target_peer_id` = 本轮原始发起方 / 当前需要接收回执结果的一方
- `initiated_by_peer_id` 固定表示“谁发起了这一次 RTT 测量”，不会因 ack 改写。
- `receipt` 必须由 runtime actor 自动发出。
- `result` 必须由 `RuntimeLinkProofService` 在本端 RTT 计算成功后主动发布。
- `observed_rtt_ms` 只在 `ack_kind = "result"` 时必填。

### 4. Shared Session Ownership（共享会话所有权）

proof 不能让双方各自创建独立 `proof_session_id`。固定规则如下：

- 自动验证：
  - `pairing responder（输入 PIN 的一侧）` 是 session owner（会话拥有者）
  - responder 在 PIN 成功并完成本地 `registerPeerLocally()` 后创建共享 `proof_session_id`
  - initiator 不再自建第二个自动 session，而是接入 responder 发起的这条 session
- 手动 `测试互联`：
  - 谁点击，谁就是 session owner
  - 对端收到第一条 proof request 后接入同一 session

joiner（接入方）规则：

- 必须先看到来自该 peer 的第一条 `system.link_proof.request`
- 必须采用这条 request 自带的 `proof_session_id`
- 在 adoption window（接入窗口，建议 5 秒）内不得自创第二个自动 session

### 5. Join / Retry Timing（接入与重试时序）

发起方不能再在“看到新 peer”这一刻直接成功，也不能立刻因为 host record 还没 materialize 就失败。

固定规则：

- initiator 看到 `/mesh/peers` 新 peer 后，先进入 `verifying_pending（等待验证上下文）`
- 在 `verifying_pending` 里并行做两件事：
  - 循环 `refreshRuntimeSnapshot()`，直到能解析出对应 `RuntimeHostRecord`
  - 轮询 filtered history，直到看到该 peer 发来的第一条 proof request，并接入同一个 `proof_session_id`
- 只有两件事都齐了，才进入真正 `verifying`
- 如果 adoption window 超时，才进入 `verification_failed`
- `重试验证` 会重新发起一轮新 session；不会复用超时 session，也不要求重新输入 PIN

### 6. Automatic Proof Flow（自动验证闭环）

#### 响应方 UI

1. `respondToPairing()` 成功。
2. `registerPeerLocally()` 成功。
3. responder 创建共享 `proof_session_id`。
4. UI 进入 `verifying（验证中）`。
5. 立刻启动 `RuntimeLinkProofService.runVerification()`：
   - 发出自己的 `request`
   - 等待 `receipt`
   - 计算 `local initiated RTT`
   - 发布 `ack(kind=result)`
   - 继续等待对端的 `ack(kind=result)`
6. 只有“两端 RTT 都齐了”才进入 `success`。

#### 发起方 UI

1. 仍然通过 `/mesh/peers` 轮询发现新 peer。
2. 发现新 peer 后，不再直接 `success`，而是先进入 `verifying_pending`。
3. 在 `verifying_pending` 里：
   - 重试 `refreshRuntimeSnapshot()`
   - 等待 responder 发来的第一条 proof request
   - 采用 responder 创建的 `proof_session_id`
   - 解析出对应 `RuntimeHostRecord`
4. 上述条件齐了以后，才进入 `verifying` 并启动 `RuntimeLinkProofService.runVerification()`。
5. 本端 RTT 完成后，也会发布 `ack(kind=result)`。
6. 收到对端 `result` 后，才允许进入最终成功态。

### 7. Success / Failure Rule（成功 / 失败规则）

- 首次配对成功条件：
  - 本端 RTT 成功
  - 对端 RTT 成功
  - 两份 `result ack` 都已收到
- 首次配对失败条件：
  - 任一轮 `receipt` 超时
  - 任一方未发布 `result`
  - 轮询 history 超时
  - 在 adoption window 内无法同时拿到：
    - 对应的 host record
    - 对端发来的共享 `proof_session_id`

失败后：

- 已完成的 PIN 配对和 peer 注册不回滚。
- 但首次配对弹窗不能显示“完成”。
- 用户只能：
  - `重试验证`
  - `关闭`

### 8. Why History Polling Instead of UI SSE Route（为什么用 History 轮询而不是 UI SSE 路由）

当前事实：

- UI SSE 只会收到命中 `frontend|agent -> ui` route 的 topic。
- `system.link_proof.*` 不是 UI 路由主题。
- 如果为它专门建 UI route，会把 proof topic 直接引入 signal topology 主视图和 route 语义里，违背“proof 不默认进主拓扑视图”的产品约束。

因此本次方案固定为：

- 扩展 `/signals/history` 支持过滤参数：
  - `limit`
  - `topic_prefix`
  - `after_event_id`
  - `exclude_topic_prefix`
- proof 轮询使用专用 strict cursor helper：
  - `after_event_id` 找不到时返回空集
  - 不允许像 SSE replay 那样退回整个窗口
- `RuntimeLinkProofService` 使用短轮询：
  - 轮询间隔 `250-400ms`
  - 只拉 `topic_prefix=system.link_proof.`
  - 使用 `after_event_id` 缩小窗口

这样可以同时满足：

- proof 不污染拓扑主视图
- 不需要额外 UI route
- proof 信号仍然进入 Signal History
- 服务端和前端都能做精确匹配

### 9. Device View Status Priority（设备页状态优先级）

`connectionState（传输状态）` 与 `verificationStatus（互通验证状态）` 分开表达，不能混成一个文案。

固定规则：

- 顶部角标继续显示真实 `connectionState`
  - `online`
  - `offline`
  - `error`
- `verificationStatus = idle` 在 `confirmed_peer` 上绝不隐藏，固定显示：
  - `未验证互通 / Not verified yet（未验证互通）`
  - 并明确写出“在线 ≠ 已验证”
- 新增“互通验证”区块作为更高优先级的业务语义：
  - `running` -> `正在验证互通`
  - `verified` -> `已验证互通`
  - `failed` -> `在线，但互通验证失败` 或 `离线，最近验证失败`
- 复制状态文案不再冒充互通验证结果。

### 10. Signal History Filter Strategy（信号历史过滤策略）

当前 topic filter 只展示前 8 个唯一 topic，proof topic 会把普通业务 topic 挤掉。

本次固定改为：

- `AgentsPage` 改成双窗口加载：
  - business window：`/signals/history?...&exclude_topic_prefix=system.link_proof.`
  - proof window：`/signals/history?...&topic_prefix=system.link_proof.`
- 两个窗口在前端按时间合并后再给列表视图渲染
- `全部主题`
- 普通业务 topic：仍然最多展示前 8 个唯一 topic
- 额外固定追加一个伪过滤器：
  - `链路验证`
  - 实际匹配 `topic.startsWith("system.link_proof.")`

这样 proof 一定可见，但不会把普通 topic 的 filter 挤掉。

### 11. Zero-State Validation Checklist（零状态验收前置清理）

人工验收前必须清掉以下状态，不允许手工补地址：

- 前端 localStorage
  - `agent_runtime_hosts_v1`
  - `exomind:embeddedRuntimeStatus`
  - `exomind:runtimeTargetMode`
  - `exomind:runtimeExternalAddress`
- 显式把 `exomind:embeddedRuntimeNetworkMode` 设回 `lan`
- Runtime mesh 持久化
  - `/mesh/peers`
  - mesh persisted state file（若配置了 `EXOMIND_RT_MESH_STATE_PATH`）
- 禁止保留任何手工添加的 host:port 种子

---

## Task 0: Update the existing umbrella issue before implementation（实现前先更新现有总 Issue）

**Files / Systems:**
- GitHub issue tracker
- 当前计划文档：`docs/plans/2026-03-30-mdns-link-proof-implementation-plan.md`

**Step 1: Collect related issues（收集相关 issue）**

- 搜索现有 node-first / pairing / mesh / signal-history / Android pairing 相关 issue。
- 记录哪些 issue 会被这个大 PR 覆盖，哪些只引用不关闭。

**Step 2: Reuse the existing umbrella issue（复用现有总 issue）**

- 优先复用现有 umbrella issue（当前已存在 `#773`）。
- 若 `#773` 的正文 / checklist 与本计划不一致，则直接更新，不再新建重复总票。
- 只有在确认不存在同等 umbrella issue 时，才创建新 issue。

**Step 3: Post the first comment as checklist（首条评论写 checklist）**

首条评论 checklist 固定包含：

- [ ] proof protocol + mesh targeted forwarding
- [ ] filtered history polling for proof
- [ ] pairing dialog verifying state on both roles
- [ ] device page manual connectivity test
- [ ] signal history system proof rendering
- [ ] zero-state desktop + Android validation
- [ ] E2E + targeted regression tests
- [ ] proof-heavy history window does not evict business topics

**Step 4: Link plan document（关联计划）**

- 把本计划文档路径贴进 `#773` 的跟踪评论。
- Draft PR 若已存在（当前已有 `#774`），继续复用，不再开重复 PR。

---

## Task 1: Extend `/signals/history` for filtered polling（扩展历史接口）

**Files:**
- Modify: `crates/exomind-runtime/src/routes/signals.rs`
- Modify: `crates/exomind-runtime/src/signal/window.rs`
- Modify: `src/lib/services/signal-http-sse-transport.ts`
- Modify: `src/lib/services/signal-stream.service.ts`
- Modify: `src/lib/types/signal-pool.ts`
- Test: `crates/exomind-runtime/src/routes/signals.rs`
- Test: `tests/unit/services/signal-http-sse-transport.test.ts` or create `tests/unit/services/signal-history-filtering.test.ts`

**Step 1: Write failing tests（先写失败测试）**

- `GET /signals/history?topic_prefix=system.link_proof.` 只返回 proof 事件。
- `GET /signals/history?after_event_id=<id>` 只返回该事件之后的记录。
- `GET /signals/history?exclude_topic_prefix=system.link_proof.` 能稳定拉到 business window。
- strict cursor helper 在 `after_event_id` 不存在时返回空集，而不是整窗回退。
- 前端 transport 能构造带 query 的 history 请求。

**Step 2: Run tests and verify failure（运行并确认失败）**

```powershell
cargo test -p exomind-runtime routes::signals -- --nocapture
bunx vitest run tests/unit/services/signal-history-filtering.test.ts
```

**Step 3: Implement minimal filtering（做最小实现）**

- `HistoryQuery` 增加：
  - `topic_prefix?: String`
  - `after_event_id?: String`
- `exclude_topic_prefix?: String`
- `WindowCache` 保留原有 SSE `since()` 行为，但额外增加 proof 轮询专用 strict helper：
  - 按 `after_event_id`
  - 按 `topic_prefix`
  - 按 `exclude_topic_prefix`
  - unknown cursor 返回空集
- `SignalTransport.history()` 改成支持 query object，而不是只接 `limit`。

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 2: Add `link_proof` runtime actor + mesh bypass（增加 proof actor 与 mesh 定向放行）

**Files:**
- Create: `crates/exomind-runtime/src/signal/actors/link_proof_actor.rs`
- Modify: `crates/exomind-runtime/src/signal/actors/mod.rs`
- Modify: `crates/exomind-runtime/src/lib.rs`
- Modify: `crates/exomind-runtime/src/mesh/mod.rs`
- Test: `crates/exomind-runtime/src/signal/actors/link_proof_actor.rs`
- Test: `crates/exomind-runtime/src/mesh/mod.rs`

**Step 1: Write failing runtime tests（先写失败测试）**

- actor 收到 `system.link_proof.request` 且 `target_peer_id == local_host_id` 时，会发 `ack(kind=receipt)`。
- target 不匹配时，不会误发 receipt。
- `system.link_proof.request` / `system.link_proof.ack` 只要 payload 的 `target_peer_id` 命中 peer，就允许 mesh forward，即使没有 route / interest。

**Step 2: Run tests（确认失败）**

```powershell
cargo test -p exomind-runtime link_proof_actor -- --nocapture
cargo test -p exomind-runtime mesh:: -- --nocapture
```

**Step 3: Implement minimal actor + bypass（最小实现）**

- actor 只负责 `request -> receipt ack`
- `ack(kind=result)` 不由 actor 生成
- `should_stream_event_to_peer()` 增加 `system.link_proof.*` 定向放行逻辑

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 3: Persist verification result on runtime hosts（给运行时主机持久化验证结果）

**Files:**
- Modify: `src/lib/types/agent-hub-runtime.ts`
- Modify: `src/lib/services/runtime-host.service.ts`
- Test: `tests/unit/services/runtime-host.service.issue205.test.ts`

**Step 1: Write failing tests（先写失败测试）**

新增断言：

- `verificationStatus`
- `lastVerifiedAt`
- `lastVerificationError`
- `lastVerificationTrigger`
- `localInitiatedRttMs`
- `peerInitiatedRttMs`

都能被 `mergeHostMetadata()` 持久化并读回。

**Step 2: Run tests（确认失败）**

```powershell
bunx vitest run tests/unit/services/runtime-host.service.issue205.test.ts
```

**Step 3: Implement minimal metadata fields（最小实现）**

建议字段：

```ts
verificationStatus?: 'idle' | 'running' | 'verified' | 'failed';
lastVerifiedAt?: string;
lastVerificationTrigger?: 'pairing_auto' | 'manual_retry';
localInitiatedRttMs?: number;
peerInitiatedRttMs?: number;
lastVerificationError?: string;
```

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 4: Implement `RuntimeLinkProofService`（实现统一链路验证服务）

**Files:**
- Create: `src/lib/services/runtime-link-proof.service.ts`
- Modify: `src/lib/services/index.ts`
- Modify: `src/lib/types/signal-pool.ts`
- Modify: `src/lib/services/signal-stream.service.ts`
- Test: `tests/unit/services/runtime-link-proof.service.test.ts`

**Step 1: Write failing tests（先写失败测试）**

至少覆盖：

- session owner 创建共享 `proof_session_id`
- joiner 会采用对端 request 携带的 `proof_session_id`，不会自建第二个自动 session
- 本端发起 request，能等到匹配的 `receipt ack`
- 收到 `receipt ack` 后能计算本端 RTT，并发布 `ack(kind=result)`
- 能等待对端 `ack(kind=result)` 并收齐两端 RTT
- 任一阶段超时会返回可直接展示给 UI 的错误消息
- `after_event_id` 轮询不会重复处理旧 proof event

**Step 2: Run tests（确认失败）**

```powershell
bunx vitest run tests/unit/services/runtime-link-proof.service.test.ts
```

**Step 3: Implement service（实现服务）**

服务最小职责：

- 支持两种模式：
  - `owner`：创建共享 `proof_session_id`
  - `joiner`：采用对端 request 中已有的 `proof_session_id`
- 发布本端 `request`
- 轮询 filtered history 等待 `receipt ack`
- 计算 `localInitiatedRttMs`
- 发布 `ack(kind=result)`
- 继续轮询等待对端 `ack(kind=result)`
- 返回：

```ts
{
  status: 'verified',
  proofSessionId: 'uuid',
  localInitiatedRttMs: 42,
  peerInitiatedRttMs: 57,
  completedAt: '2026-03-30T10:00:00.000Z'
}
```

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 5: Refactor `PeerPairingDialog` into strict verifying flow（把配对弹窗改成严格验证流）

**Files:**
- Modify: `src/ui/app/components/PeerPairingDialog.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/peer-pairing-dialog.test.tsx`

**Step 1: Write failing tests（先写失败测试）**

覆盖四类路径：

- 发起方：`waiting -> verifying -> success`
- 响应方：`loading -> verifying -> success`
- 任一边 proof timeout：停在 `verification_failed`
- 失败后点击 `重试验证` 可以重新跑 proof，不要求重新输入 PIN

**Step 2: Run tests（确认失败）**

```powershell
bunx vitest run tests/unit/ui/peer-pairing-dialog.test.tsx
```

**Step 3: Implement strict state machine（实现严格状态机）**

- `PairingStatus` 扩成：
  - `idle`
  - `loading`
  - `waiting`
  - `verifying_pending`
  - `verifying`
  - `verification_failed`
  - `success`
  - `error`
- 发起方轮询到新 peer 后：
  - 先进入 `verifying_pending`
  - adoption window 内同时等待：
    - history 中对端第一条 proof request
    - `refreshRuntimeSnapshot()` 解析出 host record
  - 两者都齐了才进入 `verifying`
- 响应方在 `registerPeerLocally()` 成功后创建共享 session 并进入 `verifying`
- `success` 只能在 `RuntimeLinkProofService` 返回 verified 后出现

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 6: Add manual connectivity test to device page（设备页加入手动测试互联）

**Files:**
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

**Step 1: Write failing tests（先写失败测试）**

断言：

- `confirmed_peer` 卡片显示最近验证状态
- `verificationStatus = idle` 时明确显示 `未验证互通`
- 有 `测试互联`
- 点击后进入 `验证中`
- 成功后显示两端 RTT
- 失败后显示最近错误
- `online` 与 `verification failed` 并存时，文案优先级正确
- 刷新 / 重新挂载页面后，最近验证状态仍能从 snapshot 恢复

**Step 2: Run tests（确认失败）**

```powershell
bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
```

**Step 3: Implement minimal UI + wiring（最小实现）**

- `AgentsPage` 注入 `RuntimeLinkProofService`
- `DeviceView` 只消费：
  - `verificationStatus`
  - `lastVerificationError`
  - `lastVerifiedAt`
  - `localInitiatedRttMs`
  - `peerInitiatedRttMs`
- `onRuntimeHostProbe` 保留给 transport probe
- 新增 `onVerifyPeer(hostId)` 专用于互通验证

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 7: Render proof signals in Signal History without polluting normal filters（在历史中展示 proof 信号但不污染普通过滤器）

**Files:**
- Modify: `src/ui/app/pages/agents/SignalHistoryTabView.tsx`
- Modify: `src/ui/app/pages/agents/agents-utils.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.signal-history.issue444.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`

**Step 1: Write failing tests（先写失败测试）**

覆盖：

- `system.link_proof.request`
- `system.link_proof.ack`
- `链路验证` 伪过滤器
- 普通 topic filter 仍保留前 8 个业务 topic，不被 proof 挤掉
- proof-heavy window 下，business topic 仍能通过 business window 保留下来

**Step 2: Run tests（确认失败）**

```powershell
bunx vitest run tests/unit/ui/agent-hub/agents-page.signal-history.issue444.test.tsx
```

**Step 3: Implement minimal rendering（最小实现）**

- `AgentsPage` 同时拉 business window + proof window，并按时间合并
- 增加系统标签，例如 `系统 / System（系统）`
- payload 渲染保留：
  - `proof_session_id`
  - `attempt_id`
  - `ack_kind`
  - `initiated_by_peer_id`
  - `observed_rtt_ms`
- proof topic 仍然只在历史视图可见，不进 topology 主视图

**Step 4: Re-run tests（回归）**

同上命令，预期全绿。

---

## Task 8: Fill the missing automated tests（补足缺失自动化测试）

**Files:**
- Modify: `tests/unit/ui/peer-pairing-dialog.test.tsx`
- Modify: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.signal-history.issue444.test.tsx`
- Modify: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Modify: `tests/unit/services/runtime-host.service.issue205.test.ts`
- Create: `tests/unit/services/runtime-link-proof.service.test.ts`
- Modify: `package.json`
- Create: `tests/e2e/agent-pairing-link-proof.issue773.test.ts`
- Create or modify: `tests/e2e/playwright.issue773.config.ts`

**Step 1: Add missing cases（补缺用例）**

- initiator 成功路径
- responder 成功路径
- initiator `verifying_pending -> verifying -> success/fail`
- proof timeout
- proof retry
- 关闭弹窗后从设备页再次 `测试互联`
- signal history 里的 `链路验证` 过滤器
- `mergeHostMetadata -> refreshSnapshot -> AgentsPage -> DeviceView` 跨层恢复
- proof-heavy history window 下 business topic 仍保留

**Step 2: Run targeted test suite（跑定向测试）**

```powershell
bunx vitest run tests/unit/ui/peer-pairing-dialog.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.signal-history.issue444.test.tsx tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-link-proof.service.test.ts
```

**Step 3: Add or adjust UI E2E harness（补足 UI E2E）**

- 允许在 Playwright 中注入 discovered peer / proof history 事件
- 但必须真实走 UI 状态机，不允许只 mock 一个最终成功状态
- 在 `package.json` 新增 `test:e2e:issue773`
- 不再把 `issue205` 旧 host-probe E2E 误当成 link-proof E2E

**Step 4: Run E2E（跑 E2E）**

```powershell
bun run test:e2e:issue773
```

---

## Task 9: Real desktop + Android validation from zero state（做桌面 + Android 的零状态联调）

**Files:**
- Modify: `docs/plans/2026-03-30-mdns-link-proof-implementation-plan.md`
- Create: `docs/testing/2026-03-30-mdns-link-proof-manual-checklist.md`

**Step 1: Write the manual checklist（写人工验收清单）**

必须写清：

- 清理 localStorage 哪些 key
- 清理 mesh peers / mesh persisted state
- 双方都切到 embedded + LAN
- 禁止手工添加地址

**Step 2: Start manager instances（启动多实例）**

```powershell
bun run tauri:manager -- list
bun run tauri:manager -- logs --name issue-773-node-first --tail 80
bun run tauri:manager -- logs --name issue-773-phone --tail 80
```

需要时：

- 桌面端在当前工作分支启动
- Android 端也必须在当前工作分支启动
- Android 初始化遵循现有 release / CI 风格流程

**Step 3: Record validation evidence（记录证据）**

至少记录：

- `/mesh/discovered` 双方都有对方
- PIN 配对成功
- 自动验证完成
- Signal History 有 request / ack
- 设备页再次手动 `测试互联` 成功

---

## Task 10: Final verification, code review, PR linking（最终验证、评审与 PR 关联）

**Files / Systems:**
- Git history
- PR description
- umbrella issue

**Step 1: Run full targeted verification（跑完整定向验证）**

```powershell
cargo test -p exomind-runtime link_proof_actor -- --nocapture
cargo test -p exomind-runtime routes::signals -- --nocapture
bunx vitest run tests/unit/ui/peer-pairing-dialog.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-page.signal-history.issue444.test.tsx tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-link-proof.service.test.ts
bunx tsc --noEmit
bun run test:e2e:issue773
```

**Step 2: Request code review（发起代码评审）**

review 必看点：

- proof actor 是否只做最小 receipt 责任
- mesh bypass 是否只放行目标 peer，不会扩散
- history filtering 是否能避免重复处理旧事件
- PairingDialog 的 initiator / responder 状态机是否收口一致
- DeviceView 的 `online` 与 `verification failed` 文案是否一致

**Step 3: Update issue + PR（更新 issue 与 PR）**

- umbrella issue 勾 checklist
- PR 说明只写对外可读内容，不写内部“方案 B/C 选择史”
- PR 关联所有真实覆盖到的 issue
- 只关闭本次真正解决的 issue

**Step 4: Final commits（最终提交）**

建议按语义拆 commit：

```powershell
git add crates/exomind-runtime/src/routes/signals.rs crates/exomind-runtime/src/signal/actors crates/exomind-runtime/src/mesh/mod.rs
git commit -m "feat: add link proof runtime protocol"

git add src/ui/app/components/PeerPairingDialog.tsx src/ui/app/pages/agents/DeviceView.tsx src/lib/services/runtime-link-proof.service.ts src/lib/services/runtime-host.service.ts
git commit -m "feat: add pairing verification and device connectivity proof"

git add tests docs
git commit -m "test: cover link proof flow and zero-state validation"
```

---

## Review Closure Checklist（计划评审关闭标准）

在开始实现前，必须确认以下问题都已关闭：

- [x] 双 RTT 的发起者、回执者、结果回传路径明确
- [x] 发起方 / 响应方何时进入 `verifying` 明确
- [x] proof 实时观察路径明确为 filtered history polling，而不是模糊写“订阅或历史”
- [x] 设备页 `connectionState` 与 `verificationStatus` 优先级明确
- [x] Signal History filter 不会被 proof topic 挤爆
- [x] 零状态验收清理项补全
- [x] umbrella issue 前移到实现前

## Notes For Execution（执行备注）

- proof topic 固定保留：
  - `system.link_proof.request`
  - `system.link_proof.ack`
- `ack(kind=result)` 是服务层结果信号，不是 runtime actor 自动回执。
- UI 文案优先使用“本端 / 对端”；若能从 host snapshot 拿到友好名称，再渲染成具体设备名。
- Android 模拟器可用于流程回归，但“纯 mDNS 首次发现”最终验收优先桌面 + 真机或稳定局域网设备组合。
- 不回退现有 node-first、confirmed peer replay、Android guest address guard 等已完成修复。
