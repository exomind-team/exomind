# Reticulum 下一阶段无上下文 Agent 交接

> 日期：2026-06-08
> 工作树：`H:\A137442\Develop\AGI\exomind-reticulum`
> 分支：`codex/ens-reticulum-adapter`
> 目标读者：没有本轮会话上下文、但需要继续推进 Reticulum 同步的 Agent

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
- `ReticulumEnsProvider` 已接入当前同级 `ExoNet-Reticulum` crate root，并支持 queue / UDP / TCP server / TCP client interface entrypoint。
- queue-backed 真实 Reticulum provider 已证明 signed `EnsDataFrame::SignalEvent` 可以在不经 HTTP/SSE 的情况下完成 A -> B EventLog 复制。
- Reticulum data-plane wire frame 已从裸 `EnsDataFrame` 收敛为 signed envelope：`frame`、`to_peer_identity_hex`、`signature`。
- 出站 provider 只为本机 `identity_hex` 声称的 frame 签名；若 frame 的 `from_peer` 不是本机 Reticulum identity，直接拒绝发送。
- 入站 provider 会校验目标 peer、sender identity hex、签名长度和 Ed25519 签名；legacy raw frame、坏签名、错误接收者都会 fail closed，并把 provider health 置为 `Degraded`。
- `EnsTransportService` 仍负责 Mesh 授权；签名有效但未授权的 signer 会被拒绝，不会写入 store。

当前故意没有完成的能力：

- signed envelope 当前提供的是“可验签 signer identity”，不是 Reticulum link-layer 暴露的独立 observed sender。
- `EnsReceivedDataFrame.transport_peer` 在 Reticulum provider 中暂时表示 verified signer；若 ExoNet-Reticulum 后续暴露 source-binding/link metadata，需要再增加 verified signer 与 observed link sender 的一致性校验。
- UDP/TCP/mDNS/local JSON/JSONL/file/queue/Bluetooth 等日用物理联通层还没有全部迁到 Reticulum interface 下方；下一阶段应做这些物理层纵切，而不是继续扩展 HTTP/SSE。
- 真实 provider 目前只完成 EventLog signed happy path；Task、TimeBlock active/completed、Proposal 的真实 provider 四域验收仍待从 fake gateway 搬过来。

## 本轮代码变更

相关文件：

- `crates/exomind-runtime/src/ens/data_protocol.rs`
  - 新增 `EnsReceivedDataFrame { transport_peer, frame }` envelope。
  - 新增 `EnsDataFrame::from_peer()`，供 provider 在签名前后统一读取 frame 声称的 sender。
- `crates/exomind-runtime/src/ens/provider.rs`
  - `drain_received_data_frames` 改为返回 `Vec<EnsReceivedDataFrame>`。
- `crates/exomind-runtime/src/ens/fake_provider.rs`
  - fake provider 支持注入带 observed transport peer 的 received data frame。
- `crates/exomind-runtime/src/ens/reticulum_provider.rs`
  - `ReticulumEnsWireFrame::Data` 改为 signed envelope，裸 `EnsDataFrame` 不再作为 Reticulum data-plane wire frame。
  - provider 保存 `PrivateIdentity`，出站对 canonical bytes 签名，并绑定目标 `to_peer_identity_hex`。
  - canonical bytes 固定为 `b"exomind.reticulum.ens.data.v1" + 0 + to_peer_identity_hex + 0 + serde_json(frame)`，避免跨接收者重放。
  - 入站验签成功后推入 `EnsReceivedDataFrame { transport_peer: Some(verified_signer), frame }`。
  - 解码失败、legacy raw frame、坏签名、错误接收者、非法 identity hex 都 fail closed。
- `crates/exomind-runtime/src/ens/service.rs`
  - 新增 `handle_received_data_frame`。
  - 新增 sender binding 校验：缺 observed transport peer 返回 `MissingDataFrameTransportPeer`；observed peer 与 frame 内 `from_peer` 不一致返回 `DataFrameTransportPeerMismatch`。
  - `handle_pending_data_frames` 会继续处理后续帧，保留第一个错误并最终返回，避免坏帧吞掉后续好帧。
- `crates/exomind-runtime/src/routes/mesh.rs`
  - `/mesh/events` 读取 peer token 注入的 `AuthenticatedPeerIdentity`；若 token 身份与 body `from_peer_id` 不一致，返回 `403`。
  - ENS error mapping 中，缺 sender proof 映射 `400`，sender mismatch 映射 `403`。
- `crates/exomind-runtime/tests/ens_data_plane.rs`
  - fake data-plane 四域测试已迁到 sender-bound envelope。
  - 新增缺 transport peer、transport peer mismatch、mixed invalid+valid pending frames 回归测试。
- `crates/exomind-runtime/tests/ens_reticulum_provider.rs`
  - queue-backed provider 测试确认 signed EventLog frame 可以通过真实 Reticulum provider 写入 B 端 store。
  - 覆盖 legacy unsigned frame fail closed、bad signature fail closed、wrong recipient fail closed、non-local signing refused。
  - 覆盖签名有效但 Mesh 未授权 signer 时由 service 返回 `UnauthorizedDataFramePeer`，B 端 store 保持为空。
- `crates/exomind-runtime/tests/mesh_routes_integration.rs`
  - 新增 peer A token 冒充 peer B 的 `403` 回归测试，以及匹配身份的 happy path。

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

## 下一步顺序

1. 补 UDP dynamic port 纵切。
   - 动态绑定端口。
   - 把实际 bound port 投影到 endpoint/interface snapshot。
   - 双 provider 验证 EventLog `SignalEvent`。
2. 补 mDNS `ret_port` bootstrap。
   - mDNS 只发布/发现 Reticulum interface bootstrap 信息。
   - 最终仍投影为 `EnsEndpointAdvertisement`，不能成为 Mesh peer truth。
3. 补 TCP seed / TCP server-client interface。
   - 端口必须来自显式 config 或 endpoint advertisement。
   - 禁止恢复旧分支的 `port +/- 5000` 推导。
4. 把 fake 已覆盖的 Task、TimeBlock active/completed、Proposal 场景搬到真实 provider。
5. JSONL/file/queue 作为 local-dev/file medium 实验接口继续收敛到 Reticulum physical layer。
6. 如果 ExoNet-Reticulum 暴露 link/source metadata，补 verified signer 与 observed link sender 的一致性测试。
7. 最后再考虑 AppState/route/UI 默认启动集成。

## 推荐验证命令

```powershell
git diff --check
cargo test -j 1 -p exomind-runtime --test ens_data_plane -- --nocapture
cargo test -j 1 -p exomind-runtime --test mesh_routes_integration -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_reticulum_provider -- --nocapture --test-threads=1
cargo test -j 1 -p exomind-runtime --test ens_routes_debug -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_control_plane_prototype -- --nocapture
cargo check --lib -j 1 -p exomind-runtime
```

运行 Rust 验证时会看到一些既有 warning，集中在 agent、timeblock、task bridge 等区域；不要在 Reticulum patch 里顺手修。

## 脏文件边界

当前工作树存在与 Reticulum/ENS 无关的脏文件，不要 stage、revert 或顺手格式化：

- `crates/exomind-runtime/src/agent/life.rs`
- `crates/exomind-runtime/src/agent/session.rs`
- `crates/exomind-runtime/src/agent/timeblock_summary/context.rs`
- `crates/exomind-runtime/src/agent/timeblock_summary/templates.rs`
- `crates/exomind-runtime/src/routes/workspace.rs`
- `crates/exomind-runtime/src/signal/actors/replication_actor.rs`
- `crates/exomind-runtime/src/task/bridge_prototype.rs`
- `crates/exomind-runtime/src/timeblock.rs`
- `src-tauri/src/commands/runtime_commands.rs`

可以 stage 的 Reticulum/ENS 相关文件仅限：

- `crates/exomind-runtime/src/ens/data_protocol.rs`
- `crates/exomind-runtime/src/ens/fake_provider.rs`
- `crates/exomind-runtime/src/ens/mod.rs`
- `crates/exomind-runtime/src/ens/provider.rs`
- `crates/exomind-runtime/src/ens/reticulum_provider.rs`
- `crates/exomind-runtime/src/ens/service.rs`
- `crates/exomind-runtime/src/routes/mesh.rs`
- `crates/exomind-runtime/tests/ens_data_plane.rs`
- `crates/exomind-runtime/tests/ens_reticulum_provider.rs`
- `crates/exomind-runtime/tests/mesh_routes_integration.rs`
- `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
- `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`
- `docs/plans/2026-06-08-reticulum-next-agent-handoff.md`

## 参考文档

- `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
- `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`
- `docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`
- `docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`
