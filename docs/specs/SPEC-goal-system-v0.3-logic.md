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

> C10 定义的独立性是**架构解耦**：任务系统的运行不依赖目标系统的存在。但目标系统可以通过事件/API 与任务系统**联动操作**（如级联取消），这属于用户意愿的传递，不违反独立性。

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

// 边的派生状态（继承自任务系统状态枚举）
type TaskEdgeStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'

// 目标的展示状态（全部为派生，见 §3.2 deriveGoalDisplayStatus）
type GoalDisplayStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
```

### 1.1 GoalNode — 目标节点

```typescript
interface GoalNode {
  id: GoalId
  title: string           // 空字符串 = 待命名
  description: string
  cancelled: boolean      // 唯一存储态标记，默认 false
  completionRule: Set<Set<TaskEdgeId>>  // 最简与或式（DNF），见 §4
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

**状态说明**：
GoalNode 不存储 completed 状态。所有 5 种展示状态均由 `deriveGoalDisplayStatus`（§3.2）实时派生。`cancelled` 是唯一的存储态标记。

**派生冻结**：
当 `deriveGoalDisplayStatus` 返回 `completed` 时，目标的 title、description、completionRule **不可修改**，入边冻结（§2.2）。`cancelled` 目标完全冻结。

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
- `taskNodeRef` 为空 = **空槽位边**（又称匿名边），表示「要达成目标需要定义一个任务」。全文统一使用「空槽位边」
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
| **C2** | cancelled 是唯一的存储态终态 | 取消了就是取消了 | `cancelled` 不可逆，目标完全冻结 |
| **C3** | 不可删除 | 取消 ≈ 删除（逻辑保留，UI 隐藏） | 目标节点无 delete 操作 |
| **C4** | Me 永驻 | 自我是起点 | Me 不可取消/完成 |
| **C5** | 无孤立目标 | 每个目标都有路可达 | 创建目标时必须基于已有节点，自动配套任务边 |
| **C6** | DAG 约束 | 目标网络不能形成环 | 创建/修改边时检测 |
| **C7** | 有向边 | source 是前提条件，target 是要达成的目标 | source→target = 通过此边可达 target |
| **C8** | 目标完成纯派生 | 目标不能手动标记完成 | completed 不存储，实时计算（§3.2 deriveGoalDisplayStatus） |
| **C9** | 空槽位不可完成 | 没做具体事不算达成 | taskNodeRef 为空 → 边状态锁定为 pending |
| **C10** | 任务独立性 | 任务系统不依赖目标系统存在 | 架构解耦；联动操作是用户意愿传递，不算违反 |

### 2.2 图结构约束

- Me 是有效端点（边可连 Me↔目标）
- **允许平行边**：两节点间可有多条任务边，用于绑定多个「从某目标出发的不同任务」
- 边必须有两个端点（不允许悬空边）
- 边的两端不能是同一个节点（无自环）
- 边的起止节点可修改，修改后须通过 DAG 检测
- **入边冻结**：派生状态为 completed 的目标的入边——禁止新增、修改 target（reconnect target）、删除、修改 taskNodeRef、修改 title/description；但**允许修改 source**（不影响 target 的完成判定）。cancelled 的目标入边不冻结
- **出边约束**：cancelled 的目标，禁止新增出边（包括通过 reconnectEdge 将其他边的 source 改为该节点），但已有出边可修改/删除。从 cancelled 目标出发的空槽位边成为僵尸边（永远 pending），留给 UI 层隐藏或提示用户删除

### 2.3 实体删除策略

| 实体 | 可删除？ | 理由 |
|------|---------|------|
| GoalNode | **否**（C3） | 目的不变，取消 ≈ 删除。cancelled 目标完全冻结；派生状态为 completed 的目标 title/description/completionRule 不可修改（派生冻结） |
| TaskEdge | **是** | 手段可变，可替换/移除/重新规划 |

删除 TaskEdge 后需触发 C5 检查：若 target 目标因此无任何入边（只看入边，不看出边），系统自动补充 Me→目标空槽位边。

**deleteEdge 前置检查**：若 edge.target 的派生状态为 completed，拒绝删除（入边冻结）。

---

## 3. 状态机

### 3.1 TaskEdge 状态（派生自关联任务）

TaskEdge 自身**不存储**独立状态。其状态由 `taskNodeRef` 决定，通过 `getEdgeStatus` 实时查询：

| taskNodeRef | 边的状态 | 说明 |
|-------------|---------|------|
| 空（空槽位） | `pending` | 尚未定义具体任务，固定为待办 |
| 有值 | 与所指 TaskNode 的状态同步 | 任务进行中→边进行中，任务完成→边完成，等等 |

这意味着：
- 空槽位永远是 `pending`，不占用任务系统
- 边的状态变更 = 底层任务的状态变更，逻辑层不需要独立的 `updateEdgeStatus`
- C9 自然满足：空槽位的状态锁定为 pending，永远不会是 completed

### 3.2 GoalNode 状态（派生）

GoalNode 没有存储状态。所有 5 种展示状态均由 `deriveGoalDisplayStatus` 实时派生：

```typescript
function deriveGoalDisplayStatus(goal: GoalNode, inEdges: TaskEdge[]): GoalDisplayStatus {
  if (goal.cancelled) return 'cancelled'
  if (evaluateCompletion(goal.completionRule)) return 'completed'
  if (inEdges.some(e => getEdgeStatus(e) === 'in_progress')) return 'in_progress'
  if (inEdges.some(e => getEdgeStatus(e) === 'suspended')) return 'suspended'
  // 所有入边都已终结（completed/cancelled）但规则未满足 → 挂起（等待新手段）
  const allTerminal = inEdges.length > 0 && inEdges.every(e => {
    const s = getEdgeStatus(e)
    return s === 'completed' || s === 'cancelled'
  })
  if (allTerminal) return 'suspended'
  // 注：inEdges 为空时返回 pending。原型阶段 C5 可选实现，可能出现无入边目标；完整实现中 C5 保证不会出现
  return 'pending'
}
```

优先级：`cancelled > completed > in_progress > suspended > pending`

| 展示状态 | 规则 |
|----------|------|
| cancelled | `goal.cancelled === true`（唯一存储态标记） |
| completed | `evaluateCompletion(goal.completionRule)` 为 true（纯派生，C8） |
| in_progress | 有任何入边处于 in_progress |
| suspended | 无 in_progress 入边，但有 suspended 入边；或所有入边已终结但规则未满足（等待新手段） |
| pending | 默认（以上条件均不满足） |

状态变更：
- `cancelled` 通过 `cancelGoal` 设置（不可逆）
- 其他状态完全实时派生，无状态转移图

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

**边界语义**：
- 外层空 `{}` = **永不自动完成**，需要用户重新配置完成条件
- 含空子集 `{ {} }`：写入时自动过滤空子集（§5.7），运行时防御性跳过（§4.3）。过滤后若外层为空则永不完成
- 新建目标时自动填充为 AND 模式（`{ {所有入边} }`），默认从最严格开始

### 4.2 UI 层兼容

当前 UI 层为了交互方便，仍暴露 AND/OR 切换：
- 用户选 AND → 逻辑层设为 `{ {所有入边} }`
- 用户选 OR → 逻辑层设为 `{ {E1}, {E2}, ... }`

API 层面暴露嵌套数组 `TaskEdgeId[][]`，RT 内部去重转为 `Set<Set<>>`。

新入边加入 completionRule 的**位置由 UI 层/调用方决定**（指定加入哪个子集），RT 按指定位置插入。

### 4.3 推导规则

```typescript
function evaluateCompletion(rule: CompletionRule): boolean {
  // 外层为空 → 永不完成
  if (rule.size === 0) return false
  // 外层 OR：任一子集满足即为 true
  for (const clause of rule) {
    if (clause.size === 0) continue  // 防御性跳过空子集（§5.7 保证不会写入，此处防御 bug/竞态）
    // 内层 AND：子集内所有边须为 completed
    const allCompleted = [...clause].every(edgeId => {
      const edge = getEdge(edgeId)  // 返回 null 若边不存在
      return edge && getEdgeStatus(edge.id) === 'completed'
    })
    if (allCompleted) return true
  }
  return false
}
```

注意：
- cancelled 的边不满足 completed 条件
- 规则中引用了已删除的边 → 该引用视为 false（边不存在 = 未完成）

### 4.4 删除边时的规则维护

删除边时从 completionRule 中移除该边的引用：
1. 从每个内层子集中移除该 edgeId
2. **若内层子集因此变空 → 整个子集移除**（防止空子集被防御性跳过后导致语义歧义）
3. 若外层因此变空 → 规则变为 `{}`（永不完成，需用户重新配置）

### 4.5 触发时机

完成状态是实时派生的（§3.2 `deriveGoalDisplayStatus`），每次查询时计算。以下操作会导致派生结果变化：

1. 关联任务状态变更（通过事件订阅感知，见 §7.3）
2. TaskEdge 被删除（影响规则中的引用）
3. TaskEdge 被创建且被加入完成规则
4. 完成规则本身被修改

**任务系统集成**：目标系统通过事件订阅（如 `task.statusChanged`）感知关联任务的状态变化。级联传播（§4.6）需要事件驱动通知下游目标重新查询。

### 4.6 级联传播

```
入边 E 对应任务完成 → 重新查询 E.target 目标 G 的派生状态
  → 若 G 为 cancelled → 跳过，不触发任何变更
  → 若 G 的派生状态变为 completed
    → 找到所有以 G 为 source 的边 E'
      → 边 E' 保持各自状态（C10：任务独立性）
      → 通知 E'.target 重新查询派生状态（沿 DAG 向下游传播，遇 cancelled 跳过）
```

关键：
- **目标完成不联动边的状态**。级联只传播重新查询，不传播状态变更
- **cancelled 目标跳过**。cancelled 是唯一的存储态终态，不可逆

---

## 5. 操作定义

> 所有操作都是纯逻辑的，不涉及 UI 决策。原 v0.2 中需要「用户选择」的点，改为可选参数。

### 5.1 createGoal — 基于已有节点派生目标

```typescript
createGoal(params: {
  fromNode: NodeId          // 基于哪个节点派生（默认 Me）
  direction: 'upstream' | 'downstream'  // 新目标在 fromNode 的上游还是下游
  title?: string
  description?: string
  rulePosition?: { clauseIndex: number }  // upstream 时指定新边加入 fromNode completionRule 的位置，默认 clauseIndex=0
}): { goal: GoalNode; edge: TaskEdge }
```

**行为**：
- 创建 GoalNode，cancelled = false，completionRule 自动填充为 AND（`{ {新边} }`）
- 根据 direction 创建配套 TaskEdge：
  - `downstream`：fromNode → 新目标（新目标在下游，需要从 fromNode 出发达成）
  - `upstream`：新目标 → fromNode（新目标是 fromNode 的前置条件）。新边加入 fromNode 的 completionRule；新目标自身 completionRule 初始化为 `{}`（无入边→永不自动完成，等待后续添加入边）
- **限制**：若 fromNode 是 Me 且 direction 是 upstream → 拒绝（Me 不能作为边的 target，target 类型为 GoalId）
- DAG 检测（C6）
- 返回创建的目标和边

**设计意图**：目标不能凭空创建（C5），必须基于已有节点派生，确保图始终连通。

### 5.2 createEdge — 创建任务边

```typescript
createEdge(params: {
  source: NodeId            // GoalId 或 MeId
  target: GoalId
  title?: string
  description?: string
  taskNodeRef?: TaskNodeId  // 可选：关联已有任务
  rulePosition: { clauseIndex: number }   // 加入 target completionRule 的位置（必填）。clauseIndex 越界时创建新子集
}): TaskEdge
```

**前置检查**：
- source 和 target 必须存在
- source ≠ target（无自环）
- 创建后不得形成环（C6）
- target 的派生状态不是 completed（入边冻结）
- source 不是 cancelled（禁止新增出边；注：派生状态为 completed 的目标允许新增出边，出边不冻结）

**副作用**：
- 创建 TaskEdge
- 按 `rulePosition` 将新边加入 target 的 completionRule（必填）
- 触发 target 的完成重算

### 5.3 cancelGoal — 取消目标

```typescript
cancelGoal(params: {
  goalId: GoalId
  cascadeInTasks?: boolean   // 是否取消入边关联的任务，默认 false
  cascadeOutTasks?: boolean  // 是否取消出边关联的任务，默认 false
}): void
```

**前置检查**：
- 不是 Me（C4）
- 当前未 cancelled 且派生状态非 completed（不能取消已完成的目标）

**行为**：
1. 设 goalNode.cancelled = true（目标完全冻结）
2. **边不删除**：取消目标不删除任何边（目标不可删除，边也保留以记录历史）
3. 若 `cascadeInTasks = true`：入边中有关联任务的 → 通过任务系统 API 取消关联任务（空槽位边无 taskNodeRef，不受影响）
4. 若 `cascadeOutTasks = true`：出边中有关联任务的 → 通过任务系统 API 取消关联任务（空槽位边不受影响）
5. 若 cascadeOutTasks 触发了出边关联任务的取消 → 重算这些出边的 target 目标（被取消目标自身已为终态，跳过重算）

### 5.4 deleteEdge — 删除任务边

```typescript
deleteEdge(params: {
  edgeId: TaskEdgeId
}): void
```

**前置检查**：
- edge.target 的派生状态不是 completed（入边冻结）

**副作用**：
- 从图中移除该 TaskEdge
- 从 target 的 completionRule 中移除引用（§4.4 规则维护）
- C5 检查：若 target 目标因此无入边，自动补充 Me→目标空槽位边
- target 的派生状态可能因此变化

### 5.5 reconnectEdge — 修改边的起止节点

```typescript
reconnectEdge(params: {
  edgeId: TaskEdgeId
  newSource?: NodeId      // 新源节点，省略则不变
  newTarget?: GoalId      // 新目标节点，省略则不变
  rulePosition: { clauseIndex: number }   // 加入新 target completionRule 的位置（必填）。clauseIndex 越界时创建新子集
}): void
```

**前置检查**：
- 新端点必须存在
- 新 source ≠ 新 target（无自环）
- 修改后不得形成环（C6）
- 旧 target 的派生状态若为 completed **且 newTarget 有值**（即要改 target）→ 拒绝（入边冻结）。仅改 source 时不拒绝（§2.2 允许）
- 新 target 的派生状态若为 completed → 拒绝（入边冻结）
- 新 source 若为 cancelled → 拒绝（禁止新增出边）。注：newSource 省略时不检查旧 source 状态（修改已有边，非新增出边）

**副作用**：
- 若仅 source 变更：无 completionRule 变更，无重算触发（source 不影响 target 的完成判定）
- 若 target 变更：
  - 从旧 target 的 completionRule 移除引用（§4.4），触发旧 target 重算
  - 按 `rulePosition` 将边加入新 target 的 completionRule（必填，不允许幽灵边）
- C5 检查（旧 target 可能变孤立）

### 5.6 splitEdge — 拆解边（复合操作）

```typescript
splitEdge(params: {
  edgeId: TaskEdgeId                    // 要拆解的边 A→B
  middleGoalId?: GoalId                // 用已有目标作为中间节点
  middleGoalTitle?: string             // 新中间目标的标题
  assignOriginalTo?: 'first' | 'second'  // 原边分配到前半段还是后半段，默认 'first'
}): { middleGoal: GoalNode; firstEdge: TaskEdge; secondEdge: TaskEdge }
```

**性质**：复合操作，底层调用 reconnectEdge + createGoal + createEdge 等原子操作。全部成功才生效，任一步失败则整体回滚。边界场景（如 B 为 cancelled、A 为 cancelled）的前置检查委托给底层原子操作。

**行为**：将边 A→B 拆为 A→C→B
1. 确定中间节点 C（已有或新建）
2. 原边通过 `reconnectEdge` 重定向到前半段（A→C）或后半段（C→B），由 `assignOriginalTo` 决定
3. 另一段创建新空槽位边
4. 统一 DAG 检测（C6），失败则全部回滚
5. completionRule 维护：
   - 若 `assignOriginalTo='first'`：原边重定向到 A→C，新建 C→B 边替代原边在 B 的 completionRule 中的位置
   - 若 `assignOriginalTo='second'`：原边保留为 C→B，completionRule 无需变更（原边引用仍然有效）
6. 若使用已有目标 middleGoalId 作为中间节点，新入边加入 C 的 completionRule（位置由调用方指定或默认加入第一个子集）

### 5.7 updateGoal — 更新目标属性

```typescript
updateGoal(params: {
  goalId: GoalId
  title?: string
  description?: string
  completionRule?: TaskEdgeId[][]
}): void
```

**前置检查**：
- 目标未 cancelled 且派生状态非 completed（派生冻结：cancelled 目标完全冻结，派生 completed 的目标 title/description/completionRule 不可修改）
- completionRule 中不允许存在空内层子集（写入时自动过滤空子集）
- completionRule 中的所有 edgeId 必须是该目标的实际入边（严格校验，节省后续判定开销）

**副作用**：
- 若 completionRule 变更 → 派生状态可能因此变化

### 5.8 updateEdge — 更新任务边属性

```typescript
updateEdge(params: {
  edgeId: TaskEdgeId
  title?: string
  description?: string
  taskNodeRef?: TaskNodeId  // 绑定/解绑任务
}): void
```

**前置检查**：
- 若 edge.target 的派生状态为 completed → 禁止修改 taskNodeRef（入边冻结；title/description 也冻结）

---

## 6. 查询接口

| 查询 | 输入 | 输出 | 说明 |
|------|------|------|------|
| getGraph | — | GoalGraph | 完整图数据 |
| getGoal | GoalId | GoalNode | 单个目标 |
| getEdge | TaskEdgeId | TaskEdge \| null | 单条边，不存在时返回 null（防御性处理） |
| **getInEdges** | GoalId | TaskEdge[] | 目标的所有入边（高频查询，需索引优化） |
| getOutEdges | NodeId | TaskEdge[] | 节点的所有出边 |
| getEdgeStatus | TaskEdgeId | TaskEdgeStatus | 派生状态（空槽位=pending，有关联=同步任务状态）。§3 代码中的 `getEdgeStatus(edge)` 是内部便捷形式 |
| deriveGoalDisplayStatus | GoalId | GoalDisplayStatus | 5 种展示状态 |
| getEdgesByTaskRef | TaskNodeId | TaskEdge[] | 按关联任务反查边（事件处理用） |
| getShortestPath | NodeId, NodeId | NodeId[] | 最短有向路径（排除 cancelled 边） |
| getHopDistance | GoalId | number | Me 到目标的最短跳数（排除 cancelled 边） |

**索引需求**（运行时派生，不参与序列化）：
- `targetIndex: Map<GoalId, Set<TaskEdgeId>>` — getInEdges 用，完成推导核心
- `taskRefIndex: Map<TaskNodeId, Set<TaskEdgeId>>` — getEdgesByTaskRef 用，事件处理核心

**路径计算过滤**：getShortestPath 和 getHopDistance 排除 cancelled 边（已取消的边不是有效路径）。

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
// 任务系统发出（此处 TaskEdgeStatus 仅为文档表述方便，实际应使用任务系统原生状态枚举，目标系统做映射）
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
| C2 cancelled 唯一存储态终态 | cancelled 仍为不可逆终态（保持） | 不可逆 |
| C5 自动空槽位边 | 可选实现 | 必须 |
| C6 DAG 检测 | 可选实现 | 必须 |
| C8 完成纯派生 | completed 为纯派生，原型阶段通过 override 间接影响派生结果 | 只能派生 |
| C9 空槽位限制 | 不限制 | 限制 |
| completionRule | UI 用 AND/OR 简化 | 完整 DNF |

| 级联传播 | 无深度限制，同步执行 | 引入批量重算/事件合并机制 |

放宽的约束标注为 `prototype-only`。

### 8.1 原型专属操作（prototype-only）

以下操作仅存在于原型阶段，正式版移除。

#### setEdgeStatusOverride — 临时覆盖边状态

```typescript
setEdgeStatusOverride(params: {
  edgeId: TaskEdgeId
  status: TaskEdgeStatus    // 覆盖值
}): void
```

**行为**：
- 在内存中维护 `edgeOverrides: Map<TaskEdgeId, TaskEdgeStatus>`
- `getEdgeStatus` 优先返回 override 值，无 override 时按正常派生（§3.1）
- **override 可穿透入边冻结**：即使目标的派生状态为 completed，仍可设置 override（因为 override 不走正常的边修改路径，属于原型调试用途）
- 修改后影响 `deriveGoalDisplayStatus` 的派生结果（§3.2）

**存储**：内存 Map，不参与 localStorage 序列化。页面刷新后 override 丢失。

#### clearEdgeStatusOverride — 清除边状态覆盖

```typescript
clearEdgeStatusOverride(params: {
  edgeId: TaskEdgeId
}): void
```

**行为**：从 `edgeOverrides` 中移除该边的覆盖值。边状态恢复为正常派生。关联目标的派生状态可能因此变化。

#### clearAllEdgeStatusOverrides — 清除所有边状态覆盖

```typescript
clearAllEdgeStatusOverrides(): void
```

**行为**：清空 `edgeOverrides` Map。所有受影响目标的派生状态可能因此变化。

**UI 入口**：无。仅供代码调用。页面刷新自动清除（内存 Map 不参与序列化）。

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
| 创建目标 | 凭空创建 | 基于已有节点派生（§5.1） |
| 终态冻结 | 部分 | cancelled 完全冻结；派生 completed 冻结 title/description/completionRule + 入边 |
| 入边冻结 | 无 | completed 目标入边冻结 |
| 出边约束 | 无 | cancelled 目标禁止新增出边 |
| 删除边规则维护 | 无 | §4.4 内层清空则整个子集移除 |
| 级联重算 | 未说明终态处理 | 终态目标跳过重算 |
| 操作日志 | 无 | §7.2 原型阶段操作日志数组 |
| 事件集成 | 无 | §7.3 任务状态变更事件订阅 |
| 目标 completed 状态 | 存储态 | 纯派生（§3.2） |
| GoalNode.status | 3 种存储态 | cancelled: boolean 单一标记 |

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-03-24 | 0.1 | 初稿（v0.1） | Claude + 用户 |
| 2026-03-24 | 0.2 | 统一设计（v0.2） | Claude + 用户 |
| 2026-03-25 | 0.3-draft | 拆分逻辑模型；吸纳十条原则 + 两轮审查修正（共 24 项） | Claude + 用户 |
| 2026-03-26 | 0.3-r1 | §8.1 新增原型专属操作：setEdgeStatusOverride（不受入边冻结约束）、clearEdgeStatusOverride、clearAllEdgeStatusOverrides、uncancelGoal。C1/C2 原型放宽（completed 可回退、cancelled 可撤销）。双向推导机制 | Claude + 用户 |
| 2026-03-26 | 0.3-r2 | 架构简化：completed 从存储态改为纯派生；GoalNode.status 简化为 cancelled: boolean；消除 C1；重写 §3.2 状态派生；更新 §5 操作前置检查；§8.1 删除 uncancelGoal 和双向推导 | Claude + 用户 |
