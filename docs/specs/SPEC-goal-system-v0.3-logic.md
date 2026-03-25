# 外心目标系统 v0.3 — 逻辑模型

> 纯运作逻辑，面向 RT 实现。不涉及用户交互、视觉呈现、布局算法。
>
> 判定边界：「如果没有屏幕，这个规则还成立吗？」→ 成立 = 属于本文档。

## 基本信息

| 字段 | 内容 |
|------|------|
| **文档名称** | 目标系统逻辑模型 |
| **版本** | 0.3-draft |
| **创建日期** | 2026-03-25 |
| **前序版本** | `SPEC-goal-system-design-v0.2.md`（完整设计） |
| **定位** | RT 核心运作逻辑，与 UI 交互文档（v0.3-ui）配对 |

---

## 1. 实体定义

### 1.1 GoalNode — 目标节点

```typescript
interface GoalNode {
  id: string
  title: string           // 空字符串 = 待命名
  description: string
  status: GoalStatus      // 'pending' | 'completed' | 'cancelled'
  achieveMode: 'AND' | 'OR'
  createdAt: number       // UTC timestamp ms
  updatedAt: number
}
```

- 目标**没有** `in_progress` / `suspended` 状态
- 推进状态从关联 TaskEdge **派生**（见 §4.1）

### 1.2 TaskEdge — 任务边

```typescript
interface TaskEdge {
  id: string
  title: string           // 空字符串 = 待命名（匿名边）
  description: string
  source: string          // 源节点 ID
  target: string          // 目标节点 ID
  status: TaskEdgeStatus  // 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
  taskNodeRef?: string    // 后续集成：关联的现有 TaskNode ID
  createdAt: number
  updatedAt: number
}
```

- TaskEdge 是独立实体，`taskNodeRef` 为空时 = 匿名边
- 匿名边 = 占位，表示「这里需要一个具体任务但尚未定义」

### 1.3 MeNode — 自我节点

```typescript
interface MeNode {
  id: string
  name: string
  // 后续扩展：knowledge, mindSet
}
```

- Me **不是** GoalNode 的特殊实例，是独立实体
- Me 不参与状态机（永远存在，不可取消/完成）

### 1.4 GoalGraph — 图容器

```typescript
interface GoalGraph {
  me: MeNode
  goals: GoalNode[]
  edges: TaskEdge[]
}
```

---

## 2. 约束规则

### 2.1 硬约束（不变量）

| 编号 | 不变量 | 行为语义 | 说明 |
|------|--------|---------|------|
| **C1** | 已完成不可逆 | 完成了就是完成了 | `completed` 是终态 |
| **C2** | 已取消不可逆 | 放弃了就是放弃了 | `cancelled` 是终态 |
| **C3** | 不可删除 | 放弃 = 取消，不是删除 | 目标节点无 delete 操作 |
| **C4** | Me 永驻 | 自我是起点 | Me 不可取消/删除/完成 |
| **C5** | 无孤立目标 | 每个目标都有路可达 | 新建目标时自动创建 Me→目标匿名边 |
| **C6** | DAG 约束 | 目标网络不能形成环 | 创建边时检测，拒绝成环操作 |
| **C7** | 有向边 | 任务指向它要达成的目标 | source→target = 贡献于达成 target |
| **C8** | 目标完成纯推导 | 目标不能手动标记完成 | completed 只能由 AND/OR 推导得出 |
| **C9** | 匿名边不可完成 | 没做具体事不算达成 | taskNodeRef 为空 → 不可转为 completed |

### 2.2 图结构约束

- Me 是有效端点（边可连 Me↔目标）
- 允许平行边（两节点间可有多条任务边）
- 边必须有两个端点（不允许悬空边）
- 边的两端不能是同一个节点（无自环）

### 2.3 TaskEdge 可删除性

> **v0.3 新增**：TaskEdge（任务边）与 GoalNode（目标节点）的删除策略不同。

| 实体 | 可删除？ | 理由 |
|------|---------|------|
| GoalNode | **否**（C3） | 目标代表意愿，放弃 = 取消，留下痕迹 |
| TaskEdge | **是** | 边是手段，可以被替换、移除、重新规划 |

删除 TaskEdge 后需触发 C5 检查：若目标因此变为孤立（无任何入边且非 Me 直连），系统应自动补充 Me→目标匿名边。

---

## 3. 状态机

### 3.1 TaskEdge 状态转移

```
             ┌──────────────────┐
             │                  ↓
  pending → in_progress ↔ suspended
               │                │
               ↓                ↓
           completed        cancelled
               ↑
               └── suspended
```

合法转移：

| 从 | 到 | 条件 |
|----|-----|------|
| pending | in_progress | — |
| in_progress | suspended | — |
| suspended | in_progress | — |
| in_progress | completed | C9：taskNodeRef 不为空 |
| suspended | completed | C9：taskNodeRef 不为空 |
| in_progress | cancelled | — |
| suspended | cancelled | — |
| pending | cancelled | — |

`completed` 和 `cancelled` 是终态，不可转出。

### 3.2 GoalNode 状态转移

```
  pending ──→ completed  （纯推导，见 §4）
     │
     └──→ cancelled      （cancelGoal 操作）
```

- `pending → completed`：仅由达成推导触发（§4），不接受外部直接设置
- `pending → cancelled`：通过 `cancelGoal` 操作（§5.4）
- `completed` 和 `cancelled` 是终态
- 已完成的目标不可取消

---

## 4. 达成推导

### 4.1 推导规则

目标的 `achieveMode` 决定其入边（target = 该目标的所有 TaskEdge）如何组合判定完成：

| achieveMode | 规则 |
|-------------|------|
| **AND** | 所有入边 status = completed → 目标 completed |
| **OR** | 任一入边 status = completed → 目标 completed |

注意：
- 只看**入边**（target 为该目标的边）
- `cancelled` 的边不参与 AND 判定（不阻塞也不满足）
- 零条入边时：AND 模式下视为 trivially satisfied（自动完成）；OR 模式下永远不完成

### 4.2 触发时机

达成推导在以下操作后触发：

1. TaskEdge 状态变更为 `completed`
2. TaskEdge 被删除（可能影响 AND 判定）
3. TaskEdge 被创建（新入边可能影响 AND 判定）
4. GoalNode 的 `achieveMode` 变更

### 4.3 级联传播

```
边 E 完成 → 重算 E.target 目标 G
  → 若 G 变为 completed
    → 找到所有以 G 为 source 的边 E'
      → 对每条 E' 不自动改状态（边保持各自状态）
      → 但重算 E'.target（沿 DAG 向下游传播）
```

关键：**目标完成不联动边的状态**。一个目标完成后，以它为 source 的边保持原状态。级联只传播重算，不传播状态变更。

### 4.4 派生查询：目标是否在推进

```typescript
function isGoalInProgress(goalId: string, edges: TaskEdge[]): boolean {
  return edges
    .filter(e => e.target === goalId)
    .some(e => e.status === 'in_progress')
}
```

这不是存储状态，是实时查询。

---

## 5. 操作定义

> **v0.3 核心变化**：所有操作都是纯逻辑的，不涉及 UI 决策。原 v0.2 中需要「用户选择」的点，改为可选参数。

### 5.1 createGoal — 创建目标

```typescript
createGoal(params: {
  title?: string          // 省略则为待命名
  description?: string
  achieveMode?: 'AND' | 'OR'  // 默认 AND
}): GoalNode
```

**副作用**：
- 创建 GoalNode，status = pending
- 自动创建 Me→新目标 的匿名 TaskEdge（C5）

### 5.2 createEdge — 创建任务边

```typescript
createEdge(params: {
  source: string          // GoalNode.id 或 MeNode.id
  target: string          // GoalNode.id
  title?: string
  description?: string
}): TaskEdge
```

**前置检查**：
- source 和 target 必须存在
- source ≠ target（无自环）
- 创建后不得形成环（C6，DAG 检测）

**副作用**：
- 创建 TaskEdge，status = pending
- 触发 target 的达成重算（§4.2）

### 5.3 updateEdgeStatus — 变更任务边状态

```typescript
updateEdgeStatus(params: {
  edgeId: string
  newStatus: TaskEdgeStatus
}): void
```

**前置检查**：
- 转移合法性（§3.1）
- C9：匿名边不可 completed

**副作用**：
- 若 newStatus = completed → 触发 edge.target 的达成重算（§4）

### 5.4 cancelGoal — 取消目标

```typescript
cancelGoal(params: {
  goalId: string
  cascadeEdges?: boolean  // 是否同时取消所有关联边，默认 false
}): void
```

**前置检查**：
- 不是 Me（C4）
- 当前 status = pending（不能取消已完成的）

**行为**：
1. 设 goalNode.status = cancelled
2. 若 `cascadeEdges = true`：
   - 找到所有 target = goalId 的非终态边，设为 cancelled
   - 找到所有 source = goalId 的非终态边，设为 cancelled
3. 触发所有受影响目标的达成重算

> **设计意图**：v0.2 原文为「弹窗让用户选择」，在逻辑层抽象为可选参数 `cascadeEdges`。UI 层决定这个参数的值从哪里来（弹窗、默认值、设置项等）。

### 5.5 deleteEdge — 删除任务边

```typescript
deleteEdge(params: {
  edgeId: string
}): void
```

**副作用**：
- 从图中移除该 TaskEdge
- C5 检查：若 edge.target 目标因此无入边，自动补充 Me→目标匿名边
- 触发 edge.target 的达成重算

### 5.6 splitEdge — 拆解边

```typescript
splitEdge(params: {
  edgeId: string                    // 要拆解的边 A→B
  middleGoalId?: string            // 用已有目标作为中间节点，省略则创建新目标
  middleGoalTitle?: string         // 新中间目标的标题（仅 middleGoalId 省略时生效）
  assignOriginalTo?: 'first' | 'second'  // 原边分配到前半段还是后半段，默认 'first'
}): { middleGoal: GoalNode; firstEdge: TaskEdge; secondEdge: TaskEdge }
```

**行为**：将边 A→B 拆为 A→C→B
1. 确定中间节点 C（已有或新建）
2. 原边保留，分配到 A→C 或 C→B（由 `assignOriginalTo` 决定）
3. 另一段创建匿名边
4. DAG 检测（C6）

### 5.7 updateGoal — 更新目标属性

```typescript
updateGoal(params: {
  goalId: string
  title?: string
  description?: string
  achieveMode?: 'AND' | 'OR'
}): void
```

**副作用**：
- 若 achieveMode 变更 → 触发达成重算

### 5.8 updateEdge — 更新任务边属性

```typescript
updateEdge(params: {
  edgeId: string
  title?: string
  description?: string
  taskNodeRef?: string
}): void
```

---

## 6. 查询接口

| 查询 | 输入 | 输出 | 说明 |
|------|------|------|------|
| getGraph | — | GoalGraph | 完整图数据 |
| getGoal | goalId | GoalNode | 单个目标 |
| getEdge | edgeId | TaskEdge | 单条边 |
| getInEdges | goalId | TaskEdge[] | 目标的所有入边 |
| getOutEdges | nodeId | TaskEdge[] | 节点的所有出边 |
| isGoalInProgress | goalId | boolean | 是否有入边在 in_progress |
| getShortestPath | from, to | string[] | Me→目标的最短有向路径（节点 ID 序列） |
| getHopDistance | goalId | number | Me 到目标的最短跳数 |

---

## 7. 存储

原型阶段：localStorage，key = `exomind:goal-graph`

序列化格式 = GoalGraph 的 JSON。

后续迁移路径：RT EventLog → PouchDB/CouchDB。

---

## 8. 原型阶段放宽

| 约束 | 原型行为 | 完整行为 |
|------|---------|---------|
| C5 自动匿名边 | 可选实现 | 必须 |
| C6 DAG 检测 | 可选实现 | 必须 |
| C8 完成纯推导 | 用户可直接改 | 只能推导 |
| C9 匿名边限制 | 不限制 | 限制 |

放宽的约束标注为 `prototype-only`。

---

## 9. 与 v0.2 的差异

| 变化点 | v0.2 | v0.3-logic |
|--------|------|-----------|
| 文档范围 | 逻辑+UI 混合 | 纯逻辑 |
| 取消联动 | 「弹窗让用户选」 | `cancelGoal({ cascadeEdges })` 可选参数 |
| TaskEdge 删除 | 未明确 | 明确可删除 + C5 补边 |
| 操作定义 | 隐含在描述中 | 显式函数签名 + 前置检查 + 副作用 |
| 拆解 | 描述性 | 显式 splitEdge 参数 + 返回值 |
| 查询接口 | 无 | 定义 getHopDistance 等 |
| 派生状态 | 简单提及 | 明确为查询接口（isGoalInProgress） |

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-24 | 0.1 | 初稿（v0.1） | Claude + 用户 |
| 2026-03-24 | 0.2 | 统一设计（v0.2） | Claude + 用户 |
| 2026-03-25 | 0.3-draft | 从 v0.2 拆分逻辑模型，新增操作定义、查询接口、TaskEdge 可删除性 | Claude + 用户 |
