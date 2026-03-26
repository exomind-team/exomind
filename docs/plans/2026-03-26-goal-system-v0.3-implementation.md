# 目标系统 v0.3 实现计划

> 将 v0.3 设计稿（逻辑文档 v0.3-r2 + UI 文档 v0.3-r7）转化为可执行的增量实现计划。

| 字段 | 内容 |
|------|------|
| **创建日期** | 2026-03-26 |
| **设计文档** | `docs/specs/SPEC-goal-system-v0.3-logic.md` (v0.3-r2) |
| **UI 文档** | `docs/specs/SPEC-goal-system-v0.3-ui.md` (v0.3-r7) |
| **现有代码** | `src/ui/app/pages/goals/` |
| **目标分支** | `feature/issue-xxx-goal-system-v0.3`（基于 `dev`） |

---

## 1. 现状分析

### 1.1 当前 v0.2 原型

现有代码位于 `src/ui/app/pages/goals/`，包含 3 个文件：

| 文件 | 职责 | 行数 |
|------|------|------|
| `goal-store.ts` | 数据模型 + localStorage 持久化 | ~97 |
| `goal-force-layout.ts` | d3-force 物理模拟 | ~195 |
| `GoalsPage.tsx` | ReactFlow 渲染 + 交互 + 详情面板（全在一个文件） | ~931 |

### 1.2 差距分析

#### 数据模型（`goal-store.ts`）— 需重写

| v0.2 现状 | v0.3 要求 | 差距 |
|-----------|-----------|------|
| `GoalNode.status: 'pending' \| 'completed' \| 'cancelled'` 存储态 | `GoalNode.cancelled: boolean` 唯一存储态；5 种展示状态纯派生 | 状态模型根本不同 |
| `GoalNode.achieveMode: 'AND' \| 'OR'` | `GoalNode.completionRule: TaskEdgeId[][]`（DNF） | 完成规则从简到复杂 |
| `GoalNode.name` | `GoalNode.title + description` | 字段拆分 |
| `GoalNode.isMe` 混在 GoalNode 里 | MeNode 独立实体 | 结构变化 |
| `TaskEdge.status` 存储态 | 边状态派生自 taskNodeRef | 消除存储态状态 |
| 无 `taskNodeRef` | `TaskEdge.taskNodeRef?: TaskNodeId` 槽位抽象 | 新增概念 |
| 无 `completionRule` | DNF 完成规则 + evaluateCompletion | 全新逻辑 |
| 无操作日志 | GoalOpLog | 新增 |
| 无约束校验 | C2-C10 不变量 | 全新逻辑层 |

#### 力导向布局（`goal-force-layout.ts`）— 可复用

现有实现质量好，可直接复用：
- d3-force 物理模拟、RAF 循环、pin/release 拖拽 -- 全部保留
- 需要适配：过滤 cancelled 节点/边、MeNode 独立类型

#### UI 层（`GoalsPage.tsx`）— 需大幅重构

| v0.2 现状 | v0.3 要求 | 差距 |
|-----------|-----------|------|
| 双击空白创建目标 | 右键/长按基于节点派生创建 | 创建方式完全不同 |
| 无右键菜单 | 完整右键菜单体系（节点/边/Me） | 全新 |
| 直接编辑状态（select） | 状态只读 + 开发者 override | 交互模式变化 |
| 简单详情面板（无响应式） | 响应式面板（桌面侧栏/移动底部抽屉） | 布局重写 |
| 3 种状态颜色 | 5 种状态 + 空槽位 + 空规则警告 | 视觉扩展 |
| 无 cancelled 隐藏 | 已取消隐藏 + 显示开关 | 新增 |
| 无连线模式 | 右键「连接到...」连线模式 | 新增 |
| 无触屏适配 | 长按替代右键 + 响应式面板 | 新增 |
| 无空状态引导 | Me 旁引导气泡 | 新增 |

### 1.3 可复用 vs 需重写

| 部分 | 处理 |
|------|------|
| `goal-force-layout.ts` | **复用**，小幅适配 |
| `GoalsPage.tsx` 的 ReactFlow 框架结构 | **复用骨架**，重构内部逻辑 |
| `GoalsPage.tsx` 的 `GoalFlowNode` 渲染 | **复用并扩展**（新增状态样式） |
| `GoalsPage.tsx` 的 `TaskFlowEdge` 渲染 | **复用并扩展**（新增状态样式） |
| `GoalsPage.tsx` 的平行边偏移计算 | **直接复用** |
| `GoalsPage.tsx` 的 `wouldCreateCycle` | **移入逻辑层** |
| `GoalsPage.tsx` 的详情面板 | **重写**（响应式 + 冻结规则 + 新字段） |
| `goal-store.ts` | **重写**（新数据模型 + 逻辑层 API） |

---

## 2. 实现阶段划分

```
Phase 1: 数据模型 + 逻辑层核心
    ↓
Phase 2: Store 层（zustand）+ 持久化
    ↓
Phase 3: UI 基础（节点/边渲染 + 力导向适配）
    ↓
Phase 4: 右键菜单 + 创建/删除操作
    ↓
Phase 5: 详情面板 + 编辑交互
    ↓
Phase 6: 连线模式 + 编辑模式拖拽连线
    ↓
Phase 7: 开发者模式 + 收尾 + 集成测试
```

每个阶段产出一个可验证的增量。

---

## 3. 各阶段具体任务

### Phase 1: 数据模型 + 逻辑层核心

**目标**：纯逻辑层，不依赖 UI，100% 测试覆盖。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/goal-types.ts` | 类型定义（GoalNode, TaskEdge, MeNode, GoalGraph, CompletionRule 等） |
| `src/ui/app/pages/goals/goal-logic.ts` | 纯函数逻辑层（所有 §5 操作 + §3 状态派生 + §4 完成推导 + §6 查询） |
| `src/ui/app/pages/goals/__tests__/goal-logic.test.ts` | 逻辑层单元测试 |

**关键实现点**：

1. **类型定义** -- 严格对应逻辑文档 §1：
   - `GoalNode`：`cancelled: boolean` + `completionRule: string[][]`（序列化形式）
   - `TaskEdge`：`taskNodeRef?: string`，无 status 字段
   - `MeNode`：独立实体
   - `GoalGraph`：`{ me: MeNode, goals: GoalNode[], edges: TaskEdge[] }`

2. **状态派生**（纯函数）：
   - `getEdgeStatus(edge, edgeOverrides?, getTaskStatus?)` -- §3.1
   - `deriveGoalDisplayStatus(goal, inEdges, ...)` -- §3.2
   - `evaluateCompletion(rule, getEdgeStatusFn)` -- §4.3

3. **操作函数**（返回新 GoalGraph 或错误）：
   - `createGoal(graph, params)` -- §5.1
   - `createEdge(graph, params)` -- §5.2
   - `cancelGoal(graph, params)` -- §5.3
   - `deleteEdge(graph, params)` -- §5.4
   - `updateGoal(graph, params)` -- §5.7
   - `updateEdge(graph, params)` -- §5.8

4. **约束校验**（嵌入操作函数中）：
   - `wouldCreateCycle(graph, source, target)` -- C6
   - 入边冻结检查 -- §2.2
   - C5 自动补充空槽位边

5. **查询函数**：
   - `getInEdges(graph, goalId)` / `getOutEdges(graph, nodeId)`
   - `getHopDistance(graph, goalId)`

6. **原型专属**（§8.1）：
   - `setEdgeStatusOverride` / `clearEdgeStatusOverride` / `clearAllEdgeStatusOverrides`

**测试策略**：

- 每个操作函数的正常路径 + 前置检查拒绝 + 副作用验证
- `deriveGoalDisplayStatus` 的 5 种状态覆盖
- `evaluateCompletion` 的 AND/OR/混合/空集/引用已删边
- C5 自动补充场景
- C6 环路检测
- 入边冻结 / 出边约束 / cancelled 冻结
- completionRule 维护（删边时移除引用、子集清空时移除子集）

**验收标准**：`npx vitest run src/ui/app/pages/goals/__tests__/goal-logic.test.ts` 全部通过，覆盖率 100%。

---

### Phase 2: Store 层（zustand）+ 持久化

**目标**：zustand store 封装逻辑层，提供响应式数据给 UI。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/goal-store.ts` | **重写** -- zustand store |
| `src/ui/app/pages/goals/__tests__/goal-store.test.ts` | store 层测试 |

**关键实现点**：

```typescript
interface GoalStore {
  // 核心数据
  graph: GoalGraph

  // 原型专属（内存态）
  edgeOverrides: Map<string, TaskEdgeStatus>

  // 操作日志
  opLog: GoalOpLog[]

  // 派生查询（包装逻辑层纯函数）
  getEdgeStatus(edgeId: string): TaskEdgeStatus
  deriveGoalDisplayStatus(goalId: string): GoalDisplayStatus
  getInEdges(goalId: string): TaskEdge[]
  getOutEdges(nodeId: string): TaskEdge[]
  getHopDistance(goalId: string): number

  // 操作（包装逻辑层 + 持久化 + 日志）
  createGoal(params: CreateGoalParams): Result<{ goal: GoalNode; edge: TaskEdge }>
  createEdge(params: CreateEdgeParams): Result<TaskEdge>
  cancelGoal(params: CancelGoalParams): Result<void>
  deleteEdge(params: DeleteEdgeParams): Result<void>
  updateGoal(params: UpdateGoalParams): Result<void>
  updateEdge(params: UpdateEdgeParams): Result<void>

  // 原型
  setEdgeStatusOverride(edgeId: string, status: TaskEdgeStatus): void
  clearEdgeStatusOverride(edgeId: string): void
  clearAllEdgeStatusOverrides(): void
}
```

**持久化**：
- `exomind:goal-graph` -- GoalGraph JSON（completionRule 序列化为 `string[][]`）
- `exomind:goal-oplog` -- 操作日志
- `edgeOverrides` 不持久化（内存态，刷新清除）

**数据迁移**：
- 检测 localStorage 中旧格式（`GoalNode.status` / `GoalNode.isMe` / `TaskEdge.status`）
- 自动迁移到 v0.3 格式（一次性）

**测试策略**：
- store 操作的端到端流程（createGoal → 查询派生状态 → cancelGoal）
- 持久化 round-trip
- 旧数据迁移

**验收标准**：store 测试全部通过；旧数据能自动迁移。

---

### Phase 3: UI 基础（节点/边渲染 + 力导向适配）

**目标**：画布能正确渲染 v0.3 数据模型的节点和边，5 种状态视觉正确。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/components/GoalFlowNode.tsx` | 目标节点组件（从 GoalsPage 拆出 + 扩展） |
| `src/ui/app/pages/goals/components/TaskFlowEdge.tsx` | 任务边组件（从 GoalsPage 拆出 + 扩展） |
| `src/ui/app/pages/goals/components/MeFlowNode.tsx` | Me 节点组件（可选，或复用 GoalFlowNode） |
| `src/ui/app/pages/goals/goal-force-layout.ts` | 适配新数据模型（GoalGraph → ForceNode） |
| `src/ui/app/pages/goals/GoalsPage.tsx` | 重构为使用 zustand store + 新组件 |

**关键实现点**：

1. **节点视觉扩展**（§2.3）：
   - pending：现有 sky→indigo 渐变
   - in_progress：默认渐变 + 琥珀色边框/脉冲动画
   - suspended：默认渐变 + 灰色边框
   - completed：绿色 + 打勾，opacity 0.5-0.7
   - cancelled：默认隐藏
   - 空规则警告角标（completionRule 为空）

2. **边视觉扩展**（§2.4）：
   - pending（空槽位）：细虚线 + 「待定义」
   - pending（有 taskNodeRef）：虚线
   - in_progress：实线 + 琥珀色
   - suspended：虚线 + 灰色
   - completed：实线 + 绿色
   - cancelled（任务取消）：半透明 + 划线

3. **已取消隐藏**（§1.3）：
   - `showCancelled` 开关（localStorage 持久化）
   - 过滤 cancelled 目标及其关联边
   - cancelled 边的场景 A/B 区分

4. **力导向适配**：
   - `GoalForceSimulation.buildNodesAndLinks` 接收 `GoalGraph` 而非旧 `GoalGraphData`
   - 过滤 cancelled 节点（showCancelled=false 时不参与物理模拟）

**测试策略**：
- 组件快照测试（各状态视觉）
- 力导向布局数据转换测试

**验收标准**：画布能渲染 v0.3 数据，5 种状态视觉正确，cancelled 隐藏/显示正常。

---

### Phase 4: 右键菜单 + 创建/删除操作

**目标**：用户可以通过右键菜单创建目标、删除边、取消目标。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/components/GoalContextMenu.tsx` | 右键菜单组件 |
| `src/ui/app/pages/goals/components/CancelGoalDialog.tsx` | 取消确认弹窗 |
| `src/ui/app/pages/goals/hooks/useContextMenu.ts` | 右键/长按 hook |
| `src/ui/app/pages/goals/hooks/useLongPress.ts` | 长按检测 hook（触屏） |
| `src/ui/app/pages/goals/GoalsPage.tsx` | 集成右键菜单 |

**关键实现点**：

1. **右键菜单**（§6）：
   - 活跃目标：详情、添加下游目标、添加上游目标、连接到...、取消目标
   - completed 目标：详情（只读）、添加下游目标、连接到...
   - cancelled 目标：不出现菜单
   - Me：详情、添加目标
   - 边：详情、删除
   - 画布空白：禁用默认菜单

2. **触屏长按**（§11.1）：
   - >=500ms 不移动 → 触发右键菜单
   - 移动超过 10px → 取消计时器，开始拖拽

3. **创建后行为**：
   - 创建目标后自动选中 + 打开详情面板
   - 删除边后无确认弹窗
   - 取消目标弹窗：「返回」/「确认取消」按钮

4. **副作用反馈**（toast）：
   - deleteEdge 后 completionRule 调整提示
   - C5 自动补充边 + 闪烁动画
   - 空规则警告角标

5. **移除双击创建**：v0.3 不再支持双击空白创建目标。

**测试策略**：
- 右键菜单条件渲染测试（各状态下的菜单项）
- 操作流程集成测试（右键 → 创建 → 验证数据）

**验收标准**：右键菜单功能完整；触屏长按正常；创建/删除/取消操作正确调用逻辑层。

---

### Phase 5: 详情面板 + 编辑交互

**目标**：详情面板支持查看和编辑目标/边/Me 属性，冻结规则正确。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/components/GoalDetailPanel.tsx` | 目标详情面板 |
| `src/ui/app/pages/goals/components/EdgeDetailPanel.tsx` | 边详情面板 |
| `src/ui/app/pages/goals/components/MeDetailPanel.tsx` | Me 详情面板 |
| `src/ui/app/pages/goals/components/DetailPanelShell.tsx` | 面板外壳（响应式布局：桌面侧栏/移动底部抽屉） |

**关键实现点**：

1. **响应式布局**（§1.2、§11.2）：
   - 桌面端：右侧栏 w-[340px] absolute
   - 移动端：底部抽屉 max-h-[72vh] rounded-t-[28px]
   - 参考 `TaskDagDetailPanel` 实现

2. **目标详情**（§4.1）：
   - title（空时「待命名」）、description、status 标签（只读）
   - AND/OR 切换控件
   - completionRule 人类可读展示（「A 且 B」/「A 或 B」）
   - 入边/出边列表（可点击跳转）
   - 跳数距离
   - 冻结规则：cancelled/completed 时所有字段 disabled

3. **边详情**（§4.2）：
   - title（三级 fallback：边 title → 任务标题 → 「待定义」）
   - description、status 标签（只读）
   - source/target 名称（可点击跳转）
   - taskNodeRef 绑定/解绑
   - 冻结规则：target 为 completed 时冻结

4. **编辑保存策略**（§4）：
   - blur 保存，无保存按钮
   - 保存失败回滚 + toast
   - 派生状态实时响应（外部变化时面板更新）

5. **空状态引导**（§1.5）：
   - 只有 Me 节点时显示引导气泡
   - 桌面端「右键添加你的第一个目标」/ 触屏「长按添加」
   - localStorage 持久化

**测试策略**：
- 面板渲染测试（各状态下的字段可编辑性）
- 冻结规则测试（cancelled/completed 时 disabled）
- blur 保存流程测试

**验收标准**：详情面板功能完整；冻结规则正确；响应式布局正常。

---

### Phase 6: 连线模式 + 编辑模式拖拽连线

**目标**：编辑模式下拖拽连线 + 右键「连接到...」连线模式。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/hooks/useConnectMode.ts` | 连线模式状态管理 |
| `src/ui/app/pages/goals/GoalsPage.tsx` | 集成连线交互 |

**关键实现点**：

1. **编辑模式拖拽连线**（§3.2）：
   - ReactFlow `onConnect` 回调
   - 视觉反馈：虚线跟随、hover 吸附
   - rulePosition 默认 AND（clauseIndex: 0）
   - 失败 toast（DAG/自环/target completed/source cancelled）

2. **右键连线模式**（§3.3）：
   - 进入：右键「连接到...」→ 光标变十字 + 虚线跟随
   - 确认：点击目标节点
   - 取消：ESC / 点击空白
   - 方向：发起方 = source，点击方 = target

3. **创建后行为**：新边自动选中 + 打开详情面板。

**测试策略**：
- 连线模式状态机测试（进入/确认/取消）
- 失败路径测试

**验收标准**：两种连线方式正常工作；失败处理正确。

---

### Phase 7: 开发者模式 + 收尾 + 集成测试

**目标**：开发者模式可用；端到端流程完整；旧代码清理。

**创建/修改文件**：

| 文件 | 说明 |
|------|------|
| `src/ui/app/pages/goals/components/EdgeDetailPanel.tsx` | 添加开发者折叠区 |
| `src/ui/app/pages/goals/__tests__/goal-integration.test.ts` | 集成测试 |

**关键实现点**：

1. **开发者折叠区**（§0.5、§4.2）：
   - 边详情面板底部「⚙ 开发者」折叠区（警告色，默认折叠）
   - 边状态下拉框 → `setEdgeStatusOverride`
   - 「清除覆盖」按钮 → `clearEdgeStatusOverride`
   - toast 带「[开发者]」前缀
   - override 不受入边冻结约束

2. **C5 自动补充动画**（§5.4）：
   - 新边高亮闪烁 ~1s
   - toast「已自动添加连接以保持目标可达」

3. **旧代码清理**：
   - 移除 `GoalNode.status` / `GoalNode.isMe` / `GoalNode.achieveMode` 旧字段
   - 移除双击创建逻辑
   - 移除旧详情面板

4. **集成测试**：
   - 创建目标 → 添加边 → 切换 AND/OR → 通过开发者模式标记完成 → 验证派生状态
   - 取消目标 → 验证隐藏 → 开关显示
   - 删除边 → C5 自动补充
   - 数据迁移 round-trip

**验收标准**：
- `npx tsc --noEmit` 无错误
- `npx vitest run src/ui/app/pages/goals/` 全部通过
- 手动在浏览器中走通完整流程

---

## 4. 技术决策

### 4.1 状态管理方案

采用 zustand 单 store，结构如 Phase 2 所述。关键设计：

- **逻辑层为纯函数**：`goal-logic.ts` 不依赖任何外部状态，接收 `GoalGraph` 返回新 `GoalGraph` 或错误。这使得逻辑层 100% 可测试。
- **store 层为薄包装**：调用逻辑层纯函数 → 更新 zustand state → 触发持久化 + 日志。
- **派生查询在 store 层**：`getEdgeStatus` / `deriveGoalDisplayStatus` 等在 store 中实现，内部调用逻辑层纯函数 + 读取 `edgeOverrides` 内存态。

### 4.2 组件架构

```
GoalsPage
├── GoalModeSelector            // 浏览/编辑切换
├── ShowCancelledToggle         // 已取消显示开关
├── EmptyStateGuide             // 空状态引导气泡
├── ReactFlow
│   ├── GoalFlowNode            // 目标节点（含 Me 样式分支）
│   └── TaskFlowEdge            // 任务边
├── GoalContextMenu             // 右键菜单
├── CancelGoalDialog            // 取消确认弹窗
└── DetailPanelShell            // 响应式面板外壳
    ├── GoalDetailPanel         // 目标详情
    ├── EdgeDetailPanel         // 边详情（含开发者折叠区）
    └── MeDetailPanel           // Me 详情
```

### 4.3 与现有代码的集成策略

- **就地重构**，不新建页面路由。`GoalsPage` 保持同一入口。
- **分阶段合并**：每个 Phase 一个 PR 或一批 commits，确保每步可编译可运行。
- **数据迁移**：store 初始化时检测旧格式，自动迁移。旧数据格式在 v0.4 时可移除兼容代码。
- **保留 `goal-force-layout.ts`** 的 API 不变，仅修改输入数据适配。

### 4.4 错误处理模式

逻辑层操作返回 `Result<T>` 类型：

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string }
```

store 层检查 `result.ok`，失败时 toast 提示。UI 层不直接处理错误。

---

## 5. 风险和注意事项

### 5.1 已知技术风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| ReactFlow 右键菜单与浏览器默认菜单冲突 | 右键菜单不弹出 | 在 ReactFlow 容器上 `onContextMenu` `preventDefault` |
| 长按检测与拖拽冲突（触屏） | 误触发菜单或误拖拽 | §11.1 的 500ms+10px 阈值需实测调优 |
| 力导向布局 cancelled 节点过滤后位置跳动 | 隐藏/显示 cancelled 时节点位置剧烈变化 | 隐藏时保留力模拟中的节点但不渲染，或重建时保留已有位置 |
| completionRule 引用已删除边 | evaluateCompletion 异常 | 已在逻辑文档中处理：引用不存在边 → false |
| 旧数据迁移可能丢失信息 | v0.2 的 `GoalNode.status: 'completed'` 无法映射到 v0.3 的派生 completed | 迁移时为 completed 目标的所有入边设置 override（或接受状态丢失并 toast 提示） |

### 5.2 边界场景

- **空图**（只有 Me）：空状态引导气泡正确显示
- **单目标无入边**：如果 C5 实现，自动补充 Me→目标边；如果 C5 放宽，completionRule 为空集显示警告
- **所有入边已终结但规则未满足**：目标显示为 suspended（等待新手段）
- **upstream 创建的目标**：completionRule 初始化为空集 `{}`，显示空集警告角标
- **平行边的右键点击**：需要精准命中检测，沿曲线扩展点击区域
- **面板打开时外部状态变化**：如开发者 override 导致目标变为 completed，面板字段需实时切换为 disabled

### 5.3 性能考量

- `deriveGoalDisplayStatus` 在每次渲染时调用，需保持 O(入边数) 复杂度
- `evaluateCompletion` 中的 `getEdgeStatus` 查询应避免重复计算（可在 store 层缓存一帧内的结果）
- 力导向模拟的节点上限：原型阶段 <100 个目标无性能问题

### 5.4 开发规范提醒

- 分支命名：`feature/issue-xxx-goal-system-v0.3`
- 提交规范：`feat: xxx` / `refactor: xxx` / `test: xxx`
- 每个 Phase 完成后运行 `npx tsc --noEmit` + `npx vitest run`
- PR 目标分支为 `dev`

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-26 | 1.0 | 初版实现计划 | Claude + 用户 |
