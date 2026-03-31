# Network Node-First Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把网络页 / 设备页的默认主路径从 single RT host 切换为 node-first，让用户在主界面看到本机节点、已发现节点、已确认节点、配对入口和高级兼容区。

**Architecture:** 保持现有 runtime manager、runtime host service、pairing dialog 与 runtime target 状态流不变，优先重构 `DeviceView` 的信息架构与 `AgentsPage` 的配对入口装配。先用单测锁定新的 UI 叙事和主路径，再做最小实现；外部 RT 和手工 host 录入保留，但统一下沉到 advanced/compatibility 区域。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、Tauri runtime 状态服务

---

### Task 1: 写首批失败测试，锁定 node-first 主路径

**Files:**
- Modify: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

**Step 1: Write the failing test**

- 新增一个测试，断言设备页出现：
  - `我的节点`
  - `已发现节点`
  - `已确认节点`
  - `高级 / 兼容模式`
- 断言旧的“外部 RT”不再作为首屏核心文案出现，而是落在高级区。
- 断言主路径存在“发起配对”或“响应配对”入口按钮。

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected: FAIL，因为当前 `DeviceView` 仍是 single-host 信息架构。

**Step 3: Write minimal implementation**

- 在 `DeviceView.tsx` 新增 node-first 分区与配对入口。
- 先不追求最终样式，只满足结构与交互。

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected: PASS

### Task 2: 接入 pairing 入口到设备主路径

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`

**Step 1: Write the failing test**

- 在 `agent-device-runtime-host.issue205.test.tsx` 追加测试：
  - 点击设备页主路径中的配对入口后，出现 `PeerPairingDialog`
  - 不再要求用户先进入设置页

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected: FAIL，因为当前 pairing 入口只在设置页。

**Step 3: Write minimal implementation**

- `AgentsPage.tsx` 负责读取本地 runtime info（hostId / auth token）并控制 `PeerPairingDialog` 开关
- `DeviceView.tsx` 只暴露 `onOpenPeerPairing` 入口，不重复读取 localStorage

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/peer-pairing-dialog.test.tsx`

Expected: PASS

### Task 3: 把 discovered / confirmed / advanced 三个区块映射到现有 host snapshots

**Files:**
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`
- Modify: `tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

**Step 1: Write the failing test**

- 增加快照数据：
  - `discovered_candidate`
  - `confirmed_peer`
  - `manual_seed`
- 断言三个区块各自展示正确设备与状态标签。

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected: FAIL，因为当前设备页没有按 trust state 分组。

**Step 3: Write minimal implementation**

- 基于 `runtimeHostSnapshots[].host.trustState` 分组
- 维持原来的 probe、manage host、external RT 能力
- Advanced 区收纳手工 host / external RT / bind mode 控件

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx`

Expected: PASS

### Task 4: 验证并整理文案

**Files:**
- Modify: `src/ui/app/pages/agents/DeviceView.tsx`
- Optionally modify: `docs/plans/2026-03-30-phone-embedded-rt-mesh-design.md`

**Step 1: Run targeted verification**

Run:

```powershell
bunx tsc --noEmit
bunx vitest run tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx tests/unit/ui/peer-pairing-dialog.test.tsx
```

Expected: 全绿

**Step 2: Commit**

```powershell
git add docs/plans/2026-03-30-network-node-first-implementation-plan.md src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/agents/DeviceView.tsx tests/unit/ui/agent-hub/agent-device-runtime-host.issue205.test.tsx
git commit -m "feat: switch device view to node-first runtime flow"
```
