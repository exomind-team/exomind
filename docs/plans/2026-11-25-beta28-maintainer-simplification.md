# β28 代码简化提案 · 接手成本与复核方法

**状态为待用户审阅。** 2026-11-25 的走查基线是 `dev-0.6@4a241ceb`。首先沿一条真实提交理解 [草稿控制器](../../src/beta/drafts.ts)、[Native 入口](../../src-tauri/src/beta_native.rs)、[Host 资格检查](../../crates/exomind-beta-host/src/lib.rs)与[Core 事务](../../crates/exomind-core/src/store.rs)。β27 继续交付日用改动。β28 Agent 应以接手时的实际提交和工作树复查本提案，再将具体变更提交用户审阅。[产品迭代边界](2026-11-25-beta-iteration-after-user-review.md) · [回归门禁](../development/beta-iteration-guards.md)

## 接手时先做的判断

入口引导已归入[快速上手](../development/quickstart.md)、[版本状态](../AI-CONTEXT.md)和[架构导览](../architecture/README.md)。新人可先用开发态内存档案观察操作，再用独立 Host 的固定命令核对保存结果。各代可执行入口和兼容域都有单独用户。是否移动目录、撤下接口或更名协议字段，应沿真实调用链与公开契约决定。

| 顺序与责任范围 | 走查证据及拟议改变 | 给用户审阅的行为判据与回退边界 |
|---|---|---|
| 1 · 草稿／阅读／输入（优先从真实预发送场景验证） | 基线 `ProfileWorkspace` 跨 668 行，含 25 个 `useState` 和 23 个 `useRef`。其中阅读窗口、导出选区、焦点与附件预发送有不同所有者。`BetaDraftController` 已冻结稳定命令且持草稿 revision。建议 UI 持焦点/IME/选区，控制器给出可排队、可取消、已尝试提交、待查回执等动作。按钮、快捷键和状态文字共用该结果。分清 `timelinePeriod` 与 `selectionMode`。通用 `errorMessage` 有 13 个生产源文件从草稿模块导入，可在带来真实依赖缩减时移至错误模块。[页面装配](../../src/beta/BetaApp.tsx) · [草稿实现](../../src/beta/drafts.ts) | 慢附件期间在原稿补字、用户移开焦点、切档、回执迟到。输入与附件可恢复，旧命令至多提交一次，键盘/触摸共用相同业务判定。沿用[预发送行为测试](../../tests/unit/beta/original-composer.test.tsx)，再用实体 IME 与已交付 β27 对照。若所有权仍需在两处维护，缩回切片。 |
| 2 · Host 的多连接与实际拨号 | 持久 `PeerConnection`、按 `(profile, device)` 保存的 `Route`、UI 的 `PeerConnectionView` 回答三个问题。B1a 先保存连接配置，worker 仍消耗旧路由。建议内部名称区分保存的策略、拨号路径与设备状态。选路先做观察对照，再决定实际唯一入口。基线 `peers/network.rs` 3,320 行，独立的扫描范围计算或报文编解码可先移出，worker 保有停止、取消和清理责任。[连接存储](../../crates/exomind-beta-host/src/peers/connection_store.rs) · [选路](../../crates/exomind-beta-host/src/peers/network.rs) · [B1a 现状](2026-11-22-beta26-b1a-connection-store.md) | 两条可用路线中停用一条，分别观测事件与原件的实际拨号。验证同一身份、成员代次与目标 ACK，手机退出后由另一 RT 补给第三端。保持现有 TLS、成员和来源资格检查。旧路与新策略选择不同，先报告原因并保留旧入口。[网络回归](../../crates/exomind-beta-host/src/peers/network_tests.rs) · [复制合同](../development/beta-multiorigin-sync.md) |
| 3 · 可用能力及其宿主差异 | 基线 `BetaClient` 22 个成员中 16 个可选，页面同时读取方法、`serviceScope` 和 `capabilities` 判断可用性。先用一个能力做试点，例如时段时间线。装配端明确可用的读取方式和缺失原因，页面消费结果，Host 执行每次操作时复查资格。[客户端](../../src/beta/client.ts) · [实际页面](../../src/beta/BetaApp.tsx) | 在 Native、Web、旧服务缺能力、内存 mock 上比对相同用户动作。支持、缺能力、无授权、读失败维持可辨。若消费者仍须推断适配器形状，重新界定接口。 |
| 4 · 旧接口和 DTO | 基线可检索源码中 `ISyncPort`、`ICryptoPort` 的类型名只出现在声明处。旧同步 store 仍消费同一文件中的类型。建议先分清仍用的 DTO、旧入口的兼容错误与潜在对外导出，再提请移动或撤下多余声明。[旧同步接口](../../src/environment/interfaces/sync.port.ts) · [旧加密接口](../../src/environment/interfaces/crypto.port.ts) · [旧调用者](../../src/ui/stores/sync-store.ts) | 核对导出、下游包和测试，保持旧数据与旧版调用者行为。以能够完成同一作用域操作的内存与持久档案来设计 β28 存储接缝。存在未核实的外部调用者时先给兼容路径。 |
| 5 · 浮窗责任、命名与测试夹具 | `MainOverlayBridge` 负责应用偏好和观察，`ui_owner_generation` 由 Native 生成，`nativeMainOverlayPort` 属于历史传输测试。建议以 `workspaceGeneration` 等体现负责方的内部名承接原 wire 字段，核实历史接口的最后消费者后归入夹具。[主窗客户端](../../src/beta/overlay/MainOverlayBridge.tsx) · [协议](../../src/beta/overlay/protocol.ts) · [历史适配入口](../../src/beta/overlay/native-port.ts) | 主窗卸载/切档后浮窗仍可操作自己的档案，旧消息仍被正确解码或拒绝。保留[主窗行为测试](../../tests/unit/beta/main-workspace-client.test.tsx)。快捷退出测试中按函数名出现次数作出的断言，可提议替换为真实初始化次数和关闭路径的断言，保留必要的原生接线门禁。[测试位置](../../tests/unit/beta/quick-exit-integration.test.tsx) |

## β28 Agent 提审交付

1. 记录复核 SHA、影响的调用者与真实用户动作。先划去 β27 已交付的改动，再列仍有重复判断或兼容负担的位置。
2. 每次只选一个有收益的切片，列出变更前后谁写入、谁结算、谁恢复，给出兼容策略、数据和 wire 影响、可回退位置以及对应回归。
3. 让接手工程师完成三个任务：运行合成档案并指出数据源，解释改稿后旧附件的结算路径，找出证明禁用路线行为的测试或明确证据缺口。记录走错的入口和需要原作者补充的问题，作为本轮收益度量。
4. 将复核结果、建议顺序和需要裁定的行为变化交给用户。取得对应批准后实施获批切片，分别记录源码、精确构建、真实设备及人审结果。
