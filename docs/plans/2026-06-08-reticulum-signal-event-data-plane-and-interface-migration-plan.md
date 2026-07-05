# Reticulum SignalEvent 数据面与 Interface/local-link 迁移计划

> 本文件只保存长期关系、契约与验收标准。一次性现场信息以 Git 历史、测试输出和专门汇报为准，不写入本计划。
>
> 关联计划：`2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
> 关联考古：`2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`
> 关联质量门槛：`2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`

## 一句话目标

让用户能够在已授权设备之间通过 Reticulum 同步外心里的事件日志、时间块、任务与提案。Reticulum gateway、`SignalEvent` frame、Interface/local-link 迁移和 provider 分层都是服务这个用户功能目标的实现约束。

## 用户功能目标

最低可交付能力不是“Reticulum 状态可见”，而是两端已授权 RT 能通过 Reticulum 看到同一批用户数据：

1. 事件日志：一端追加 EventLog record，另一端出现同一 record。
2. 任务：一端创建或更新 Task，另一端获得同一任务快照。
3. 时间块：一端更新 active/completed TimeBlock，另一端获得对应时间块状态。
4. 提案：一端创建或更新 Proposal，另一端获得同一提案状态。

用户不需要理解 `SignalEvent`、provider trait、Reticulum packet 或 interface topology；这些设计只用于保证上述能力可维护、可测试、可扩展。

## 核心判断

Reticulum 的角色不是“一个可调试状态区”，而是 ExoMind RT 之间唯一的跨 RT 网络网关。RT-to-RT 的发现、配对、授权和同步应收敛到 Reticulum identity、announce/link/data packet 与 Reticulum interface 之上，而不是继续扩展 HTTP/SSE peer transport。

目标同步中轴固定为：

```text
User action / domain write
  -> domain service/appender
  -> SignalEvent(replication topic)
  -> Reticulum gateway frame
  -> Reticulum link / packet / physical interface
  -> MeshState::ingest_remote_event
  -> SignalPool
  -> replication_actor / domain projector
  -> remote store
```

实现应补强 Reticulum gateway 和 interface physical layer，而不是重写业务同步语义。EventLog 是纵切验证路径，不是最终功能边界；最终功能边界必须覆盖 EventLog、Task、TimeBlock 与 Proposal。

HTTP/SSE 的定位：

- 本机 UI 调 RT、debug route、开发联调和 legacy compatibility 可以继续使用 HTTP/SSE。
- RT-to-RT 的发现、配对、同步不应以 HTTP base URL 可达为前提。
- `MeshRelayManager` 只能作为历史参考与过渡兼容，不是目标架构的 peer transport。
- 跨局域网、NAT、远程连接、蓝牙或文件/队列等媒介差异，都应由 Reticulum gateway 与 Reticulum interfaces 屏蔽。

## 非目标

1. 不做 `ReticulumEventLogSync`、`ReticulumTaskSync`、`ReticulumTimeBlockSync` 这类 domain-specific transport 接口。
2. 不重写 EventLog、Task、TimeBlock、Proposal 的业务 projector。
3. 不让 Reticulum provider 直接调用 `EventLogStore`、`TaskStore`、`TimeBlockStore`、`ProposalStore` 或其他业务 store。
4. 不把 UDP/TCP/mDNS/File/JSONL/Queue/local registry 提升为与 Reticulum 平级的跨 RT truth。
5. 不把 HTTP base URL、localhost 端口推导或 mDNS registry 当成 peer identity / peer transport truth。
6. 不创建 Reticulum-only route island 或 UI island；route/UI 只消费 service DTO。
7. 不在 UI component 中实现协议状态机，也不让 UI 伪造 provider、topology、pairing、delivery 的成功状态。

## 分层契约

### L3 runtime mesh service

L3 service 拥有同步语义与授权语义：

- 维护 peer identity、pairing status、authorized peers、delivery state。
- 调用 provider 发送 control-plane frame 与 data-plane frame。
- 接收 provider frame 后先验权，再调用 `MeshState::ingest_remote_event`。
- 不知道 UDP/TCP/mDNS/File/JSONL/Queue 的具体细节。
- 跨 RT peer key 以 Reticulum identity 为根；`host_id` 只是 runtime metadata。

### ENS/Reticulum gateway provider

provider 连接 ExoMind runtime mesh 与唯一 Reticulum gateway：

- control plane：peer discovery、announce、pairing frame。
- data plane：发送和接收 `SignalEvent` frame。
- interface plane：列出接口快照、设置全局/单接口 topology。
- 不调用业务 store。
- 不暴露 HTTP base URL 作为跨 RT 主连接事实。
- endpoint advertisement 必须声明 `gateway=reticulum`，并用 `via_interface` / `via_medium` 表达底层互通来源。

### Reticulum physical layer

Reticulum 下方的 UDP/TCP/mDNS/File/JSONL/Queue/local JSON 等媒介只负责发现、bootstrap、连通和 packet 承载：

- 它们是 Reticulum interface medium，不是独立同步协议。
- 它们可以服务本地多实例、局域网、文件同步、队列同步、远程连接或蓝牙等扩展场景。
- 它们不得绕过 Reticulum identity、pairing authorization、signed frame 和 mesh ingest 路径。

### Debug route / UI

debug route 与 UI 只投影后端事实：

- 当前事实源是 `GET /mesh/ens/snapshot` 加显式 refresh；未来可接等价 SSE，但 SSE 只能发布同一份后端 snapshot truth。
- route 暴露 typed DTO，不暴露 ExoNet-Reticulum 内部类型。
- UI 可发命令、进入 pending、刷新 snapshot；不能本地推导“已成功切换”。

## Reticulum identity root

RT 的跨设备网络身份应派生自 Reticulum identity：

- `identity_hex` 是 trust、pairing、delivery、discovery 的主键。
- `host_id` 是 runtime metadata，可用于 UI、日志和本机进程归因，但不能替代 Reticulum identity。
- pairing 授权、peer store、delivery record 都应以 Reticulum identity 为稳定 key。
- identity seed 损坏、解析失败或意外 rotation 必须 fail closed。

## Data-plane 契约

同步层只认 `SignalEvent`，provider 只负责把它装入 Reticulum gateway frame：

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

必须满足：

1. frame envelope 标识 immediate sender；immediate sender 来自 Reticulum identity。
2. `SignalEvent.origin_host_id` 保留业务事件源，不被 provider 重写。
3. 出站 frame 必须绑定本机 Reticulum identity；不能为非本机 `from_peer` 签名。
4. 入站 frame 必须校验目标 peer、sender identity、签名或等价 source-binding metadata。
5. 验权以 immediate sender 与 peer authorization 为准。
6. 去重仍依赖 `MeshState::ingest_remote_event` 的 event id dedupe。
7. hop 递增、origin bounce、hop limit 仍由 mesh ingest 路径负责。
8. ack/receipt 可以后置；没有 end-to-end receipt 前，delivery `sent` 只能表达为“已记录/已交给 provider”，不能表达为“已送达/远端已应用”。

## Interface/local-link 契约

旧分支的 InterfaceMode/local-link 经验要迁移为 provider/physical layer 能力，而不是迁移旧代码形状。

保留：

- Off / Passive / Active 三态连接语义。
- global topology 与 per-interface topology。
- `InterfaceInfo` / `EnsInterfaceSnapshot` 快照：name、type、online、outgoing、configured topology、effective topology、physical address。
- UDP/TCP/File/JSONL/Queue/local JSON 等作为 local/dev 或真实 provider 的 interface medium。
- 本地多实例开发连接场景，但必须由显式 config 或 provider advertisement 描述。

不保留：

- 旧路径 `reticulum::iface::InterfaceMode`。
- 指向 `ExoNet-Reticulum/src` 的 path dependency。
- localhost hardcode 和端口偏移推导。
- 把 interface state 放进 UI component 或 route island。
- 把 local registry/mDNS bridge 写进 service 主循环，并让它们绕过 Reticulum。

### Topology 一致性

global topology 和 per-interface topology 是两处不同状态：

```text
Off < Passive < Active
effective_topology = min(global_topology, interface.topology)
```

含义：

- `global_topology` 是全局能力上限，类似总电源或总限制。
- `interface.topology` 是单个接口的配置状态。
- `interface.effective_topology` 是后端 snapshot 中暴露给 UI 的运行事实。
- `global_topology = Off` 时，所有接口的生效状态都是 Off，但接口自身配置值不应被批量改写。
- `global_topology = Passive` 时，配置为 Active 的接口也只能生效为 Passive，不能发 announce。
- `global_topology = Active` 时，接口按自身配置生效。

这条规则必须在 service/provider 层统一计算并测试；route、TypeScript service 和 React UI 不得各自重新解释 topology。

### Endpoint 呈现边界

- 面板全局“本机身份”必须来自 `EnsTransportSnapshot.local_identity.identity_hex`；兼容旧 snapshot 时最多回退到 `local_endpoint.identity_hex`。
- `local_endpoint` 是 discovery/pairing/兼容 payload，不是顶层“本机 endpoint”展示字段。
- `interfaces[*].interface_address` 只在对应接口行展示；`udp://...`、`tcp://...`、`file://...`、`queue://...` 等物理地址不得显示成顶层本机身份。
- `127.0.0.1:0` / `udp://127.0.0.1:0` / `tcp-listen://127.0.0.1:0` 只能作为 bind input；snapshot、route payload、UI payload 必须投影实际 bound port。

## Snapshot/UI 一致性契约

UI 状态必须宁可滞后，也不能比后端实际运行态更“成功”。

后端 snapshot 的核心 DTO 关系：

```rust
pub struct EnsTransportSnapshot {
    pub enabled: bool,
    pub provider_id: String,
    pub local_identity: Option<EnsPeerIdentity>,
    pub local_endpoint: Option<EnsEndpointAdvertisement>,
    pub global_topology: EnsInterfaceTopology,
    pub health: EnsTransportHealth,
    pub peers: Vec<EnsPeerSnapshot>,
    pub interfaces: Vec<EnsInterfaceSnapshot>,
    pub operations: Vec<EnsOperationSnapshot>,
    pub deliveries: Vec<EnsDeliverySnapshot>,
    pub updated_at: String,
}
```

UI 规则：

- UI 只相信 backend snapshot/refresh；未来接 SSE 时也必须保持同一份后端 snapshot truth。点击按钮后的 pending 状态不能把 displayed topology、authorized、pairing_pending、provider health 或 delivery status 改成目标值。
- 命令返回成功只表示后端接受请求；UI 必须重新读取 snapshot 或等待未来 SSE 确认后，才能显示新状态。
- 命令失败、refresh 失败或 SSE 断开时，UI 保留上一份已确认 snapshot，并显示 error/stale；不得清空事实或显示目标值成功。
- backend snapshot 缺少关键字段或字段值不合法时，UI 显示“未知”或 malformed/stale，不能把缺失值回退成 Off/Disabled/待配对/配置即生效。
- 顶层本机身份可短显保护布局，但 hover/title 必须暴露完整 `identity_hex`；点击复制必须复制完整身份 ID。复制 toast 只反馈剪贴板动作，不代表 runtime 状态变化。
- `operations[*]` 只承载 pairing/control-plane 状态；data-plane delivery 必须放在独立 `deliveries[*]`，或未来由等价 SSE 事件投影同一后端事实。
- `deliveries[*]` 只投影 ENS-owned outbound `ens:` data-plane route；legacy `mesh:`、actor/local/internal delivery record 不得混成 Reticulum 投递状态。
- `DeliveryStatus::Sent` 在 UI 中只能表达为“已记录”或等价保守文案；没有 receipt/ack 前不得显示为“已送达”。

## 代码锚点

这些锚点用于校验本计划是否仍贴合代码，不是进度流水账：

- Rust DTO：`crates/exomind-runtime/src/ens/dto.rs` 中的 `EnsPeerIdentity`、`EnsEndpointAdvertisement`、`EnsInterfaceSnapshot`、`EnsDeliverySnapshot`、`EnsTransportSnapshot`。
- TypeScript DTO/service：`src/lib/services/runtime-ens.service.ts` 镜像 Rust snapshot contract，并通过 `/mesh/ens/snapshot`、topology route、pairing route 访问后端。
- UI debug 面板：`src/ui/app/pages/agents/DeviceView.tsx` 的 `ReticulumDebugPanel` 使用 `RuntimeEnsService.getSnapshot()`，展示 `local_identity`、interfaces、peers、operations、deliveries 与 stale/error。
- fake data-plane 测试：`crates/exomind-runtime/tests/ens_data_plane.rs` 约束 `SignalEvent` frame、四域 projector 复用、unauthorized、duplicate、origin bounce、delivery failed/skipped。
- real provider 测试：`crates/exomind-runtime/tests/ens_reticulum_provider.rs` 约束 queue/UDP/TCP/JSONL/file/mDNS bootstrap、signed frame、fail closed、dynamic port projection 与 TCP 四域同步。
- route/debug 测试：`crates/exomind-runtime/tests/ens_routes_debug.rs` 约束 snapshot route、ENS-owned delivery filtering、pairing operation error、peer last_error 和 interface topology route。
- startup 测试：`crates/exomind-runtime/tests/runtime_startup.rs` 约束 runtime Reticulum provider env/config、`runtime-reticulum-ens` provider、local identity 与真实 bound UDP endpoint projection。
- UI 单测：`tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx` 约束本机身份 hover/copy、接口行 endpoint、topology snapshot truth、delivery/operation/error/stale 展示。

## 能力验收矩阵

| 能力 | 稳定验收关系 | 代码锚点 | 人工/回归验收边界 |
|------|--------------|----------|----------|
| control-plane pairing / authorization | discovered peer 先进入低信任可见状态；只有 pairing 授权后才能进入 data-plane | `ens_control_plane_prototype.rs`、`ens_routes_debug.rs` | 双实例/双设备人工链路：发现 -> 配对 -> 授权 -> snapshot/UI 可见 |
| fake data-plane 四域同步 | EventLog、Task、TimeBlock、Proposal 都走同一种 `EnsDataFrame::SignalEvent`，不新增 domain-specific transport | `ens_data_plane.rs` | 保持 fake 测试作为语义回归，不把 fake provider 当真实网络验收 |
| real Reticulum provider EventLog | queue/UDP/TCP/JSONL/file medium 能承载 signed Reticulum ENS data frame，不经跨 RT HTTP/SSE | `ens_reticulum_provider.rs` | 将日用入口继续收敛到 Reticulum physical layer，不复活平级 local registry truth |
| real Reticulum provider 四域同步 | TCP server/client 作为四域真实 data-plane 基线，证明 domain projector 可复用 | `ens_reticulum_provider.rs` | 基线必须能转化为可人工复现的多端 debug 场景 |
| mDNS bootstrap | mDNS 只投影 Reticulum endpoint，不直接授权 data-plane | `ens_control_plane_prototype.rs`、`ens_reticulum_provider.rs` | 真实局域网双进程验收；不能退回 legacy HTTP mesh pairing |
| interface topology | `effective_topology = min(global_topology, interface.topology)` 由后端事实计算 | `ens_control_plane_prototype.rs`、`ens_routes_debug.rs`、`runtime_startup.rs` | 多接口、多动态端口、global/per-interface UI 操作继续保持 snapshot truth |
| debug UI | UI 展示 provider/local identity/interfaces/peers/operations/deliveries/stale/error；不乐观显示成功 | `device-view.reticulum-debug.test.tsx` | 从手动 refresh/snapshot 走向 SSE 或明确轮询时，仍保持后端事实优先 |
| 用户可验多端同步 | 人能看到 discovery、pairing、authorization、delivery/error/stale 与四域同步结果 | 以上所有锚点组合 | 端到端人工手册或脚本，确保可打开 exe 后纯人验证真实效果 |

## 与旧分支的迁移关系

旧分支应该迁出行为，不迁出代码形状。

应迁出：

- stable peer identity / `identity_hex` 经验。
- PIN-over-Reticulum 配对状态机场景。
- authorized peer 才能进入 data-plane 的约束。
- interface 三态连接语义。
- local/dev connection adapter 经验，但必须放到 Reticulum interface 层下方。
- typed snapshot/refresh 驱动 UI 的边界经验；未来可接 SSE，但不得改变后端事实优先契约。

不应迁出：

- 巨型 runtime loop。
- Reticulum-only route island。
- 直接 path dependency 到 Reticulum 内部源码目录。
- UI 单体组件承载协议状态机。
- localhost/port arithmetic endpoint model。
- 绕过 `SignalPool`、RT SQLite、domain projector 或 scope authorization 的同步路径。

## 推进依赖顺序

1. 建立双实例或双设备人工验收链路：端口、临时数据目录、Reticulum interface bind、runtime route、Tauri/MCP bridge 都必须隔离，且不影响已安装版外心。
2. 闭合发现、配对、授权状态：UI/debug route 必须能看到 discovered peer、pairing operation/error、authorized state 与 fail-closed 结果。
3. 以 TCP server/client 四域真实 provider 作为多端 Reticulum data-plane 主基线；JSONL/file/local JSON 等 medium 只按“日用入口价值”扩展，并且必须仍在 Reticulum physical layer 下方。
4. 做真实局域网 mDNS bootstrap 验收；mDNS 只负责 Reticulum endpoint bootstrap，不授权 data frame，也不恢复 HTTP mesh pairing。
5. 在没有 receipt/ack 前，保持 delivery `sent = 已记录` 的保守语义；只有 source-binding、签名、授权和远端应用确认都能被验证后，才引入 end-to-end receipt。
6. 默认启动集成、更大范围 AppState/UI 接入和用户侧同步 UX 依赖上述能力稳定；route/UI 仍只消费 typed snapshot/refresh，未来可接 SSE 但必须保持同一 snapshot truth，仍禁止乐观显示 topology、provider、pairing 或 delivery 状态。

## 质量门槛

任何修改 Reticulum/ENS data-plane 的 Agent 必须先逐项确认：

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
- [ ] UI 不乐观显示 Reticulum 状态；命令后以 snapshot/refresh 结果为准，未来接 SSE 时也必须保持同一后端事实源。
- [ ] UI command handler 没有把点击目标值写入 displayed `snapshot`，也没有本地伪造 `authorized`、`pairing_pending`、delivery success 或 provider health。
- [ ] backend snapshot 缺少关键字段或字段不合法时，UI 显示“未知”或 malformed/stale，不把缺失字段回退成 Off/Disabled/待配对/配置即生效。
- [ ] pending 状态只用于禁用控件、显示等待或阻止重复提交；屏幕上的 provider/interface/peer/delivery 事实仍来自最后一次 backend snapshot/refresh 或未来等价 SSE。
- [ ] 命令失败、refresh 失败或 SSE 断开时，UI 保留上一份已确认 snapshot，并显示错误或 stale 状态；不得显示目标值成功。
- [ ] 没有实时 SSE 的 UI 必须提供手动 refresh 或明确 stale 语义；宁可滞后、等待或卡顿，也不能显示比后端实际运行态更成功的 Reticulum 状态。
- [ ] `operations[*]` 只承载 pairing/control-plane 状态；data-plane delivery 必须放在独立的 `deliveries[*]` 或等价 SSE 事件里。
- [ ] `deliveries[*]` 只投影 ENS-owned outbound `ens:` data-plane route，不能把 legacy `mesh:`、actor/local/internal delivery record 混成 Reticulum 投递状态。
- [ ] `DeliveryStatus::Sent` 在 UI 中只能表达为“已记录”或等价保守文案；没有 end-to-end receipt 前不得显示为“已送达”。
- [ ] 没有 `ExoNet-Reticulum/src` path dependency。
- [ ] 没有生产代码中的 localhost hardcode 或端口偏移推导。
- [ ] `127.0.0.1:0` / `udp://127.0.0.1:0` / `tcp-listen://127.0.0.1:0` 只作为 bind input；snapshot、endpoint、route payload、UI payload 不得出现 `:0`。
- [ ] 多 dynamic UDP interface 有稳定且互不冲突的内部 manager identity；按 public name 设置 topology 不会影响另一个接口。
- [ ] 没有把 protocol state machine 放进 UI component。
- [ ] 没有在 async service loop 中加入阻塞文件系统操作。
- [ ] 真实 Reticulum dependency 必须由 provider 级纵切测试覆盖；新增物理层入口必须有 queue/UDP/TCP/mDNS 中至少一个可复现验证。
- [ ] 默认启动集成前，真实 provider 必须把 immediate sender 与 signed frame、Reticulum link proof 或 source-binding metadata 绑定；不能只相信 frame 内自声明的 `from_peer`。
- [ ] 如果 Reticulum provider 的 `transport_peer` 表示 verified signer，且另有 observed link sender 字段，必须测试二者一致。
