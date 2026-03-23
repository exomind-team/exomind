# 批次 A''：DAG 三期——工具框布局 + 搜索增强 + 智能隐藏 + 聚焦升级

> **状态**：待执行
> **分支**：直接在 `dev` 上开发
> **关联 Issue**：#608, #624, #637, #609, #607, #610, #629, #630, #631, #632
> **执行顺序**：#608 → #624 → #637 → #609 → #607 → #610 → #629 → #630 → #631 → #632

---

## Context

DAG 一期（三模式 + Sugiyama）和二期（键盘 + 交互增强）已全部完成。三期聚焦工具框布局升级和散件打磨：

**核心 4 步**（原计划）：
1. **#608**（极小）：工具框↔图例上下位置互换
2. **#609**（大）：搜索框独立成行 + 描述/模糊/过滤三选项 + 持久化
3. **#607**（中）：隐藏已结束保留承载未结束下游的终态节点
4. **#610**（中）：跳到根节点升级为按执行状态聚焦节点集合

**追加 6 个极小散件**（每个 1-5 行改动）：
5. **#624**（极小）：对外命名统一为「任务依赖图」（页面标题、breadcrumb 文案）
6. **#637**（极小）：右下角提示板最大宽度扩展到页面内容宽度的 1/2
7. **#629**（极小）：浏览模式下已选中节点的 Enter/Space 等价于鼠标左键点击（触发详情/双击导航）
8. **#630**（小）：浏览模式节点详情打开时隐藏右上角工具栏与图例
9. **#631**（极小）：节点折叠状态 localStorage 持久化
10. **#632**（极小）：选中节点时切换模式，节点样式立即热更新

---

## 步骤 1：#608 工具框在上、图例在下

### 1.1 改动

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

**当前**（行 60-145）：根容器内先渲染图例（行 61-69）再渲染工具框（行 71-145）。

**改为**：交换两个 div 的渲染顺序——工具框在前，图例在后。

```tsx
<div className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
  {/* ★ 工具框（原来在下方，现在在上方） */}
  <div className={[
    'pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-2xl border ...',
    immersive ? '...' : '',
  ].join(' ')}>
    {/* 搜索、隐藏已结束、沉浸、方向、跳到根节点 */}
  </div>

  {/* ★ 图例（原来在上方，现在在下方） */}
  <div className={[
    'pointer-events-auto flex items-center gap-2 rounded-full border ...',
    immersive ? '...' : '',
  ].join(' ')}>
    {legendChip('H', '硬依赖...', '...', 'task-dag-legend-hard-chip')}
    {legendChip('S', '软依赖...', '...', 'task-dag-legend-soft-chip')}
  </div>
</div>
```

就是把行 61-69 和行 71-145 的位置互换，不改内容。

### 1.2 验证

```bash
bunx tsc --noEmit
```

---

## 步骤 2：#609 搜索框独立成行 + 搜索选项

### 2.1 搜索选项状态

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

新增 3 个搜索选项状态，带 localStorage 持久化：

```ts
const SEARCH_OPTIONS_KEY = 'exomind:dag-search-options';

interface DagSearchOptions {
  includeDescription: boolean;  // 默认 false
  fuzzy: boolean;               // 默认 true
  filterMode: boolean;          // 默认 false
}

const DEFAULT_SEARCH_OPTIONS: DagSearchOptions = {
  includeDescription: false,
  fuzzy: true,
  filterMode: false,
};

function readStoredSearchOptions(): DagSearchOptions {
  try {
    const saved = window.localStorage.getItem(SEARCH_OPTIONS_KEY);
    if (saved) return { ...DEFAULT_SEARCH_OPTIONS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_SEARCH_OPTIONS;
}

const [searchOptions, setSearchOptions] = useState(() => readStoredSearchOptions());

useEffect(() => {
  try {
    window.localStorage.setItem(SEARCH_OPTIONS_KEY, JSON.stringify(searchOptions));
  } catch { /* ignore */ }
}, [searchOptions]);
```

### 2.2 修改搜索匹配逻辑

**文件**：`src/ui/app/pages/task-title-fuzzy-search.ts`（或新建）

当前 `filterTasksByTitleFuzzySearch` 只匹配标题。扩展为：

```ts
export function filterTasksBySearch(
  tasks: TaskNode[],
  query: string,
  options: { includeDescription: boolean; fuzzy: boolean },
): TaskNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return tasks;

  return tasks.filter((task) => {
    const title = task.title.toLowerCase();
    const description = options.includeDescription ? (task.description ?? '').toLowerCase() : '';
    const searchText = `${title} ${description}`;

    if (options.fuzzy) {
      return extractTaskTitleSearchQuery(normalizedQuery)
        .every((term) => searchText.includes(term));
    }
    return searchText.includes(normalizedQuery);
  });
}
```

### 2.3 过滤模式

当 `filterMode = true` 时，DAG 只显示匹配的节点（类似 hideTerminal 过滤）。当 `filterMode = false` 时，仍使用当前的高亮 + 半透明方式。

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

在构建 flowGraph 的位置，增加 filterMode 分支：

```ts
// 如果 filterMode 且有搜索词，过滤 visibleGraph 只保留匹配节点
const searchFilteredGraph = searchOptions.filterMode && searchDraft.trim()
  ? filterNodesBySearch(renderedVisibleGraph, searchDraft, searchOptions)
  : renderedVisibleGraph;
```

### 2.4 工具框布局调整

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

搜索框从工具框内部提取为独立一行，放在工具框上方：

```tsx
<div className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[min(28rem,calc(100%-1.5rem))] flex-col items-end gap-2">
  {/* 第 1 行：搜索框独立行 */}
  <div className={[
    'pointer-events-auto flex w-full items-center gap-2 rounded-2xl border ... p-2',
    immersive ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '',
  ].join(' ')}>
    <label className="flex flex-1 items-center gap-2 ...">
      <Search size={12} />
      <input ... placeholder="搜索节点标题..." />
      {hasSearch ? <span>{searchMatchCount}</span> : null}
    </label>
    {/* 搜索选项多选枚举 */}
    <div className="flex items-center gap-1">
      {(['描述', '模糊', '过滤'] as const).map((label, i) => {
        const keys: (keyof DagSearchOptions)[] = ['includeDescription', 'fuzzy', 'filterMode'];
        const key = keys[i];
        const active = searchOptions[key];
        return (
          <button
            key={key}
            onClick={() => onSearchOptionToggle(key)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              active ? 'bg-[#FFF7ED] text-[#C75B3A]' : 'text-[#A8A29E] hover:text-[#57534E]'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  </div>

  {/* 第 2 行：主控制区（隐藏已结束、沉浸、方向、聚焦） */}
  <div className={['pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-2xl border ... p-2', ...].join(' ')}>
    {/* 隐藏已结束、沉浸模式、方向切换、聚焦按钮 */}
  </div>

  {/* 第 3 行：图例 */}
  <div className={[...].join(' ')}>
    {legendChip('H', ...)}
    {legendChip('S', ...)}
  </div>
</div>
```

### 2.5 Props 变更

`TaskDagControlPanel` 新增 props：

```ts
searchOptions: DagSearchOptions;
onSearchOptionToggle: (key: keyof DagSearchOptions) => void;
```

### 2.6 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 搜索框在工具框上方独立一行 ✓
- 描述/模糊/过滤三选项可切换，选中高亮 ✓
- 刷新后搜索选项保持 ✓
- 过滤模式：只显示匹配节点 ✓
- 非过滤模式：高亮 + 半透明 ✓

---

## 步骤 3：#607 隐藏已结束保留承载下游的终态节点

### 3.1 算法设计

**文件**：`src/ui/app/pages/TaskDagPage.tsx`（`filterTerminalNodesFromVisibleGraph` 函数）

**当前**：直接移除所有 `completed/cancelled` 节点。

**改为**：仅移除"整条下游链路都已终态"的终态节点。

```ts
function filterTerminalNodesFromVisibleGraph(visibleGraph: VisibleTaskGraph): VisibleTaskGraph {
  // 1. 找出所有终态节点
  const terminalNodeIds = visibleGraph.nodes
    .filter((n) => isTerminalStatus(n.status))
    .map((n) => n.id);
  const terminalIdSet = new Set(terminalNodeIds);

  // 2. 构建邻接表：source → target[]
  const downstream = new Map<string, string[]>();
  for (const edge of visibleGraph.edges) {
    const targets = downstream.get(edge.source) ?? [];
    targets.push(edge.target);
    downstream.set(edge.source, targets);
  }

  // 3. 判断一个终态节点是否"承载未结束下游"
  function hasActiveDownstream(nodeId: string, visited: Set<string>): boolean {
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const children = downstream.get(nodeId) ?? [];
    for (const childId of children) {
      const child = visibleGraph.nodes.find((n) => n.id === childId);
      if (!child) continue;
      if (!isTerminalStatus(child.status)) return true; // 找到未结束的下游
      if (hasActiveDownstream(childId, visited)) return true; // 递归检查
    }
    return false;
  }

  // 4. 只隐藏"整条下游链路都已终态"的终态节点
  const safeToHide = terminalNodeIds.filter(
    (id) => !hasActiveDownstream(id, new Set())
  );
  const hideIdSet = new Set(safeToHide);

  // 5. 过滤
  const nodes = visibleGraph.nodes.filter((n) => !hideIdSet.has(n.id));
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edges = visibleGraph.edges.filter(
    (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
  );

  // 6. 重算根节点
  const incomingCount = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }
  const visibleRootNodeIds = nodes.map((n) => n.id).filter((id) => (incomingCount.get(id) ?? 0) === 0);
  const visibleCurrentRootNodeId = nodes.find((n) => new Set(visibleRootNodeIds).has(n.id))?.id ?? null;

  return {
    ...visibleGraph,
    nodes,
    edges,
    hiddenNodeIds: [...visibleGraph.hiddenNodeIds, ...safeToHide],
    visibleRootNodeIds,
    visibleCurrentRootNodeId,
  };
}
```

### 3.2 验证

```bash
bunx tsc --noEmit
bunx vitest run tests/unit/ui/task-dag-visibility.issue395.test.ts
```

**新增测试**：

```ts
describe('#607 隐藏已结束保留承载下游', () => {
  it('终态节点有未结束下游时不隐藏', () => {
    // A(completed) → B(pending)
    // 开启隐藏已结束后，A 仍然可见
  });

  it('终态节点下游全部终态时隐藏', () => {
    // A(completed) → B(completed)
    // 开启隐藏已结束后，A 和 B 都隐藏
  });

  it('链式终态：中间有未结束节点则上游终态保留', () => {
    // A(completed) → B(pending) → C(completed)
    // A 保留（因为 B 未结束），C 隐藏（无下游）
  });
});
```

---

## 步骤 4：#610 按执行状态聚焦节点集合

### 4.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前** `handleJumpToCurrentRoot`：跳到单个根节点。

**改为** `handleFocusActionableNodes`：按执行状态聚焦一组节点。

```ts
function handleFocusActionableNodes() {
  const activeTaskIds = resolveActiveBlockTaskIds(activeBlock);

  let targetNodeIds: string[];

  if (activeTaskIds.length > 0) {
    // 有时间块执行中 → 聚焦所有关联任务节点
    targetNodeIds = activeTaskIds.filter((id) => visibleNodeIdSet.has(id));
  } else {
    // 无时间块 → 聚焦所有未阻塞可执行节点
    targetNodeIds = flowGraph.nodes
      .filter((n) => {
        const graphNode = taskGraph.nodes.find((gn) => gn.id === n.id);
        return graphNode?.isExecutable && !graphNode?.isBlocked;
      })
      .map((n) => n.id);
  }

  if (targetNodeIds.length === 0) return;

  flowInstanceRef.current?.fitView({
    nodes: targetNodeIds.map((id) => ({ id })),
    duration: 300,
    padding: 0.3,
  });
}
```

### 4.2 按钮文案更新

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

**当前**（行 133-143）：

```tsx
<LocateFixed size={12} />
跳到根节点
```

**改为**：根据是否有活跃时间块显示不同文案。

需要新增 prop：

```ts
hasActiveBlock: boolean;
```

按钮改为：

```tsx
<LocateFixed size={12} />
{hasActiveBlock ? '聚焦执行中' : '聚焦可执行'}
```

**显示条件**：始终显示（移除 `hasCurrentRoot` 条件判断），因为无论何时都可以聚焦可执行节点。

### 4.3 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 无时间块时点击"聚焦可执行" → 视口覆盖所有 isExecutable 节点 ✓
- 有时间块时点击"聚焦执行中" → 视口覆盖所有关联任务节点 ✓
- 无可执行节点时按钮仍可见但点击无反应 ✓

---

## 步骤 5：#624 对外命名统一为「任务依赖图」

### 5.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

将页面标题和 breadcrumb 中的「任务依赖 DAG」改为「任务依赖图」：

```tsx
// header h1（约行 967）
<h1>任务依赖图</h1>  // 原来是「任务依赖 DAG」

// breadcrumb current label（约行 963）
current={{ label: '依赖图', icon: Waypoints }}  // 原来是「DAG 视图」
```

**注意**：代码内部变量名（`TaskDagPage`、`task-dag-flow.ts` 等）保持不变，只改用户可见文案。

---

## 步骤 6：#637 提示板最大宽度扩展

### 6.1 改动

**文件**：`src/ui/app/components/TaskDagKeyHints.tsx`

将提示板根 div 的 `max-w` 从当前固定值改为 `max-w-[50%]`（页面内容宽度的 1/2）。

如果当前没有 max-w 限制，新增：

```tsx
className="... max-w-[50%] ..."
```

---

## 步骤 7：#629 Enter/Space 等价于左键点击（浏览模式）

### 7.1 改动

**文件**：`src/ui/app/hooks/useTaskDagKeyboard.ts`

在 `handleKeyDown` 中，浏览模式下 Enter/Space 已选中节点时，触发与鼠标单击相同的行为（打开详情面板）。

新增 option callback：

```ts
onBrowseActivate?: (nodeId: string) => void;  // 浏览模式 Enter/Space 激活节点
```

在 handleKeyDown 中追加：

```ts
if ((key === 'Enter' || key === ' ') && mode === 'browse' && selectedTaskId) {
  event.preventDefault();
  onBrowseActivate?.(selectedTaskId);
  return;
}
```

TaskDagPage 中传入：

```tsx
onBrowseActivate={(nodeId) => {
  // 等价于鼠标单击：确保详情面板打开（selectedTaskId 已设置）
  // 如果需要双击行为（导航到详情页），可以通过快速连按检测
}}
```

---

## 步骤 8：#630 浏览模式详情打开时隐藏工具栏

### 8.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

当浏览模式下 `selectedTaskId` 非空（详情面板打开）时，隐藏右上角工具栏和图例，让详情面板获得更多空间。

```tsx
// TaskDagControlPanel 和图例的渲染条件：
const hideControlPanel = mode === 'browse' && selectedTaskId !== null;

// 在工具栏/图例外层加条件：
{hideControlPanel ? null : (
  <TaskDagControlPanel ... />
)}
```

**注意**：只在浏览模式隐藏。连接/执行模式下即使有选中也不隐藏（用户需要工具栏操作）。

---

## 步骤 9：#631 折叠状态 localStorage 持久化

### 9.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

当前 `dagVisibility`（含 `collapsedUpstreamOf`、`collapsedDownstreamOf`）是纯内存态。改为 localStorage 持久化：

```ts
const DAG_VISIBILITY_KEY = 'exomind:dag-visibility';

function readStoredVisibility(): TaskDagVisibilityState {
  try {
    const saved = window.localStorage.getItem(DAG_VISIBILITY_KEY);
    if (saved) return { ...EMPTY_TASK_DAG_VISIBILITY_STATE, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return EMPTY_TASK_DAG_VISIBILITY_STATE;
}

const [dagVisibility, setDagVisibility] = useState(() => readStoredVisibility());

useEffect(() => {
  try {
    window.localStorage.setItem(DAG_VISIBILITY_KEY, JSON.stringify(dagVisibility));
  } catch { /* ignore */ }
}, [dagVisibility]);
```

---

## 步骤 10：#632 选中节点切换模式时样式热更新

### 10.1 问题

当用户选中一个节点后切换模式（浏览→连接），节点的样式（如选中环、执行态高亮）没有立即更新，需要取消选中再重新选中才生效。

### 10.2 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

确保 `flowGraph` 的 `useMemo` 依赖包含 `mode`。如果当前没有包含，追加：

```ts
const flowGraph = useMemo(
  () => buildVisibleTaskDagFlow(renderedVisibleGraph, {
    // ... 已有参数 ...
    mode,  // ★ 确保 mode 在依赖中
  }),
  [renderedVisibleGraph, /* ... */, mode],  // ★ 追加 mode
);
```

如果 `buildVisibleTaskDagFlow` 不接受 mode 参数，则检查 `TaskDagNode` 渲染组件是否正确读取了 `nodeData` 中随 mode 变化的字段（如 `executeState`、`showConnectHandles`）。问题可能在于 node data 的引用没有随 mode 变化而更新。

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/ui/app/components/TaskDagControlPanel.tsx` | 布局重排 + 搜索独立行 + 聚焦按钮 | #608 #609 #610 |
| `src/ui/app/pages/TaskDagPage.tsx` | 搜索选项 + 过滤 + 聚焦 + 隐藏算法 + 命名 + 详情隐藏工具栏 + 折叠持久化 | #609 #607 #610 #624 #630 #631 #632 |
| `src/ui/app/pages/task-title-fuzzy-search.ts` | 扩展搜索匹配逻辑 | #609 |
| `src/ui/app/components/TaskDagKeyHints.tsx` | 最大宽度扩展 | #637 |
| `src/ui/app/hooks/useTaskDagKeyboard.ts` | 浏览模式 Enter/Space 激活 | #629 |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| **不要改动 useTaskDagKeyboard.ts** | 键盘导航不变 |
| **不要改动 TaskDagModeSelector.tsx** | 模式切换不变 |
| **不要改动 task-dag-layout.ts** | Sugiyama 布局不变 |
| **不要改动 task-dag-visibility.ts** | 折叠算法不变（#607 改的是 TaskDagPage 中的 filter 函数） |
| **不要引入全文搜索库** | 搜索用简单 includes/split 即可 |

## ⚠️ 容易出错的关键点

1. **#608 只是交换顺序**：不改内容、不改 class、不改 immersive 逻辑，只交换两个 div 的渲染位置
2. **#609 搜索选项 JSON 持久化**：`JSON.parse` 要 try-catch，合并时用 `{ ...DEFAULT, ...parsed }` 保证新字段有默认值
3. **#607 hasActiveDownstream 递归要防环**：用 `visited: Set<string>` 避免 DAG 中可能的边缘情况
4. **#607 不改 task-dag-visibility.ts**：`filterTerminalNodesFromVisibleGraph` 在 TaskDagPage.tsx 中定义，不在 visibility 模块中
5. **#610 fitView 到多个节点**：`fitView({ nodes: [{ id: '...' }, ...] })` 在 @xyflow/react v12 中会自动计算包围盒
6. **#610 移除 hasCurrentRoot 条件**：按钮始终可见，不再依赖 `hasCurrentRoot && onJumpToCurrentRoot`

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 布局顺序 | 观察右上角 | 工具框在上、图例在下 | #608 |
| 搜索独立行 | 观察搜索框 | 单独一行，与控制按钮分离 | #609 |
| 描述搜索 | 开启"描述"选项，搜索描述中的文字 | 命中 | #609 |
| 精确搜索 | 关闭"模糊"选项 | 需完整包含搜索词 | #609 |
| 过滤模式 | 开启"过滤" | 只显示匹配节点 | #609 |
| 选项持久化 | 开启描述→刷新 | 仍然开启 | #609 |
| 智能隐藏 | A(完成)→B(待办)，开启隐藏 | A 仍可见 | #607 |
| 全链终态 | A(完成)→B(完成)，开启隐藏 | 都隐藏 | #607 |
| 聚焦-无时间块 | 点击"聚焦可执行" | 视口覆盖可执行节点 | #610 |
| 聚焦-有时间块 | 点击"聚焦执行中" | 视口覆盖关联节点 | #610 |
| 命名 | 页面标题和 breadcrumb | 显示「任务依赖图」而非「DAG」| #624 |
| 提示板宽度 | 大量提示项 | 最大宽度不超过页面 50% | #637 |
| Enter 浏览 | 浏览模式选中节点按 Enter | 等价于鼠标单击 | #629 |
| 详情隐藏工具栏 | 浏览模式选中节点 | 工具栏和图例隐藏 | #630 |
| 详情隐藏-连接模式 | 连接模式选中节点 | 工具栏仍显示 | #630 |
| 折叠持久化 | 折叠上游→离开→返回 | 折叠状态保持 | #631 |
| 切模式样式 | 选中节点后 Ctrl+→ 切模式 | 节点样式立即更新 | #632 |
| tsc | `bunx tsc --noEmit` | 零错误 | 全部 |

---

## 完成回填

- 执行日期：2026-03-21
- 执行结果：#608 #624 #637 #609 #607 #610 #629 #630 #631 #632 已按顺序完成
- 主要落地：
  - `TaskDagControlPanel.tsx`：搜索框独立成行，新增描述/模糊/过滤三选项，控制区与图例顺序调整为“搜索行 → 工具框 → 图例”，聚焦按钮改为始终可见并按活跃时间块动态显示“聚焦执行中 / 聚焦可执行”
  - `TaskDagPage.tsx`：页面标题与 breadcrumb 改为“任务依赖图”；新增搜索选项与折叠状态 localStorage 持久化；搜索过滤模式；终态节点智能隐藏；浏览模式详情打开时隐藏右上角控制区；聚焦逻辑升级为 `fitView` 到执行中/可执行节点集合；`flowGraph` 热更新依赖补入 `mode`
  - `task-title-fuzzy-search.ts`：扩展为支持标题/描述、模糊/精确两种搜索
  - `TaskDagKeyHints.tsx`：提示板最大宽度调整为 `max-w-[50%]`
  - `useTaskDagKeyboard.ts`：仅追加浏览模式 `Enter / Space` 激活回调，未改原有连接/平移/缩放键盘逻辑
- 验证命令：
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx`
  - `bunx vitest run tests/unit/ui/task-dag-visibility.issue395.test.ts`
- 验证结果：
  - `tsc` 通过
  - `task-dag-page.issue394`：43/43 通过
  - `task-dag-visibility.issue395`：9/9 通过
