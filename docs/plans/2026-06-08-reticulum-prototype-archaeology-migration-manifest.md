# Reticulum 原型考古迁移清单

> 日期：2026-06-08
> 工作树：`H:\A137442\Develop\AGI\exomind-reticulum`
> 分支：`feat/ret-mesh-prototype-review`
> 来源提交：`430beb113412f9599bb514bef8e98ea9c74aaeaa`

## 目的

本文记录旧 Reticulum 原型分支已经完成了什么、哪些内容应该迁移到下一个 ENS 集成分支、哪些内容应该作为原型脚手架留在原地。

目标不是丢弃 `feat/ret-mesh-prototype`。目标是把它从一个陈旧的 merge candidate，转化成经过审计的设计与实现资产来源。

配套质量审查：

- `docs/plans/2026-06-08-reticulum-code-quality-audit-and-agent-rules.md`

## 基线事实

- 审查 worktree 基于 `origin/feat/ret-mesh-prototype` 创建。
- 与当前 `origin/dev` 的 merge base：`6ae5448bdbf83bca73f2ac0963a406028b1588c4`。
- 考古时的分叉规模：`origin/dev...HEAD = 85 79`。
- 相对当前 `origin/dev` 的 diff 规模：52 个文件，约 8005 行新增、42 行删除。
- 初始审查 worktree 在 checkout 后是干净的。
- 创建时最初需要 `git -c core.symlinks=false worktree add ...`，因为当时 Windows session 无法创建 `.claude` / `.codex` 符号链接。
- 符号链接问题之后已通过启用 Git symlink 支持和修正本地权限解决。`.claude/agents`、`.claude/skills`、`.codex/agents`、`.codex/skills` 现在都能解析为符号链接。
- 当前考古输出在 `docs/plans/` 下新增两份未跟踪审查文档。

窄验证尝试：

```text
cargo check -p exomind-net-pairing
```

当前结果：尚未进入编译阶段就失败，因为 `crates/exomind-net-pairing/Cargo.toml` 依赖：

```toml
reticulum = { path = "../../../ExoNet-Reticulum/src" }
```

但当前 ExoNet-Reticulum 的 crate 根路径是：

```text
H:\A137442\Develop\AGI\ExoNet-Reticulum\Cargo.toml
```

并且 `H:\A137442\Develop\AGI\ExoNet-Reticulum\src\Cargo.toml` 已不存在。

结论：旧分支在不至少更新 dependency path/facade 的情况下，无法针对当前 ExoNet-Reticulum 布局构建。

## 分支地层

### 地层 1：Reticulum 传输证明

代表提交：

- `3cac03e7 feat(net-pairing): Reticulum-based device discovery + pairing Phase 1`
- `bcfda260 feat(net-pairing): 完整集成到 RT 启动流程`
- `d05d086d feat(net-pairing): 加入 Announce 接收循环 + HTTP 路由`
- `5751182a feat(net-pairing): 添加 TCP Interface 到 Reticulum Transport`

资产：

- `crates/exomind-net-pairing`
- `RetMeshNode`
- Reticulum identity seed load/create/persist helpers
- Reticulum announce data model
- TCP/UDP/JSONL interface attachment helpers

状态：

- 作为 transport proof 有价值。
- 还不能作为生产 API 使用，因为它直接依赖 Reticulum 内部和同级 path dependency。

### 地层 2：发现与物理连通性

代表提交：

- `87ba43bc feat(net-pairing): mDNS 自动发现引导 Reticulum 组网`
- `17ad9dbd feat(net-pairing): mDNS-Reticulum 桥接`
- `c02ddb4a fix(reticulum): Windows UDP SO_REUSEADDR + 统一广播地址`
- `d676874c feat(net-pairing): 本地文件注册表`
- `fc20a4b9 fix: 文件注册表残留导致单向发现`

资产：

- mDNS `ret_port` bridge idea
- local multi-instance registry idea
- Windows UDP and broadcast experience
- port-aware deduplication

状态：

- 作为 local/dev discovery 现场经验有价值。
- 不应成为主 ENS abstraction。
- 生产边界应是 ENS discovery/provider APIs，mDNS/local registry 只作为可选 discovery provider。

### 地层 3：身份与授权模型

代表提交：

- `41f023b0 feat(net-pairing): 三层配对状态模型落地`
- `5e10d478 feat(net-pairing): authorize Reticulum peers from device view`
- `0a9fd020 feat(net-pairing): expose Reticulum peer authorization state`
- `d8cecca7 fix: PairingOffer initiator_peer_id 错误 + 撤销授权 trust_state 复位`

资产：

- `identity_hex` 作为稳定 Reticulum/ENS peer identity
- `host_id` metadata 与 network identity 分离
- `connected_unauthorized` 与 `connected_authorized`
- `MeshState` authorization 作为业务 trust boundary
- revoke authorization 会清除 `auth_token` / `inbound_secret`

状态：

- 这是最应该保留的部分之一。
- 它应该迁移进当前 `MeshState` / runtime mesh model，而不是保留成独立的 Reticulum-only UI state island。

### 地层 4：InterfaceMode 与连接控制

代表提交：

- `8357f3a7 feat(ret-mesh): 三态连接模式`
- `28d5250a feat(ret-mesh): InterfaceManager 接口枚举 API + 动态 UDP 端口`
- `f10317b9 fix(ret-mesh): S3 接口三态重做`
- `5f7b8a2f refactor(ret-mesh): 三态定义下沉到 reticulum-rs`
- `1bb6b843 refactor(ret-mesh): ret_mesh_mode 统一用 InterfaceMode enum`
- `6193ffbb docs: ADR-005 InterfaceMode + ADR-006 SSE-driven UI`

资产：

- `Off / Passive / Active`
- 通过 `min(global, interface)` 组合 global mode 和 per-interface mode
- mode filtering，而不是移除/重建 interface
- runtime snapshot 中的 interface list

状态：

- 保留这个模型。
- enum 应属于 ExoNet-Reticulum 或 ENS facade，而不是 ExoMind UI layer。
- ExoMind 应通过稳定 adapter DTO 消费它。

### 地层 5：PIN-over-Reticulum 配对状态机

代表提交：

- `4a12cd6b wip(net-pairing): PIN-over-Reticulum 配对闭环`
- `9843a61e feat(ret-mesh): initiate-pair 端点 + SSE snapshot peers 字段`
- `d432fe1f feat(ret-mesh): Plan 1 Batch 1-3 全量实现`
- `51a1a104 feat(ui): PIN 输入框回车确认`
- `588ae363 feat(ui): 「授权」时主动检查对端是否已发起配对`
- `b4d6f9a6 feat: PairingCancel 帧`
- `b58174ff fix: 反复授权/取消导致双边都展示 PIN`
- `62ceab56 fix: 两边同时授权时的竞态`
- `2a24a84c fix: 配对失败显示具体错误原因`

资产：

- `RetPairingLinkFrame::PairingOffer`
- `RetPairingLinkFrame::PairingCancel`
- `RetPairingLinkFrame::PairingResponse`
- remote `pairing_pending` state
- dual-initiation race handling
- explicit error body for pairing failures
- PIN session generation、pair、unpair、token persistence、token invalidation 相关测试

状态：

- 很有价值。
- 应作为 control-plane protocol 迁移。
- Route 名称和 UI 实现可以改变，但 state machine 不应被丢弃。

### 地层 6：SSE 驱动 UI

代表提交：

- `d59be8ce fix(ret-mesh): 三态开关点击后立即推送 SSE snapshot 刷新状态`
- `6193ffbb docs: ADR-006 SSE-driven UI`
- `6d4569cc feat(ui): Reticulum 网络 6 态状态机`
- `06bcd7b5 fix(ui): 精简 Reticulum 5 态状态机`
- `552ff4b5 fix(ui): 接口三态指示灯灰→蓝→绿`

资产：

- backend snapshot 是 source of truth
- UI 不乐观编造 Reticulum state
- 操作路径：POST command，backend apply，SSE snapshot 更新 UI

状态：

- 保留这个原则。
- 不要把旧 `ReticulumPeerSection` 整体迁入当前 `DeviceView`。
- 应基于当前 `RuntimeMeshHostSyncService` / peer pairing UI 边界重建。

### 地层 7：数据面迁移计划

代表文档：

- `docs/plans/2026-05-25-reticulum-authorized-sync-migration-plan.md`
- `docs/architecture/physical-connectivity-layer.md`

资产：

- 业务事实仍然保留在 RT SQLite
- domain projectors/reconciliation 保持在 transport 之上
- HTTP/SSE 应成为 transport adapter，而不是 mesh 的定义
- Reticulum/ENS 应承载 live replication、pull、response 和 acknowledgement frames
- 第一个候选 domain：EventLog 或 Task

状态：

- 已规划，未实现。
- 这是主要未完成区域。

## 迁移分类

### 高置信迁移

1. 以身份为先的 peer model：
   - `identity_hex` 作为 peer id
   - `host_id` 作为 metadata
   - fail-closed authorization merge

2. 配对控制协议：
   - `PairingOffer`
   - `PairingCancel`
   - `PairingResponse`
   - pairing pending state
   - 明确的 timeout/rejection/transport error categories

3. 授权语义：
   - PIN/session 保持为 human presence proof
   - `MeshState` 保持为 authorization persistence
   - revoke 清除 local credentials 并移除 business access

4. 接口模式模型：
   - `Off / Passive / Active`
   - `min(global, interface)`
   - mode filtering，而不是破坏性的 remove/add

5. SSE 驱动状态更新规则：
   - command routes 不定义 UI truth
   - backend snapshot 定义 UI truth

6. 测试作为行为规格：
   - pair 会授权 identity-keyed peer
   - unpair 会撤销 token
   - stale inbound token 会停止认证
   - initiate 会创建新的 PIN/session
   - SSE stream 会发出 snapshot

### 迁移前重写

1. `crates/exomind-net-pairing`
   - 重命名/重塑为 ENS adapter crate。
   - 用稳定 ExoNet-Reticulum facade 替换对 Reticulum internals 的直接依赖。
   - 保留 protocol DTOs，不保留当前 transport coupling。

2. `ret_mesh_background`
   - 从 `crates/exomind-runtime/src/lib.rs` 中抽取。
   - 转换成有明确 inputs/outputs 的 runtime service。
   - 避免在 runtime startup 中嵌入大型 select loop。

3. `/mesh/ret/*` routes
   - 保留行为作为测试。
   - 不要把 route namespace 作为长期产品 API。
   - 优先保留当前 `/mesh/*` compatibility，并在需要时增加 `/mesh/transports/ens/*` debug/status。

4. `ReticulumPeerSection`
   - 保留交互经验。
   - 基于当前 DeviceView 和 pairing dialog architecture 重建。

5. 发现桥接
   - 保留 mDNS/local registry 作为 provider implementations。
   - 不要把 mDNS/local file registry 作为 ENS abstraction。

### 不迁移

1. 旧分支的 `Cargo.lock`。
2. 直接 dependency path `../../../ExoNet-Reticulum/src`。
3. `.codegraph` artifacts。
4. PR preview 或临时 audit reports 作为 source changes。
5. Reticulum-specific UI settings 作为主产品入口。
6. 任何让 Reticulum 绕过 `SignalPool`、RT SQLite、domain projectors 或 scope authorization 的路径。

## 推荐的下一步考古动作

创建 fresh implementation branch 之前，在这个 review worktree 中再做一个本地考古 patch：

1. 把 `reticulum = { path = "../../../ExoNet-Reticulum/src" }` 改到当前 crate root path。
2. 运行 `cargo check -p exomind-net-pairing`。
3. 把下一批 compilation breakages 记录成 API drift list。
4. 不要试图在原地修完所有 breakages。用这份清单定义 ExoMind 需要的 ENS facade。

预期结果：

- 如果 breakages 较浅，一部分代码可以机械迁移。
- 如果 breakages 很深，先迁移 protocol DTOs 和 tests，再基于当前 ExoNet facade 重建 adapter。

## 考古后的拟议实现分支

从最新 `origin/dev` 创建，而不是从这个 review branch 创建：

```text
feat/ens-transport-adapter
```

初始实现顺序：

1. 添加 ENS adapter boundary 和 DTOs。
2. 移植 pairing frames 和 identity-keyed peer state tests。
3. 先实现 discovery provider stub/fake。
4. 添加真实 ExoNet-Reticulum facade dependency。
5. 接入 runtime mesh，但不改变 domain replication。
6. 后端状态稳定后再重建 UI states。

## 当前判断

旧分支比一次可丢弃原型推进得更远。它完成了：

- discovery proof
- runtime startup integration
- identity persistence
- Reticulum peer state projection
- PIN-over-Link control frames
- 通过 `MeshState` 的 authorization and revocation
- SSE-driven UI state
- 有意义的 route tests

它没有完成：

- stable ENS facade
- current ExoNet-Reticulum compatibility
- clean runtime service extraction
- real business replication 的 data-plane transport
- current `origin/dev` integration

因此，该分支应作为经过审计的原型资产来源被保存；生产分支则应基于当前 `dev` 重建，并使用本清单作为迁移地图。
