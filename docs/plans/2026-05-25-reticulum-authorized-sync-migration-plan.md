# Reticulum 授权配对与业务同步迁移计划
> 日期：2026-05-25（checkpoint 更新 2026-05-26 v3）
> 状态：活跃开发版 — 3 次迭代已将物理联通层基础能力落地，详情见 §11 Checkpoint
> 分支：`feat/ret-mesh-prototype`
> 关联文档：
> - [Reticulum 组网配对模型设计](2026-05-24-ret-mesh-pairing-model-design.md)
> - [多设备同步规格（RT-only）](../specs/sync.md)
> - [Task Sync Reconciliation Solution Plan](2026-04-13-task-sync-reconciliation-solution-plan.md)
> - [ECS 通信栈](../architecture/ECS-communication-stack.md)
---
## 1. 目标
后续工作按三步推进：
1. **配对机制与授权对齐**：在 Reticulum 发现和连接之上恢复原有 PIN / token / per-peer 授权语义，让“配对”不再只是 UI 标记，而是能创建稳定的 `MeshState` peer、持久化 token、撤销授权，并限制未授权连接只能访问最小功能面。
2. **发现 / 确认 API 脱离 HTTP/SSE 语义**：把旧的“已发现节点 / 已确认节点”从 HTTP runtime peer 概念迁移为 Reticulum 连接状态与授权状态，即“已连接未授权 / 已连接已授权”。旧 HTTP/SSE peer API 只作为兼容桥，最终不能继续作为组网真相源。
3. **业务数据传输媒介无关化**：在 1 和 2 稳定后，把 EventLog、TimeBlock、Task、Proposal 等业务同步的传输源从 HTTP/SSE 快路径迁到 Reticulum 承载的 ENS（ExoNet Network Stack / 外心网络栈）data-plane；数据落库、冲突裁决、reconciliation 仍沿用现有 RT SQLite 与领域同步机制。
最终目标不是“UI 上显示 Reticulum 设备”，而是：**Reticulum identity 成为 RT 设备身份，Reticulum 连接成为组网通道，外心授权层决定哪些业务数据可以通过该通道同步。**
---
## 2. 调查结论
### 2.1 当前已具备的基础
#### Reticulum 发现与身份
当前 `crates/exomind-net-pairing/` 已具备实验基座：
- `RetMeshConfig` / `RetMesh`：启动 Reticulum transport、announce、本地 TCP interface 和 seed 连接。
- `DeviceMetadata` / `DiscoveredPeer`：announce payload 中携带 `host_id`、`node_name`、版本和 runtime port。
- `identity_hex`：Reticulum identity hash 已进入发现结果，是比旧 `host_id` 更适合作为稳定设备身份的字段。
- `PeerStore`：已有 `identity_hex` 与 `paired_peers` 的 JSON 持久化雏形，但当前仍偏实验态，还没有成为 runtime 授权表的唯一真相源。
#### Runtime mesh 授权表
当前 `crates/exomind-runtime/src/mesh/mod.rs` 已具备可复用授权结构：
- `PeerInfo`：包含 `id`、`base_url`、`enabled`、`status`、`auth_token`、`inbound_secret`。
- `MeshState::upsert_peer()`：创建 / 更新 peer 并持久化。
- `MeshState::revoke_peer_authorization()`：禁用 peer、清空 `auth_token` / `inbound_secret`、撤销 interests 与 scope grants。
- `PeerScopeGrant`：已具备按 peer + domain 管理领域授权的基础。
- `MeshRelayManager`：当前仍以 HTTP base URL + Bearer token 转发 `/mesh/stream` 与 `/mesh/events`。
#### Reticulum UI 第一刀
当前 `crates/exomind-runtime/src/routes/mesh.rs` 与 `src/ui/app/pages/agents/DeviceView.tsx` 已完成第一刀：
- `GET /mesh/ret/discovered`：兼容旧发现视图，列出 Reticulum 发现 peers，并把 runtime `MeshState` 授权状态叠加到 `trust_state`。`n- `GET /mesh/ret/peers`：新的状态视图，显式返回 `peer_id`、`connection_state`、`authorized` 与可选 `mesh_peer`，区分“已连接未授权”和“已连接已授权”。
- `POST /mesh/ret/peers/:peer_id/pair`：从 Reticulum peer 创建 / 启用 `MeshState` peer，并持久化 token。
- `DELETE /mesh/ret/peers/:peer_id/pair`：撤销授权，清空 token，UI 回到未授权状态。
- UI 已有“授权 / 撤销授权”，并通过实测验证 `Discovered → Paired → Discovered`。
这一步证明：Reticulum peer 可以成为旧 `MeshState` peer 的创建入口，并且 UI / API 已不再把“发现 / 连接”误当成“已配对”；但目前还不是完整 PIN-over-Reticulum 配对协议。
### 2.2 当前主要错位
#### “连接”被误当成“配对”
Reticulum announce / seed 连接只证明“节点可发现 / 可连通”，不证明用户授权。后续 UI 与 API 必须严格区分：
| 概念 | 含义 | 是否授权 | 可访问能力 |
|------|------|----------|------------|
| `discovered` | 收到 announce，知道对方 identity | 否 | 展示、health、发起配对 |
| `connected_unauthorized` | 已有 Reticulum link/session，但未通过外心授权 | 否 | health、pairing handshake |
| `connected_authorized` | Reticulum identity 已验证，外心授权 token 已建立 | 是 | scope 允许的数据传输 |
| `trusted` | 已授权 identity 经持久化信任，可自动重连授权 | 是 | scope 允许的数据传输 |
| `blocked` | 用户拒绝 / 屏蔽该 identity | 否 | 默认无能力 |
因此，“只要连上就是已配对”是错误语义。连接是 Reticulum transport 事实；配对是外心授权事实。
#### 旧配对流程仍绑定 HTTP
旧配对核心在 `crates/exomind-runtime/src/pairing.rs` 与 `crates/exomind-runtime/src/routes/mesh.rs`：
- `POST /mesh/pairing/initiate`：本地 admin 发起 session，生成 6 位 PIN。
- `POST /mesh/pairing/respond`：远端经 HTTP 提交 PIN、`responder_host_id`、`responder_base_url` 与 token。
- 成功后双方写入 `MeshState`，后续通信靠 HTTP Bearer token。
这套安全语义值得保留：PIN 是人的在场证明；session 是 one-shot；错误 PIN 销毁 session；per-peer token 控制访问。但它不应继续依赖 HTTP endpoint 和 `base_url` 才能成立。
#### 同步主路径仍以 HTTP/SSE 作为传输实现
当前 `docs/specs/sync.md` 已明确 RT-only：业务真相源是 RT SQLite，在线增量复制靠 replication topics，离线靠 backfill / reconciliation。但传输实现仍写成：
- `signal SSE` 下行：`src/ui/hooks/useSignalStream.ts` / `SignalStreamService`。
- `MeshRelayManager` HTTP 转发：`/mesh/interests/:peer_id`、`/mesh/events`、`/mesh/stream`。
- 领域投影：`eventlog.replication.appended`、`task.replication.upserted`、`timeblock.replication.completed`、`reminder.replication.upserted` 到达后写入本地 RT SQLite。
这说明后续不应重写同步领域逻辑，而应把“复制事件如何抵达对端”抽象出来。HTTP/SSE 是一种 data-plane transport，不应继续等同于 RT mesh 本身。
---
## 3. 设计原则
### 3.1 Reticulum identity 是设备身份主键
后续新机制以 Reticulum `identity_hex` 作为稳定 peer id。旧 `host_id` 保留为 metadata / 兼容字段，但不能再作为跨介质身份真相源。
原因：
1. Reticulum identity hash 来自密码学身份，比旧 RT `host_id` 更适合证明“同一个节点”。
2. 同一个 peer 经不同介质发现时，identity hash 可用于归并，而不是产生多个“设备”。
3. 授权与撤销应绑定身份，而不是绑定某个 IP、端口或一次 HTTP base URL。
### 3.2 Transport 只证明可达，授权层决定可信
Reticulum link、TCP interface、announce 都不等价于授权。未授权连接只能访问最小能力：
- `health` / capability probe
- pairing session discovery
- pairing handshake
- 必要的 identity / proof exchange
所有业务同步、scope grant、agent 调用、配置写入都必须在 `connected_authorized` 或 `trusted` 之后才可用。
### 3.3 保留旧配对安全语义，替换承载通道
第一阶段不是重新设计授权，而是把旧 PIN/session/token 机制搬到 Reticulum 连接上：
- 保留 6 位 PIN、TTL、one-shot、错误销毁。
- 保留 per-peer inbound/outbound token。
- 保留 `MeshState` 持久化授权结果。
- 替换 HTTP respond 为 Reticulum pairing message。
- 后续再把 token 从“HTTP Bearer”推广为“ENS peer credential”。
### 3.4 业务同步只替换传输，不重写领域存储
EventLog、Task、TimeBlock、Reminder、Proposal 的同步迁移应遵守：
- 本地真相源仍是 RT SQLite。
- 领域 projector / reconciliation / backfill 不因 Reticulum 改写语义。
- Reticulum data-plane 只负责传输复制事件、pull 请求、pull 响应与确认。
- 业务域继续通过 scope / domain grant 判断是否允许同步。
---
## 4. 三阶段路线
### Phase 1：Reticulum 配对 = 外心授权
#### 目标
把“授权 / 撤销授权”从当前 UI 快捷按钮推进为真正的 Reticulum pairing 协议：发现只是发现；配对成功才创建 / 启用 `MeshState` peer 并持久化 token；撤销授权会使该 identity 失去业务访问能力。
#### 任务切片
1. **身份统一**
   - 以 `identity_hex` 作为 Reticulum peer selector 与 `MeshState.peer.id`。
   - 旧 `host_id` 写入 metadata，用于 UI 显示、日志与兼容。
   - 对同一 `identity_hex` 的多来源发现结果做归并。
2. **未授权连接能力边界**
   - 明确 runtime 内部状态：`discovered`、`connected_unauthorized`、`connected_authorized`、`trusted`、`blocked`。
   - `GET /mesh/ret/discovered` 不再把 connected 误报为 paired。
   - 未授权 peer 只能执行 health / pairing handshake。
3. **Reticulum pairing message**
   - 复用 `PairingManager` 生成 session 与 PIN。
   - 在 Reticulum link / packet 上定义最小消息：`pairing_offer`、`pairing_response`、`pairing_result`。
   - 成功后双方生成或交换 per-peer credential，并写入 `MeshState`。
   - 当前 HTTP `/mesh/pairing/*` 保留为兼容路径，但不再是新机制主路径。
4. **撤销与解绑**
   - `MeshState::revoke_peer_authorization()` 成为授权撤销唯一入口。
   - 同步撤销 Reticulum peer store 中该 identity 的 trusted/paired 记录。
   - 撤销后清空 token、scope grants、interests，并断开或降级 Reticulum link。
5. **UI 对齐**
   - “Reticulum 设备”区分“已发现 / 已连接未授权 / 已授权 / 已信任 / 已屏蔽”。
   - “授权”按钮进入 PIN 配对流程，而不是直接授权。
   - “撤销授权”明确表达解绑后业务同步会停止。
#### 验收
- 双 RT 通过 Reticulum 发现后，默认不是“已配对”。
- 未授权 Reticulum peer 无法触发业务同步，只能 health / pairing。
- PIN 正确后，双方 `MeshState` 创建 / 启用同一个 `identity_hex` peer，并持久化 token。
- PIN 错误后 session 销毁，peer 不进入 authorized。
- 撤销授权后，token / scope grants / interests 被清理，UI 从 authorized 回到 discovered 或 connected_unauthorized。
- Tauri MCP 双实例实测覆盖 `discover → pairing → authorized → unpair → unauthorized`。
#### 关键文件
- `crates/exomind-net-pairing/src/lib.rs`
- `crates/exomind-net-pairing/src/pairing.rs`
- `crates/exomind-net-pairing/src/peer_store.rs`
- `crates/exomind-runtime/src/pairing.rs`
- `crates/exomind-runtime/src/mesh/mod.rs`
- `crates/exomind-runtime/src/routes/mesh.rs`
- `src/ui/app/pages/agents/DeviceView.tsx`
- `tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx`
- `crates/exomind-runtime/tests/mesh_routes_integration.rs`
---
### Phase 2：旧发现 / 确认 API 迁移为 Reticulum peer 状态
#### 目标
把旧“已发现节点 / 已确认节点 / HTTP runtime peer”模型降级为兼容层，使真实状态来自 Reticulum identity + authorization + connection。新 API 不再问“这个 HTTP base URL 是否 confirmed”，而是问“这个 identity 当前是否 connected / authorized / trusted”。
#### 任务切片
1. **Peer 状态模型重构**
   - 定义 runtime 内部 `ReticulumPeerState`，至少包含：identity、host metadata、transport reachability、authorization、trust、last_seen、capabilities。
   - `MeshState` 保存授权与 scope，不保存 transient 连接事实。
   - Reticulum discovery store 保存当前可见 / 已连接事实。
2. **API 分层**
   - 新增或稳定 `GET /mesh/ret/peers`，返回 connected / authorized / trusted 的统一状态。
   - 保留 `/mesh/ret/discovered` 作为发现兼容视图，但语义上只代表 announce 可见。
   - `/mesh/peers` 继续表示授权 peer 表，不再承担发现职责。
   - `/mesh/discovered` 与旧 mDNS / HTTP discovery 标注 legacy，并逐步从 UI 主路径移除。
3. **旧 HTTP/SSE peer 兼容桥**
   - 对已授权 Reticulum peer，如存在 HTTP base URL，仍可临时生成 legacy `PeerInfoPublic`。
   - 兼容桥只服务尚未迁移的 `MeshRelayManager` / tests，不作为 UI 真相源。
   - 明确删除条件：Reticulum data-plane 能承载 mesh events 与 domain pull 后，兼容桥退出主路径。
4. **权限与 scope 接入**
   - `PeerScopeGrant` 从“HTTP peer id”迁到 “Reticulum identity peer id”。
   - 所有 scope grant lookup 以 `identity_hex` 为 key。
   - 已撤销 / blocked peer 不参与 reconciliation、backfill、event relay。
5. **UI 与测试迁移**
   - DeviceView 的“待配对节点 / 可信 peer”改由 Reticulum peer state 驱动。
   - 原 `confirmed_peer` / `discovered_candidate` 只作为 legacy section 或 fallback。
   - 更新单测与 Tauri MCP 验收脚本，以 identity 状态而非 HTTP base URL 判断配对。
#### 验收
- 同一个 Reticulum identity 通过不同地址 / seed 被发现时，UI 只显示一个 peer。
- 旧 confirmed peer 语义可由 authorized Reticulum peer 等效表达。
- 已授权 peer 可被 `PeerScopeGrant` 正确授予 / 撤销领域权限。
- 未授权 peer 不会出现在业务同步候选列表。
- 旧 HTTP/SSE routes 的兼容测试仍可通过，但新增测试以 Reticulum state 为主。
#### 关键文件
- `crates/exomind-runtime/src/routes/mesh.rs`
- `crates/exomind-runtime/src/mesh/mod.rs`
- `crates/exomind-net-pairing/src/discovery.rs`
- `crates/exomind-net-pairing/src/peer_store.rs`
- `src/lib/services/runtime-mesh-sync.service.ts`
- `src/ui/app/pages/agents/DeviceView.tsx`
- `src/ui/app/pages/agents/TopologyView.tsx`
- `src/ui/app/pages/agents-signal-topology.ts`
---
### Phase 3：业务同步迁移到 Reticulum data-plane
#### 目标
让 Reticulum / ENS 成为业务复制事件的承载通道。HTTP/SSE 可以保留为本地 UI、开发调试或兼容 transport，但跨 RT 同步不再依赖 HTTP base URL、EventSource 或 `/mesh/stream`。
#### 任务切片
1. **抽象 mesh data-plane**
   - 在 runtime 内定义媒介无关 `MeshDataPlane` / `PeerTransport` trait。
   - 能力至少包括：send event、subscribe events、request pull、respond pull、send ack / error。
   - HTTP/SSE 实现作为 legacy transport；Reticulum 实现作为新主路径。
2. **Reticulum frame 协议**
   - 定义 ENS frame envelope：`peer_id`、`channel`、`domain`、`message_id`、`cursor`、`payload`、`ttl/hop`、`signature/proof`（后续硬化）。
   - 第一版支持 JSON payload，先追求可观测和端到端正确，再做二进制压缩。
   - frame 类型至少覆盖：`signal_event`、`pull_request`、`pull_response`、`ack`、`error`。
3. **Signal relay 迁移**
   - `MeshRelayManager::forward_event_to_peers()` 不再直接 `POST /mesh/events`，而是调用 `MeshDataPlane`。
   - 本地 `SignalBus` 与 `Journal` 保持不变。
   - Reticulum 收到远端 frame 后复用 `MeshState::ingest_remote_event()`，避免重写领域 projector。
4. **Backfill / reconciliation 迁移**
   - 现有 Task reconciliation 里的 peer-auth pull 通路改为 data-plane pull。
   - EventLog / TimeBlock / Reminder / Proposal 的 backfill 也使用同一 request-response frame。
   - HTTP `/mesh/*/pull` routes 可保留为调试接口，但不是跨 RT 主通道。
5. **Proposal 纳入同步域**
   - Proposal 的同步与通知不能只停留在本地 UI 或 HTTP API。
   - 先按事件化路径处理：proposal created / updated / accepted / rejected / executed 进入 replication topic 或 domain pull。
   - 授权边界沿用 “动作 + 作用域”，不能因为走 Reticulum 就绕过 proposal 审批语义。
6. **传输选择与 fallback**
   - 默认优先 Reticulum data-plane。
   - 本地开发可配置 HTTP/SSE fallback。
   - fallback 不能改变授权语义：peer identity 与 scope grant 仍以 Reticulum identity 为准。
#### 验收
- A 端新增 EventLog / Task / TimeBlock 后，B 端通过 Reticulum data-plane 落库，不依赖 `/mesh/stream`。
- B 端离线期间漏掉 live frame，重连后通过 Reticulum pull / reconciliation 追平。
- 已撤销授权 peer 不再收到 replication frame，也无法 pull 数据。
- Proposal 生命周期事件至少能通过 Reticulum data-plane 被远端观察或补拉。
- HTTP/SSE transport 可关闭或不配置时，Reticulum 双 RT 仍能完成至少一个业务域的端到端同步。
- Tauri MCP 或双设备 release 包实测留下证据文件。
#### 关键文件
- `crates/exomind-runtime/src/mesh/mod.rs`
- `crates/exomind-runtime/src/signal/*`
- `crates/exomind-runtime/src/routes/eventlog.rs`
- `crates/exomind-runtime/src/routes/tasks.rs`
- `crates/exomind-runtime/src/routes/timeblocks.rs`
- `crates/exomind-runtime/src/proposal/*`
- `src/ui/hooks/useSignalStream.ts`
- `src/lib/services/ecs-eventlog-replication.service.ts`
- `src/lib/services/ecs-task-replication.service.ts`
- `src/lib/services/ecs-timeblock-completed-replication.service.ts`
- `src/lib/services/rt-domain-backfill.service.ts`
---
## 5. 推荐执行顺序
### 第一刀：身份与状态语义收口
先做最小但正确的状态模型：Reticulum discovered / connected / authorized 分离，并以 `identity_hex` 作为 peer id。没有这个前提，后续所有同步都会继续混淆“连上了”和“授权了”。
交付物：
- Reticulum peer state 类型与 API。
- UI 不再把 connected 直接显示为 paired。
- 现有 `POST /mesh/ret/peers/:peer_id/pair` 改为临时授权入口，并标明后续由 PIN flow 替代。
### 第二刀：Reticulum PIN 配对闭环
把旧 `PairingManager` 的 PIN/session/token 语义搬到 Reticulum message 上，完成真正的授权闭环。
交付物：
- Reticulum pairing offer / response / result。
- 双方授权 token 持久化。
- 撤销授权同步清理 runtime 与 Reticulum peer store。
### 第三刀：兼容 API 退居桥接层
把 UI 与同步候选列表切到新 Reticulum state，旧 `/mesh/discovered`、`/mesh/peers`、HTTP base URL 只作为兼容桥。
交付物：
- DeviceView 与 TopologyView 状态源迁移。
- MeshState scope grant 全面使用 identity peer id。
- 旧 mDNS / HTTP discovery 不再驱动主 UI。
### 第四刀：Reticulum 承载一个业务域
先选 EventLog 或 Task 中一个域做 Reticulum data-plane 闭环。推荐先选 EventLog：append-only、cursor 明确、冲突少；但若目标是验证 reconciliation，则选 Task 更能暴露真实问题。
交付物：
- `MeshDataPlane` trait。
- Reticulum frame 最小协议。
- 一个业务域 live replication + backfill 通过 Reticulum 完成。
### 第五刀：扩展到 TimeBlock / Task / Proposal
在 data-plane 被一个域证明后，按领域复杂度扩展。
交付物：
- TimeBlock completed replication。
- Task reconciliation Reticulum pull。
- Proposal lifecycle replication / notification。
---
## 6. API 替换清单
| 旧 API / 行为 | 目标状态 | 迁移阶段 |
|---------------|----------|----------|
| `POST /mesh/pairing/initiate` | 兼容保留；主流程由 Reticulum pairing control message 发起 | Phase 1 |
| `POST /mesh/pairing/respond` | 兼容保留；主流程由 Reticulum link / ENS control frame 提交 PIN | Phase 1 |
| `GET /mesh/discovered` | legacy projection；真相源来自 Reticulum peer state | Phase 2 |
| `GET /mesh/peers` | 授权表视图；真相源为 identity-keyed `MeshState` authorization | Phase 2 |
| `GET /mesh/ret/discovered` | 发现兼容视图；只代表 announce 可见，不代表 paired | Phase 2 |
| `GET /mesh/ret/peers` | 新主视图；返回 discovered / connected / authorized / trusted / blocked | Phase 2 |
| `PUT /mesh/interests/:peer_id` | 语义保留；`peer_id` 改为 Reticulum identity-first | Phase 2 |
| `GET /mesh/stream` | HTTP/SSE transport adapter；不再是跨 RT relay 核心 | Phase 3 |
| `POST /mesh/events` | HTTP transport adapter ingest；Reticulum adapter 走内部等价入口 | Phase 3 |
| domain replication HTTP routes | 调试 / fallback / backfill adapter；同步主源迁到 ENS frame | Phase 3 |
| UI “已确认节点” | 改为 authorized peer projection | Phase 2 |
| UI “Reticulum 设备” | 主设备网络入口，显示 discovered / connected unauthorized / authorized / trusted / blocked | Phase 1-2 |
---
## 7. 数据迁移策略
### 7.1 identity-first lazy migration
读取现有 mesh 持久化状态时，如果 peer id 是旧 `host_id`，且能从 Reticulum discovered / trusted store 找到对应 `identity_hex`，则迁移为 identity-keyed peer。
迁移要求：
- 原 `host_id` 保留为 alias / metadata，避免旧 UI、日志和测试一次性断裂。
- 同一 `identity_hex` 下多条旧 host 记录合并为一个 peer。
- 合并冲突时授权状态 fail-closed：只有明确授权 token / inbound secret 存在且未 revoked 时，才进入 authorized。
### 7.2 token 保留，语义升级
第一阶段继续保留 `inbound_secret` / `auth_token`：
- `inbound_secret` 表示“对方可访问本端业务能力的应用层授权”。
- `auth_token` 作为 HTTP adapter 的 outbound credential。
- Reticulum adapter 不必直接使用 Bearer header，但可把 token 作为应用层授权 proof 或迁移期 credential。
长期再把 token 升级为 scope-bound credential、identity proof 或 frame-level signature。
### 7.3 scope grants 跟随授权主键
`PeerScopeGrant.peer_id` 必须跟随 Reticulum identity 主键迁移：
- host_id → identity migration 时同步迁移 grants。
- revoke 时必须清理该 identity 的全部 grants。
- blocked / revoked peer 不参与 automatic grant reconciliation。
### 7.4 peer interests 不绑定 base_url
`PeerInterestSnapshot` 后续应绑定 transport-independent peer id：
- interests 只允许 authorized peer 设置。
- interests 不能绑定 HTTP base URL。
- 同 identity 多 transport 在线时，interests 代表 peer 意图，不代表某条连接。
---
## 8. 风险与约束
### 8.1 不要提前删除 HTTP/SSE
HTTP/SSE 目前仍承担：
- 本地 UI 订阅 RT signal。
- 开发调试与 tests。
- 旧 MeshRelayManager 兼容路径。
迁移目标是把跨 RT 真相源从 HTTP/SSE 移走，而不是一开始删除所有 HTTP/SSE 代码。
### 8.2 不要把 token 当作最终密码学方案
当前 token 是从旧 HTTP Bearer 机制继承来的授权凭证，适合第一阶段复用。长期应转为：
- Reticulum identity proof。
- link/session 级安全上下文。
- frame 签名或 HMAC。
- scope-bound credential。
但第一阶段不应因此阻塞配对迁移。
### 8.3 不要重写领域同步
业务同步已有大量领域规则：Task terminal precedence、EventLog replicationSeq、TimeBlock active/completed 分离、Proposal 授权语义。Reticulum 迁移只替换 transport，不改变这些领域规则。
### 8.4 Release 包跨设备实测要纳入验收
后续每完成一个阶段，至少要保留一种真实运行证据：
- 双 Tauri instance + Tauri MCP。
- 本机 release 包 + 另一台设备。
- 记录端口、identity、状态转换、数据落库结果。
---
### 8.5 当前阶段判断
当前处于 **战略相持期**：Reticulum 发现、identity 持久化、UI 状态、pair/unpair 第一刀已经具备；主要矛盾已经从“看得见 Reticulum 节点”转为“授权与业务同步仍由旧 HTTP/SSE 心智支配”。下一阶段局部进攻点是 Phase 1 的真实 PIN pairing over Reticulum：它最小、可测、能直接消除“发现即配对”的语义错误。
---
## 9. 测试矩阵
| 阶段 | Rust 单测 / 集成测试 | TS / UI 测试 | 实测 |
|------|----------------------|--------------|------|
| Phase 1 | `mesh_routes_integration`、`pairing.rs` one-shot / wrong PIN / revoke | DeviceView peer states / pair dialog / unpair | 双实例 discover → PIN pair → unpair |
| Phase 2 | identity merge、scope grant lookup、legacy bridge | DeviceView / TopologyView 状态源迁移 | 同 identity 多地址只显示一个 peer |
| Phase 3 | data-plane frame encode/decode、ingest、pull response | replication projector 不回归 | 关闭 HTTP peer stream 后，Reticulum 仍能同步一个业务域 |
建议每次开发切片至少运行：
```bash
cargo test -p exomind-runtime --test mesh_routes_integration
cargo check -p exomind-net-pairing -p exomind-runtime
yarn vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
```
涉及业务域同步时，追加对应 domain tests 与 Tauri MCP 双实例实测。
---
## 10. 完成判据
### 10.1 阶段性完成
- Phase 1 完成：Reticulum peer 的授权 / 撤销授权可替代旧配对的核心安全语义。
- Phase 2 完成：UI 和 API 的主状态源不再是 HTTP discovered / confirmed，而是 Reticulum identity + authorization。
- Phase 3 完成：至少 EventLog / Task / TimeBlock / Proposal 中一个真实业务域通过 Reticulum data-plane 完成 live replication + backfill，并证明可扩展到其他域。
### 10.2 总完成
- 未授权 Reticulum 连接不能访问业务数据。
- 已授权 identity 可跨不同发现介质自动归并并无感授权。
- 撤销授权后，业务同步立即停止且持久化状态被清理。
- HTTP/SSE 不再是跨 RT 同步的唯一主路径。
- 业务同步仍落在现有 RT SQLite / domain projector / reconciliation 架构中。
---
## 11. Session Checkpoint — 2026-05-26 v3
> 无上下文 Agent 从本 checkpoint 开始即可独立恢复工作。
> v3 增补：SSE snapshot 含 peers 字段，#2 已解决。
### 当前分支与提交
| 仓库 | 分支 | 最新提交 | 变更概要 |
|------|------|---------|---------|
| `exomind-team/exomind` | `feat/ret-mesh-prototype` | `d59be8ce` | fix(ret-mesh): 三态开关点击后立即推送 SSE snapshot 刷新状态 |
| `ARCJ137442/Reticulum-research` | `main` | `c210cc5` | ara: O14 — 联通方式×Reticulum Interface 理论区分 |
`feat/ret-mesh-prototype` 增量 6 commits 相对基线 `dev`（v3 待提交）：
| SHA | 摘要 |
|-----|------|
| `8357f3a7` | feat(ret-mesh): 三态连接模式 — AtomicBool → RetMeshMode |
| `12442bf7` | docs: neat-freak — 三态开关 API 文档同步 + 状态表更新 |
| `28d5250a` | feat(ret-mesh): InterfaceManager 接口枚举 API + 动态 UDP 端口 |
| `5323cdc6` | docs: neat-freak — 追加 PIN 配对 UI 缺口已知问题 |
| `7179e004` | docs: 三态开关附着点修正 + 联通方式×Interface 理论研究课题 |
| `d59be8ce` | fix(ret-mesh): 三态开关点击后立即推送 SSE snapshot 刷新状态 |
### 已完成的工作（v3 新增 #8）
1. **三态连接模式全局开关** — `RetMeshMode` 枚举（Off/Passive/Active）替代 `AtomicBool`。AppState `ret_mesh_mode: Arc<AtomicU8>`。API：`POST /mesh/ret/announce {"mode":"off|passive|active"}`。SSE：`announce_mode` 字段。前端：三段式按钮（"连接模式"），右上角。19 files changed, +208/-72。
2. **InterfaceManager 接口枚举 API** — `LocalInterface` 增加 name/iface_type；`spawn()` 接受 name+type 参数；`list_interfaces()` 公开枚举；`InterfaceInfo` 结构体。SSE snapshot `interfaces` 字段。
3. **动态 UDP 端口** — 主 UDP 接口从固定 `HTTP_port+6000` 改为 `0.0.0.0:0`（OS 分配）；`UdpInterface.bound_port: Arc<AtomicU16>`；`add_udp_interface` 返回 `Arc<AtomicU16>`，forward_addr 改为 `Option<&str>`；mDNS 注册移至 ret_mesh 创建之后（使用实际端口）；`default_ret_udp_port()` 已删除。
4. **文档同步** — AGENTS.md + physical-connectivity-layer.md（§3.1/§3.3/§9/§10）+ Reticulum-research AGENTS.md Rust API 示例。
5. **ARA 理论沉淀** — N12（三态决策）、N13（物理联通层决策）、N14（Tauri 构建死胡同）；H01 结晶；O11-O14 暂存。
6. **Release 构建** — ExoMind_0.4.15_x64-setup.exe（NSIS）+ MSI + 单程序 exe。Release 模式构建不受 dev 栈溢出影响。
7. **✅ initiate-pair 端点 + PIN 展示弹窗** — 新增 `POST /mesh/ret/peers/:peer_id/initiate-pair`，调用 `PairingManager::initiate()` 生成 PIN+session，返回给前端展示。前端「授权」按钮改为先 initate → 展示 PIN 弹窗（发起方）→ 可切换至输入 PIN 弹窗（响应方）。4 files changed, ~176 行增量。
8. **✅ SSE snapshot 含 peers 字段** — `try_push_ret_mesh_snapshot` 在推送 snapshot 时将 peers map 转换为 `connection_state`/`authorized` 等字段的 JSON 数组写入 `payload.peers`。前端 SSE handler 可直接消费，无需手动刷新页面。1 file + 1 test。
### 已知问题（待处理）
| # | 问题 | 严重度 | 文档位置 |
|---|------|--------|---------|
| ~~1~~ | ~~PIN 配对 UI 缺口~~ | **✅ 已解决** | `physical-connectivity-layer.md §9.1` |
| ~~2~~ | ~~mDNS 列表不刷新（SSE snapshot 缺 peers）~~ | **✅ 已解决** | `physical-connectivity-layer.md §9.2` |
| 3 | mesh_relay + discovery_pairing_relay 测试 5/5 fail — `enable_ret_mesh` 覆写 host_id 导致 relay 匹配失败 | 中 | 根因已分析待修复 |
| 4 | 按 Interface 三态开关未实现 — `InterfaceManager.set_interface_mode()` + 前端每接口按钮 | 低 | `physical-connectivity-layer.md §4` |
| 5 | 联通方式×Reticulum Interface 的理论区分需研究 — 5 个具体问题 | 低 | `physical-connectivity-layer.md §10` |
| 6 | Reticulum 启动后首条 SSE snapshot 延迟 10s — 前端 status 由 SSE 驱动且无 `GET /mesh/ret/status` 退路，导致窗口期内 UI 显示「未启用」 | 低 | `lib.rs:ret_mesh_background` tick 间隔 |
| 7 | ⚠️ `tauri-plugin-log` logger 冲突 — 并行 `cargo build` 破坏增量状态后，Tauri log plugin 初始化失败 `PluginInitialization("log", "attempted to set a logger after the logging system was already initialized")` | 中 | 串行构建可避免 |
| 8 | 🔧 `reticulum-rs` 编译警告清理 — 15 个 warnings（`CacheSet::insert`/`contains` 等未使用方法） | 低 | `Reticulum/experiment/rs` |
**Next steps 优先级建议（由高到低）：**

### 安全加固：消除「跨 await 持锁」危险模式

死锁排查发现 3 处 `MutexGuard` 跨 `.await` 的危险模式，按紧迫度排序：

1. **🔴 iface.rs send() — 完全消除阻塞 fallback**（`iface.rs:246`）
   - 当前：`try_send` 在 `Full` 时回退到 `send(msg).await` — 仍然阻塞
   - 修复：`Full` 时直接 `drop(msg)`（UDP 不可靠，丢一个 announce 不影响）
   - 文件：`reticulum-rs/src/iface.rs:237-248`

2. **🔴 handle_announce — 缩短锁 A（handler）持有时间**（`transport.rs:811`）
   - 当前：`MutexGuard<TransportHandler>` 贯穿异步路径 → `handler.send(message).await` 再取锁 B
   - 修复：入口提取字段 → `drop(handler)` → 锁外再发 announce_tx
   - 文件：`reticulum-rs/src/transport.rs`

3. **🔴 manage_transport RX 循环 — 分阶段处理**（`transport.rs:1245`）
   - 当前：`handler.lock().await` 后 match → handler 被移入 `handle_announce`
   - 修复：锁内只读报文头 → `drop(handler)` → 分发到专用 handler
   - 文件：`reticulum-rs/src/transport.rs`

### 功能迭代

4. **按 Interface 三态开关（#4）** — `InterfaceManager.set_interface_mode()` + 前端每接口三段式按钮
5. **修复 Reticulum UI 状态不同步（#6）** — 立即推送首条 SSE snapshot
6. **修复 relay 测试失败（#3）** — `enable_ret_mesh=false` 或修复 host_id 覆写逻辑
7. **研究任务（#5）** — 联通方式×Interface 理论区分

### 架构改进

8. **🟡 iface_mgr.send() 并行化 — 消除单接口拖垮全局**（`iface.rs:223-241`）
   - 当前：`for iface in &self.ifaces { ... tx_send.try_send(msg).await }` — 串行遍历，但 `try_send` 已非阻塞
   - 问题：若某个接口完全死亡（TX task 挂起），虽不会阻塞但接口沦为僵尸，浪费资源
   - 背景：设计继承自 Python RNS 的同步心智。Python 版本也逐接口串行 `send()`。Rust 移植版直接沿用了同样的循环结构。
   - 修复：用 `futures::future::join_all` 并行发往所有接口，配合超时机制淘汰僵尸接口
   - 文件：`reticulum-rs/src/iface.rs`
   - 前置：`try_send` 已就绪（#1），确保无阻塞后再做并行化

### 配对协议状态机补齐 — PairingOffer 帧

**背景**：当前 `initiate-pair` 仅在本机 `PairingManager` 创建 session，不通知对端。响应方需要手动点「授权」+「改为输入配对码」才能进入输入模式。

**三层架构确认**（含多跳路由）：

```
配对授权层（PIN / session / token / MeshState）
    ↑
Reticulum 层
   ├── Identity / 加密（端到端 Link 加密）
   ├── 多跳路由：
   │   ├── PathTable — 按目的地查下一跳 + 接口（path_table.rs）
   │   ├── PathRequest — 未知目的地时广播探路（transport.rs:898）
   │   ├── send_to_next_hop — 转发非本地包（transport.rs:691）
   │   ├── Link 跨中间节点建立（handle_link_request_as_intermediate）
   │   └── 跳数追踪：PATHFINDER_M=128, announce.header.hops+1
   └── Announce 扩散 / 包路由 / 链路维护
    ↑
物理联通层（UDP / TCP / 文件 / mDNS）
```

**代码证据** — `reticulum-rs/src/transport/path_table.rs`：

```rust
pub struct PathEntry {
    pub hops: u8,                    // 到目的地的跳数
    pub received_from: AddressHash,  // 下一跳 identity
    pub iface: AddressHash,          // 从哪个接口可达
}

// Announce 到达时更新路径表（跳数择优）
let hops = announce.header.hops + 1;
if let Some(existing) = self.map.get(&announce.destination) {
    if hops > existing.hops { return; }  // 不优的路径丢弃
}
self.map.insert(announce.destination, PathEntry { hops, .. });

// 转发包时重写包头指向下一跳
pub fn handle_inbound_packet(&self, packet, lookup)
    -> (Packet, Option<AddressHash>) {
    let entry = self.map.get(&lookup)?;
    (Packet {
        header: Header { hops: packet.header.hops + 1, .. },
        transport: Some(entry.received_from),  // 下一跳
        ..
    }, Some(entry.iface))
}
```

Reticulum 层不只是"加密传输通道"——它是一个完整的多跳自组织网络栈，包含路径发现、择优、转发和链路跨节点建立。

**三层简化描述**：
- 物理联通层：打通第一跳（UDP/TCP/文件）
- Reticulum 层：多跳路由（从第一跳到第 N 跳）
- 配对授权层：决定谁可以访问（PIN/token/MeshState）

`RetPairingLinkFrame` 定义在 `exomind-net-pairing/src/pairing.rs`，不在 `reticulum-rs`。发送接收都通过 reticulum-rs 的通用 API（`link.data_packet()` / `link_in_rx`），不需要为新增帧类型修改 reticulum-rs。

**阶段 1：PairingOffer 帧**（当前最高优先级，不改 reticulum-rs）

| 文件 | 改动 |
|------|------|
| `exomind-net-pairing/src/pairing.rs` | `RetPairingLinkFrame` 增加 `PairingOffer { session_id, initiator_peer_id }` variant |
| `exomind-runtime/src/routes/mesh.rs` | `initiate_ret_pair` 末尾调用 `send_pairing_frame` 发送 Offer 帧 |
| `exomind-runtime/src/lib.rs` | `link_in_rx` handler 增加 `PairingOffer` 分支，存入 `pairing_pending` 状态 + 推 SSE |
| `src/ui/app/pages/agents/DeviceView.tsx` | SSE 检测 `pairing_pending` 后自动切换到输入模式 |

### 开启真正多跳路由 — set_retransmit(true)

**现状**：`TransportConfig` 的 `retransmit` 默认为 `false`，exomind 创建 Transport 时从未调用 `set_retransmit(true)`。导致：

```
C 发出 announce → B 收到 → if retransmit { handler.send(message) } → 永不成立
                                                            → announce 不转发
                                                            → PathTable 只有直连条目
                                                            → Link 无法跨节点建立
                                                            → 每个 peer 必须直连接口
```

**开启后的变化**（`retransmit=true` + `reroute_eager=true`）：

```
节点 A ──(UDP/TCP)──→ 节点 B ──(UDP/TCP)──→ 节点 C
   │                    │                     │
   │  C 的 announce     │  B 转发 announce    │  原始 announce
   │  ←────────────  ←─────────────────────── C 发出
   │                     │
   │  A 的 PathTable:    │  B 的 PathTable:
   │  C → 下一跳 B      │  C → 直连
   │  (无需到 C 的接口)   │
```

**改动**：

| 文件 | 改动 |
|------|------|
| `exomind-net-pairing/src/lib.rs` | `create_transport` 中加 `config.set_retransmit(true); config.set_reroute_eager(true);` |

**收益**：
- 文件注册表/UDP 接口不再需要为每个 peer 创建——有 1 个邻居连接到转发节点即可到达整个 mesh
- Link 可以在任意两个节点间建立，即使没有直连物理链路
- 物理联通层更简单——只需要保证至少一个接口到网络

**注意事项**：
- 转发节点会增加 CPU/带宽开销（为他人转发 announce 和数据包）
- 需确认 `announce_limits` 已生效（第 830 行），防止 announce 风暴
- `PATHFINDER_M = 128` 最大跳数，小规模 mesh 下绰绰有余
- `iface_tx_cap = 16` 原为 1（旧代码），需确认当前值足够应付转发积压

**阶段 2：JSONL 文件通道**（若 TCP/UDP 配对不稳定则启用）
- 复用文件注册表目录结构，每实例写自己的消息文件
- `Reticulum Link` 加密保证载荷机密性，JSONL 只承载加密后的 Reticulum 包

### 接口删除 — remove_interface() 按名称清理

**背景**：按名称删除最合理——名称在 UI 中已显示（下层接口列表），且 TCP Client 的名称包含地址（`TCP Client → 127.0.0.1:50848`），可精确匹配。当前接口删除方案受限于 udp.rs `spawn()` 使用本地 `CancellationToken`，而非 `context.channel.stop`：

```rust
// udp.rs 当前：
let stop = CancellationToken::new();  // 本地 token，不受外部控制
// RX/TX 任务使用这个本地 stop → 即使 LocalInterface.stop 被 cancel 也不影响

// 修正后：
let stop = context.channel.stop.clone();  // 与 LocalInterface.stop 共享同一 token
// cancel LocalInterface.stop → udp.rs 循环检测到 → 不重建 → 接口永久停止
```

**改动清单**：

| 文件 | 改动 | 影响范围 |
|------|------|---------|
| `reticulum-rs/src/iface.rs` | 新增 `pub fn remove_interface(name: &str) -> bool` | 仅 InterfaceManager |
| `reticulum-rs/src/iface/udp.rs` | `CancellationToken::new()` → `context.channel.stop.clone()` | 1 行，UDP 接口生命周期 |
| `reticulum-rs/src/iface/tcp_client.rs` | 同上（如果也用了本地 stop） | 可能 1 行 |
| `reticulum-rs/src/iface/tcp_server.rs` | 同上 | 可能 1 行 |
| `exomind-runtime/src/lib.rs` | 撤销授权后调用 `remove_iface` | 仅撤销授权路径 |

**前置**：当前 TCP 去重已能防止重复连接积累，`remove_interface` 是更完整的清理，独立任务后续再做。

### 验证命令速查
```bash
# 编译
cargo check -p exomind-net-pairing -p exomind-runtime
# Rust 测试
cargo test -p exomind-net-pairing
cargo test -p exomind-runtime --test mesh_routes_integration
# 前端测试
npx vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
npx vitest run tests/unit/services/runtime-mesh-sync.service.test.ts
npx vitest run tests/unit/services/runtime-mesh-host-sync.service.test.ts
npx vitest run tests/unit/sync/device-id.test.ts
# Release 构建
cd src-tauri && cargo tauri build
```
### Tauri MCP 验证预检清单
连 MCP 前必须完成以下三重预检，否则大概率卡住。详见 `docs/development/tauri-mcp-windows-playbook.md` 的「MCP 连接排查标准流程」章节。
| 预检 | 命令 | 通过标准 |
|------|------|----------|
| API 存活 | `curl /mesh/ret/status` | 200 |
| 后端健康 | `grep -E "panic\|overflow" .tmp/tauri-dev-instances/<name>.log` | 0 匹配 |
| bridge 归属 | `netstat -ano \| findstr ":<bridge_port>"` | 端口 LISTENING，PID 匹配当前实例 |
### 验收标准
#### 自动化验收（开发迭代期每次必跑）
上述验证命令速查中的所有检查项全部通过。
#### Tauri MCP 真窗验收（发布前或 UI 变更后必做）
**仅通过 API curl 验证不算完成**。必须在真实 Tauri 桌面窗口中完成交互式操作验证：
1. **启动**：`bun run tauri:manager start --name <instance>`
2. **确认 RT 端口可达**：`curl http://127.0.0.1:<rt_port>/mesh/ret/status` → 200
3. **连接 Tauri MCP**：`driver_session start --host 127.0.0.1 --port <bridge_port>`
   - 若官方 driver_session 不可用，改用 raw bridge 连接 WebSocket
4. **交互验证**：
   - 在窗口中点击对应 UI 元素（按钮、开关、弹窗）
   - 通过 `webview_snapshot`/`webview_execute_js` 确认前端状态变化
   - 通过 API curl 确认后端状态变化
5. **窗口截图**保留为验收证据
**查看实际元素变化**（如按钮状态切换、PIN 弹窗出现、peer 列表更新）才算 Tauri MCP 验收通过。
