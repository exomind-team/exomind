# Reticulum 原型代码质量审查与 Agent 规则

> 状态：历史原型审计与后续规则材料。本文描述的是旧 Reticulum 原型分支的质量问题、可迁移行为和禁止迁移的代码形状，不代表 `codex/ens-reticulum-adapter` 当前实现状态。
>
> 注意：下方“工作树 / 分支 / 来源分支”是被审计对象的历史信息，不是当前开发分支。
>
> 日期：2026-06-08
> 工作树：`H:\A137442\Develop\AGI\exomind-reticulum`
> 分支：`feat/ret-mesh-prototype-review`
> 来源分支：`origin/feat/ret-mesh-prototype`
> 关联清单：`docs/plans/2026-06-08-reticulum-prototype-archaeology-migration-manifest.md`

## 目的

本文记录旧 Reticulum 原型分支中发现的代码质量问题，并把这些问题转化为后续 Agent 可以机械执行的规则。

旧分支是有价值的。它已经证明了发现、身份、PIN-over-Link 配对、通过 `MeshState` 授权、撤销授权、接口模式控制、SSE 驱动的 UI 更新，以及有用的行为测试。

问题不在于这个分支毫无价值。问题在于太多原型状态泄漏到了模块边界之外。传输、协议、运行时服务状态、HTTP 命令、UI 状态和测试被允许长成一坨互相耦合的补丁堆。这使得该分支不能安全地原样合并，也让能力较弱的 Agent 继续扩展时风险很高。

## 基线事实

- 该原型目前无法构建，因为 `crates/exomind-net-pairing/Cargo.toml` 依赖 `../../../ExoNet-Reticulum/src`，而当前同级仓库的 crate 根路径是 `H:\A137442\Develop\AGI\ExoNet-Reticulum\Cargo.toml`。
- 当前 `ExoNet-Reticulum` 仍然是一个名为 `reticulum` 的单 crate，但公开源码布局已经是 `src/lib.rs`、`src/transport.rs`、`src/interface.rs` 等。
- 当前 `ExoNet-Reticulum` 暴露的是 `interface::InterfaceTopology` 和 `InterfaceInfo`；旧 ExoMind 分支通过 `reticulum::iface::InterfaceMode` 这类路径导入 Reticulum 符号。
- 旧分支相对当前 `origin/dev` 约有 8k 行新增，集中在运行时启动、net pairing、mesh routes、DeviceView UI 和集成测试。
- CodeGraph 未在该审查 worktree 初始化。本审查使用源码检查、`rg`、既有考古清单，以及一个独立只读 reviewer subAgent。

## 主要诊断

该分支已经达到了真实原型阶段，但它没有稳定的集成边界。

正确的下一步不是通过修改 path dependency 先把旧分支救到能编译。正确的下一步是把值得保留的行为抽取到新的 ENS adapter 分支里，并建立明确的 service、command、snapshot 和 error 契约。

## 高风险发现

### 1. 同级仓库依赖边界不稳定

证据：

- `crates/exomind-net-pairing/Cargo.toml` 依赖 `../../../ExoNet-Reticulum/src`。
- 当前 `ExoNet-Reticulum` 的 crate 根路径是同级仓库根目录，不是 `src`。
- 当前 ExoNet API 语言已经转向 `interface::InterfaceTopology`，而原型代码仍使用旧的 `iface::InterfaceMode` 风格路径。

风险：

- Agent 可能在 `cargo check` 甚至无法开始的状态下继续堆代码。
- API 漂移会被 path patch 掩盖，而不是被设计成清晰的 adapter contract。

规则：

- ExoMind 不得依赖同级仓库的内部源码路径。
- Reticulum/ENS 集成必须通过有文档说明的 facade crate 或 adapter module 进入。
- 迁移 PR 在 `cargo check -p <affected crate>` 能够启动、并记录第一轮 API 漂移清单之前，不得继续推进。

### 2. Reticulum runtime 是塞在 `lib.rs` 里的巨型循环

证据：

- `crates/exomind-runtime/src/lib.rs:1965` 定义了 `ret_mesh_background`，这是一个 500+ 行的异步循环。
- 它同时处理启动扫描、文件注册表、mDNS bridge、Reticulum announce、Link event、pairing、interface mode、SSE snapshot、peer eviction、debug counter 和 timeout cleanup。
- 启动时使用 `tokio::spawn(ret_mesh_background(...))`，但没有保留 `JoinHandle`，没有 health signal、shutdown contract 或 restart policy。

风险：

- 后续任何改动都必须继续 patch 同一个中心循环。
- 协议错误可能杀死或卡住后台任务，而 route/UI 无法感知。
- 测试会退化成宽泛的 route-level 测试，而不是 service-level 行为测试。

规则：

- 新的 transport/runtime 集成不得直接加到 `crates/exomind-runtime/src/lib.rs`。
- 任何包含 `tokio::select!`、timer、channel、transport event，或超过 150 行的后台任务，都必须抽取到独立 service module。
- 长生命周期 service 被 spawn 后，至少必须暴露：command input、typed event/snapshot output、health state、shutdown path 和 error reporting。

### 3. 异步 service 中使用阻塞文件系统操作

证据：

- `ret_mesh_background` 在启动和 tick 处理中调用 `std::fs::create_dir_all`、`std::fs::write`、`std::fs::read_dir` 和 `std::fs::read_to_string`。
- 同一个 select loop 还处理网络 announce、Link data、pairing command 和 SSE snapshot。

风险：

- 慢文件系统、杀毒扫描、格式错误文件或陈旧注册项都可能延迟网络控制流。
- 大多数失败模式被忽略或跳过。

规则：

- 异步 service 不得在事件循环里调用 `std::fs::*`。
- 文件发现必须使用 `tokio::fs`、`spawn_blocking`，或独立 worker，将 typed event 上报给 service。
- 文件注册表错误至少必须作为 typed warning 或 degraded health state 可见。

### 4. 协议与身份错误 fail open 或直接消失

证据：

- `RetMeshNode::load_or_create_identity` 在已有 seed 无效时静默创建随机 identity。
- `announce_with_pairing_result` 使用 `serde_json::to_vec(&meta).unwrap_or_default()`。
- `PeerStore` 把无效 store 数据读成默认值，并丢弃写入失败。

风险：

- identity rotation 可能静默撤销用户的网络身份。
- 空 announce metadata 可能伪装成合法但空的 payload。
- 授权持久化可能看似成功，但数据实际没有写入。

规则：

- identity、key、token、peer store 和 pairing serialization 错误必须是 typed error。
- 无效 identity seed 必须 fail closed，并要求显式恢复。
- `unwrap_or_default` 禁止出现在 identity、authorization、transport protocol 和 persistence 代码中，除非调用方能证明空值/默认值就是预期领域状态。

### 5. HTTP route 混淆了“命令已接受”和“业务动作已完成”

证据：

- `initiate_ret_pair` 即使 `SendPairingOffer` 入队失败或后续发送失败，也会返回 PIN。
- `set_ret_interface_mode` 只要命令发送到 channel 就返回 OK，即使接口并不存在。
- `toggle_ret_announce` 对 invalid mode 返回 HTTP 200 的 JSON error。
- `pair_ret_peer` 在 HTTP handler 内最多等待 35 秒来等待协议完成。

风险：

- UI 会在网络命令失败时显示成功。
- API client 无法可靠区分 validation failure、command accepted、timeout、transport failure 和 completed state。
- 长 HTTP 等待会把协议延迟变成请求延迟。

规则：

- 改变状态的 route 必须返回 typed command result，不能只返回“channel send succeeded”。
- 如果完成过程是异步的，route 应返回 operation/session id，由 SSE 或 status route 报告进度。
- 每个 command 都必须有负路径测试，覆盖：channel closed、timeout、target missing 和 state transition rejected。
- HTTP error contract 必须一致，并使用正确的 status code。

### 6. Endpoint model 依赖 localhost 和端口算术猜测

证据：

- runtime 和 route 用 `127.0.0.1` 构造 endpoint。
- Reticulum TCP port 通过 `peer.port + 5000` 或 `peer.port - 5000` 猜测。
- Mesh peer base URL 从 Reticulum discovery port 推导，而不是来自 advertised runtime endpoint DTO。

风险：

- LAN 和多设备行为会坏掉，即使 localhost 测试通过。
- 发现事实和服务 endpoint 互相缠绕。
- 端口算术把互不相关的 listener 绑定成隐藏耦合。

规则：

- 生产网络代码不得从本地测试端口偏移推导 peer service endpoint。
- Endpoint 必须来自 discovery/provider DTO，并有明确字段，例如 runtime URL、Reticulum address、interface address 和 advertised capabilities。
- 生产网络代码里出现 `127.0.0.1`、`+ 5000`、`- 5000` 应触发审查，除非它们位于测试 fixture 或显式命名的 localhost dev adapter 中。

### 7. Snapshot 和 route payload 是无类型 JSON blob

证据：

- Runtime snapshot 用 `serde_json::json!` 组装。
- Route handler 重复构造 snapshot/status。
- 前端解析 SSE payload 时检查可选对象字段并猜测形状。

风险：

- 后端和前端可能在没有编译错误的情况下漂移。
- 测试会断言偶然 JSON 细节，而不是稳定 DTO 语义。

规则：

- SSE、route response 和 command payload 必须有 Rust DTO。
- 面向 UI 的 payload 必须有由这些 DTO 生成或手动匹配的 TypeScript 类型。
- 核心状态流不得用 `serde_json::json!` 手写，除非只位于极窄的序列化边界。

### 8. UI 组件持有协议状态机

证据：

- `src/ui/app/pages/agents/DeviceView.tsx` 中的 `ReticulumPeerSection` 同时持有 EventSource、initial fetch、pair/unpair、initiate/cancel、PIN display/input、pending offer handling、interface mode update 和 error state。
- 它静默捕获了多个网络失败。
- 它在 `error && peers.length === 0` 时直接隐藏整个 Reticulum section。
- `force=true` 的存在说明 UI 需要补偿协议取消竞态。

风险：

- UI 行为无法与后端协议行为分开单测。
- 协议竞态处理泄漏到 button handler。
- 用户失去可行动的失败信息。

规则：

- Page component 不得持有 transport/protocol state machine。
- 必须拆成：typed API client、用于 Reticulum UI state 的 React hook 或 reducer，以及纯展示组件。
- UI 可以把 SSE 作为 source of truth，但 command failure 仍必须暴露给用户，或体现在 typed operation state 中。
- control command 禁止使用静默 `.catch(() => {})`。

### 9. Interface topology 状态语义容易被误写成批量操作

证据：

- 旧原型和当前调试 UI 都容易把“全局 Off / Passive / Active”写成“全部接口 Off / Passive / Active”。
- Reticulum/ENS 实际需要表达两层状态：`global_topology` 和 `interface.topology`。
- 用户可见的有效连接能力并不等于接口配置值，而是 `min(global_topology, interface.topology)`。

风险：

- UI 可能显示某接口已经 Active，但 backend 由于 global Passive/Off 实际不能发 announce。
- command route 可能把“设置全局限制”实现成“批量改写所有接口配置”，导致用户恢复全局 Active 后丢失原本的单接口配置。
- 后续局域网发现、配对和数据同步调试会被错误状态掩盖，表现为“UI 正常但 RT 不工作”。

规则：

- `global_topology` 与 `interface.topology` 必须是两个独立字段。
- `interface.effective_topology` 必须由后端统一计算：`Off < Passive < Active`，`effective = min(global, interface)`。
- 设置 global topology 不得批量改写 interface topology。
- route 和 TS client 命名不得使用“set all interfaces topology”表达全局状态。
- UI 必须同时显示 global、interface configured、interface effective 三类状态。
- UI 禁止乐观呈现 topology；command 成功后也必须以 snapshot/SSE 为准。

### 10. Reticulum 容易被误写成 HTTP/SSE 的并列 carrier

证据：

- 早期计划容易把 Reticulum 说成“HTTP/SSE 之外的另一个 carrier”。
- 当前用户意图已经校正：Reticulum 应成为后续跨 RT 通信的唯一网络网关。
- UDP/TCP/mDNS/File/Queue 等能力应该位于 Reticulum interface 下方，而不是作为 ExoMind mesh 的平级发现/互通渠道。

风险：

- Agent 继续扩展 `/mesh` HTTP peer endpoint，会让跨 RT 通信仍然依赖局域网端口可达。
- mDNS/local registry 可能再次被提升为 ExoMind 自己的 peer discovery truth，绕过 Reticulum identity。
- RT 身份可能继续由 `host_id` 主导，导致 Reticulum identity、trust store、delivery record 互相漂移。

规则：

- 新的 RT-to-RT discovery、pairing、data sync 必须以 Reticulum gateway 为目标路径。
- HTTP/SSE 只能作为本机 UI 调试、legacy route、过渡兼容或 local-dev 辅助，不能作为长期 peer transport 扩展。
- RT 的跨设备网络身份应派生自 Reticulum identity；`host_id` 只能作为 runtime metadata。
- UDP/TCP/mDNS/File/Queue 只能通过 Reticulum interface/provider 进入 ExoMind。
- discovered peer snapshot 必须来自 Reticulum gateway projection；不能从端口、localhost、HTTP base URL 或 mDNS registry 直接拼出 peer truth。

### 11. 测试有用，但过于宽泛

证据：

- `reticulum_pair_route_authorizes_mesh_peer_after_pin_over_reticulum` 在一个大型 route test 里覆盖 discovery、pairing、authorization、persistence、revocation 和 token invalidation。
- 其他测试主要验证 mock channel 行为，而不是真实 service 行为。
- SSE 测试先 sleep 再发送，然后最多等待 5 秒拿 chunk。

风险：

- 失败难以定位。
- Agent 可能继续添加 route assertion，却没有证明 service state machine 正确。
- 基于时间的测试可能变得 flaky。

规则：

- 保留大型 route test 作为 smoke spec，但不要继续扩大它。
- 为 pairing offer、response、cancel、timeout、authorization、revocation 和 snapshot projection 抽取 service-level 测试。
- async 测试避免裸 sleep。优先使用受控 channel、paused time、barrier 或显式 readiness signal。

### 12. 活跃计划与文档偏离实现

证据：

- 有些文档仍描述 `HasMode` / `AtomicInterfaceMode` 风格实现，而代码在 ExoMind 中使用 mutex-held mode，在当前 ExoNet 中使用 `InterfaceTopology`。
- 多份已完成或已被取代的 Reticulum 文档仍留在 `docs/plans` 下。

风险：

- 后续 Agent 会把陈旧计划当作当前架构阅读。
- 漂移文档会加速坏补丁产生。

规则：

- 架构文档必须标明自己描述的是当前实现、历史原型，还是拟议迁移。
- 已完成的考古报告只有在仍被活跃使用时才可留在 plans 中；迁移后应移动或标记为 archived/superseded。
- 任何 Agent 修改 Reticulum/ENS 代码时，都必须更新 manifest 或 quality gate 中对应的状态行。

## Agent 可执行质量门槛

未来 Agent 在迁移或新增 Reticulum/ENS 代码之前，必须通过这份清单。

### 依赖与构建门槛

- [ ] 没有依赖使用 `../ExoNet-Reticulum/src` 或任何同级仓库内部源码目录。
- [ ] 选定的 ExoNet dependency path 指向 crate root 或有文档说明的 facade crate。
- [ ] `cargo check -p exomind-net-pairing` 或替代 ENS crate 的 check 能够成功启动。
- [ ] 大范围编辑开始前已记录 API drift。

建议扫描：

```powershell
rg -n "ExoNet-Reticulum/src|\\.\\./\\.\\./\\.\\./ExoNet-Reticulum/src" Cargo.toml crates
rg -n "reticulum::iface::InterfaceMode|reticulum::iface" crates
```

### 运行时服务门槛

- [ ] 没有新的 transport service 逻辑被加入 `crates/exomind-runtime/src/lib.rs`。
- [ ] 长生命周期 service 有命名 module 和 handle type。
- [ ] Command 有 typed request 和 typed result/ack variant。
- [ ] Service 暴露 shutdown 和 health state。
- [ ] 后台任务错误不只是 log；它们会变成可观察的 health 或 command error。

建议扫描：

```powershell
rg -n "tokio::spawn\\(|tokio::select!|std::fs::" crates/exomind-runtime/src
rg -n "Arc<Mutex|std::sync::Mutex" crates/exomind-runtime/src
```

### 协议与持久化门槛

- [ ] Identity seed parse failure 会 fail closed。
- [ ] Peer store 读写失败是 typed error。
- [ ] Pairing serialization error 会被传播。
- [ ] 协议 metadata 不使用静默默认序列化。

建议扫描：

```powershell
rg -n "unwrap_or_default\\(|let _ = std::fs|serde_json::to_vec" crates/exomind-net-pairing crates/exomind-runtime/src
```

### 端点门槛

- [ ] 生产 endpoint DTO 区分 runtime URL、Reticulum destination、interface address 和 discovery source。
- [ ] 生产代码不通过 `+ 5000` 或 `- 5000` 猜 port。
- [ ] `127.0.0.1` 只出现在测试、本地开发 adapter 或显式 bind default 中。
- [ ] 跨 RT 通信不以 HTTP base URL 作为主连接事实。
- [ ] UDP/TCP/mDNS/File/Queue 只作为 Reticulum interface/provider 的底层能力进入。

建议扫描：

```powershell
rg -n "127\\.0\\.0\\.1|\\+ 5000|- 5000" crates src
```

### API 与 UI 门槛

- [ ] SSE payload 使用 Rust DTO 和匹配的 TypeScript type。
- [ ] Route error 使用一致的 status code 和 response body。
- [ ] UI protocol logic 位于 hook/reducer/API client，而不是 page component。
- [ ] Control command error 会暴露出来，或记录在 typed operation state 中。
- [ ] Reticulum topology UI 不做乐观呈现；pending 期间显示旧 snapshot truth。
- [ ] 全局 topology 控制不命名为“全部接口”，也不批量改写接口配置。
- [ ] 每个接口 UI 同时展示 configured topology 和 effective topology。
- [ ] discovered peer UI 只展示 Reticulum gateway snapshot，不从 HTTP/mDNS/local registry 拼状态。

建议扫描：

```powershell
rg -n "serde_json::json!|Json<serde_json::Value>" crates/exomind-runtime/src/routes crates/exomind-runtime/src
rg -n "catch\\(\\(\\) => \\{\\}\\)|EventSource|force=true" src/ui
```

### 测试门槛

- [ ] 每个 pairing control frame 都有一个 service-level 测试：offer、response、cancel。
- [ ] 负路径测试覆盖 channel closed、timeout、target missing 和 invalid state。
- [ ] Route test 断言 API 行为，而不是 service 内部细节。
- [ ] Async test 不依赖任意 sleep，除非有明确说明。
- [ ] topology service test 覆盖 global Passive 限制 interface Active。
- [ ] topology service test 覆盖 global Off 限制所有 interface effective Off，但不改写 interface 配置。
- [ ] route/UI test 覆盖 command pending 期间不乐观显示目标 topology。

建议扫描：

```powershell
rg -n "tokio::time::sleep|Duration::from_secs\\(5\\)|PairingOffer|PairingCancel|PairingResponse" crates/exomind-runtime/tests crates/exomind-net-pairing/src
```

## 给能力较弱 Agent 的硬规则

未来 Reticulum/ENS 任务中，把这些当作硬指令使用。

1. 如果目标 crate 不能启动 `cargo check`，不要继续写代码。
2. 不要把 path dependency 修复和功能改动放进同一个 patch。
3. 不要为了新的 Reticulum 功能直接给 `AppState` 加字段；要加 service handle。
4. 不要继续给 `ret_mesh_background` 增加分支；先抽取 service。
5. 不要对 handler 和后台任务共享的 async runtime state 使用 `std::sync::Mutex`，除非有文档说明理由且不存在 await boundary 风险。
6. 不要把 file IO 放进处理 network 或 pairing event 的同一个 async loop。
7. 不要把 `mpsc::Sender::send` 成功当作业务成功。
8. 不要在旧 identity 解析失败时静默生成新 identity。
9. 不要在 protocol、identity、authorization、peer store 或 snapshot 代码中使用 `unwrap_or_default`。
10. 不要在测试之外硬编码 localhost 或从端口偏移推导 endpoint。
11. 不要用匿名 JSON 构建核心 SSE payload。
12. 不要把协议状态机放进 React page component。
13. 不要在 UI control path 中吞掉 command error。
14. 不要把 global topology 写成批量设置所有接口。
15. 不要在 UI 中乐观显示 Reticulum/ENS topology；只显示 backend snapshot/SSE 的事实。
16. 不要把 Reticulum 写成 HTTP/SSE 的并列 carrier；它是目标跨 RT gateway。
17. 不要用 `host_id` 替代 Reticulum identity 做跨设备 trust/delivery 主键。
18. 不要让 mDNS/local registry 绕过 Reticulum gateway 直接成为 peer discovery truth。
19. 当 service/unit test 能更好定位行为时，不要继续扩大型 smoke integration test。
20. 不要把拟议设计写成当前实现。必须明确标记 current/prototype/proposed。

## 历史推荐的下一步实现顺序（当前分支禁用）

以下顺序是审查旧原型分支时给出的历史迁移建议，只用于理解为什么当前分支选择 fresh adapter 路径。`codex/ens-reticulum-adapter` 已经完成 fresh branch、ENS facade、typed snapshot、Reticulum provider、四域 data-plane 自动基线等纵切，不能再把本节当作当前行动计划执行。

当前分支的权威下一步以 `docs/plans/2026-06-08-reticulum-next-agent-handoff.md` 和 `docs/development/reticulum-dual-instance-verification.md` 为准：先完成 discovery、pairing/authorization、UI snapshot truth 与双窗口人工验收闭环，再继续扩展物理联通层和四域同步体验。

1. 从当前 `dev` 创建 fresh branch，而不是从 prototype branch 创建。
2. 添加或选择一个能够针对当前 `ExoNet-Reticulum` 编译的 ENS/Reticulum facade boundary。
3. 先只迁移 DTO：peer identity、endpoint advertisement、pairing frames、pairing result announce、interface mode/topology DTO。
4. 接着迁移行为测试，把大型 route test 拆成 service tests。
5. 实现带 typed commands、typed snapshots、health 和 shutdown 的 `RetMeshService` 或 `EnsTransportService`。
6. 将 `/mesh` route integration 重建为 command submission 加 typed ack/status。
7. 通过 API client 和 hook/reducer 重建 UI；保持 SSE 为 source of truth。
8. 只有 control plane 稳定后，才恢复 data-plane sync 工作。

## 原型中应该保留什么

- Identity-first peer model。
- 作为 presence proof 的人工 PIN。
- Pairing control frames：offer、cancel、response。
- 通过 `MeshState` 授权。
- Revocation 清除 credentials，但保留可追溯状态。
- Off/passive/active connectivity semantics，并适配当前 ExoNet `InterfaceTopology`。
- SSE-driven UI truth。
- 行为测试场景，但要在正确层级重写。

## 不应该保留什么

- 直接 Reticulum 源码路径依赖。
- 当前 `ret_mesh_background` 形态。
- Fire-and-forget command routes。
- Localhost/port-offset endpoint inference。
- 作为单体页面组件的 `ReticulumPeerSection`。
- Identity、peer store 和 protocol serialization 中的 silent fallback。
- 把漂移的 active plans 当作 architecture truth。

## 审查结论

原型分支应该作为已审计资产来源保留，而不是作为 merge base。

下一个生产分支应该迁移行为，而不是迁移代码形状。如果后续 Agent 说不清楚哪个 service 拥有状态、哪个 DTO 穿过边界、哪个 route 报告 ack/status、哪个测试证明失败路径，它就应该在继续写 Reticulum 代码之前停下来。
