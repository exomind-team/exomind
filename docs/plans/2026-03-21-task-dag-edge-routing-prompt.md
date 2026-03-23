# Codex 实现提示词：task-dag 跨层连边沿 dagre dummy 节点路径绘制

> Issue: #662
> 分支：`fix/issue-662-dagre-edge-routing`，基于 `dev`

---

## 目标

当前 task-dag 使用 `@dagrejs/dagre` 做 Sugiyama 分层布局。dagre 在 `layout()` 后为每条边计算了完整的路径点（含 dummy 节点坐标），存储在 `graph.edge(e).points` 中。但当前代码 **只读取了节点坐标**，边的渲染使用 ReactFlow 内置的 `type: 'default'`（朴素 Bezier 曲线），完全忽略了 dagre 的路径信息。

这导致跨层连边走直线/简单 Bezier，与其他边产生 **视觉假交叉**，丢失了 Sugiyama 交叉最小化的成果。

**本次改动**：让边沿 dagre 计算的 dummy 节点路径绘制，使用「去共线 + 直线段(L) + 三次 Bezier 弯道(C)」方案。

---

## 技术栈

- **布局库**：`@dagrejs/dagre` ^2.0.4
- **渲染库**：`@xyflow/react`（ReactFlow v12）
- **语言**：TypeScript（严格模式）
- **构建**：Vite + bun
- **测试**：Vitest
- **Node 验证**：`npx tsc --noEmit` + `npx vitest run`

---

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/ui/app/pages/task-dag-layout.ts` | **修改** | 补充返回 edge points |
| `src/ui/app/pages/task-dag-flow.ts` | **修改** | 传递 points 到 edge data，改 edge type |
| `src/ui/app/pages/TaskDagPage.tsx` | **修改** | 注册 edgeTypes |
| `src/ui/app/pages/DagreRoutedEdge.tsx` | **新增** | 自定义 Edge 组件 |
| `tests/unit/pages/dagre-routed-edge.test.ts` | **新增** | 路径生成的纯函数单元测试 |

---

## 详细改动说明

### 1. `task-dag-layout.ts`

**当前签名**：

```typescript
export function layoutDagNodes(
  nodes: DagLayoutNode[],
  edges: DagLayoutEdge[],
  direction: ResolvedDagDirection,
): Map<string, { x: number; y: number }>
```

**改为**：

```typescript
export type DagLayoutResult = {
  nodePositions: Map<string, { x: number; y: number }>;
  edgePoints: Map<string, Array<{ x: number; y: number }>>;
};

export function layoutDagNodes(
  nodes: DagLayoutNode[],
  edges: DagLayoutEdge[],
  direction: ResolvedDagDirection,
): DagLayoutResult
```

**实现要点**：

- 在 `dagre.layout(graph)` 之后，遍历 `graph.edges()` 读取 `graph.edge(e).points`
- edge key 格式为 `"${e.v}\0${e.w}"`（用 NUL 分隔，避免与 ID 中可能出现的字符冲突）
- dagre 返回的 points 是**绝对坐标**（与 node center 同坐标系），无需偏移
- 节点坐标仍然需要做 `x - width/2, y - height/2` 转换（与现有逻辑一致）

**注意**：返回值结构变了，所有调用方（`task-dag-flow.ts` 中的 `resolveNodePositions`）需要同步适配。

---

### 2. `task-dag-flow.ts`

#### 2.1 适配 `layoutDagNodes` 新返回值

`resolveNodePositions` 函数当前只返回节点坐标。改为同时返回边路径点：

```typescript
function resolveNodePositions(
  orderedNodeIds: string[],
  edges: Array<{ source: string; target: string }>,
  direction: ResolvedDagDirection,
): {
  nodePositions: Map<string, { x: number; y: number }>;
  edgePoints: Map<string, Array<{ x: number; y: number }>>;
}
```

当 dagre 失败 fallback 到 `buildFallbackPositions` 时，`edgePoints` 返回空 Map（fallback 布局没有 dagre 路径信息，此时边渲染会自动降级为默认 Bezier）。

#### 2.2 `buildEdges` 增加 points 参数

```typescript
function buildEdges(
  edges: Array<{ id: string; source: string; target: string; type: 'hard' | 'soft' }>,
  edgePoints: Map<string, Array<{ x: number; y: number }>>,
): TaskDagFlowEdge[]
```

为每条边注入 dagre 路径点：

```typescript
{
  id: edge.id,
  source: edge.source,
  target: edge.target,
  type: 'dagreRouted',  // ← 从 'default' 改为自定义类型
  data: {
    points: edgePoints.get(`${edge.source}\0${edge.target}`) ?? null,
    hardEdge: edge.type === 'hard',
  },
  animated: false,
  selectable: false,
  // style 和 markerEnd 保持不变
}
```

**降级策略**：当 `data.points` 为 null 或长度 < 2 时，自定义 Edge 组件内部 fallback 到 ReactFlow 内置的 `getBezierPath()`。

#### 2.3 更新 `buildTaskDagFlow` 和 `buildVisibleTaskDagFlow`

两个函数都需要：
1. 从 `resolveNodePositions` 获取 `edgePoints`
2. 将 `edgePoints` 传递给 `buildEdges`

---

### 3. `TaskDagPage.tsx`

在 `TASK_DAG_NODE_TYPES` 旁边增加：

```typescript
import { DagreRoutedEdge } from './DagreRoutedEdge';

const TASK_DAG_EDGE_TYPES = {
  dagreRouted: DagreRoutedEdge,
} satisfies EdgeTypes;
```

在 `<ReactFlow>` 组件上添加 `edgeTypes` prop：

```tsx
<ReactFlow<TaskDagFlowNode, TaskDagFlowEdge>
  nodes={flowGraph.nodes}
  edges={flowGraph.edges}
  nodeTypes={TASK_DAG_NODE_TYPES}
  edgeTypes={TASK_DAG_EDGE_TYPES}   // ← 新增
  ...
>
```

**注意**：`TASK_DAG_EDGE_TYPES` 必须定义在组件外部（与 `TASK_DAG_NODE_TYPES` 同级），不能在 render 函数内定义，否则每次渲染都会创建新对象导致 ReactFlow 重新挂载所有边。

---

### 4. `DagreRoutedEdge.tsx`（新增文件）

这是核心新增件。位置：`src/ui/app/pages/DagreRoutedEdge.tsx`

#### 4.1 组件签名

```typescript
import { type EdgeProps, getBezierPath, BaseEdge } from '@xyflow/react';

type DagreRoutedEdgeData = {
  points?: Array<{ x: number; y: number }> | null;
  hardEdge?: boolean;
};

export function DagreRoutedEdge(props: EdgeProps<DagreRoutedEdgeData>): JSX.Element
```

#### 4.2 路径生成算法（核心逻辑）

将以下纯函数独立导出（方便测试）：

```typescript
export function buildDagreRoutedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  dagrePoints: Array<{ x: number; y: number }>,
  cornerRadius?: number,
): string
```

**参数说明**：
- `sourceX/Y`：ReactFlow 计算的 source handle 坐标（用作路径起点）
- `targetX/Y`：ReactFlow 计算的 target handle 坐标（用作路径终点）
- `dagrePoints`：dagre 返回的完整路径点数组（含首尾的边界附着点）
- `cornerRadius`：拐角圆角半径，默认 20px

**算法步骤**：

**Step 1：拼接路径点**

用 ReactFlow handle 坐标替换 dagre 的首尾附着点（dagre 首尾点可能偏离 ReactFlow handle 位置），保留 dagre 的中间路径点：

```
points = [
  { x: sourceX, y: sourceY },         // ReactFlow handle
  ...dagrePoints.slice(1, -1),         // dagre 中间路径点（dummy 节点）
  { x: targetX, y: targetY },         // ReactFlow handle
]
```

**Step 2：去除共线中间点**

遍历 points，检测连续三点是否共线。共线判定：

```typescript
function isCollinear(a: Point, b: Point, c: Point, epsilon = 0.5): boolean {
  // 叉积接近 0 → 共线
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) < epsilon;
}
```

去除共线中间点后得到 **关键点数组** `keyPoints`。保留首尾点，只去除中间的共线点。

**Step 3：生成 SVG path**

遍历 `keyPoints`，对每对相邻线段的拐角生成三次 Bezier 圆角：

```
对于关键点序列 [p0, p1, p2, ..., pn]:

M p0                                      // 移动到起点

对每个内部拐点 pi (i = 1 to n-1):
  d_in  = normalize(pi - p_{i-1})         // 入射方向
  d_out = normalize(p_{i+1} - pi)         // 出射方向

  // 圆角的起止点
  r_eff = min(cornerRadius, dist(p_{i-1}, pi)/2, dist(pi, p_{i+1})/2)
  S = pi - r_eff * d_in                   // 圆角起点（在入射直线段上）
  E = pi + r_eff * d_out                  // 圆角终点（在出射直线段上）

  // 三次 Bezier 控制点
  cp1 = S + (r_eff / 3) * d_in
  cp2 = E - (r_eff / 3) * d_out

  L S.x,S.y                               // 直线到圆角起点
  C cp1.x,cp1.y cp2.x,cp2.y E.x,E.y      // 三次 Bezier 弯道

L pn.x,pn.y                               // 直线到终点
```

**关键细节**：
- `r_eff` 取 `cornerRadius` 和相邻线段长度一半的**最小值**，防止线段太短时圆角溢出
- `normalize` 返回单位向量：`{ x: dx/len, y: dy/len }`
- 如果 `keyPoints` 只有 2 个点（直连，无中间 dummy），直接返回 `M sourceX,sourceY L targetX,targetY`

#### 4.3 组件渲染

```typescript
export function DagreRoutedEdge({
  id, sourceX, sourceY, targetX, targetY,
  data, style, markerEnd,
}: EdgeProps<DagreRoutedEdgeData>) {
  const points = data?.points;

  // 降级：无 dagre 路径时用默认 Bezier
  if (!points || points.length < 2) {
    const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY });
    return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
  }

  const path = buildDagreRoutedPath(sourceX, sourceY, targetX, targetY, points);
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
```

注意使用 ReactFlow 的 `<BaseEdge>` 组件渲染，它自动处理 marker、交互区域等。

#### 4.4 样式

边的样式（stroke color、width、dasharray）仍然通过 `style` prop 传入（在 `buildEdges` 中设置），DagreRoutedEdge 不需要管样式逻辑。hard/soft 的视觉区分保持不变。

---

### 5. 单元测试

文件：`tests/unit/pages/dagre-routed-edge.test.ts`

测试 `buildDagreRoutedPath` 纯函数：

#### 测试用例

```typescript
describe('buildDagreRoutedPath', () => {
  // 1. 只有 2 个点（源→目标直连）→ 应生成 M...L 直线
  it('returns straight line for 2 points', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 100, [
      { x: 0, y: 0 }, { x: 100, y: 100 },
    ]);
    expect(path).toBe('M 0,0 L 100,100');
  });

  // 2. 共线 3 点 → 去除中间点 → 直线
  it('removes collinear intermediate point', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 0, [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
    ]);
    expect(path).toBe('M 0,0 L 100,0');
  });

  // 3. 共线 5 点（垂直走廊）→ 去除 3 个中间点 → 直线
  it('removes multiple collinear points in vertical corridor', () => {
    const path = buildDagreRoutedPath(50, 0, 50, 400, [
      { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 50, y: 200 },
      { x: 50, y: 300 }, { x: 50, y: 400 },
    ]);
    expect(path).toBe('M 50,0 L 50,400');
  });

  // 4. 有一个拐点 → path 包含 L 和 C 命令
  it('generates L + C + L for single bend', () => {
    const path = buildDagreRoutedPath(0, 0, 100, 200, [
      { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 200 },
    ]);
    expect(path).toContain('M ');
    expect(path).toContain('L ');
    expect(path).toContain('C ');
    // 不应包含 Q（应该用三次 Bezier，不是二次）
    expect(path).not.toContain('Q ');
  });

  // 5. cornerRadius 受短线段约束（不溢出）
  it('clamps corner radius to half of shortest adjacent segment', () => {
    // 两段各 10px，cornerRadius=20 → r_eff 应为 5
    const path = buildDagreRoutedPath(0, 0, 10, 10, [
      { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 },
    ], 20);
    // 验证没有越界：path 中坐标不应超出 [0,10] 范围
    const numbers = path.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(11);
    }
  });

  // 6. dagre 典型输出：入口斜线 → 垂直走廊 → 出口斜线
  it('handles entry-corridor-exit pattern', () => {
    const path = buildDagreRoutedPath(222, 140, 222, 520, [
      { x: 273, y: 140 },  // dagre 边界附着点（被 sourceX/Y 替换）
      { x: 316, y: 200 },  // dummy 入口
      { x: 316, y: 330 },  // dummy 走廊（共线，应去除）
      { x: 316, y: 460 },  // dummy 出口
      { x: 273, y: 520 },  // dagre 边界附着点（被 targetX/Y 替换）
    ]);
    // 应有 2 个 C 命令（入口弯道 + 出口弯道）
    const cCount = (path.match(/C /g) ?? []).length;
    expect(cCount).toBe(2);
    // 起止点应为 ReactFlow handle 坐标
    expect(path.startsWith('M 222,140')).toBe(true);
    expect(path.endsWith('L 222,520')).toBe(true);
  });

  // 7. 首尾替换：dagre 首尾点被 sourceX/Y、targetX/Y 替换
  it('replaces dagre boundary points with ReactFlow handle coords', () => {
    const path = buildDagreRoutedPath(100, 0, 100, 300, [
      { x: 130, y: 0 },    // dagre 边界（应被 100,0 替换）
      { x: 150, y: 100 },
      { x: 150, y: 200 },
      { x: 130, y: 300 },  // dagre 边界（应被 100,300 替换）
    ]);
    expect(path.startsWith('M 100,0')).toBe(true);
    expect(path).toContain('150');
    expect(path).not.toContain('130'); // dagre 边界坐标不应出现
  });
});
```

---

## 约束与注意事项

1. **不改动任何节点渲染逻辑**。节点的类型、样式、交互全部不动。
2. **不改动边的样式**。hard（实线/红色）和 soft（虚线/灰色）的视觉区分保持不变，由 `style` prop 控制。
3. **不改动边的交互**。`selectable: false`、`animated: false` 保持不变。
4. **TypeScript 严格模式**。所有新代码必须通过 `npx tsc --noEmit`，不允许 `any`。
5. **坐标精度**。SVG path 中的坐标使用最多 1 位小数（`toFixed(1)`），避免过长的小数。但如果 toFixed(1) 的结果以 `.0` 结尾则省略小数部分。
6. **`TASK_DAG_EDGE_TYPES` 必须定义在 React 组件外部**（模块顶层 const），与 `TASK_DAG_NODE_TYPES` 一致，避免每次 render 重新创建。
7. **fallback**：当 dagre 未返回 edge points 或 points 数组长度 < 2 时，使用 ReactFlow 的 `getBezierPath` 作为降级。
8. **cornerRadius 默认 20px**，定义为模块级常量 `DAGRE_EDGE_CORNER_RADIUS`。
9. **edge key 格式**：`"${source}\0${target}"`，使用 NUL 字符分隔。在 `buildEdges` 中查找时使用相同格式。
10. **LR 方向同样适用**。dagre 在 `rankdir: 'LR'` 下也输出 edge points，算法不假设特定方向——方向由 dagre 布局决定，我们只用其输出的绝对坐标。

---

## 验证步骤

```bash
# 1. 类型检查
npx tsc --noEmit

# 2. 运行单元测试
npx vitest run tests/unit/pages/dagre-routed-edge.test.ts

# 3. 运行所有测试（确认无回归）
npx vitest run

# 4. 启动开发服务器视觉验证
npx vite --host 0.0.0.0 --port 5173
# 打开 http://localhost:5173/tasks/dag
# 检查：
#   - 跨层边是否沿走廊绘制（不再穿过中间节点区域）
#   - 同层短边是否仍然平滑（降级到默认 Bezier）
#   - 拐角是否圆滑（无生硬折角）
#   - 直线走廊是否笔直（无 S 形波动）
#   - hard 边（红色实线）和 soft 边（灰色虚线）视觉区分是否正常
#   - 箭头（markerEnd）方向是否正确指向目标节点
#   - LR 和 TB 方向切换后边是否正常
```

---

## 完成回填

- 完成时间：2026-03-22
- 执行结果：已完成核心实现
- 实际改动：
  - `src/ui/app/pages/task-dag-layout.ts`
    - `layoutDagNodes` 改为返回 `nodePositions + edgePoints`
    - 新增 `buildDagLayoutEdgeKey()`，使用 `source\0target` 作为 edge key
  - `src/ui/app/pages/task-dag-flow.ts`
    - 适配新的 layout 返回值
    - 为边注入 dagre points 到 `data.points`
    - 边类型从 `default` 改为 `dagreRouted`
    - fallback 布局下返回空 `edgePoints`
  - `src/ui/app/pages/TaskDagPage.tsx`
    - 新增模块级 `TASK_DAG_EDGE_TYPES`
    - 在 `<ReactFlow>` 上注册 `edgeTypes`
  - `src/ui/app/pages/DagreRoutedEdge.tsx`
    - 新增自定义 Edge 组件
    - 新增 `buildDagreRoutedPath()` 纯函数
    - 实现“首尾 handle 替换 + 去共线 + L/C 圆角路径 + bezier fallback”
  - `tests/unit/pages/dagre-routed-edge.test.ts`
    - 新增 7 个路径生成单测
  - `tests/unit/ui/task-dag-flow.issue564.test.ts`
    - 同步更新旧断言，边类型改为 `dagreRouted`
- 验证结果：
  - `bunx tsc --noEmit` 通过
  - `npx vitest run tests/unit/pages/dagre-routed-edge.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts` 通过
  - `npx vitest run` 在本地跑到约 5 分钟后因既有测试大量 stderr 输出触发 `EPIPE` 并超时，未拿到完整结果；当前未观察到与本次 DAG 改动直接相关的失败
- 未执行项：
  - 未进行人工浏览器视觉验收；如需我继续，可启动 `vite` 并给出具体 UI 验证步骤
