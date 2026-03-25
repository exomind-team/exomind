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

## 0. 设计哲学

### 0.1 目标节点 = 目的，任务边 = 手段

手段可变而目的不变。目标代表意愿方向，一经确立便留下痕迹（不可删除，只可取消）。任务边是达成目标的路径，可以被替换、移除、重新规划。

### 0.2 任务系统独立性

目标建立在任务之上，而非任务被目标系统约束。没了目标系统，任务应照常运行。任务边上关联的任务可以独立完成，不受「源头目标是否完成」的约束。

### 0.3 没有不可达的目标，只有没拆解好的目标

边的起止节点允许修改，边可以拆分引入中间目标——目标网络是动态进化的。引导的心智模型：任何远大目标都可以通过拆解变得可达。

### 0.4 取消语义

「取消」是唯一的终止操作语义。不使用「放弃」「删除」等措辞。在用户感知层面，取消 ≈ 删除（UI 层负责隐藏已取消的节点），但逻辑层保留完整记录。传达理念：目标要认真对待，不能随意丢弃。

---

## 1. 实体定义

### 1.0 类型别名

> 设计原则：对语义不同的类型使用特殊别名，避免后续迁移中产生歧义。

```typescript
type GoalId = string        // 目标节点 ID
type MeId = string          // Me 节点 ID
type TaskEdgeId = string    // 任务边 ID
type TaskNodeId = string    // 任务系统中的 TaskNode ID（外部系统）
type Timestamp = number     // UTC timestamp ms
type NodeId = GoalId | MeId // 图中任意节点 ID
```

### 1.1 GoalNode — 目标节点

```typescript
interface GoalNode {
  id: GoalId
  title: string           // 空字符串 = 待命名
  description: string
  status: GoalStatus      // 'pending' | 'completed' | 'cancelled'（存储态）
  completionRule: Set<Set<TaskEdgeId>>  // 最简与或式（DNF），见 §4
  createdAt: Timestamp
  updatedAt: Timestamp
}

// 展示状态（含派生）
type GoalDisplayStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
```

**状态说明**：
- `in_progress`、`suspended` 是**派生状态**，由关联入边状态决定（见 §3.2）
- 存储时只持久化 `pending` | `completed` | `cancelled`，`in_progress` / `suspended` 在查询时实时计算

### 1.2 TaskEdge — 任务边（槽位抽象）

```typescript
interface TaskEdge {
  id: TaskEdgeId
  title: string           // 空字符串 = 待命名
  description: string
  source: NodeId          // 源节点 ID（GoalId 或 MeId）
  target: GoalId          // 目标节点 ID
  taskNodeRef?: TaskNodeId  // 可选：关联的任务系统 TaskNode
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**槽位抽象**：
- TaskEdge 更像是一个**任务的槽位**，而非任务本身
- `taskNodeRef` 为空 = 匿名边 = 空槽位，表示「要达成目标需要定义一个任务」
- 空槽位不占用任务系统资源，不会产生匿名任务
- 边的状态**派生自** `taskNodeRef` 所指任务的状态（见 §3.1）

**关联任务被取消**：
- 当 taskNodeRef 所指的 TaskNode 被取消时，边状态同步为 cancelled
- 边本身保留（记录历史），不自动删除

**起止节点可变**：
- source 和 target 允许修改（通过 `reconnectEdge` 操作）
- 修改后必须通过 DAG 检测（C6）

### 1.3 MeNode — 自我节点

```typescript
interface MeNode {
  id: MeId                // 保留 id，后续可锚定用户
  name: string
  // 后续扩展：knowledge, mindSet
}
```

- Me **不是** GoalNode 的特殊实例，是独立实体
- Me 有 id：当前系统只有一个 Me，但 id 为未来多用户场景预留扩展
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
| **C1** | 已完成不可逆 | 完成了就是完成了 | `completed` 是终态，入边冻结（不允许修改/删除/新增） |
| **C2** | 已取消不可逆 | 取消了就是取消了 | `cancelled` 是终态 |
| **C3** | 不可删除 | 取消 ≈ 删除（逻辑保留，UI 隐藏） | 目标节点无 delete 操作 |
| **C4** | Me 永驻 | 自我是起点 | Me 不可取消/完成 |
| **C5** | 无孤立目标 | 每个目标都有路可达 | 新建目标时自动创建 Me→目标匿名边 |
| **C6** | DAG 约束 | 目标网络不能形成环 | 创建/修改边时检测 |
| **C7** | 有向边 | source 是前提条件，target 是要达成的目标 | source→target = 通过此边可达 target |
| **C8** | 目标完成纯推导 | 目标不能手动标记完成 | completed 只能由完成规则推导得出 |
| **C9** | 空槽位不可完成 | 没做具体事不算达成 | taskNodeRef 为空 → 边状态锁定为 pending |
| **C10** | 任务独立性 | 任务不被目标系统约束 | 任务可独立完成，不受源头目标状态影响 |

### 2.2 图结构约束

- Me 是有效端点（边可连 Me↔目标）
- **允许平行边**：两节点间可有多条任务边，用于绑定多个「从某目标出发的不同任务」
- 边必须有两个端点（不允许悬空边）
- 边的两端不能是同一个节点（无自环）
- 边的起止节点可修改，修改后须通过 DAG 检测
- **入边冻结**：已完成（completed）的目标，其入边不允许新增、修改（reconnect）、删除；出边仍可操作。已取消的目标入边不冻结

### 2.3 实体删除策略

| 实体 | 可删除？ | 理由 |
|------|---------|------|
| GoalNode | **否**（C3） | 目的不变，取消 ≈ 删除 |
| TaskEdge | **是** | 手段可变，可替换/移除/重新规划 |

删除 TaskEdge 后需触发 C5 检查：若 target 目标因此无任何入边（只看入边，不看出边），系统自动补充 Me→目标匿名边。

---

## 3. 状态机

### 3.1 TaskEdge 状态（派生自关联任务）

TaskEdge 自身**不存储**独立状态。其状态由 `taskNodeRef` 决定：

| taskNodeRef | 边的状态 | 说明 |
|-------------|---------|------|
| 空（空槽位） | `pending` | 尚未定义具体任务，固定为待办 |
| 有值 | 与所指 TaskNode 的状态同步 | 任务进行中→边进行中，任务完成→边完成，等等 |

这意味着：
- 空槽位永远是 `pending`，不占用任务系统
- 边的状态变更 = 底层任务的状态变更，逻辑层不需要独立的 `updateEdgeStatus`
- C9 自然满足：空槽位的状态锁定为 pending，永远不会是 completed

### 3.2 GoalNode 状态（派生）

存储状态只有三种：`pending` | `completed` | `cancelled`

展示状态增加两种派生状态：

```typescript
function deriveGoalDisplayStatus(goal: GoalNode, inEdges: TaskEdge[]): GoalDisplayStatus {
  if (goal.status === 'completed') return 'completed'
  if (goal.status === 'cancelled') return 'cancelled'
  // goal.status === 'pending' 时，看入边：
  if (inEdges.some(e => getEdgeStatus(e) === 'in_progress')) return 'in_progress'
  if (inEdges.some(e => getEdgeStatus(e) === 'suspended')) return 'suspended'
  return 'pending'
}
```

| 展示状态 | 来源 | 规则 |
|----------|------|------|
| pending | 存储 | 默认 |
| in_progress | **派生** | 有任何入边处于 in_progress |
| suspended | **派生** | 无 in_progress 入边，但有 suspended 入边 |
| completed | 存储 | 由完成规则推导写入（C8） |
| cancelled | 存储 | 由 cancelGoal 操作写入 |

状态转移：
- `pending → completed`：仅由完成规则推导触发（§4）
- `pending → cancelled`：通过 `cancelGoal` 操作
- `completed` 和 `cancelled` 是终态，不可转出
- 已完成的目标不可取消

---

## 4. 完成规则（达成推导）

### 4.1 数据结构：最简与或式（DNF）

> **v0.3 核心变化**：取代 v0.2 的 `achieveMode: 'AND' | 'OR'`

```typescript
// 完成规则 = 析取范式（DNF）
// 外层 Set = OR（任一子集满足即完成）
// 内层 Set = AND（子集内所有边都须完成）
type CompletionRule = Set<Set<TaskEdgeId>>
```

**语义**：`(E1 ∧ E2) ∨ (E3 ∧ E4) ∨ ...`

**示例**：
- 全 AND：`{ {E1, E2, E3} }` = E1 且 E2 且 E3 全部完成
- 全 OR：`{ {E1}, {E2}, {E3} }` = E1 或 E2 或 E3 任一完成
- 混合：`{ {E1, E2}, {E3} }` = (E1 且 E2) 或 E3

### 4.2 UI 层兼容

当前 UI 层为了交互方便，仍暴露 AND/OR 切换：
- 用户选 AND → 逻辑层设为 `{ {所有入边} }`
- 用户选 OR → 逻辑层设为 `{ {E1}, {E2}, ... }`

API 层面暴露嵌套数组 `TaskEdgeId[][]`，RT 内部去重转为 `Set<Set<>>`。

### 4.3 推导规则

```typescript
function evaluateCompletion(rule: CompletionRule, edges: TaskEdge[]): boolean {
  // 外层 OR：任一子集满足即为 true
  for (const clause of rule) {
    // 内层 AND：子集内所有边须为 completed
    const allCompleted = [...clause].every(edgeId => {
      const edge = findEdge(edgeId)
      return edge && getEdgeStatus(edge) === 'completed'
    })
    if (allCompleted) return true
  }
  return false
}
```

注意：
- 空规则：新建目标时自动填充为 AND 模式（`{ {所有入边} }`），默认从最严格开始
- 新入边加入 completionRule 的位置由 UI 层/调用方决定（指定加入哪个子集），RT 按指定位置插入
- 含空子集 `{ {} }`：trivially satisfied（空 AND = true）
- cancelled 的边不满足 completed 条件

### 4.4 触发时机

完成推导在以下操作后触发：

1. 关联任务状态变更（通过事件订阅感知，见 §7.2）
2. TaskEdge 被删除（影响规则中的引用）
3. TaskEdge 被创建且被加入完成规则
4. 完成规则本身被修改

**任务系统集成**：目标系统通过事件订阅（如 `task.statusChanged`）感知关联任务的状态变化。懒计算无法可靠处理级联传播，因此采用事件驱动。

### 4.5 级联传播

```
入边 E 对应任务完成 → 重算 E.target 目标 G
  → 若 G 变为 completed
    → 找到所有以 G 为 source 的边 E'
      → 边 E' 保持各自状态（C10：任务独立性）
      → 重算 E'.target（沿 DAG 向下游传播）
```

关键：**目标完成不联动边的状态**。级联只传播重算，不传播状态变更。

---

## 5. 操作定义

> 所有操作都是纯逻辑的，不涉及 UI 决策。原 v0.2 中需要「用户选择」的点，改为可选参数。

### 5.1 createGoal — 创建目标

```typescript
createGoal(params: {
  title?: string
  description?: string
  completionRule?: TaskEdgeId[][]  // 省略则自动填充 AND（见 §4.2）
}): GoalNode
```

**副作用**：
- 创建 GoalNode，status = pending
- 自动创建 Me→新目标 的匿名 TaskEdge（C5）

### 5.2 createEdge — 创建任务边

```typescript
createEdge(params: {
  source: NodeId            // GoalId 或 MeId
  target: GoalId
  title?: string
  description?: string
  taskNodeRef?: TaskNodeId  // 可选：关联已有任务
}): TaskEdge
```

**前置检查**：
- source 和 target 必须存在
- source ≠ target（无自环）
- 创建后不得形成环（C6）

**副作用**：
- 创建 TaskEdge
- 触发 target 的完成重算

### 5.3 cancelGoal — 取消目标

```typescript
cancelGoal(params: {
  goalId: GoalId
  cascadeEdges?: boolean  // 是否同时取消所有关联边，默认 false
}): void
```

**前置检查**：
- 不是 Me（C4）
- 当前 status = pending（不能取消已完成的）

**行为**：
1. 设 goalNode.status = cancelled
2. 若 `cascadeEdges = true`：
   - 找到所有 target = goalId 的非终态边，取消其关联任务（若有）
   - 找到所有 source = goalId 的非终态边，取消其关联任务（若有）
   - 删除所有空槽位边（无关联任务的边直接移除）
3. 触发受影响目标的完成重算

### 5.4 deleteEdge — 删除任务边

```typescript
deleteEdge(params: {
  edgeId: TaskEdgeId
}): void
```

**副作用**：
- 从图中移除该 TaskEdge
- C5 检查：若 target 目标因此无入边，自动补充 Me→目标匿名边
- 从 target 的 completionRule 中移除对该边的引用
- 触发 target 的完成重算

### 5.5 reconnectEdge — 修改边的起止节点

```typescript
reconnectEdge(params: {
  edgeId: TaskEdgeId
  newSource?: NodeId      // 新源节点，省略则不变
  newTarget?: GoalId      // 新目标节点，省略则不变
}): void
```

**前置检查**：
- 新端点必须存在
- 新 source ≠ 新 target（无自环）
- 修改后不得形成环（C6）

**副作用**：
- 若 target 变更：从旧 target 的 completionRule 移除引用，触发旧 target 重算
- 新 target 的 completionRule 不自动包含此边（需用户/UI 显式添加）
- C5 检查（旧 target 可能变孤立）

### 5.6 splitEdge — 拆解边

```typescript
splitEdge(params: {
  edgeId: TaskEdgeId                    // 要拆解的边 A→B
  middleGoalId?: GoalId                // 用已有目标作为中间节点
  middleGoalTitle?: string             // 新中间目标的标题
  assignOriginalTo?: 'first' | 'second'  // 原边分配到前半段还是后半段，默认 'first'
}): { middleGoal: GoalNode; firstEdge: TaskEdge; secondEdge: TaskEdge }
```

**行为**：将边 A→B 拆为 A→C→B
1. 确定中间节点 C（已有或新建）
2. 原边通过 `reconnectEdge` 重定向到前半段（A→C）或后半段（C→B），由 `assignOriginalTo` 决定
3. 另一段创建新匿名边
4. DAG 检测（C6）
5. B 的 completionRule 中对原边的引用可选迁移到新的两条边之一（由调用方决定）

### 5.7 updateGoal — 更新目标属性

```typescript
updateGoal(params: {
  goalId: GoalId
  title?: string
  description?: string
  completionRule?: TaskEdgeId[][]
}): void
```

**副作用**：
- 若 completionRule 变更 → 触发完成重算

### 5.8 updateEdge — 更新任务边属性

```typescript
updateEdge(params: {
  edgeId: TaskEdgeId
  title?: string
  description?: string
  taskNodeRef?: TaskNodeId  // 绑定/解绑任务
}): void
```

---

## 6. 查询接口

| 查询 | 输入 | 输出 | 说明 |
|------|------|------|------|
| getGraph | — | GoalGraph | 完整图数据 |
| getGoal | goalId | GoalNode | 单个目标 |
| getEdge | edgeId | TaskEdge | 单条边 |
| **getInEdges** | goalId | TaskEdge[] | 目标的所有入边（高频查询，需索引优化） |
| getOutEdges | nodeId | TaskEdge[] | 节点的所有出边 |
| getEdgeStatus | edgeId | TaskEdgeStatus | 派生状态（空槽位=pending，有关联=同步任务状态） |
| deriveGoalDisplayStatus | goalId | GoalDisplayStatus | 5 种展示状态 |
| getShortestPath | from, to | string[] | 最短有向路径（节点 ID 序列） |
| getHopDistance | goalId | number | Me 到目标的最短跳数 |

**索引需求**：`getInEdges` 是完成推导的核心查询，需要 O(1) 或 O(k) 级别的访问效率（k = 入边数量）。建议维护 `targetIndex: Map<GoalId, Set<TaskEdgeId>>`。

---

## 7. 存储与日志

### 7.1 图数据存储

原型阶段：localStorage，key = `exomind:goal-graph`

序列化格式：
- GoalGraph 的 JSON
- `completionRule` 序列化为 `TaskEdgeId[][]`（嵌套数组）
- Me 有 id，作为 `graph.me` 存储

后续迁移路径：RT EventLog → PouchDB/CouchDB。

### 7.2 操作日志

原型阶段在内存中维护操作日志数组：

```typescript
interface GoalOpLog {
  action: string          // 操作名（createGoal, cancelGoal, deleteEdge, ...）
  timestamp: Timestamp
  params: Record<string, unknown>  // 操作参数
  result?: unknown        // 操作结果摘要
}
```

存储：localStorage，key = `exomind:goal-oplog`

后续迁移为 RT EventLog 时，每条操作日志对应一条事件，需定义新的事件类型。

### 7.3 任务系统事件集成

目标系统订阅任务系统的状态变更事件：

```typescript
// 任务系统发出
interface TaskStatusChangedEvent {
  taskNodeId: TaskNodeId
  oldStatus: TaskEdgeStatus
  newStatus: TaskEdgeStatus
}

// 目标系统监听 → 找到所有 taskNodeRef = taskNodeId 的边 → 触发完成重算
```

原型阶段可用简单的回调/EventEmitter；RT 阶段迁移为正式事件总线。

---

## 8. 原型阶段放宽

| 约束 | 原型行为 | 完整行为 |
|------|---------|---------|
| C5 自动匿名边 | 可选实现 | 必须 |
| C6 DAG 检测 | 可选实现 | 必须 |
| C8 完成纯推导 | 用户可直接改 | 只能推导 |
| C9 空槽位限制 | 不限制 | 限制 |
| completionRule | UI 用 AND/OR 简化 | 完整 DNF |

放宽的约束标注为 `prototype-only`。

---

## 9. 与 v0.2 的差异

| 变化点 | v0.2 | v0.3-logic |
|--------|------|-----------|
| 文档范围 | 逻辑+UI 混合 | 纯逻辑 |
| 设计哲学 | 隐含 | §0 显式陈述（目的/手段、任务独立性、拆解心智） |
| 目标状态 | 无 in_progress/suspended | 新增派生状态（§3.2） |
| 边状态 | 独立存储 | 派生自关联任务（§3.1 槽位抽象） |
| 达成方式 | `achieveMode: AND\|OR` | `completionRule: Set<Set<>>` 最简与或式 |
| 取消语义 | 混用「放弃/取消」 | 统一为「取消」 |
| Me 节点 | 有 id（isMe 标记） | 有 id（独立实体，预留多用户） |
| 边的起止 | 不可变 | 可变（reconnectEdge） |
| 任务关联 | 隐含状态 | 显式槽位抽象（空槽位=pending，不占用任务系统） |
| 平行边 | 允许 | 允许（明确用途：绑定多个任务） |

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-24 | 0.1 | 初稿（v0.1） | Claude + 用户 |
| 2026-03-24 | 0.2 | 统一设计（v0.2） | Claude + 用户 |
| 2026-03-25 | 0.3-draft | 拆分逻辑模型；吸纳十条原则（派生状态、槽位抽象、DNF 完成规则、Me 无 id、取消统一、边可重连、任务独立性） | Claude + 用户 |
