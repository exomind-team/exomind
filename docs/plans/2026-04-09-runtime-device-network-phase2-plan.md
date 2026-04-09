# Runtime Device Network Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Runtime 具备独立 `device_id`、返回最小真实设备图，并让前端从统一底层数据中同时提供 `Device Network View（设备网络视图）` 和 `Signal Topology View（信号拓扑视图）`。

**Architecture:** 后端在 `config.sqlite` 中新增 `device_id` 持久化键，并把 `/topology` 从“壳对象”升级为“最小真实设备图”；前端不新建独立设备存储，而是在 `RuntimeHostRecord + RuntimeHostSnapshot` 基础上派生 `RuntimeDeviceSnapshot`。UI 只做语义收口与数据切换，不重做整页结构。

**Tech Stack:** Rust `axum` / `serde`, TypeScript, React 18, Vitest, Playwright

---

### Task 1: 设计文档与计划落盘

**Files:**
- Create: `docs/plans/2026-04-09-runtime-device-network-phase2-design.md`
- Create: `docs/plans/2026-04-09-runtime-device-network-phase2-plan.md`

- [ ] **Step 1: 写入 Phase 2 设计说明**

说明内容必须包含：

```md
- device_id 独立于 host_id
- device_components / device_links 返回最小真实枚举
- RuntimeManager 派生 device snapshots
- UI 收口为“设备网络 / 信号拓扑”
```

- [ ] **Step 2: 写入 Phase 2 实施计划**

计划需明确三块任务：

```md
- 后端 device identity
- 设备图与前端聚合
- UI 双视图与验收
```

- [ ] **Step 3: 自查**

Run:

```powershell
rg -n "device_id|设备网络|信号拓扑|RuntimeDeviceSnapshot" "D:\project\exomind\.worktrees\runtime-device-network\docs\plans\2026-04-09-runtime-device-network-phase2-*.md"
```

Expected:
- 文档包含核心关键词

### Task 2: 后端 `device_id` 独立持久化

**Files:**
- Modify: `crates/exomind-runtime/src/lib.rs`
- Test: `crates/exomind-runtime/src/lib.rs`

- [ ] **Step 1: 先写失败测试**

新增测试目标：

```rust
#[test]
fn persisted_runtime_device_id_reuses_device_scope_config_entry() {
    // 连续两次读取，device_id 必须一致
}

#[test]
fn persisted_runtime_device_id_is_distinct_from_host_id() {
    // 同一 config.sqlite 下 host_id / device_id 都稳定，但不相等
}
```

- [ ] **Step 2: 跑 Rust 定向测试确认失败**

Run:

```powershell
cargo test -p exomind-runtime persisted_runtime_device_id -- --nocapture
```

Expected:
- 新增测试失败

- [ ] **Step 3: 实现最小持久化逻辑**

实现点：

```rust
const RUNTIME_DEVICE_ID_CONFIG_KEY: &str = "exomind:deviceId";

pub fn configured_device_id_from_env() -> String { /* mirror host_id path */ }
fn load_or_create_persisted_runtime_identity(path: &Path, key: &str, prefix: &str) -> Option<String> { /* shared helper */ }
```

要求：

```rust
- host_id 继续使用 exomind:runtimeHostId
- device_id 使用 exomind:deviceId
- 默认生成前缀可区分，如 rt- / dev-
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```powershell
cargo test -p exomind-runtime persisted_runtime_device_id -- --nocapture
```

Expected:
- 两个 device_id 相关测试通过

### Task 3: `/topology` 输出最小真实设备图

**Files:**
- Modify: `crates/exomind-runtime/src/routes/topology.rs`
- Modify: `crates/exomind-runtime/tests/mesh_routes_integration.rs`

- [ ] **Step 1: 先写失败测试**

补充断言：

```rust
assert_ne!(payload["device"]["id"], payload["host_id"]);
assert!(payload["device_components"].as_array().unwrap().len() >= 1);
assert!(payload["device_links"].as_array().unwrap().len() >= 1);
assert_eq!(payload["device"]["primary_runtime_host_id"], payload["host_id"]);
```

- [ ] **Step 2: 跑 `/topology` 集成测试确认失败**

Run:

```powershell
cargo test -p exomind-runtime --test mesh_routes_integration topology_ -- --nocapture
```

Expected:
- `device.id` 仍等于 `host_id`
- component/link 数组仍为空

- [ ] **Step 3: 实现最小真实设备图**

实现点：

```rust
pub struct DeviceComponentResponse { /* 保持已有结构 */ }
pub struct DeviceLinkResponse { /* 保持已有结构 */ }

let device_id = configured_device_id_from_env();
let runtime_host_component_id = format!("{device_id}:runtime-host");
```

返回内容至少包含：

```rust
device.id = device_id
device.primary_runtime_host_id = state.host_id.clone()

device_components = vec![DeviceComponentResponse {
    id: runtime_host_component_id.clone(),
    device_id: device_id.clone(),
    kind: "runtime_host".to_string(),
    name: "Runtime Host".to_string(),
    status: "online".to_string(),
    protocol: Some("exomind-runtime".to_string()),
    runtime_host_id: Some(state.host_id.clone()),
}]

device_links = vec![DeviceLinkResponse {
    id: format!("{device_id}:owns:runtime-host"),
    source_kind: "device".to_string(),
    source_id: device_id.clone(),
    target_kind: "device_component".to_string(),
    target_id: runtime_host_component_id,
    transport: "ownership".to_string(),
    status: "online".to_string(),
    latency_ms: None,
}]
```

- [ ] **Step 4: 跑 Rust 测试确认通过**

Run:

```powershell
cargo test -p exomind-runtime --test mesh_routes_integration topology_ -- --nocapture
```

Expected:
- `/topology` 相关测试通过

### Task 4: 前端 `deviceId` 持久化与 device snapshots 派生

**Files:**
- Modify: `src/lib/types/agent-hub-runtime.ts`
- Modify: `src/lib/services/runtime-host.service.ts`
- Modify: `src/services/runtime-manager.ts`
- Test: `tests/unit/services/runtime-host.service.issue205.test.ts`
- Test: `tests/unit/services/runtime-manager.issue201.test.ts`

- [ ] **Step 1: 写失败测试**

新增测试目标：

```ts
it('persists deviceId across host service instances', async () => { /* service */ })
it('derives runtime device snapshots from host topology', async () => { /* manager */ })
```

关键断言：

```ts
expect(hosts[0]?.deviceId).toBe('device-123')
expect(snapshot.devices[0]?.id).toBe('device-123')
expect(snapshot.devices[0]?.runtimeHosts).toHaveLength(1)
expect(snapshot.devices[0]?.components).toHaveLength(1)
```

- [ ] **Step 2: 跑 TS 定向测试确认失败**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-manager.issue201.test.ts
```

Expected:
- `deviceId` 尚未持久化
- `RuntimeManagerSnapshot` 尚无 `devices`

- [ ] **Step 3: 实现最小前端模型**

需要改动：

```ts
interface RuntimeHostRecord {
  deviceId?: string;
}

interface RuntimeDeviceSnapshot {
  id: string;
  name: string;
  kind: RuntimeTopologyDeviceKind;
  primaryHostId?: string;
  runtimeHosts: RuntimeHostSnapshot[];
  components: RuntimeTopologyDeviceComponent[];
  links: RuntimeTopologyDeviceLink[];
  connectionState: RuntimeHostConnectionState;
}
```

实现要求：

```ts
- RuntimeHostMetadataPatch 增加 deviceId
- normalizeRuntimeHostRecord / mergeHostMetadata 支持 deviceId
- persistSuccessfulDialMetadata() 同时写入 hostId + deviceId + lastSuccessfulDialAddress
- refreshSnapshot() 返回 devices
```

- [ ] **Step 4: 跑 TS 定向测试确认通过**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-manager.issue201.test.ts
```

Expected:
- host service / manager 新增测试通过

### Task 5: 设备网络视图与信号拓扑视图收口

**Files:**
- Modify: `src/lib/types/agent-hub.ts`
- Modify: `src/ui/app/pages/agents/agents-utils.ts`
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`
- Modify: `src/ui/app/pages/agents/TopologyView.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Test: `tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx`
- Test: `tests/e2e/agent-runtime-host.issue205.test.ts`

- [ ] **Step 1: 写失败测试**

新增断言方向：

```ts
expect(screen.getByText('设备网络视图')).toBeInTheDocument()
expect(screen.getByText('信号拓扑视图')).toBeInTheDocument()
expect(screen.getByText('device id:')).toBeInTheDocument()
expect(screen.getByText('部件')).toBeInTheDocument()
expect(screen.getByText('链路')).toBeInTheDocument()
```

E2E 至少确认：

```ts
await expect(page.getByTestId('agent-view-toggle-device')).toContainText('设备网络')
await expect(page.getByTestId('agent-view-toggle-topology')).toContainText('信号拓扑')
```

- [ ] **Step 2: 跑 UI / E2E 入口确认失败**

Run:

```powershell
bun x vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
bun x playwright test tests/e2e/agent-runtime-host.issue205.test.ts
```

Expected:
- 文案与设备摘要断言失败

- [ ] **Step 3: 实现 UI 收口**

实现方向：

```ts
- VIEW_ITEMS:
  topology => 信号拓扑
  device => 设备网络

- DeviceView:
  新增 `devices: RuntimeDeviceSnapshot[]`
  展示 device id / primary host / component count / link count
  peer 卡片优先按 device 语义渲染

- TopologyView:
  增加 “信号拓扑视图” 标题或说明
```

- [ ] **Step 4: 跑 UI / E2E 验证通过**

Run:

```powershell
bun x vitest run tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
bun x playwright test tests/e2e/agent-runtime-host.issue205.test.ts
```

Expected:
- 新增 UI / E2E 测试通过

### Task 6: 全量验收、评审、提交、推送

**Files:**
- Modify: 本阶段所有变更文件

- [ ] **Step 1: 跑定向验收**

Run:

```powershell
bun x vitest run tests/unit/services/runtime-client.issue201.test.ts tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-manager.issue201.test.ts tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx
cargo test -p exomind-runtime persisted_runtime_device_id -- --nocapture
cargo test -p exomind-runtime --test mesh_routes_integration topology_ -- --nocapture
```

Expected:
- 定向测试全绿

- [ ] **Step 2: 跑基线与类型检查**

Run:

```powershell
bun x tsc --noEmit
bun x playwright test tests/e2e/agent-runtime-host.issue205.test.ts
git diff --check
```

Expected:
- 类型检查通过
- E2E 通过
- 无空白错误

- [ ] **Step 3: 代码评审**

检查点：

```md
- device_id 与 host_id 是否语义分离
- 是否没有新造独立设备仓库
- 是否只返回最小真实 component/link
- UI 是否做到了两张视图、一张底层网
```

- [ ] **Step 4: 提交与推送**

Run:

```powershell
git add docs/plans/2026-04-09-runtime-device-network-phase2-design.md docs/plans/2026-04-09-runtime-device-network-phase2-plan.md src/lib/types/agent-hub-runtime.ts src/lib/types/agent-hub.ts src/lib/services/runtime-host.service.ts src/services/runtime-manager.ts src/ui/app/pages/agents/agents-utils.ts src/ui/app/pages/agents/DeviceView.tsx src/ui/app/pages/agents/TopologyView.tsx src/ui/app/pages/AgentsPage.tsx tests/unit/services/runtime-host.service.issue205.test.ts tests/unit/services/runtime-manager.issue201.test.ts tests/unit/ui/agent-hub/device-view.runtime-topology.test.tsx tests/e2e/agent-runtime-host.issue205.test.ts crates/exomind-runtime/src/lib.rs crates/exomind-runtime/src/routes/topology.rs crates/exomind-runtime/tests/mesh_routes_integration.rs
git commit -m "feat: add runtime device network phase2"
git push origin feat/runtime-device-network:dev
```

Expected:
- 提交成功
- 远端 `dev` 更新
