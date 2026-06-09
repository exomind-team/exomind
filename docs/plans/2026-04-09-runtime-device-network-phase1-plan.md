# Runtime Device Network Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `/topology` 升级成面向 `RuntimeHost / Device / DeviceComponent / DeviceLink` 的向后兼容基础契约，并让 TypeScript / Rust / UI 在不改持久化模型的前提下完成第一轮统一收口。

**Architecture:** Phase 1 采用 additive contract（增量契约）策略。Rust `/topology` 同时输出 legacy flat fields（旧扁平字段）与 nested foundation fields（新嵌套基础字段）；TypeScript client 采用 dual-read parser（双读解析器）并回填旧字段；UI 与 manager 改为通过 selector helper（选择器辅助函数）读取 live topology，避免未来继续散落读取 `host_id / capabilities / hostname`。

**Tech Stack:** Rust `axum` / `serde`, TypeScript, React 18, Vitest, Cargo test

---

## Scope And Non-Goals（范围与非目标）

- 范围内：
  - `/topology` 增加 `runtime_host / device / device_components / device_links`
  - TS 类型与解析器支持 nested-only、flat-only、mixed payload
  - `RuntimeManager` 与设备页相关 UI 改为 selector 取值
  - 最小测试闭环：TS 单测 + Rust 集成测试 + UI 单测
- 不做：
  - `RuntimeHostRecord` 持久化结构迁移
  - `device_id` 独立持久化
  - 真实 `device_components / device_links` 枚举
  - 双图成品视图（`Device Network View / Signal Topology View`）

## Task Breakdown（任务拆分）

### Task 1: Topology Contract And Client Parser（拓扑契约与客户端解析器）

**Files:**
- Modify: `src/lib/types/runtime-topology.ts`
- Modify: `src/services/runtime-client.ts`
- Test: `tests/unit/services/runtime-client.issue201.test.ts`

**Step 1: Write the failing tests**

- 在 `tests/unit/services/runtime-client.issue201.test.ts` 新增：
  - `parses nested runtime_host/device contract and backfills legacy fields`
  - `accepts empty device_components/device_links arrays`
- 断言重点：
  - nested-only `/topology` payload 能被解析
  - `result.data.runtime_host.host_id` 存在
  - `result.data.host_id` / `result.data.capabilities` 被 client 回填
  - 空数组不触发 `invalid_payload`

**Step 2: Run test to verify it fails**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-client.issue201.test.ts
```

Expected:
- 新增测试失败
- 失败原因是当前 parser 只接受 legacy flat payload

**Step 3: Write minimal implementation**

- 在 `src/lib/types/runtime-topology.ts`：
  - 增加 `RuntimeTopologyRuntimeHost`
  - 增加 `RuntimeTopologyDevice`
  - 增加 `RuntimeTopologyDeviceComponent`
  - 增加 `RuntimeTopologyDeviceLink`
  - 扩展 `RuntimeTopologyResponse`
  - 增加 selector helpers：
    - `resolveTopologyHostId(topology)`
    - `resolveTopologyCapabilities(topology)`
    - `resolveTopologyDevice(topology)`
    - `resolveTopologyHostname(topology)` 可选，若能减少 UI 分支可一并加
- 在 `src/services/runtime-client.ts`：
  - 新增 nested parser
  - 支持 flat-only / nested-only / mixed payload
  - 若只有 nested，则回填 legacy flat fields
  - 保持 wire format 与现有调用兼容

**Step 4: Run test to verify it passes**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-client.issue201.test.ts
```

Expected:
- `runtime-client.issue201.test.ts` 全绿

**Step 5: Review checkpoint**

- 自查：
  - 是否没有修改 `RuntimeHostRecord`
  - 是否没有把未来信息硬编码进 `device_components / device_links`
  - selector 是否只依赖 live topology

### Task 2: Manager Selector Adoption And Rust Topology Route（Manager 收口与 Rust 路由）

**Files:**
- Modify: `src/services/runtime-manager.ts`
- Modify: `tests/unit/services/runtime-manager.issue201.test.ts`
- Modify: `tests/unit/services/runtime-manager.issue385.test.ts`
- Modify: `crates/exomind-runtime/src/routes/topology.rs`
- Modify: `crates/exomind-runtime/tests/mesh_routes_integration.rs`

**Step 1: Write the failing tests**

- 在 `tests/unit/services/runtime-manager.issue201.test.ts` 新增：
  - `persists hostId from topology.runtime_host.host_id when flat host_id is absent`
- 在 `tests/unit/services/runtime-manager.issue385.test.ts` 新增：
  - `keeps capabilities from topology.runtime_host.capabilities`
- 在 `crates/exomind-runtime/tests/mesh_routes_integration.rs` 新增：
  - `topology_exposes_runtime_host_and_device_contract`
  - 断言 legacy flat fields 仍存在
  - 断言 `runtime_host`、`device`、空数组 `device_components / device_links` 存在

**Step 2: Run tests to verify they fail**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-manager.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts
cargo test -p exomind-runtime --test mesh_routes_integration
```

Expected:
- JS 测试因为 manager 仍直接读 `topology.host_id / topology.capabilities` 而失败
- Rust 测试因为 `/topology` 还没输出 nested foundation contract 而失败

**Step 3: Write minimal implementation**

- 在 `src/services/runtime-manager.ts`：
  - `persistSuccessfulDialMetadata()` 改用 selector 读取 live host id
  - 仅持久化 `hostId + lastSuccessfulDialAddress`
- 在 `crates/exomind-runtime/src/routes/topology.rs`：
  - 新增 `runtime_host`
  - 新增 `device`
  - 新增 `device_components: []`
  - 新增 `device_links: []`
  - `device.id` Phase 1 临时 alias 到 `host_id`
  - 保留现有 flat fields，不删

**Step 4: Run tests to verify they pass**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-manager.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts
cargo test -p exomind-runtime --test mesh_routes_integration
```

Expected:
- manager 相关单测通过
- Rust topology contract 测试通过

**Step 5: Review checkpoint**

- 确认没有把 `Device / DeviceComponent / DeviceLink` 写回 host persistence
- 确认 Rust payload 仍兼容旧前端 mock

### Task 3: UI Selector Adoption And Device Semantics（UI 收口与设备语义）

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/agents-utils.ts`
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx`
- Test: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts`

**Step 1: Write the failing tests**

- 在 `tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx` 增加 nested topology fixture：
  - create-flow capability gate 改用 `runtime_host.capabilities`
- 在 `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx` 增加断言：
  - 设备页本机 / peer 显示优先读取 `topology.device.name`
  - 手动验证、自动 adopt 仍优先使用 live host id
- 在 `tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts` 如有必要补：
  - `resolveRuntimeSnapshotPeerId()` 从 nested runtime host 回退

**Step 2: Run tests to verify they fail**

Run:

```powershell
bun x vitest run tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts
```

Expected:
- 新增 nested fixture 失败
- 失败原因是 UI 还在直接读 legacy flat fields

**Step 3: Write minimal implementation**

- 在 `AgentsPage.tsx`：
  - capability gate 改用 topology selectors
  - live host id 读取改用 selector
- 在 `agents-utils.ts`：
  - `resolveRuntimeSnapshotPeerId()` 改用 selector
- 在 `DeviceView.tsx`：
  - 设备名称优先 `topology.device.name`
  - host id / hostname / capabilities 只通过 selector 或 fallback helper 读取

**Step 4: Run tests to verify they pass**

Run:

```powershell
bun x vitest run tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts
```

Expected:
- 三个 UI / helper 测试入口全绿

**Step 5: Review checkpoint**

- 确认 UI 没有新增复杂视图，只是语义收口
- 确认所有 selector fallback 路径可覆盖旧 mock

### Task 4: Integrated Verification, Review, And Ship（集成验收、评审与交付）

**Files:**
- Modify: `docs/plans/2026-04-09-runtime-device-network-phase1-plan.md`（只更新状态或记录，如有必要）
- Optional Modify: `docs/verification/*`（如需记录）

**Step 1: Run targeted integration verification**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts
cargo test -p exomind-runtime --test mesh_routes_integration
```

Expected:
- Phase 1 目标测试全绿

**Step 2: Run baseline regression set**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-aggregator.service.test.ts tests/unit/services/agent-hub.service.issue204.test.ts
```

Expected:
- 现有基线 5 files / 54 tests 继续通过

**Step 3: Code review gates**

- 规格符合性评审（spec compliance review）：
  - 是否只实现了 Phase 1
  - 是否保持 additive compatibility
- 代码质量评审（code quality review）：
  - selector 是否集中
  - fallback 是否清晰
  - 是否避免把 live topology 混入持久化 host record

**Step 4: Commit and push**

Run:

```powershell
git add docs/plans/2026-04-09-runtime-device-network-phase1-plan.md src/lib/types/runtime-topology.ts src/services/runtime-client.ts src/services/runtime-manager.ts src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/agents/agents-utils.ts src/ui/app/pages/agents/DeviceView.tsx tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-manager.issue201.test.ts tests/unit/services/runtime-manager.issue385.test.ts tests/unit/ui/agent-hub/agents-page.create-flow.issue385.test.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/agent-hub/agents-utils.pty-spawn-target.test.ts crates/exomind-runtime/src/routes/topology.rs crates/exomind-runtime/tests/mesh_routes_integration.rs
git commit -m "feat: add runtime device foundation contract phase1"
git push origin feat/runtime-device-network:dev
```

Expected:
- 本地提交成功
- 变更同步到远端 `dev`

## Acceptance Checklist（验收清单）

- [ ] `/topology` 同时暴露 legacy flat fields 与 nested foundation fields
- [ ] TypeScript client 支持 nested-only payload
- [ ] manager 通过 selector 读取 live host id / capabilities
- [ ] UI 不再散落直接依赖 legacy topology fields
- [ ] `RuntimeHostRecord` 未被扩成 live topology 容器
- [ ] targeted TS + Rust tests 全绿
- [ ] baseline regression tests 全绿

## Delegation Plan（子代理分工）

- Explorer / Reviewer A：契约与 Rust route review
- Explorer / Reviewer B：UI selector adoption review
- Implementer 1：Task 1
- Implementer 2：Task 2
- Implementer 3：Task 3

## Notes（备注）

- `device.id` 在 Phase 1 仅临时 alias 到 `host_id`，后续如支持“一台设备多个 runtime host”再独立建模。
- `device_components / device_links` Phase 1 固定返回空数组，禁止伪造数据。
- 若第二个 explorer 返回更细的 UI 风险点，只允许补充到 Task 3，不扩大 Phase 1 范围。
