# Reticulum 下一阶段无上下文 Agent 交接

> 日期：2026-06-08
> 工作树：`H:\A137442\Develop\AGI\exomind-reticulum`
> 分支：`codex/ens-reticulum-adapter`
> 目标读者：没有本轮会话上下文、但需要继续推进 Reticulum 同步的 Agent
> 最新 checkpoint：2026-07-05，debug 构建基线、本机 Reticulum identity 展示/复制、interface endpoint 分层、snapshot truth UI、signed queue、dynamic UDP、JSONL/file EventLog、dynamic TCP server/client 四域同步纵切、mDNS `ret_port` bootstrap projection、runtime startup config 与 endpoint 发布保护已完成

## 当前目标

Reticulum 要成为后续跨 RT 通信的唯一 gateway。最终用户功能不是“看到 Reticulum 状态”，而是至少能在已授权设备之间通过 Reticulum 同步：

1. 事件日志。
2. 时间块。
3. 任务。
4. 提案。

UDP、TCP、mDNS、local JSON、JSONL、file、queue、Bluetooth 等都只能作为 Reticulum 下方的 physical/interface layer。它们可以负责发现、bootstrap、互通和本地调试，但不能重新变成与 Reticulum 平级的跨 RT transport。HTTP/SSE 只能保留为本机 UI 调试、legacy compatibility 或开发联调，不应继续扩展为 RT-to-RT 主通信路径。

## 当前 checkpoint

已经完成的能力：

- ENS fake control-plane 已能完成双节点 PIN pairing happy path。
- 后端已支持 `global_topology`、`interface.topology` 与 `interface.effective_topology = min(global_topology, interface.topology)`。
- route/UI debug contract 已能查看和调整 Reticulum interface 状态，并以 backend snapshot 为事实来源。
- ENS data-plane 已有独立 `EnsDataFrame::SignalEvent`，与 `EnsPairingFrame` 分离。
- fake provider 已证明同一个 `SignalEvent` data frame 能覆盖 EventLog、Task、TimeBlock active/completed、Proposal 四类复制 topic。
- `ReticulumEnsProvider` 已接入当前同级 `ExoNet-Reticulum` crate root，并支持 queue / UDP / TCP server / TCP client / JSONL / file interface entrypoint。
- queue-backed 真实 Reticulum provider 已证明 signed `EnsDataFrame::SignalEvent` 可以在不经 HTTP/SSE 的情况下完成 A -> B EventLog 复制。
- Reticulum data-plane wire frame 已从裸 `EnsDataFrame` 收敛为 signed envelope：`frame`、`to_peer_identity_hex`、`signature`。
- 出站 provider 只为本机 `identity_hex` 声称的 frame 签名；若 frame 的 `from_peer` 不是本机 Reticulum identity，直接拒绝发送。
- 入站 provider 会校验目标 peer、sender identity hex、签名长度和 Ed25519 签名；legacy raw frame、坏签名、错误接收者都会 fail closed，并把 provider health 置为 `Degraded`。
- `EnsTransportService` 仍负责 Mesh 授权；签名有效但未授权的 signer 会被拒绝，不会写入 store。
- dynamic UDP provider 纵切已完成：`127.0.0.1:0` / `udp://127.0.0.1:0` 只允许作为 bind input；provider local endpoint、interface snapshot、route payload 与 UI payload 都投影为 OS 实际 bound port。
- 多个 dynamic UDP interface 已有唯一内部 manager identity；snapshot 调试展示名使用实际 `host:port` public name，按第二个 public name 改 topology 不会影响第一个接口。
- dynamic TCP server provider 纵切已完成：`127.0.0.1:0` 只允许作为 bind input；provider local endpoint 与 interface snapshot 会投影为 OS 实际 bound port，`tcp-listen://127.0.0.1:0` 不得出现在 endpoint/snapshot payload。
- TCP server/client 真实 provider 闭环已完成：B 端 dynamic TCP server 暴露实际 bound port，A 端 TCP client 使用该端口连接，EventLog、Task、TimeBlock active、TimeBlock completed 与 Proposal 的 replication `SignalEvent` 都可通过 Reticulum provider 写入 B 端 store。
- UI debug panel 顶层已显示 backend snapshot 给出的本机 Reticulum identity，支持短显、hover/title 完整 ID、点击复制完整 ID；物理 endpoint 只在 interface 行显示，并覆盖 dynamic UDP 多接口防串线测试。
- mDNS `ret_port` bootstrap 已完成 provider/service/route 级投影闭环：mDNS TXT 保留 legacy `host_id`，新增 `ret_identity_hex`、`ret_port`、`ret_destination`、`ret_interface`、`ret_capabilities`，并把发现结果投影为 `gateway=reticulum`、`via_medium=mdns`、`runtime_base_url=None` 的未授权 `EnsEndpointAdvertisement`。
- mDNS bootstrap 不写 `MeshState`，不授权 data frame，不能完成 legacy HTTP mesh pairing；invalid / zero `ret_port` fail closed。
- JSONL 与 file provider 入口已完成 EventLog 级 physical medium 纵切：两端通过共享 JSONL 目录或 shared file 传递 signed EventLog `SignalEvent`，B 端经 `EnsTransportService` 写入 `EventLogStore`。
- runtime startup 已支持 `RuntimeStartOptions.reticulum_ens`，并可通过环境变量启用真实 `ReticulumEnsProvider`。
- `/mesh/ens/snapshot` 在 runtime 启动后可观测真实 Reticulum provider、本机 Reticulum identity、用于 discovery/pairing payload 的 local endpoint、实际动态 UDP 端口与 Reticulum destination。
- local registry load/publish 已接入 `apply_config`：load 只投影未授权 discovered endpoint；publish 会等待动态 UDP/TCP server endpoint 具备真实 `interface_address`，不会写入 `:0` 或缺失动态端口的本机 endpoint。
- mDNS Reticulum TXT 发布已改为等待 provider snapshot 中真实可拨号 UDP endpoint；缺 `reticulum_destination`、缺 `udp://host:port`、端口为 `0` 或 medium 非 UDP 时，不发布 Reticulum bootstrap 字段。
- local registry publish 已改为 fail closed：必须具备非空 identity/destination/interface、可接受 physical medium 和可拨号 `interface_address`；否则返回 typed error 且不创建半成品 registry 文件。

当前故意没有完成的能力：

- signed envelope 当前提供的是“可验签 signer identity”，不是 Reticulum link-layer 暴露的独立 observed sender。
- `EnsReceivedDataFrame.transport_peer` 在 Reticulum provider 中暂时表示 verified signer；若 ExoNet-Reticulum 后续暴露 source-binding/link metadata，需要再增加 verified signer 与 observed link sender 的一致性校验。
- Bluetooth 等日用物理联通层还没有全部迁到 Reticulum interface 下方；JSONL/file 已有 EventLog 级纵切，但不是四域完整验收。
- mDNS bootstrap 目前完成的是 provider/service/route 级行为闭环，尚未做真实局域网双进程人工验收。
- 真实 provider 目前已完成 EventLog signed happy path，并已覆盖 queue、dynamic UDP、JSONL、file 与 dynamic TCP server/client；Task、TimeBlock active/completed、Proposal 的真实 provider 四域验收已在 TCP server/client 路径完成，其它 medium 仍保持 EventLog 级回归。

## 本轮代码变更

相关文件：

- `crates/exomind-runtime/src/ens/data_protocol.rs`
  - 新增 `EnsReceivedDataFrame { transport_peer, frame }` envelope。
  - 新增 `EnsDataFrame::from_peer()`，供 provider 在签名前后统一读取 frame 声称的 sender。
- `crates/exomind-runtime/src/ens/provider.rs`
  - `drain_received_data_frames` 改为返回 `Vec<EnsReceivedDataFrame>`。
  - provider trait 增加 `upsert_mdns_bootstrap` 默认空实现，供 mDNS bootstrap 投影入口使用。
- `crates/exomind-runtime/src/ens/fake_provider.rs`
  - fake provider 支持注入带 observed transport peer 的 received data frame。
  - fake provider 支持把 mDNS bootstrap 投影为未授权 discovered Reticulum endpoint。
- `crates/exomind-runtime/src/ens/reticulum_provider.rs`
  - `ReticulumEnsWireFrame::Data` 改为 signed envelope，裸 `EnsDataFrame` 不再作为 Reticulum data-plane wire frame。
  - provider 保存 `PrivateIdentity`，出站对 canonical bytes 签名，并绑定目标 `to_peer_identity_hex`。
  - canonical bytes 固定为 `b"exomind.reticulum.ens.data.v1" + 0 + to_peer_identity_hex + 0 + serde_json(frame)`，避免跨接收者重放。
  - 入站验签成功后推入 `EnsReceivedDataFrame { transport_peer: Some(verified_signer), frame }`。
  - 解码失败、legacy raw frame、坏签名、错误接收者、非法 identity hex 都 fail closed。
  - dynamic UDP 使用唯一内部 manager name 绑定 `127.0.0.1:0`，状态投影为实际 bound port。
  - dynamic TCP server 使用唯一内部 manager name 绑定 `127.0.0.1:0`，状态投影为实际 bound port。
  - `set_interface_topology(public_name, topology)` 会解析回内部 manager name，并返回 public snapshot name。
  - 新增 `ReticulumMdnsBootstrap` 与 `endpoint_from_mdns_bootstrap`，把 mDNS bootstrap 投影为 `gateway=reticulum`、`via_medium=mdns`、`runtime_base_url=None` 的 endpoint。
  - 新增 `add_jsonl_interface` 与 `add_file_interface`，将 JSONL stream directory 和 shared file path 作为 Reticulum local-dev/file physical medium 接入，并投影 `jsonl://...` / `file://...` endpoint address。
  - 新增 `ReticulumEnsProviderConfig` / `ReticulumEnsInterfaceConfig` 和 `apply_config`，统一配置 UDP、TCP server、TCP client、JSONL、File 与 local registry load/publish。
  - local registry publish 前等待动态 UDP/TCP server endpoint 投影为真实 `interface_address`，防止 registry 写入 `:0`。
  - `publish_local_registry` 现在调用 publishable endpoint guard；没有 physical/interface layer 的 provider 不会被写入 registry。
- `crates/exomind-runtime/src/ens/service.rs`
  - 新增 `handle_received_data_frame`。
  - 新增 sender binding 校验：缺 observed transport peer 返回 `MissingDataFrameTransportPeer`；observed peer 与 frame 内 `from_peer` 不一致返回 `DataFrameTransportPeerMismatch`。
  - `handle_pending_data_frames` 会继续处理后续帧，保留第一个错误并最终返回，避免坏帧吞掉后续好帧。
  - snapshot 会优先读取 provider 动态 local endpoint，避免 service 中的启动静态 endpoint 与实际接口状态脱节。
  - 新增 `upsert_mdns_bootstrap`，只把 bootstrap 交给 provider projection，不授权 Mesh peer。
- `crates/exomind-runtime/src/discovery.rs`
  - mDNS TXT 继续发布 legacy `host_id`，并在可用时附加 Reticulum bootstrap 字段：`ret_identity_hex`、`ret_port`、`ret_destination`、`ret_interface`、`ret_capabilities`。
  - `MdnsDiscovery` 浏览到 Reticulum bootstrap 后通过 `MdnsReticulumBootstrapSink` 投给 ENS transport；缺 identity 的 legacy mDNS service 保持兼容，zero/invalid `ret_port` fail closed。
- `crates/exomind-runtime/src/lib.rs`
  - 默认 mDNS 启动路径会从 backend snapshot 的 local Reticulum endpoint 生成 mDNS advertisement，并把 discovered bootstrap 投影回 ENS transport。
  - mDNS Reticulum advertisement 会等待 provider 投影出的真实 UDP endpoint；等待失败时只注册 legacy mDNS，不发布 Reticulum TXT。
  - `RuntimeStartOptions` 增加 `reticulum_ens`，`start_with_options` 会创建真实 `ReticulumEnsProvider` 并替换默认 ENS transport provider。
  - `RuntimeStartOptions::default()` 可从 `EXOMIND_RT_ENS_RETICULUM`、local registry、UDP/TCP/JSONL/File 相关环境变量生成 Reticulum ENS 启动配置。
- `crates/exomind-runtime/src/ens/mod.rs`
  - 重新导出 `ReticulumEnsProviderConfig` 与 `ReticulumEnsInterfaceConfig`，供 runtime startup 和测试使用。
- `crates/exomind-runtime/src/ens/dto.rs`
  - `EnsTransportSnapshot` 增加 `local_identity`，作为 debug UI 顶层“本机身份”的事实源。
  - `EnsTransportSnapshot.local_endpoint` 保留为 discovery/pairing/兼容 payload，不再作为 debug UI 顶层身份字段。
- `src/lib/services/runtime-ens.service.ts`
  - TypeScript snapshot 类型增加 `local_identity`、`local_endpoint` 与 `interfaces[*].interface_address`。
- `src/ui/app/pages/agents/DeviceView.tsx`
  - Reticulum debug panel 顶层展示 backend snapshot 中的本机 Reticulum identity，短显但 hover/title 暴露完整 ID，点击复制完整 ID 并用 toast 反馈复制动作。
  - 物理 endpoint 只在对应 interface 行展示。
  - interface debug `data-testid` 对 `host:port` 做安全 segment 化。
- `crates/exomind-runtime/src/routes/mesh.rs`
  - `/mesh/events` 读取 peer token 注入的 `AuthenticatedPeerIdentity`；若 token 身份与 body `from_peer_id` 不一致，返回 `403`。
  - ENS error mapping 中，缺 sender proof 映射 `400`，sender mismatch 映射 `403`。
- `crates/exomind-runtime/tests/ens_data_plane.rs`
  - fake data-plane 四域测试已迁到 sender-bound envelope。
  - 新增缺 transport peer、transport peer mismatch、mixed invalid+valid pending frames 回归测试。
- `crates/exomind-runtime/tests/ens_reticulum_provider.rs`
  - queue-backed provider 测试确认 signed EventLog frame 可以通过真实 Reticulum provider 写入 B 端 store。
  - dynamic UDP 双 provider 测试确认 A -> B EventLog `SignalEvent` 可通过 OS 分配的实际 UDP 端口同步。
  - 覆盖 `127.0.0.1:0` / `udp://127.0.0.1:0` 不出现在 endpoint/snapshot payload。
  - 覆盖多个 dynamic UDP interface 保持独立 public name 与 topology 状态。
  - dynamic TCP server 测试确认 OS 分配端口会投影为 `tcp-listen://127.0.0.1:<port>`，并可按 public name 调整 topology。
  - TCP server/client 双 provider 测试确认 A -> B EventLog `SignalEvent` 可通过真实 TCP interface 同步。
  - TCP server/client 双 provider 四域测试确认 Task、TimeBlock active、TimeBlock completed 与 Proposal replication `SignalEvent` 都经同一 Reticulum data-plane 进入 `EnsTransportService` / `MeshState` / `SignalPool` / `replication_actor`，并写入对应远端业务 store。
  - JSONL 与 file 双 provider 测试确认共享 JSONL 目录或 shared file 可以作为 Reticulum physical medium 传递 signed EventLog `SignalEvent`，并验证 endpoint/snapshot 中的 `via_medium` 与 `interface_address` 投影。
  - 覆盖 `apply_config` 同时添加 interface、加载 peer registry、发布本机 registry entry；peer 只作为未授权 discovered endpoint，发布出的本机 endpoint 使用实际动态 UDP 端口。
  - 覆盖无 physical/interface layer 时 `publish_local_registry` 与 `apply_config(publish_local_registry=true)` fail closed，且不创建 registry 文件。
  - 覆盖 legacy unsigned frame fail closed、bad signature fail closed、wrong recipient fail closed、non-local signing refused。
  - 覆盖签名有效但 Mesh 未授权 signer 时由 service 返回 `UnauthorizedDataFramePeer`，B 端 store 保持为空。
- `crates/exomind-runtime/tests/mesh_routes_integration.rs`
  - 新增 peer A token 冒充 peer B 的 `403` 回归测试，以及匹配身份的 happy path。
- `tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx`
  - 覆盖本机 Reticulum identity 展示/复制、顶层不展示 endpoint、不泄漏 `:0`，以及 dynamic UDP 多接口 topology 更新不串线。
- `crates/exomind-runtime/tests/runtime_startup.rs`
  - 覆盖环境变量到 `ReticulumEnsProviderConfig` 的映射。
  - 覆盖 `start_with_options` 启动真实 Reticulum ENS provider 后，`/mesh/ens/snapshot` 可见 provider id、本机 Reticulum identity、Reticulum destination 与实际动态 UDP 端口。

## 安全与产品原则

必须遵守：

- 不信任 payload 内自声明的 `from_peer`。
- 真实 data-plane 必须有 signed ENS frame、Reticulum link proof 或扩展后的 `ReceivedData` sender proof。
- Reticulum signed envelope 是当前第一版 sender binding；缺 proof、坏签名、错误目标必须 fail closed。
- 当前 `transport_peer` 表示 verified signer；未来若 Reticulum 暴露 observed link sender，必须再校验两者一致。
- Reticulum identity 是跨 RT trust、pairing、delivery、discovery 的主键；`host_id` 只是 runtime metadata。
- provider 不直接写 `EventLogStore`、`TaskStore`、`TimeBlockStore` 或 `ProposalStore`。
- 远端事件必须进入 `MeshState::ingest_remote_event`，再由 `SignalPool` 和现有 replication actor/projector 应用。
- UI 不乐观呈现 Reticulum 状态；command 成功只表示命令被接受，显示事实必须来自 snapshot/SSE。
- topology 语义固定为 `Off < Passive < Active`，`effective_topology = min(global_topology, interface.topology)`。
- `127.0.0.1:0` / `udp://127.0.0.1:0` 只能是 UDP bind input；任何 endpoint、snapshot、route payload 或 UI payload 中出现 `:0` 都是 bug。
- dynamic UDP 的内部 manager identity 与 public snapshot name 是两层状态：内部用于 Reticulum interface manager 唯一定位，snapshot/debug 只展示 pending public name 或实际 `host:port`。
- dynamic TCP server 的内部 manager identity 与 public snapshot name 也是两层状态：内部用于 Reticulum interface manager 唯一定位，snapshot/debug 只展示 pending public name 或实际 `host:port`。

## 下一步顺序

1. 以 TCP server/client 四域真实 provider 测试作为当前 data-plane 主回归，后续扩展 transport 时不得绕过 `EnsDataFrame::SignalEvent`。
2. 用 runtime startup config 启动两个真实 runtime，做多端 Reticulum 同步验收：至少先确认 EventLog，再扩展 Task、TimeBlock、Proposal。
3. 组合验收 local registry、mDNS bootstrap、UDP/TCP、JSONL/File physical medium；这些渠道只能产生 Reticulum endpoint/bootstrap，不得自动授权 Mesh peer。
4. 对 mDNS bootstrap 做真实局域网双进程人工验收；这只验证 bootstrap/discovered endpoint，不把 mDNS 升级成授权来源。
5. mDNS/local registry 的发布事实必须继续来自 provider snapshot 的可拨号 Reticulum endpoint；禁止用 runtime HTTP port、startup bind input 或 `:0` 替代真实 interface endpoint。
6. 如果 ExoNet-Reticulum 暴露 link/source metadata，补 verified signer 与 observed sender 的一致性测试。

## 推荐验证命令

```powershell
git diff --check
cargo fmt --package exomind-runtime -- --check
npx vitest run tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx
cargo test -j 1 -p exomind-runtime --test ens_data_plane -- --nocapture
cargo test -j 1 -p exomind-runtime --test mesh_routes_integration -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_reticulum_provider -- --nocapture --test-threads=1
cargo test -j 1 -p exomind-runtime --test runtime_startup -- --nocapture --test-threads=1
cargo test -j 1 -p exomind-runtime --test ens_routes_debug -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_control_plane_prototype -- --nocapture
cargo check --lib -j 1 -p exomind-runtime
node ./node_modules/typescript/bin/tsc --noEmit
```

运行 Rust 验证时会看到一些既有 warning，集中在 agent、timeblock、task bridge 等区域；不要在 Reticulum patch 里顺手修。

## 当前可提交边界

截至 2026-07-05，本轮可提交边界是 Reticulum/ENS snapshot contract、debug UI 和对应测试/计划文档的阶段收口。提交前仍必须以 `git status --short` 为准；如果出现下列范围之外的文件，不要顺手 stage、revert 或格式化。

本阶段验收语义：

- 顶层“本机身份”来自 `EnsTransportSnapshot.local_identity.identity_hex`；兼容旧 snapshot 时最多回退到 `local_endpoint.identity_hex`。
- `local_endpoint` 保留给 discovery/pairing/兼容 payload，不作为 UI 顶层 endpoint 展示。
- UDP/TCP/File/JSONL/Queue 等物理 endpoint 只允许通过 `interfaces[*].interface_address` 在对应 interface 行展示。
- 点击复制只复制完整 identity 并显示 toast；不代表 runtime 状态切换成功。
- UI 显示事实必须来自 `/mesh/ens/snapshot` 或后续等价 SSE；命令成功后必须 refresh/等待后端事实，不能乐观成功。

可以 stage 的 Reticulum/ENS 相关文件包括：

- `crates/exomind-runtime/src/ens/dto.rs`
- `crates/exomind-runtime/src/ens/reticulum_provider.rs`
- `crates/exomind-runtime/src/ens/service.rs`
- `crates/exomind-runtime/src/lib.rs`
- `crates/exomind-runtime/tests/ens_control_plane_prototype.rs`
- `crates/exomind-runtime/tests/ens_reticulum_provider.rs`
- `crates/exomind-runtime/tests/ens_routes_debug.rs`
- `crates/exomind-runtime/tests/runtime_startup.rs`
- `src/lib/services/runtime-ens.service.ts`
- `src/ui/app/pages/agents/DeviceView.tsx`
- `tests/unit/services/runtime-ens.service.test.ts`
- `tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx`
- `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
- `docs/plans/2026-06-08-reticulum-next-agent-handoff.md`
- `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`

## 参考文档

- `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
- `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`
- `docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`
- `docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`
