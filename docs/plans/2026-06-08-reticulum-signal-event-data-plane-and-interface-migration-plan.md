# Reticulum SignalEvent 数据面与 Interface/local-link 迁移计划

> 状态：active plan
> 日期：2026-06-08
> 关联计划：`2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
> 关联考古：`2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`
> 关联质量门槛：`2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`

## 一句话目标

让用户能够通过 Reticulum 同步外心里的事件日志、时间块、任务与提案；Reticulum gateway、`SignalEvent` frame、Interface/local-link 迁移和 provider 分层都是服务这个用户功能目标的实现约束。

## 用户功能目标

最低可交付功能不是“Reticulum 状态可见”，而是用户在两个已授权设备之间能看到这些数据通过 Reticulum 同步：

1. 事件日志：一端追加 EventLog record，另一端出现同一 record。
2. 任务：一端创建或更新 Task，另一端获得同一任务快照。
3. 时间块：一端更新 active/completed TimeBlock，另一端获得对应时间块状态。
4. 提案：一端创建或更新 Proposal，另一端获得同一提案状态。

用户不需要知道 `SignalEvent`、provider trait 或 link packet 是什么；这些架构设计只用于保证上述功能可维护、可测试、可扩展。

## 背景

当前数据同步相关接口显得混乱，根因不是缺少某个 route 或某个 transport，而是五类职责被混在了一起：

1. 业务写入：例如 EventLog 的 append。
2. 复制事件生成：把业务写入转换成 `SignalEvent`。
3. 复制事件应用：远端收到后由对应 actor/projector 写入本地 store。
4. Reticulum gateway：跨 RT 唯一网络网关，负责传输、验权入口、去重入口和投递。
5. 物理 interface：UDP/TCP/mDNS/File/JSONL/Queue 等作为 Reticulum 下方的底层发现与互通途径。

旧 Reticulum 分支推进了大量现场经验，但也把 discovery、pairing、interface mode、route、UI、文件注册表、mDNS bridge 和 runtime loop 绑在一起。这个分支不应该按代码形状迁移；它应该作为行为规格和测试场景来源。

## 核心判断

Reticulum 的核心价值不是“展示一个 Reticulum 状态区”，而是成为 ExoMind RT 之间唯一的网络网关。runtime mesh 的同步功能要从互相调用 HTTP/SSE，收敛到以 Reticulum identity、Reticulum announce/link/data packet 和 Reticulum interface 为核心的跨设备通信模型。

当前同步中轴已经存在，应该复用它来交付功能：

```text
User action / domain write
  -> domain service/appender
  -> SignalEvent(replication topic)
  -> Reticulum gateway frame
  -> Reticulum link / packet
  -> MeshState::ingest_remote_event
  -> SignalPool
  -> replication_actor / domain projector
  -> remote store
```

所以后续实现应补 Reticulum gateway，而不是重写业务同步语义，也不是继续扩展 RT-to-RT HTTP/SSE 调用。Reticulum provider 负责把 `SignalEvent` 包装成传输 frame、投递、接收、验权并交回 `MeshState::ingest_remote_event`。EventLog 是第一条纵切验证路径，不是最终功能边界。

HTTP/SSE 的定位：

- 本机 UI 调 RT、debug route、开发联调和 legacy compatibility 可以继续使用 HTTP/SSE。
- RT-to-RT 的发现、配对、同步不应以 HTTP base URL 可达为前提。
- 现有 `MeshRelayManager` 只能作为历史参考与过渡兼容，不是目标架构的 peer transport。
- 脱离局域网、NAT 或端口不可达时，Reticulum gateway 才是要继续工作的网络路径。

## 为什么这样做

ExoMind 的架构原则要求动作留下痕迹、过程可追踪、责任边界明确。`SignalEvent` 已经承担了这些语义：事件有 `id`、`topic`、`origin_host_id`、`hop`、`trace_id` 和 payload。若 Reticulum 直接写业务 store，或为 EventLog/Task/TimeBlock 各自做 transport-specific 接口，就会把 gateway 和 domain projector 重新搅在一起，后续冲突处理、授权、去重、可观测性都会分裂。

因此：

- 同步层只认 `SignalEvent`。
- 业务复制仍由现有 actor/projector 应用。
- Reticulum 成为唯一跨 RT gateway/provider，不成为第二套业务同步系统。
- Interface/local-link 只进入 Reticulum provider/物理 interface 层，不进入业务层。

## 非目标

1. 不做 `ReticulumEventLogSync`、`ReticulumTaskSync`、`ReticulumTimeBlockSync` 这类 domain-specific transport 接口。
2. 不重写 EventLog、Task、TimeBlock、Proposal 的业务 projector。
3. 不让 Reticulum provider 直接调用 `EventLogStore`、`TaskStore` 或其他业务 store。
4. 不在第一阶段接 UI、route 或 `AppState` 字段。
5. 不在真实 provider 最小纵切通过前接 `AppState` / UI 或扩大启动集成面；真实 `ExoNet-Reticulum` dependency 必须由 provider 级测试约束。
6. 不迁移旧分支 localhost/端口 `+/-` 推导。
7. 不把 mDNS/local file registry 提升为与 Reticulum 平级的 ENS 抽象；它们最多是 Reticulum interface/bootstrap/local-dev provider implementation。

## 当前事实依据

### ExoMind runtime 同步链路

- `crates/exomind-runtime/src/eventlog_appender.rs`
  - `EventLogAppender::append_event` 先写本地 `EventLogStore`，再调用 `publish_replication_append`。
  - `publish_replication_append` 构造 `SignalEvent`，发布到 `SignalPool`，并可交给 `MeshRelayManager::forward_event_to_peers`。
  - EventLog 复制 topic 是 `eventlog.replication.appended`。
- `crates/exomind-runtime/src/mesh/mod.rs`
  - `MeshState::should_stream_event_to_peer` 已处理 origin bounce、hop limit、targeted remote route 和 peer topic interest。
  - `MeshState::ingest_remote_event` 已处理 origin bounce、hop limit、duplicate event id、peer online mark、发布到 `SignalPool` 和 delivery record。
  - `MeshRelayManager` 当前是 HTTP/SSE 过渡实现的参考，不是目标架构的跨 RT 传输层。
- `crates/exomind-runtime/src/signal/actors/replication_actor.rs`
  - `spawn_replication_actor` 订阅 `SignalPool`。
  - `apply_eventlog_replication` 根据 `SignalEvent` payload 写入 `EventLogStore`。
  - Task、TimeBlock、Proposal 的复制也按 `SignalEvent.topic` 分派。
  - 已有复制 topic 包括：
    - `eventlog.replication.appended`
    - `task.replication.upserted`
    - `timeblock.replication.active_upserted`
    - `timeblock.replication.completed`
    - `proposal.replication.upserted`

### 当前 ENS 原型事实

- 当前 `crates/exomind-runtime/src/ens/` 已有 control-plane fake provider、typed DTO、service 和 `EnsPairingFrame`。
- 当前 provider trait 只覆盖 `send_pairing_frame`，尚未定义 data-plane frame。
- fake 双节点 PIN 握手已跑通：`PairingOffer -> PairingResponse -> PairingComplete`，形成双侧授权闭环。

### 当前 ExoNet-Reticulum API 事实

- `H:\A137442\Develop\AGI\ExoNet-Reticulum\src\interface.rs`
  - `InterfaceTopology::{Off, Passive, Active}`
  - `InterfaceInfo`
  - `InterfaceManager::list_interfaces`
  - `InterfaceManager::set_topology`
  - `InterfaceManager::set_global_topology`
  - `InterfaceManager::add_interface`
- `H:\A137442\Develop\AGI\ExoNet-Reticulum\src\transport.rs`
  - `Transport::recv_announces`
  - `Transport::send_announce`
  - `Transport::send_to_all_out_links`
  - `Transport::send_to_out_links`
  - `Transport::send_to_in_links`
  - `Transport::link`
  - `Transport::received_data_events`
- 当前接口实现包括 `file.rs`、`jsonl.rs`、`queue.rs`、`tcp_client.rs`、`tcp_server.rs`、`udp.rs`。

## 目标分层

### L3 runtime mesh service

拥有同步语义和授权语义的入口。

- 维护 peer identity、pairing status、authorized peers、delivery state。
- 调用 provider 发送 frame。
- 接收 provider frame 后验权，再调用 `MeshState::ingest_remote_event`。
- 不知道 UDP/TCP/mDNS/File/Queue 的细节。
- 跨 RT peer key 以 Reticulum identity 为根；`host_id` 只保留为 runtime metadata。

### ENS/Reticulum gateway provider contract

连接 ExoMind runtime mesh 与唯一 Reticulum gateway。

- control plane：peer discovery、announce、pairing frame。
- data plane：发送和接收 `SignalEvent` frame。
- interface plane：列出接口快照、设置全局/单接口 topology。
- 不调用业务 store。
- 不把本地开发 endpoint 推导成生产 endpoint。
- 不暴露 HTTP base URL 作为跨 RT 主连接事实。
- endpoint advertisement 必须声明 `gateway=reticulum`，并用 `via_interface` / `via_medium` 表达底层互通来源；UDP/TCP/mDNS/Bluetooth/File/JSONL/Queue/local-dev 都是 Reticulum interface medium，不是独立的跨 RT discovery channel。

### ExoNet-Reticulum physical layer

负责真实 transport。

- 管理 `InterfaceManager`、`Transport`、link、announce 和 received data。
- 使用当前 ExoNet-Reticulum crate root 与公开 API。
- UDP/TCP/mDNS/File/Queue 等只作为 Reticulum interface 的底层发现与互通途径。
- 可先使用 queue/file 或 TCP/UDP 做最小真实 provider 验证。

### Reticulum identity root

RT 的跨设备网络身份应派生自 Reticulum identity。

- `identity_hex` 是 trust、pairing、delivery、discovery 的主键。
- `host_id` 是 runtime metadata，可用于 UI、日志和本机进程归因，但不能替代 Reticulum identity。
- pairing 授权、peer store、delivery record 都应以 Reticulum identity 为稳定 key。
- identity seed 损坏、解析失败或意外 rotation 必须 fail closed。

## 拟议 data-plane contract

当前 `EnsPairingFrame` 只服务 control plane。下一步应新增独立 data-plane frame，不要把 `SignalEvent` 塞进 pairing frame。

拟议形状：

```rust
pub enum EnsDataFrame {
    SignalEvent(EnsSignalEventFrame),
}

pub struct EnsSignalEventFrame {
    pub frame_id: String,
    pub from_peer: EnsPeerIdentity,
    pub scope_hint: Option<String>,
    pub event: SignalEvent,
}
```

provider trait 拟议拆分：

```rust
pub trait EnsDataPlaneProvider: Send + Sync {
    fn send_signal_event(
        &self,
        peer: &EnsPeerIdentity,
        event: SignalEvent,
    ) -> Result<(), EnsProviderError>;

    fn drain_received_data_frames(&self) -> Vec<EnsDataFrame>;
}
```

命名可以在实现时调整，但 contract 必须满足：

1. frame envelope 标识 immediate sender；immediate sender 来自 Reticulum identity；`SignalEvent.origin_host_id` 保留业务事件源，不被 provider 重写。
2. 验权以 immediate sender 和 peer authorization 为准。
3. 去重仍依赖 `MeshState::ingest_remote_event` 的 event id dedupe。
4. hop 递增仍由 mesh ingest 路径负责。
5. ack/receipt 可以后置，但 frame id 必须从第一版开始存在，方便后续 delivery record 对齐。

## Interface/local-link 迁移 contract

旧分支的 InterfaceMode/local-link 经验要迁移，但要落在 provider/物理连接层。

### 保留

1. Off / Passive / Active 三态连接语义，并适配当前 `InterfaceTopology`。
2. global topology 与 per-interface topology。
3. `InterfaceInfo` 快照：name、type、online、outgoing、topology。
4. UDP/TCP/File/JSONL/Queue 作为 local/dev 或真实 provider 的接口实现。
5. 本地多实例开发连接的场景，但必须由显式 config 或 provider advertisement 描述。

### 不保留

1. `reticulum::iface::InterfaceMode` 旧路径。
2. `../../../ExoNet-Reticulum/src` path dependency。
3. localhost hardcode 和端口偏移推导。
4. 把 interface state 放进 UI component 或 route island。
5. 把 local registry/mDNS bridge 写进 service 主循环。

### topology 一致性规则

global topology 和 per-interface topology 是两处不同状态，不是同一个“全部设置”动作的两种 UI 表达。

规则固定如下：

```text
Off < Passive < Active
effective_topology = min(global_topology, interface.topology)
```

含义：

- `global_topology` 是全局能力上限，类似总电源或总限制。
- `interface.topology` 是单个接口的配置状态。
- `interface.effective_topology` 是后端 snapshot 中暴露给 UI 的事实状态。
- `global_topology = Off` 时，所有接口的生效状态都是 Off，但接口自身配置值不应被批量改写。
- `global_topology = Passive` 时，配置为 Active 的接口也只能生效为 Passive，不能发 announce。
- `global_topology = Active` 时，接口按自身配置生效。

这条规则必须在 service 层统一计算并测试。route、TypeScript service 和 React UI 不得各自重新解释 topology，否则前端很容易显示“看起来已 Active”，但 Reticulum runtime 实际仍处于 Passive 或 Off。

### 目标 DTO

```rust
pub enum EnsInterfaceTopologyDto {
    Off,
    Passive,
    Active,
}

pub struct EnsInterfaceSnapshot {
    pub name: String,
    pub interface_type: String,
    pub online: bool,
    pub outgoing: bool,
    pub topology: EnsInterfaceTopologyDto,
    pub effective_topology: EnsInterfaceTopologyDto,
}

pub enum EnsLocalLinkKind {
    Udp,
    TcpServer,
    TcpClient,
    File,
    Jsonl,
    Queue,
}
```

DTO 可以复用当前 `ens/dto.rs` 中已有类型；若已有类型不足，扩展 DTO，不要让 UI 或 route 直接依赖 ExoNet-Reticulum 内部类型。

`topology` 表示单接口配置值；`effective_topology` 表示已应用全局上限后的后端事实。若后续为了命名更清晰改成 `configured_topology`，必须保持 route/TS/UI 同步迁移，不能让同一个字段在不同层含义不同。

UI 一致性约束：

- UI 必须展示全局配置状态。
- UI 必须在每个接口行展示“配置 topology”和“生效 topology”。
- 全局控制按钮不得写成“全部 Off / 全部 Passive / 全部 Active”。
- 全局控制只修改 `global_topology`，不能批量改写接口配置。
- 单接口控制只修改该接口 `topology`，不能绕过全局上限。
- UI 只相信 backend snapshot/SSE。点击按钮后的 pending 状态不能把 displayed topology 乐观改成目标值。

## 阶段计划

### 当前完成状态

截至 2026-06-08，本计划的 control-plane 前置条件、fake data-plane 最低功能集和第一条真实 Reticulum provider 纵切已经推进到可提交状态：

- ENS/Reticulum fake control-plane 能完成双节点 PIN pairing happy path。
- 后端支持 `global_topology`、`interface.topology` 与 `interface.effective_topology = min(global_topology, interface.topology)`。
- route/UI 已能查看和调整 Reticulum interface 状态，并保持 backend snapshot truth。
- discovered peer endpoint 已强制带有 `gateway=reticulum`、`via_interface`、`via_medium`，避免继续把 HTTP base URL 或 mDNS registry 当成 peer truth。
- ENS data-plane 已新增独立 `EnsDataFrame::SignalEvent`，与 `EnsPairingFrame` 分离。
- `EnsTransportService` 已提供 `send_signal_event_to_peer` 与 `handle_data_frame`，发送侧和接收侧都要求 Mesh 中存在 enabled/authorized identity-keyed peer。
- fake provider 已能记录 data frame 投递目标；测试通过 fake gateway 把 A 端 `SignalEvent` 交给 B 端 `MeshState::ingest_remote_event`。
- `crates/exomind-runtime/tests/ens_data_plane.rs` 已覆盖 EventLog、Task、TimeBlock active/completed、Proposal 四类复制 topic，并覆盖 unauthorized peer、duplicate event id、origin bounce 和发送侧未知目标。
- `ReticulumEnsProvider` 已用当前 `ExoNet-Reticulum` crate root 和公开 API 接入真实 `Transport` / `InterfaceManager` / `QueueInterface` / UDP / TCP interface entrypoint。
- provider 以 Reticulum `PrivateIdentity` 派生 `identity_hex`，以 local destination address hash 填充 `reticulum_destination`；二者不混用。
- provider 后台任务只解码 Reticulum packet-level payload 为 `EnsDataFrame`，再由 `EnsTransportService::handle_pending_data_frames` 进入 `handle_data_frame` / `MeshState::ingest_remote_event`；provider 仍不直接写业务 store。
- `crates/exomind-runtime/tests/ens_reticulum_provider.rs` 已证明 queue-backed Reticulum provider 能在不经 HTTP/SSE 的情况下把 A 端 EventLog replication `SignalEvent` raw payload 投递到 B 端 provider 收包队列；由于当前 Reticulum received data 尚无可信 sender proof，`EnsTransportService` 会 fail closed，B 端 store 不会 ingest。
- 同一测试文件已证明 local JSON registry 只把 endpoint 投影为 discovered peer，peer 默认未授权，仍需 Mesh 授权后才能进入 data-plane。
- 当前真实 provider 纵切尚未把 `from_peer` 与 Reticulum link proof 或 signed frame 做密码学绑定；默认启动集成前必须补 sender binding，不能把 packet-level proof 误当成生产安全闭环。

因此下一阶段不再继续扩展 debug UI，也不再停留在 fake data-plane；下一步应从 queue proof 扩展到 UDP/TCP/mDNS 这些日用物理联通层，并把 fake 已覆盖的四域同步搬到真实 provider。

### Phase 1：fake EventLog 用户功能纵切（已完成）

目标：不接真实 Reticulum，先证明一条用户可感知的同步功能能复用现有同步链路。

验收：

- A append EventLog 后，B 的 `EventLogStore` 出现同一 record。
- A 生成的是 `eventlog.replication.appended` `SignalEvent`。
- fake provider 只传输 `SignalEvent` frame，不碰 `EventLogStore`。
- B 通过 `MeshState::ingest_remote_event` 发布到 `SignalPool`。
- `replication_actor` 应用远端事件。
- origin bounce 被跳过。
- duplicate event id 被跳过。
- 未授权 peer 注入 frame 被拒绝。

### Phase 2：fake 四域同步最低功能集（已完成）

目标：在 fake gateway 上证明 Reticulum data-plane 的功能边界覆盖事件日志、任务、时间块与提案，而不是只覆盖 EventLog。

验收：

- Task：A 发布 `task.replication.upserted` 后，B 的 `TaskStore` 获得同一任务快照。
- TimeBlock active：A 发布 `timeblock.replication.active_upserted` 后，B 的 `TimeBlockStore` 获得 active block。
- TimeBlock completed：A 发布 `timeblock.replication.completed` 后，B 的 `TimeBlockStore` 获得 completed block。
- Proposal：A 发布 `proposal.replication.upserted` 后，B 的 `ProposalStore` 获得同一提案状态。
- 四类 domain 都通过同一个 `SignalEvent` data frame 传输。
- 四类 domain 都不新增 Reticulum-specific projector。

### Phase 3：Reticulum gateway service contract

目标：把 fake test 中隐含的 data-plane 行为提升为 Reticulum gateway service contract。

验收：

- provider trait 拆出 data-plane 能力。
- service 明确区分 control-plane operation 和 data-plane delivery。
- delivery error 不吞掉，进入可观察状态或返回 typed error。
- route/UI/AppState 仍不承载协议状态机。
- `cargo check -p exomind-runtime` 通过。

### Phase 4：Reticulum provider contract（packet-level 收包与安全闸门已完成）

目标：用当前 ExoNet-Reticulum 公开 API 实现最小真实 provider，并把 fake gateway 证明过的功能搬到真实 Reticulum packet / 后续 link 上。当前已先完成 packet-level queue 收包路径，但真实 provider 暂时 fail closed；link lifecycle、sender binding、ack/receipt 和更完整路径发现后置。

验收：

- dependency path 指向当前 crate root，而不是 `src`。
- 只通过公开模块使用 `InterfaceTopology`、`InterfaceInfo`、`InterfaceManager`、`Transport`。
- announce 只做发现和身份广告。
- packet/link data 只承载 `EnsDataFrame::SignalEvent` 等 typed frame。
- received data 解码失败必须记录 typed error，不得 fail open。
- queue interface 已证明不经 HTTP/SSE 也能把 Reticulum packet-level payload 投递到 provider 收包队列。
- `ReticulumEnsProvider` 当前无法从 `ReceivedData` 取得可信 sender/origin proof，因此会把 `transport_peer` 置为 `None`。
- `EnsTransportService` 对 `transport_peer=None` 的 `SignalEvent` 返回 `MissingDataFrameTransportPeer`，不会调用 `MeshState::ingest_remote_event`。
- EventLog 真实 provider happy path 尚未恢复；下一步必须先补 sender binding，再按 Phase 2 的四域验收扩展到 Task、TimeBlock、Proposal，并补 UDP/TCP/mDNS 日用物理层验证。

### Phase 5：Interface/local-link provider config

目标：迁移旧分支的本地连接能力和 interface snapshot/control，使用户功能可以在本机多实例、局域网和可测试接口上稳定验证。

验收：

- 能列出 interface snapshot。
- 能设置 global topology。
- 能设置单接口 topology。
- 设置 global topology 不会批量改写单接口配置 topology。
- snapshot 中每个接口包含 configured/effective 两种 topology。
- `effective_topology = min(global_topology, interface.topology)` 的规则由后端统一计算。
- Off 接口不出站。
- Passive 不产生 announce，但允许普通转发语义以 ExoNet-Reticulum 当前实现为准。
- Active 全功能参与路径发现和数据投递。
- local/dev endpoint 全部来自显式 config 或 provider advertisement。

### Phase 6：route/AppState/UI 集成

目标：data-plane 和 provider contract 稳定后，再把用户可见同步能力暴露给现有 mesh 主路径。

验收：

- 不创建 Reticulum-only 产品入口岛。
- route 只暴露 service DTO。
- UI 不持有协议状态机。
- SSE/snapshot 只展示 service state，不乐观编造 provider state。
- UI 失败状态不能隐藏整个 Reticulum/mesh section。
- 用户能看出事件日志、任务、时间块与提案同步状态，而不是只看到底层 transport debug 信息。

## 质量门槛

任何后续 Agent 在修改 Reticulum/ENS data-plane 前，必须先逐项确认：

- [ ] 我是在传输 `SignalEvent`，不是发明 domain-specific sync API。
- [ ] 用户功能目标覆盖 EventLog、Task、TimeBlock、Proposal，不只覆盖 provider 状态。
- [ ] Reticulum 是跨 RT 唯一 gateway，HTTP/SSE 没有被继续作为 peer transport 扩展。
- [ ] RT-to-RT identity 以 Reticulum identity 为根，`host_id` 只是 metadata。
- [ ] provider 没有直接调用业务 store。
- [ ] 远端事件进入 `MeshState::ingest_remote_event`。
- [ ] origin bounce、hop limit、duplicate event id、unauthorized peer 都有测试。
- [ ] Interface/local-link 只作为 provider/physical layer 配置存在。
- [ ] discovered peer endpoint 带有 `gateway`、`via_interface`、`via_medium`，且不是从 HTTP base URL、localhost 端口或 mDNS registry 拼出来的 peer truth。
- [ ] global topology 与 interface topology 没有被混成“全部设置接口”。
- [ ] effective topology 由后端 snapshot 计算并暴露，UI 不自行推导事实。
- [ ] UI 不乐观显示 Reticulum 状态；命令后以 snapshot/SSE 结果为准。
- [ ] 没有 `ExoNet-Reticulum/src` path dependency。
- [ ] 没有生产代码中的 localhost hardcode 或端口偏移推导。
- [ ] 没有把 protocol state machine 放进 UI component。
- [ ] 没有在 async service loop 中加入阻塞文件系统操作。
- [ ] 真实 Reticulum dependency 必须由 provider 级纵切测试覆盖；新增物理层入口必须有 queue/UDP/TCP/mDNS 中至少一个可复现验证。
- [ ] 默认启动集成前，真实 provider 必须把 immediate sender 与 Reticulum link proof 或 signed frame 绑定；不能只相信 frame 内自声明的 `from_peer`。

## 与旧分支的迁移关系

旧分支应该迁出的是行为，不是代码形状。

应迁出：

- stable peer identity / `identity_hex` 经验。
- PIN-over-Reticulum 配对状态机场景。
- authorized peer 才能进入 data-plane 的约束。
- interface 三态连接语义。
- local/dev connection adapter 经验，但必须放到 Reticulum interface 层下方。
- typed snapshot 和 SSE 驱动 UI 的边界经验。

不应迁出：

- 巨型 runtime loop。
- Reticulum-only route island。
- 直接 path dependency 到 Reticulum 内部源码目录。
- UI 单体组件承载协议状态机。
- localhost/port arithmetic endpoint model。
- 绕过 `SignalPool`、RT SQLite、domain projector 或 scope authorization 的同步路径。

## 下一步执行顺序

1. 保持 `ReticulumEnsProvider` 为唯一真实 gateway provider，不新增 Reticulum-only route island。
2. 补 sender binding：用 Reticulum link proof 或 signed frame 将 immediate sender 与 Reticulum identity 绑定，避免 packet-level frame 只依赖自声明 `from_peer`。
3. 在已通过的 queue proof 上，补 UDP dynamic port 纵切：动态绑定端口、把实际 bound port 投影到 endpoint/interface snapshot、用两个 provider 验证 EventLog `SignalEvent`。
4. 补 mDNS `ret_port` bootstrap：mDNS 只发布/发现 Reticulum interface bootstrap 信息，加载后仍投影为 `EnsEndpointAdvertisement`，不得成为 Mesh peer truth。
5. 补 TCP seed / tcp server-client interface：端口必须来自显式 config 或 endpoint advertisement，禁止恢复旧分支的 `port +/- 5000` 推导。
6. 将 fake 已覆盖的 Task、TimeBlock active/completed、Proposal 场景搬到真实 provider，确认四类用户数据都能通过同一 `EnsDataFrame::SignalEvent` data-plane。
7. JSONL/file 只作为 local-dev/file medium 实验接口接入，避免把轮询文件协议上升为正式跨 RT truth。
8. 最后再考虑 AppState/route/UI 启动集成；route/UI 仍只消费 typed snapshot，仍禁止乐观显示 topology 或 provider 状态。

这个顺序的理由是：fake gateway 已证明用户功能可以经 `SignalEvent` data frame 闭环，queue-backed 真实 provider 已证明 Reticulum packet-level gateway 可以在不经跨 RT HTTP/SSE 的情况下送达 provider 收包队列，但可信 ingest 还必须先补 sender binding。旧分支的 UDP/TCP/mDNS/local JSON/JSONL 经验要迁移到 Reticulum provider 的 physical layer 下方，不能重新滑回 mDNS/local registry 与 Reticulum 平级、或巨型后台循环直接驱动业务同步的旧形态。
