# #564 Sugiyama 布局升级计划

> **状态**：待执行
> **分支**：从 dev 新建 `feature/issue-564-sugiyama-layout`
> **PR 目标**：dev
> **关联 Issue**：#564

## Context

当前任务 DAG 使用手写的深度分层算法（`task-dag-flow.ts` 行 67-131），只做了层分配，完全缺失交叉最小化。节点按深度水平排列（`x = depth * 320px`），同层节点按拓扑序垂直堆叠（`y = row * 180px`）。复杂依赖图中边大量交叉，可读性差。

引入 `@dagrejs/dagre`（Sugiyama 完整实现：层分配 + 交叉最小化 + 坐标分配），替换手写布局。支持 TB/LR 方向切换（默认自动：竖屏 TB、横屏 LR）。边线从直线改为贝塞尔曲线。

---

## 实施计划

### 步骤 1：安装 dagre

```bash
bun add @dagrejs/dagre
bun add -d @types/dagre  # 如果类型声明单独发布
```

### 步骤 2：新建布局工具模块

**新建文件**：`src/ui/app/pages/task-dag-layout.ts`

**伪代码**：
```ts
import dagre from '@dagrejs/dagre';
import { TASK_DAG_NODE_WIDTH, TASK_DAG_NODE_HEIGHT } from './task-dag-flow';

export type DagDirection = 'TB' | 'LR' | 'auto';

function resolveDirection(direction: DagDirection, isDesktop: boolean): 'TB' | 'LR' {
  if (direction === 'auto') return isDesktop ? 'LR' : 'TB';
  return direction;
}

export function layoutDagNodes(
  nodes: Array<{ id: string; width?: number; height?: number }>,
  edges: Array<{ source: string; target: string }>,
  direction: 'TB' | 'LR',
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    nodesep: 60,    // 同层节点间距
    ranksep: 120,   // 层间距
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.width ?? TASK_DAG_NODE_WIDTH,
      height: node.height ?? TASK_DAG_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const { x, y } = g.node(node.id);
    // dagre 返回节点中心坐标，ReactFlow 需要左上角
    positions.set(node.id, {
      x: x - (node.width ?? TASK_DAG_NODE_WIDTH) / 2,
      y: y - (node.height ?? TASK_DAG_NODE_HEIGHT) / 2,
    });
  }

  return positions;
}
```

### 步骤 3：修改 buildTaskDagFlow / buildVisibleTaskDagFlow

**文件**：`src/ui/app/pages/task-dag-flow.ts`

**改动**：替换手写深度分层算法为 dagre 调用。

```diff
- // 手写深度分层（行 72-91）
- for (const taskId of graph.topologicalOrder) {
-   const depth = ...;
-   depthById.set(taskId, depth);
-   ...
- }
- // 手写位置计算（行 102-104）
- position: {
-   x: depth * COLUMN_GAP,
-   y: row * ROW_GAP,
- },

+ // dagre Sugiyama 布局
+ import { layoutDagNodes } from './task-dag-layout';
+
+ const positions = layoutDagNodes(
+   graph.nodes.map(n => ({ id: n.id })),
+   graph.edges.map(e => ({ source: e.source, target: e.target })),
+   direction, // 从参数传入
+ );
+
+ // 使用 dagre 计算的位置
+ position: positions.get(node.id) ?? { x: 0, y: 0 },
```

**注意**：
- `buildTaskDagFlow` 和 `buildVisibleTaskDagFlow` 都需要改
- 两个函数新增 `direction: 'TB' | 'LR'` 参数（加到 `BuildTaskDagFlowOptions` 接口）
- 根据方向调整 `sourcePosition` 和 `targetPosition`：
  - TB：`sourcePosition = Position.Bottom`, `targetPosition = Position.Top`
  - LR：`sourcePosition = Position.Right`, `targetPosition = Position.Left`（保持现有）

### 步骤 4：边线从直线改为贝塞尔曲线

**文件**：`src/ui/app/pages/task-dag-flow.ts`

```diff
- type: 'smoothstep',
+ type: 'default', // ReactFlow 默认 = 贝塞尔曲线
```

### 步骤 5：方向切换 UI

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

新增方向切换控件（三个 pill 按钮）：

```tsx
// 配置存储
const DAG_DIRECTION_KEY = 'exomind:dag-direction';
type DagDirection = 'TB' | 'LR' | 'auto';

// 控件 UI
<div className="flex gap-1">
  <button onClick={() => onDirectionChange('TB')}
    className={direction === 'TB' ? activeStyle : inactiveStyle}>↕</button>
  <button onClick={() => onDirectionChange('auto')}
    className={direction === 'auto' ? activeStyle : inactiveStyle}>A</button>
  <button onClick={() => onDirectionChange('LR')}
    className={direction === 'auto' ? activeStyle : inactiveStyle}>⟷</button>
</div>
```

**TaskDagControlPanel props 新增**：
```ts
direction: DagDirection;
onDirectionChange: (direction: DagDirection) => void;
```

方向存储在 `localStorage`，默认 `'auto'`（竖屏 TB、横屏 LR）。

### 步骤 6：TaskDagPage 集成

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

```tsx
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';

const DAG_DIRECTION_KEY = 'exomind:dag-direction';

const isDesktop = useIsDesktop();
const [dagDirection, setDagDirection] = useState<DagDirection>(() => {
  return (localStorage.getItem(DAG_DIRECTION_KEY) as DagDirection) ?? 'auto';
});

const handleDirectionChange = (dir: DagDirection) => {
  setDagDirection(dir);
  localStorage.setItem(DAG_DIRECTION_KEY, dir);
  // 方向变化后触发 fitView
  setTimeout(() => flowInstanceRef.current?.fitView({ padding: 0.2 }), 50);
};

const resolvedDirection = dagDirection === 'auto' ? (isDesktop ? 'LR' : 'TB') : dagDirection;

// 传入 buildVisibleTaskDagFlow
const flowGraph = useMemo(
  () => buildVisibleTaskDagFlow(visibleGraph, { ...options, direction: resolvedDirection }),
  [visibleGraph, options, resolvedDirection],
);
```

---

## 关键文件索引

| 文件 | 改动类型 |
|------|---------|
| `src/ui/app/pages/task-dag-layout.ts` | **新建** dagre 布局工具 |
| `src/ui/app/pages/task-dag-flow.ts` | 替换手写布局 → dagre + 边线改贝塞尔 |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 新增方向切换控件 |
| `src/ui/app/pages/TaskDagPage.tsx` | 集成方向状态 + 传参 |
| `package.json` | 新增 `@dagrejs/dagre` 依赖 |

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要删除 `COLUMN_GAP` / `ROW_GAP` 常量** | 保留作为 fallback/参考 |
| **不要改动 `task-dag-visibility.ts`** | 折叠算法与布局无关，只调用不改 |
| **不要改动 `TaskDagDetailPanel.tsx`** | 详情面板与布局无关 |
| **不要改动 `TaskDagModeSelector.tsx`** | 模式切换与布局无关 |
| **不要改动 `MultiTaskEndDialog.tsx`** | 对话框与布局无关 |
| **不要改动 RT 后端** | 布局是纯前端 |
| **不要让节点可拖拽** | `draggable: false` 保持不变 |
| **不要改动 `task-dag-graph.ts`** | 图构建逻辑不变，只改位置计算 |

## ⚠️ 容易出错的关键点

1. **dagre 返回节点中心坐标**，ReactFlow 需要左上角 → 必须减去 `width/2` 和 `height/2`
2. **TB 方向需要改 sourcePosition/targetPosition**：`Bottom→Top` 而非 `Right→Left`
3. **`buildVisibleTaskDagFlow` 也要改**，不只是 `buildTaskDagFlow`。两个函数共享同一套布局逻辑
4. **边线类型改为 `'default'`**（贝塞尔），不是 `'bezier'`。ReactFlow 中 `'default'` = 贝塞尔曲线
5. **方向切换后要触发 fitView**，否则画布可能偏移到视口外
6. **dagre 的 `setGraph` 参数**：`rankdir` 接受 `'TB'` | `'LR'` | `'BT'` | `'RL'`，我们只用前两个

---

## 验证

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 基础布局 | 打开 DAG 页 | 节点按 Sugiyama 分层，交叉明显减少 |
| TB 方向 | 切换为 ↕ | 节点从上到下排列，边从上指向下 |
| LR 方向 | 切换为 ⟷ | 节点从左到右排列，边从左指向右 |
| auto 竖屏 | 窄屏 / 竖屏 | 自动 TB |
| auto 横屏 | 宽屏 | 自动 LR |
| 方向持久化 | 切换方向后刷新页面 | 保持上次选择的方向 |
| 贝塞尔曲线 | 观察边线 | 平滑曲线而非直线/折线 |
| 折叠兼容 | 折叠上游后 | 布局重新计算，无重叠 |
| 搜索兼容 | 搜索过滤后 | 匹配节点正常，不匹配半透明，布局不变 |
| 过滤兼容 | 隐藏终态后 | 布局重新计算，更紧凑 |
| 性能 | 100 节点 DAG | 布局 < 100ms，无明显卡顿 |
| tsc | `bunx tsc --noEmit` | 零错误 |
| 测试 | `bunx vitest run` | DAG 相关测试通过 |
