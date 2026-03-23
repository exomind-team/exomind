# Agent Hub Topology Layout Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Agent Hub 拓扑图实现第一阶段 `manual layout（手动布局）` 持久化与 `auto:flow（自动布局）` 隔离机制。

**Architecture:** 新增一个纯函数模块负责 `datasetKey/filterKey/layoutStore`、手动布局合并与自动布局生成；[AgentsPage.tsx](D:/project/exomind/src/ui/app/pages/AgentsPage.tsx) 里的 `TopologyView` 只负责 React Flow 事件接线、模式切换和持久化触发。持久化层先使用 `localStorage`，按 `datasetKey -> scopeKey -> filterKey` 分层存储。

**Tech Stack:** React 18, TypeScript, React Flow (`@xyflow/react`), Vitest, Testing Library, localStorage

---

### Task 1: 提取布局纯函数模块

**Files:**
- Create: `src/ui/app/pages/topology-layout.ts`
- Test: `tests/unit/ui/agent-hub/topology-layout.issue382.test.ts`

**Step 1: Write the failing test**

- 为 `datasetKey` 写失败测试，验证：
  - 节点/边集合相同但状态变化时 key 不变
  - 节点或边变化时 key 改变
- 为 `filterKey` 写失败测试，验证：
  - 相同筛选条件顺序不同 key 仍稳定
- 为快照合并写失败测试，验证：
  - 已保存位置覆盖基础布局
  - 新节点回退基础布局
  - 已删除节点位置被清理

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/agent-hub/topology-layout.issue382.test.ts`

Expected: FAIL，提示 `topology-layout.ts` 或导出函数尚不存在。

**Step 3: Write minimal implementation**

- 实现：
  - `buildTopologyDatasetKey`
  - `buildTopologyFilterKey`
  - `applyManualLayoutSnapshot`
  - `buildAutoFlowLayout`
  - `readTopologyLayoutStore`
  - `writeTopologyLayoutStore`

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/agent-hub/topology-layout.issue382.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/topology-layout.ts tests/unit/ui/agent-hub/topology-layout.issue382.test.ts
git commit -m "feat(agent-hub): add topology layout store helpers"
```

### Task 2: 为 TopologyView 写持久化失败测试

**Files:**
- Create: `tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx`
- Modify: `src/ui/app/pages/AgentsPage.tsx`

**Step 1: Write the failing test**

- 使用 React Flow mock 覆盖：
  - `manual` 为默认模式
  - 节点拖拽后写入 `localStorage`
  - 重渲染后恢复位置
  - 切到 `auto:flow` 再切回 `manual` 恢复原手动布局
  - 切换筛选组合后分别记住布局
  - `viewport` 在手动模式下被保存并恢复

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx`

Expected: FAIL，提示缺少布局模式 UI、事件接线或持久化行为。

**Step 3: Write minimal implementation**

- 在 `TopologyView` 中接入：
  - `layoutMode`
  - `onNodesChange`
  - `onMoveEnd`
  - `defaultViewport`
  - `fitView`/重置/清空操作
- 在 `AgentsPage` 中计算：
  - `datasetKey`
  - `filterKey`
  - `scopeKey = global`
  - 当前布局快照读写

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/AgentsPage.tsx tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx
git commit -m "feat(agent-hub): persist manual topology layout"
```

### Task 3: 回归基础拓扑测试

**Files:**
- Test: `tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts`
- Test: `tests/unit/ui/agent-hub/agents-page.issue204.test.tsx`
- Test: `tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx`

**Step 1: Run targeted regression**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx
```

Expected: 若失败，说明新增布局状态影响现有拓扑基础行为或测试 mock。

**Step 2: Fix only minimal regressions**

- 调整测试 mock 或组件默认 props
- 不改变已确认的拓扑视觉结构

**Step 3: Re-run regression**

Run the same commands again and ensure PASS.

**Step 4: Commit**

```bash
git add tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx src/ui/app/pages/AgentsPage.tsx
git commit -m "test(agent-hub): cover topology layout regressions"
```

### Task 4: 类型检查与收口

**Files:**
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/ui/app/pages/topology-layout.ts`

**Step 1: Run typecheck**

Run: `npx tsc --noEmit`

Expected: PASS

**Step 2: Fix type or lint-level issues**

- 清理导入
- 收紧类型
- 保持中英对照关键注释只出现在必要复杂处

**Step 3: Run final verification**

Run:

```bash
npx vitest run tests/unit/ui/agent-hub/topology-layout.issue382.test.ts
npx vitest run tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx
npx vitest run tests/unit/ui/agent-hub/agents-signal-topology.issue245f.test.ts
npx vitest run tests/unit/ui/agent-hub/agents-page.issue204.test.tsx tests/unit/ui/agent-hub/agents-page.voice-signal.test.tsx
npx tsc --noEmit
```

Expected: 全部 PASS

**Step 4: Commit**

```bash
git add src/ui/app/pages/AgentsPage.tsx src/ui/app/pages/topology-layout.ts tests/unit/ui/agent-hub/topology-layout.issue382.test.ts tests/unit/ui/agent-hub/agents-page.topology-layout.issue382.test.tsx docs/plans/2026-03-06-agent-hub-topology-layout-design.md docs/plans/2026-03-06-issue-382-agent-hub-topology-layout-plan.md
git commit -m "feat(agent-hub): add topology layout persistence phase 1"
```
