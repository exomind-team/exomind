# Reticulum 下一阶段无上下文 Agent 交接

> 本文件是接手入口，不是变更日志。它只保存后续 Agent 必须先理解的目标、契约、代码锚点、验证入口和下一步顺序。
>
> 长期目标与验收标准以 `2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md` 为准；本文件只帮助无上下文 Agent 快速进入工作。

## 先读顺序

按下面顺序进入，不要先从旧原型分支或单个 UI 文件开始猜：

1. `AGENTS.md`：源码工作目录规则、验证与提交要求。
2. `docs/AI-CONTEXT.md`：仓库索引、技术栈和文档地图。
3. `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`：Reticulum 目标、分层契约、UI 一致性、验收矩阵。
4. `docs/development/reticulum-dual-instance-verification.md`：双 runtime、双窗口、双设备的自动/人工验收路径。
5. `docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`：旧分支质量审查和给后续 Agent 的硬规则。
6. `docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`：只在需要追溯旧分支行为资产时阅读。
7. `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`：只作为实施历史和既有纵切索引，不作为最新状态日志使用。

若这些文档冲突，优先级为：`AGENTS.md` > SignalEvent 数据面迁移计划 > 本交接文件 > 历史实施计划 / 考古材料。

## 易误导历史资料清单

这些文件保留为历史、背景或考古材料，但不能覆盖当前权威入口和当前源码事实：

- `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`：历史实施记录。不要执行其中旧任务列表、旧 route 草案或旧 UI 草案。
- `docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`：旧分支行为资产清单。不要修旧分支 path dependency，也不要迁移旧 HTTP/SSE pairing 形状。
- `docs/development/device-pairing-flow.md`：legacy node-first/HTTP mesh 配对资料。不得作为 Reticulum identity 授权闭环。
- `docs/development/lan-single-rt-guide.md`：legacy LAN/HTTP mesh 资料。mDNS 只能作为 Reticulum endpoint bootstrap。
- `docs/architecture/overview.md`、`docs/architecture/ECS-communication-stack.md` 与更早的 2026-03/2026-04 网络路线文档：只提供系统背景。跨 RT 网络路线以 Reticulum/ENS 专项 handoff、迁移计划和双实例验收手册为准。

## 冷启动自检门禁

无上下文 Agent 接手后，开始实现前必须先用当前工作树事实回答这些问题；答不出来就继续读文档或查代码，不要猜：

1. 当前工作树是否是 `H:\A137442\Develop\AGI\exomind-reticulum`，当前分支是否是 Reticulum/ENS 目标分支，`git status --short --branch` 中有哪些未提交改动。
2. 当前权威入口是哪几个文件，哪些文件只是历史计划、考古材料或旧原型审计。
3. 当前公开的 `/mesh/ens/*` debug routes 有哪些；如果要做人工授权闭环，是否仍缺 accept、complete、cancel 或 status route。
4. `RuntimeEnsService` 是否只暴露 snapshot/topology/discovered pairing，还是已经有完整 pairing accept/complete/cancel typed client。
5. `DeviceView` 是否只从 backend snapshot/refresh 呈现 Reticulum 状态；未来若接 SSE，是否仍以同一份后端 snapshot truth 为准；是否存在本地乐观授权、乐观 topology 或把 `sent` 当端到端送达的显示。
6. 下一步是否仍应围绕 discovery -> pairing -> authorization -> delivery/error/stale 的 UI/debug route 闭环和双实例验收推进。

如果 `docs/architecture/overview.md`、`docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`
或旧原型审计材料与上述答案冲突，以本文件、SignalEvent 迁移计划、双实例验收手册和当前源码事实为准。

## 当前暴露面与下一阻塞点

这张表是冷启动 Agent 的第一层事实校准。service 层已有的能力不等于 route、TypeScript client 或 UI 已经能人工操作；人工双窗口/双设备验收必须以实际暴露面为准。

| 层级 | 当前已暴露 | 当前缺口 | 对验收的影响 |
|------|------------|----------|--------------|
| 后端 debug route | `GET /mesh/ens/snapshot`、`PUT /mesh/ens/topology`、`PUT /mesh/ens/interfaces/:name/topology`、`POST /mesh/ens/pairing/discovered/:identity_hex`、`GET /mesh/ens/pairing/operations/:operation_id/status`、`POST /mesh/ens/pairing/operations/:operation_id/accept`、`POST /mesh/ens/pairing/operations/:operation_id/cancel` | 不暴露 fake/manual complete route；authorization 完成仍必须来自真实 `PairingComplete` control-plane frame | 可以人工查看 operation status、接受 inbound offer 或取消 operation；仍要通过真实双实例/双设备验收确认 authorized peer 和 data-plane |
| TypeScript client | `getSnapshot`、`setGlobalTopology`、`setInterfaceTopology`、`setTopology`、`initiatePairingWithDiscoveredPeer`、`getPairingOperationStatus`、`acceptPairingOperation`、`cancelPairingOperation` | 不提供 fake complete typed client | UI 能用 typed service 驱动 status/accept/cancel；完成态必须等待 backend snapshot/refresh 中的真实事实 |
| `DeviceView` Reticulum 面板 | 展示 backend snapshot/refresh 中的 provider、health、本机 identity、interfaces、peers、operations、operation direction、deliveries、stale/error，并可发起 discovered pairing offer、刷新 operation status、用 PIN 接受 inbound offer、取消 operation | 尚未完成双窗口/双设备人工验收脚本收口 | 当前 UI 已能操作 pairing debug 闭环，但不能单独证明 discovery -> pairing -> authorization -> data-plane 已完成 |

因此，当前阶段的明确断点不再是 status/accept/cancel route/client/UI 缺口，而是：**把真实双窗口或双设备链路从 discovery -> pairing -> authorization -> delivery/error/stale 跑完，并以远端业务 route/store 读到 EventLog、Task、TimeBlock、Proposal 作为通过标准**。不得把 pending operation、operation accepted、toast、`sent`、接口 online 或 discovered peer 当作端到端同步通过。

## 长跑目标

Reticulum 要成为 ExoMind RT 之间唯一的跨 RT 网络网关。用户可见的完成条件不是“能看到 Reticulum 调试面板”，而是已授权设备之间能通过 Reticulum 同步这些用户数据：

1. EventLog。
2. Task。
3. TimeBlock。
4. Proposal。

UDP、TCP、mDNS、File、JSONL、Queue、local JSON、Bluetooth 等只能作为 Reticulum 下方的 physical/interface medium。它们可以负责发现、bootstrap、互通、本地多实例开发或文件/队列承载，但不能重新变成与 Reticulum 平级的同步协议或 peer truth。

HTTP/SSE 只保留为本机 UI、debug route、legacy compatibility 和开发联调用途；不要继续把它扩展成 RT-to-RT peer transport。

## 不可变契约

同步链路必须保持这条中轴：

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

必须遵守：

- 同步 data-plane 只传 `SignalEvent`，不要发明 `ReticulumEventLogSync` 这类 domain-specific transport API。
- Reticulum provider 不直接写 `EventLogStore`、`TaskStore`、`TimeBlockStore`、`ProposalStore` 或其他业务 store。
- 远端事件必须进入 `MeshState::ingest_remote_event`，再由 `SignalPool` 和现有 replication actor/projector 应用。
- `identity_hex` 是 Reticulum trust、pairing、delivery、discovery 的主键；`host_id` 只是 runtime metadata。
- 入站 data frame 必须校验 sender identity、目标 peer、签名或等价 source-binding metadata；缺 proof、坏签名、错误目标都 fail closed。
- mDNS/local registry 只能投影 Reticulum endpoint/bootstrap，不能授权 data-plane，也不能绕过 Reticulum identity。
- `effective_topology = min(global_topology, interface.topology)`；设置 global topology 不得批量改写单接口配置。
- UI 只相信后端 snapshot/refresh；未来可接 SSE，但 SSE 也只能发布同一份后端事实，命令成功只表示请求被接受，显示事实必须等 refresh 或 SSE 确认。
- UI 宁可滞后、pending、stale 或显示错误，也不能比后端实际运行态更“成功”。
- 顶层“本机身份”来自 `EnsTransportSnapshot.local_identity.identity_hex`；物理 endpoint 只在对应 interface 行展示。
- `127.0.0.1:0`、`udp://127.0.0.1:0`、`tcp-listen://127.0.0.1:0` 只能作为 bind input，不得出现在 snapshot、route payload 或 UI payload 中。

## 代码锚点

接手时先围绕这些文件确认事实，不要从零搜索整仓：

```text
crates/exomind-runtime/src/ens/dto.rs
crates/exomind-runtime/src/ens/service.rs
crates/exomind-runtime/src/ens/reticulum_provider.rs
crates/exomind-runtime/src/routes/mesh.rs
crates/exomind-runtime/src/lib.rs
src/lib/services/runtime-ens.service.ts
src/ui/app/pages/agents/DeviceView.tsx
```

关键测试入口：

```text
crates/exomind-runtime/tests/ens_data_plane.rs
crates/exomind-runtime/tests/ens_reticulum_provider.rs
crates/exomind-runtime/tests/ens_routes_debug.rs
crates/exomind-runtime/tests/ens_control_plane_prototype.rs
crates/exomind-runtime/tests/runtime_startup.rs
crates/exomind-runtime/tests/runtime_reticulum_sync.rs
tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx
tests/unit/services/runtime-ens.service.test.ts
```

这些锚点对应的含义：

- `ens_data_plane.rs`：fake gateway 证明四域都走同一种 `EnsDataFrame::SignalEvent`，并覆盖 unauthorized、duplicate、origin bounce 等边界。
- `ens_reticulum_provider.rs`：真实 provider 约束 queue/UDP/TCP/JSONL/file/mDNS bootstrap、signed frame、fail closed、dynamic port projection 与 TCP 四域同步。
- `ens_routes_debug.rs`：debug route、snapshot、topology、operation/error、delivery filtering 的边界。
- `runtime_startup.rs`：真实 Reticulum provider 的 env/config startup、local identity 与实际 bound endpoint projection。
- `runtime_reticulum_sync.rs`：两个真实 runtime 通过 Reticulum TCP 同步 EventLog 与 Task/TimeBlock/Proposal domain frame。
- `device-view.reticulum-debug.test.tsx`：UI 的本机身份、接口 endpoint、topology snapshot truth、delivery/error/stale 展示。

## 当前实现状态

已完成并可用作回归基线：

- fake control-plane：pairing offer/response/complete、cancel、provider failure、discovered peer 发起配对。
- fake data-plane：EventLog、Task、TimeBlock、Proposal 都走 `EnsDataFrame::SignalEvent`，并覆盖 unauthorized、duplicate、origin bounce、缺 transport peer。
- real Reticulum provider：signed frame、queue/UDP/TCP/JSONL/file/local registry/mDNS bootstrap、动态端口投影、`:0` 不泄漏、坏签名/错 target fail closed。
- runtime startup：`EXOMIND_RT_ENS_RETICULUM=1` 可启动 `runtime-reticulum-ens` provider，并从真实 bound interface 投影 local identity 与 endpoint。
- runtime TCP 双节点测试：两个 runtime 可经 Reticulum TCP 同步 EventLog 与 Task/TimeBlock/Proposal frame。
- pairing operation debug 闭环：后端 route、TypeScript client 与 DeviceView 面板已支持 operation status、inbound offer PIN accept、cancel 和 operation direction；没有 fake complete route，授权完成仍依赖真实 `PairingComplete` frame。
- debug UI：DeviceView 的 Reticulum 面板展示 backend snapshot 中的本机 `identity_hex`、interfaces、peers、operations、deliveries、stale/error；本机身份支持完整 ID hover/title 与点击复制。

仍需补齐的接手任务：

- 把自动测试中的双 runtime Reticulum TCP 纵切转化为可重复的双窗口或双设备人工验收。
- 跑通并固化 discovery -> pairing -> authorization -> delivery/error/stale 的 UI/debug route 人工验证脚本。
- 对真实 LAN/mDNS bootstrap 做双进程或双设备验收；mDNS 只证明 Reticulum endpoint bootstrap，不授权 data-plane。
- 后续默认启动与用户侧同步 UX 必须继续消费 typed snapshot/refresh；未来可替换或补充为 SSE，但不得改变后端事实优先、不乐观显示的契约。

## 下一步实施顺序

1. 先建立可人工复现的双实例或双设备验收链路：端口、临时数据目录、Reticulum interface bind、runtime route、Tauri/MCP bridge 都要隔离，不能影响已安装版外心。
2. 执行 discovery -> pairing -> authorization -> snapshot/UI 可见的状态链路。UI/debug route 必须能显示 discovered peer、pairing operation/error、authorized state、fail-closed 结果。
3. 以 TCP server/client 四域真实 provider 测试作为多端 data-plane 主回归，把它提升为可打开 debug 构建后纯人验证的场景。
4. 组合验收 local registry、mDNS bootstrap、UDP/TCP、JSONL/File physical medium。它们只能产生 Reticulum endpoint/bootstrap，不得自动授权 Mesh peer。
5. 对 mDNS bootstrap 做真实局域网双进程验收。mDNS 只验证 Reticulum endpoint bootstrap，不恢复 legacy HTTP mesh pairing。
6. 人工验收收口后再扩大默认启动集成、AppState/UI 接入和用户侧同步 UX；仍然只消费 typed snapshot/refresh，未来接 SSE 时也必须保持同一 snapshot truth，仍然禁止乐观显示 topology、pairing、provider 或 delivery 状态。

每一步都要能收口：相关测试通过、能编译 debug `exomind.exe`、打开后能看到真实 Reticulum/ENS 状态，并且提交后工作区干净。

## 验证入口

文档或轻量边界修改至少运行：

```powershell
git diff --check
```

Reticulum/ENS 后端修改按影响面选跑：

```powershell
cargo fmt --package exomind-runtime -- --check
cargo test -j 1 -p exomind-runtime --test ens_data_plane -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_reticulum_provider -- --nocapture --test-threads=1
cargo test -j 1 -p exomind-runtime --test ens_routes_debug -- --nocapture
cargo test -j 1 -p exomind-runtime --test ens_control_plane_prototype -- --nocapture
cargo test -j 1 -p exomind-runtime --test runtime_startup -- --nocapture --test-threads=1
cargo test -j 1 -p exomind-runtime --test runtime_reticulum_sync -- --nocapture --test-threads=1
cargo check --lib -j 1 -p exomind-runtime
```

Reticulum debug UI / TypeScript 修改按影响面选跑：

```powershell
npx vitest run tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx
npx vitest run tests/unit/services/runtime-ens.service.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
```

真实人工验收必须额外确认：

- 打开的 `exomind.exe` 来自当前 `exomind-reticulum` 工作树的 debug 构建。
- Reticulum 面板顶层展示的是本机 `identity_hex`，不是 UDP/TCP/File/JSONL endpoint。
- interface 行展示各自 physical endpoint，且没有 `:0` 泄漏。
- topology 操作后 UI 通过 snapshot/refresh 展示后端事实；未来接 SSE 时也必须等待后端事实，不提前显示目标值成功。
- discovered peer、pairing、authorized、delivery/error/stale 都能在 UI 或 debug route 中观察到。
- 最终通过以远端业务 route/store 能读到 EventLog、Task、TimeBlock、Proposal 为准；不以 `sent`、toast、interface online、discovered peer 或 operation accepted 为准。

双实例、双设备和 debug exe 的机械步骤见：

```text
docs/development/reticulum-dual-instance-verification.md
```

## 禁止事项

- 不要从旧 Reticulum 原型分支原样迁代码。
- 不要创建 Reticulum-only route island 或 UI island。
- 不要把 mDNS/local registry 写成与 Reticulum 平级的 discovery truth。
- 不要在 provider 里直接写业务 store。
- 不要把 `host_id` 当作跨设备 trust/delivery key。
- 不要把 HTTP base URL 当作 RT-to-RT 主连接事实。
- 不要把 `global_topology` 写成“全部接口 topology”批量操作。
- 不要在 React page component 里实现协议状态机。
- 不要在 async service loop 中加入阻塞文件系统操作。
- 不要为了修 warning、整理样式或顺手重构而扩大 patch；Reticulum/ENS 分支每一步都要可评审、可验证、可回退。

## 提交边界

提交前必须重新看：

```powershell
git status --short --branch
git diff --stat
```

只 stage 与当前 Reticulum/ENS 目标直接相关的源码、测试和计划文档。调试截图、临时报告、构建产物、无关格式化、同级 `exomind` 工作树误改都不能进入存档点。

如果出现不属于本目标的脏文件，不要顺手 revert；先确认是不是用户改动。只有明确属于本次误改时才移除。
