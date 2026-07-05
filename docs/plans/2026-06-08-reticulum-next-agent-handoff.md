# Reticulum 下一阶段无上下文 Agent 交接

> 本文件是接手入口，不是变更日志。它只保存后续 Agent 必须先理解的目标、契约、代码锚点、验证入口和下一步顺序。
>
> 长期目标与验收标准以 `2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md` 为准；本文件只帮助无上下文 Agent 快速进入工作。

## 先读顺序

按下面顺序进入，不要先从旧原型分支或单个 UI 文件开始猜：

1. `AGENTS.md`：源码工作目录规则、验证与提交要求。
2. `docs/AI-CONTEXT.md`：仓库索引、技术栈和文档地图。
3. `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`：Reticulum 目标、分层契约、UI 一致性、验收矩阵。
4. `docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`：旧分支质量审查和给后续 Agent 的硬规则。
5. `docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`：只在需要追溯旧分支行为资产时阅读。
6. `docs/plans/2026-06-08-ens-reticulum-fresh-dev-implementation-plan.md`：只作为实施历史和既有纵切索引，不作为最新状态日志使用。

若这些文档冲突，优先级为：`AGENTS.md` > SignalEvent 数据面迁移计划 > 本交接文件 > 历史实施计划 / 考古材料。

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
- UI 只相信后端 snapshot/SSE；命令成功只表示请求被接受，显示事实必须等 refresh 或 SSE 确认。
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
tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx
tests/unit/services/runtime-ens.service.test.ts
```

这些锚点对应的含义：

- `ens_data_plane.rs`：fake gateway 证明四域都走同一种 `EnsDataFrame::SignalEvent`，并覆盖 unauthorized、duplicate、origin bounce 等边界。
- `ens_reticulum_provider.rs`：真实 provider 约束 queue/UDP/TCP/JSONL/file/mDNS bootstrap、signed frame、fail closed、dynamic port projection 与 TCP 四域同步。
- `ens_routes_debug.rs`：debug route、snapshot、topology、operation/error、delivery filtering 的边界。
- `runtime_startup.rs`：真实 Reticulum provider 的 env/config startup、local identity 与实际 bound endpoint projection。
- `device-view.reticulum-debug.test.tsx`：UI 的本机身份、接口 endpoint、topology snapshot truth、delivery/error/stale 展示。

## 下一步实施顺序

1. 先建立可人工复现的双实例或双设备验收链路：端口、临时数据目录、Reticulum interface bind、runtime route、Tauri/MCP bridge 都要隔离，不能影响已安装版外心。
2. 闭合 discovery -> pairing -> authorization -> snapshot/UI 可见的状态链路。UI/debug route 必须能显示 discovered peer、pairing operation/error、authorized state、fail-closed 结果。
3. 以 TCP server/client 四域真实 provider 测试作为多端 data-plane 主回归，把它提升为可打开 debug 构建后纯人验证的场景。
4. 组合验收 local registry、mDNS bootstrap、UDP/TCP、JSONL/File physical medium。它们只能产生 Reticulum endpoint/bootstrap，不得自动授权 Mesh peer。
5. 对 mDNS bootstrap 做真实局域网双进程验收。mDNS 只验证 Reticulum endpoint bootstrap，不恢复 legacy HTTP mesh pairing。
6. 补齐缺口后再扩大默认启动集成、AppState/UI 接入和用户侧同步 UX；仍然只消费 typed snapshot/SSE，仍然禁止乐观显示 topology、pairing、provider 或 delivery 状态。

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
- topology 操作后 UI 通过 snapshot/SSE 展示后端事实，不提前显示目标值成功。
- discovered peer、pairing、authorized、delivery/error/stale 都能在 UI 或 debug route 中观察到。

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
