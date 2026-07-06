# Reticulum 双实例与双设备验收手册

> 本手册用于把 Reticulum/ENS 的自动回归、双 runtime、双窗口和 LAN/mDNS 验收串成可复现路径。长期目标与架构契约见 `docs/plans/2026-06-08-reticulum-signal-event-data-plane-and-interface-migration-plan.md`；无上下文接手入口见 `docs/plans/2026-06-08-reticulum-next-agent-handoff.md`。

## 验收目标

Reticulum 验收只证明一件事：已授权 RT 之间可以通过 Reticulum gateway 同步 EventLog、Task、TimeBlock 与 Proposal。UDP、TCP、mDNS、JSONL、File、local registry 只是 Reticulum 下方的 interface 或 bootstrap medium；HTTP/SSE 只用于本机 UI、debug route、legacy/dev 联调。

手动验收不能用“UI 看起来成功”替代后端事实。当前 UI 必须来自 `/mesh/ens/snapshot` 加显式 refresh；未来可接等价 SSE，但 SSE 也只能发布同一份后端 snapshot truth。命令成功只表示后端接受请求，不能表示 topology、pairing、delivery 或 domain sync 已经成功。

## 隔离原则

每个实例必须隔离：

- `EXOMIND_RT_PORT`
- `EXOMIND_RT_DATA_DIR`
- `EXOMIND_RT_MESH_STATE_PATH`
- `EXOMIND_RT_SIGNAL_SQLITE_PATH`
- `EXOMIND_RT_CONFIG_SQLITE_PATH`
- Reticulum bind/connect endpoint
- Tauri web/HMR/MCP bridge 端口

不要用已安装版外心做验收。debug exe 必须来自当前 `H:\A137442\Develop\AGI\exomind-reticulum` 工作树的构建产物。若使用共享 Cargo target，例如 `G:\exomind-cargo-target`，构建前后都要确认工作目录和 exe 时间戳，避免打开同级 `exomind` 或旧构建。

若验收需要 Tauri MCP 或同时打开两个 dev 窗口，优先使用 `tauri:manager`。它会隔离 `EXOMIND_WEB_PORT`、`EXOMIND_HMR_PORT`、`EXOMIND_RT_PORT`，并通过 `scripts/dev/tauri-wrapper.ps1` 注入 `EXOMIND_DEV_WEBVIEW_MAIN_DATA_DIR`、`EXOMIND_DEV_WEBVIEW_OVERLAY_DATA_ROOT` 和 `EXOMIND_MCP_BRIDGE_BASE_PORT`。直接运行 debug exe 适合纯人工冒烟，但不能替代受管双实例的端口/bridge 隔离验证。

## 环境变量

Runtime 启动配置从 `crates/exomind-runtime/src/lib.rs` 的 `RuntimeStartOptions::default()` 和 `configured_reticulum_ens_from_env()` 读取。

| 变量 | 作用 |
|------|------|
| `EXOMIND_RT_ENS_RETICULUM=1` | 启用 `runtime-reticulum-ens` provider |
| `EXOMIND_RT_RETICULUM_UDP_BIND` | 逗号或分号分隔的 UDP bind address，可用 `127.0.0.1:0` |
| `EXOMIND_RT_RETICULUM_UDP_FORWARD` | UDP forward address |
| `EXOMIND_RT_RETICULUM_TCP_LISTEN` | 逗号或分号分隔的 TCP server bind address，可用 `127.0.0.1:0` |
| `EXOMIND_RT_RETICULUM_TCP_CONNECT` | 逗号或分号分隔的 TCP client remote address |
| `EXOMIND_RT_RETICULUM_JSONL_DIR` | JSONL stream directory |
| `EXOMIND_RT_RETICULUM_JSONL_NODE` | JSONL node name |
| `EXOMIND_RT_RETICULUM_FILE_PATH` | File interface path |
| `EXOMIND_RT_RETICULUM_FILE_NAME` | File interface name |
| `EXOMIND_RT_RETICULUM_LOCAL_REGISTRY_PATH` | local registry path；存在时同时启用 publish/load |
| `EXOMIND_RT_MDNS=1` | 启用 mDNS 广播与 bootstrap sink |

Tauri dev 双窗口还要隔离：

| 变量 | 作用 |
|------|------|
| `EXOMIND_WEB_PORT` | Vite dev server 端口 |
| `EXOMIND_HMR_PORT` | Vite HMR WebSocket 端口 |
| `EXOMIND_MCP_BRIDGE_BASE_PORT` | Tauri MCP/raw bridge 基础端口；通常由 `tauri-wrapper.ps1` 按实例目录注入 |

## 自动回归

文档或索引修改至少运行：

```powershell
git diff --check
```

Reticulum/ENS 后端修改按影响面运行：

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

Reticulum debug UI 或 TypeScript service 修改按影响面运行：

```powershell
npx vitest run tests/unit/ui/agent-hub/device-view.reticulum-debug.test.tsx
npx vitest run tests/unit/services/runtime-ens.service.test.ts
node ./node_modules/typescript/bin/tsc --noEmit
```

`runtime_reticulum_sync.rs` 是当前最接近真实多端同步的自动验收：它启动两个 runtime，用 Reticulum TCP server/client 同步 EventLog 与 Task/TimeBlock/Proposal frame。它通过后，只能证明后端纵切成立；仍需人工确认 debug exe 的 UI 能投影真实状态。

## 本机双 runtime 验收

这条路径优先用于证明后端，不要求打开 UI。

1. 运行自动基线：

```powershell
cargo test -j 1 -p exomind-runtime --test runtime_reticulum_sync -- --nocapture --test-threads=1
```

2. 从测试输出或代码确认状态链：

```text
runtime B starts with Reticulum TCP server on 127.0.0.1:0
runtime A starts with Reticulum TCP client to B actual port
A/B exchange discovered Reticulum endpoints
A/B authorize each other by identity_hex
A writes EventLog / Task / TimeBlock / Proposal SignalEvent
B receives through Reticulum provider
B applies through MeshState::ingest_remote_event -> SignalPool -> projector
```

3. 若失败，先检查：

- snapshot 中 `provider_id` 是否为 `runtime-reticulum-ens`
- `local_identity.identity_hex` 是否存在
- interface address 是否为实际端口，不能是 `tcp-listen://127.0.0.1:0`
- peer 是否以 Reticulum `identity_hex` 授权
- delivery `sent` 是否只表示已记录或已交给 provider，不要当成远端 receipt

## 本机双窗口验收

这条路径用于确认 debug exe 与 UI 能展示真实 Reticulum 运行态。

### 推荐路径：tauri:manager 受管双实例

这条路径适合 UI 与 Tauri MCP 调试。每次启动命令前都要在同一个 PowerShell 会话中设置该实例自己的 Reticulum/RT 数据环境，不要让 A/B 共用 mesh state 或 SQLite。

1. 准备隔离目录：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$a = Join-Path $root 'node-a'
$b = Join-Path $root 'node-b'
New-Item -ItemType Directory -Force $a,$b | Out-Null
```

2. 启动 B。`tauri:manager` 负责隔离 Web/HMR/RT 端口，wrapper 负责隔离 webview 与 MCP bridge；下面的 RT 数据路径仍显式给出，便于人工复核和清理：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$b = Join-Path $root 'node-b'
New-Item -ItemType Directory -Force $b | Out-Null

$env:EXOMIND_RT_HOST_ID='rt-reticulum-b'
$env:EXOMIND_RT_DEVICE_ID='dev-reticulum-b'
$env:EXOMIND_RT_DATA_DIR=$b
$env:EXOMIND_RT_MESH_STATE_PATH=(Join-Path $b 'mesh-state.json')
$env:EXOMIND_RT_SIGNAL_SQLITE_PATH=(Join-Path $b 'signals.sqlite')
$env:EXOMIND_RT_CONFIG_SQLITE_PATH=(Join-Path $b 'config.sqlite')
$env:EXOMIND_RT_ENS_RETICULUM='1'
$env:EXOMIND_RT_RETICULUM_TCP_LISTEN='127.0.0.1:0'
$env:EXOMIND_RT_DISABLE_TS_AGENTS='1'
bun run tauri:manager -- start --name reticulum-b --target desktop --web-port 1620 --hmr-port 1621 --rt-port 9324
```

3. 从 B 的 snapshot 读取实际 TCP endpoint：

```powershell
Invoke-RestMethod http://127.0.0.1:9324/mesh/ens/snapshot | ConvertTo-Json -Depth 8
```

4. 启动 A。把 `<B_TCP_PORT>` 替换为 B snapshot 中 `tcp-listen://127.0.0.1:<port>` 的实际端口：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$a = Join-Path $root 'node-a'
New-Item -ItemType Directory -Force $a | Out-Null

$env:EXOMIND_RT_HOST_ID='rt-reticulum-a'
$env:EXOMIND_RT_DEVICE_ID='dev-reticulum-a'
$env:EXOMIND_RT_DATA_DIR=$a
$env:EXOMIND_RT_MESH_STATE_PATH=(Join-Path $a 'mesh-state.json')
$env:EXOMIND_RT_SIGNAL_SQLITE_PATH=(Join-Path $a 'signals.sqlite')
$env:EXOMIND_RT_CONFIG_SQLITE_PATH=(Join-Path $a 'config.sqlite')
$env:EXOMIND_RT_ENS_RETICULUM='1'
$env:EXOMIND_RT_RETICULUM_TCP_CONNECT='127.0.0.1:<B_TCP_PORT>'
$env:EXOMIND_RT_DISABLE_TS_AGENTS='1'
bun run tauri:manager -- start --name reticulum-a --target desktop --web-port 1520 --hmr-port 1521 --rt-port 9224
```

5. 复核 manager 记录、RT 端口、snapshot 三者一致：

```powershell
bun run tauri:manager -- list
Invoke-RestMethod http://127.0.0.1:9224/mesh/ens/snapshot | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:9324/mesh/ens/snapshot | ConvertTo-Json -Depth 8
```

如果 manager、bridge 或 RT 任一层不一致，先按 `docs/development/tauri-mcp-windows-playbook.md` 定位，不进入 data-plane 结论。

### 备用路径：直接运行 debug exe

这条路径适合纯人工打开 exe 看 UI，但 webview profile 与 MCP bridge 隔离不如 `tauri:manager` 清晰。需要 Tauri MCP 自动验证时回到受管路径。

1. 在当前工作树构建 debug exe：

```powershell
$env:CARGO_TARGET_DIR='G:\exomind-cargo-target'
bun run tauri build --debug
```

2. 记录 exe 路径和时间戳。若使用 `G:\exomind-cargo-target\debug\exomind.exe`，确认它是刚由当前工作树生成：

```powershell
Get-Item G:\exomind-cargo-target\debug\exomind.exe | Format-List FullName,Length,LastWriteTime
```

3. 为两个窗口准备隔离目录：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$a = Join-Path $root 'node-a'
$b = Join-Path $root 'node-b'
New-Item -ItemType Directory -Force $a,$b | Out-Null
```

4. 先启动 B 作为 TCP server。在一个 PowerShell 终端中设置。每个终端都必须自包含地定义 `$root/$a/$b`，不要依赖另一个 PowerShell 会话里的变量：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$a = Join-Path $root 'node-a'
$b = Join-Path $root 'node-b'
New-Item -ItemType Directory -Force $a,$b | Out-Null

$env:EXOMIND_RT_PORT='9324'
$env:EXOMIND_WEB_PORT='1620'
$env:EXOMIND_HMR_PORT='1621'
$env:EXOMIND_MCP_BRIDGE_BASE_PORT='9323'
$env:EXOMIND_RT_HOST_ID='rt-reticulum-b'
$env:EXOMIND_RT_DEVICE_ID='dev-reticulum-b'
$env:EXOMIND_RT_DATA_DIR=$b
$env:EXOMIND_RT_MESH_STATE_PATH=(Join-Path $b 'mesh-state.json')
$env:EXOMIND_RT_SIGNAL_SQLITE_PATH=(Join-Path $b 'signals.sqlite')
$env:EXOMIND_RT_CONFIG_SQLITE_PATH=(Join-Path $b 'config.sqlite')
$env:EXOMIND_RT_ENS_RETICULUM='1'
$env:EXOMIND_RT_RETICULUM_TCP_LISTEN='127.0.0.1:0'
$env:EXOMIND_RT_DISABLE_TS_AGENTS='1'
G:\exomind-cargo-target\debug\exomind.exe
```

5. 在 B 的 Reticulum 面板或 debug route 中读取实际 TCP endpoint：

```powershell
Invoke-RestMethod http://127.0.0.1:9324/mesh/ens/snapshot | ConvertTo-Json -Depth 8
```

预期：

- `provider_id = runtime-reticulum-ens`
- `local_identity.identity_hex` 存在
- `interfaces[*].interface_address` 含实际 `tcp-listen://127.0.0.1:<port>`
- 没有 `tcp-listen://127.0.0.1:0`

6. 启动 A 作为 TCP client。把 `<B_TCP_PORT>` 替换为 B snapshot 中的实际端口。这个终端也要重新定义 `$root/$a/$b`：

```powershell
$root = Join-Path $env:TEMP 'exomind-reticulum-dual'
$a = Join-Path $root 'node-a'
$b = Join-Path $root 'node-b'
New-Item -ItemType Directory -Force $a,$b | Out-Null

$env:EXOMIND_RT_PORT='9224'
$env:EXOMIND_WEB_PORT='1520'
$env:EXOMIND_HMR_PORT='1521'
$env:EXOMIND_MCP_BRIDGE_BASE_PORT='9223'
$env:EXOMIND_RT_HOST_ID='rt-reticulum-a'
$env:EXOMIND_RT_DEVICE_ID='dev-reticulum-a'
$env:EXOMIND_RT_DATA_DIR=$a
$env:EXOMIND_RT_MESH_STATE_PATH=(Join-Path $a 'mesh-state.json')
$env:EXOMIND_RT_SIGNAL_SQLITE_PATH=(Join-Path $a 'signals.sqlite')
$env:EXOMIND_RT_CONFIG_SQLITE_PATH=(Join-Path $a 'config.sqlite')
$env:EXOMIND_RT_ENS_RETICULUM='1'
$env:EXOMIND_RT_RETICULUM_TCP_CONNECT='127.0.0.1:<B_TCP_PORT>'
$env:EXOMIND_RT_DISABLE_TS_AGENTS='1'
G:\exomind-cargo-target\debug\exomind.exe
```

7. 人工观察 UI：

- 顶层“本机身份”显示 Reticulum `identity_hex`，不是 UDP/TCP endpoint。
- hover/title 可看到完整 identity；点击复制复制完整 ID，toast 只表示剪贴板动作成功。
- endpoint 只出现在对应 interface 行。
- topology 操作后显示值来自下一次 snapshot/refresh；不能提前乐观显示目标状态。
- 错误、stale、operation、delivery 状态可见，且不会被隐藏成成功。

8. 完成 discovery 与 pairing/authorization 闭环。A 写 B 读之前必须在双方 `/mesh/ens/snapshot` 中看到对方 peer 且 `authorized=true`。只发现 peer、只看到 interface online、只得到 pairing ticket、只出现 `sent` 或 toast，都不能进入 data-plane 验收。

当前分支已经暴露：

- `GET /mesh/ens/snapshot`
- `PUT /mesh/ens/topology`
- `PUT /mesh/ens/interfaces/:name/topology`
- `POST /mesh/ens/pairing/discovered/:identity_hex`
- `GET /mesh/ens/pairing/operations/:operation_id/status`
- `POST /mesh/ens/pairing/operations/:operation_id/accept`
- `POST /mesh/ens/pairing/operations/:operation_id/cancel`

当前 HTTP route、TypeScript client 与 DeviceView Reticulum 面板已覆盖 operation status、inbound offer PIN accept 与 cancel。这里刻意不提供 fake/manual complete route：接受 inbound offer 只表示本机发送了 `PairingResponse`，authorization 完成仍必须来自真实 `PairingComplete` control-plane frame，并以双方 snapshot 中 `authorized=true` 为准。

因此，当前手册应进入真实双窗口或双设备验收：用 status/accept/cancel 调试控件推进 pairing，再用双方 `/mesh/ens/snapshot` 确认 authorized peer，最后以远端业务 route/store 读到 EventLog、Task、TimeBlock、Proposal 作为通过标准。`operation accepted`、toast、`sent`、interface online 或 discovered peer 都不能替代这个标准。

最小检查流程：

```powershell
$aSnapshot = Invoke-RestMethod http://127.0.0.1:9224/mesh/ens/snapshot
$bSnapshot = Invoke-RestMethod http://127.0.0.1:9324/mesh/ens/snapshot
$aSnapshot.peers | Format-Table
$bSnapshot.peers | Format-Table
```

若 A 已发现 B，可从 A 发起 pairing offer：

```powershell
$bIdentity = '<B_identity_hex_from_A_snapshot_peer>'
Invoke-RestMethod "http://127.0.0.1:9224/mesh/ens/pairing/discovered/$bIdentity" -Method Post | ConvertTo-Json -Depth 8
```

随后轮询双方 snapshot：

```powershell
Invoke-RestMethod http://127.0.0.1:9224/mesh/ens/snapshot | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:9324/mesh/ens/snapshot | ConvertTo-Json -Depth 8
```

进入下一步的唯一授权条件：

```text
A snapshot peers[*].identity.identity_hex == B local_identity.identity_hex 且 authorized == true
B snapshot peers[*].identity.identity_hex == A local_identity.identity_hex 且 authorized == true
```

不要使用 legacy `/mesh/pairing/initiate` 与 `/mesh/pairing/respond` 伪造通过。那组 route 是 HTTP mesh 配对路径，主键偏向 host/base URL，不等于 Reticulum identity 的 ENS authorization truth。

9. 写入业务数据并从远端 runtime 回读。以下命令默认 A 在 `9224`，B 在 `9324`，A 写入、B 回读。这里的 HTTP route 只用于“本机向 A 写入”和“本机从 B 回读”的控制面/观察面，不是 RT-to-RT peer transport。`sent`、接口在线、discovered peer、toast、operation accepted 都不能替代 B 端业务数据出现。

```powershell
$profile = 'reticulum-manual'

Invoke-RestMethod "http://127.0.0.1:9224/eventlog?user_id=$profile" `
  -Method Post -ContentType 'application/json' `
  -Body '{"id":"manual-event-001","content":"Reticulum EventLog manual probe","tags":["reticulum-manual"],"refs":[],"metadata":{"reticulumProbeId":"probe-001"}}'

Invoke-RestMethod "http://127.0.0.1:9324/eventlog?user_id=$profile" | ConvertTo-Json -Depth 8
```

```powershell
$profile = 'reticulum-manual'

Invoke-RestMethod "http://127.0.0.1:9224/tasks?user_id=$profile" `
  -Method Post -ContentType 'application/json' `
  -Body '{"title":"Reticulum Task manual probe","tags":["reticulum-manual"],"source":"reticulum-manual","depends_on":[],"time_block_ids":[]}'

Invoke-RestMethod "http://127.0.0.1:9324/tasks?user_id=$profile" | ConvertTo-Json -Depth 8
```

```powershell
$profile = 'reticulum-manual'

Invoke-RestMethod "http://127.0.0.1:9224/timeblocks/new?user_id=$profile" `
  -Method Post -ContentType 'application/json' `
  -Body '{"blockType":"active","name":"Reticulum TimeBlock manual probe","mode":"countup","targetMinutes":25}'

Invoke-RestMethod "http://127.0.0.1:9324/timeblocks/active?user_id=$profile" | ConvertTo-Json -Depth 8
Invoke-RestMethod "http://127.0.0.1:9324/timeblocks?user_id=$profile" | ConvertTo-Json -Depth 8
```

```powershell
$profile = 'reticulum-manual'

Invoke-RestMethod "http://127.0.0.1:9224/api/proposals?user_id=$profile" `
  -Method Post -ContentType 'application/json' `
  -Body '{"title":"Reticulum Proposal manual probe","body":"用于双实例同步验证","action_type":"append_event","action_params":{"content":"Reticulum proposal sync probe","tags":["reticulum-manual"]},"publisher":{"publisher_type":"human","id":"manual-verifier","name":"Manual Verifier"}}'

Invoke-RestMethod "http://127.0.0.1:9324/api/proposals?user_id=$profile" | ConvertTo-Json -Depth 8
```

10. 若业务回读失败，按这个顺序定位：

- 未发现：`/mesh/ens/snapshot` 中没有对方 peer。先检查 Reticulum interface endpoint、TCP connect/listen、mDNS/local registry bootstrap。
- 未授权：peer 存在但 `authorized=false`。先补 pairing accept/complete 或确认 trust store，不要检查 projector。
- 已授权但 `deliveries` 只有 queued/sent：说明最多只是本机记录或交给 provider，不能当远端 receipt；继续看 provider error/stale。
- sent 但远端未应用：检查 `MeshState::ingest_remote_event -> SignalPool -> replication_actor/projector`，以及 source-binding/signature 校验。
- projector 失败：看 B 端业务 route 和 runtime log，确认 EventLog/Task/TimeBlock/Proposal domain projector 是否报错。
- profile/user_id 不一致：A 写入和 B 回读必须使用同一个 `user_id`，不要把 profile mismatch 误判为 transport 失败。
- 业务 GET route：最终只以 B 端 EventLog/Task/TimeBlock/Proposal route 能读到 A 写入的数据为同步成功。

## LAN/mDNS bootstrap 验收

这条路径用于证明局域网发现只提供 Reticulum endpoint bootstrap，不自动授权 data-plane。

1. 两台设备或两进程都启用 mDNS 与 Reticulum UDP：

```powershell
$env:EXOMIND_RT_BIND='0.0.0.0'
$env:EXOMIND_RT_MDNS='1'
$env:EXOMIND_RT_ENS_RETICULUM='1'
$env:EXOMIND_RT_RETICULUM_UDP_BIND='0.0.0.0:0'
```

2. 从 `/mesh/ens/snapshot` 或 UI 确认 discovered peer：

- discovered endpoint 的 `gateway` 是 `reticulum`
- `via_medium` 是 `mdns`
- `discovery_source` 是 `reticulum-mdns-bootstrap`
- endpoint 中有 Reticulum destination 和实际 UDP interface address
- peer 仍未授权，不能进入 data-plane

3. 配对/授权后再验证 data-plane。没有授权前，任何 incoming `SignalEvent` 都必须 fail closed。

## 通过标准

一次阶段验收通过需要同时满足：

- 自动回归中与改动相关的测试通过。
- debug exe 来自当前工作树。
- `/mesh/ens/snapshot` 展示真实 provider、local identity、actual interface endpoint，且没有 `:0` 泄漏。
- UI Reticulum 面板只投影后端 snapshot/refresh；未来接 SSE 时也必须保持同一 snapshot truth，不乐观显示 topology、pairing、delivery 或 provider health。
- discovery、pairing、authorization、delivery/error/stale 至少能通过 UI 或 debug route 观察。
- EventLog、Task、TimeBlock、Proposal 的同步以远端业务数据出现为准，不以 `sent` 或“接口在线”为准。

## 常见失败定位

| 现象 | 优先检查 |
|------|----------|
| UI 顶层显示 `udp://` 或 `tcp://` | 顶层身份应读取 `EnsTransportSnapshot.local_identity.identity_hex`，endpoint 只能在 interface 行展示 |
| snapshot 有 `:0` | provider 没有投影实际 bound endpoint，检查 dynamic port projection |
| discovered peer 自动变 authorized | mDNS/local registry 被误当成 authorization truth |
| `sent` 被显示为已送达 | UI 文案越权；没有 end-to-end receipt 前只能显示“已记录/已交给 provider” |
| A/B 能 HTTP 互调但 Reticulum 不通 | HTTP/SSE 不是跨 RT peer transport；检查 Reticulum interface endpoint 与 identity |
| 双窗口数据混在一起 | 数据目录、mesh state、SQLite path 或 RT port 没隔离 |
