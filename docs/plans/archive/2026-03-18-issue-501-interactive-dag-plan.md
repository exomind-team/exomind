# #501 交互式 DAG 实施计划

> **状态**：待执行
> **分支**：从 dev 新建 `feature/issue-501-interactive-dag`
> **PR 目标**：dev
> **关联 Issue**：#501 (epic), #557, #558, #559, #560, #563, #573

---

## 背景

PR #552 已合并到 dev，完成了 DAG 的基础能力：
- 自定义控制面板（TaskDagControlPanel）
- 折叠上下游（安全算法 + 递归 + 下游对称）
- 右键上下文菜单
- 深色模式 + React Flow 角标隐藏
- 节点详情面板（卡片式，固定在画布右侧流式布局中）

当前 DAG 是固定高度 `h-[560px]` 的卡片布局，需升级为全画布交互式主视图。

---

## 参考文件

| 文件 | 参考什么 |
|------|---------|
| `src/ui/app/pages/agents/TopologyView.tsx` | 全画布布局、浮动控件位置、节点选中 |
| `src/ui/app/components/FocusTimerWidget.tsx` 行 540-620 | 结束反馈对话框的 JSX 结构和提交流程 |
| `src/ui/app/components/TaskStatusSelector.tsx` | 4 列任务状态选择器（直接 import 复用） |
| `src/lib/services/timeblock.service.ts` 行 82-90 | `patchActiveTaskAssociation(patch)` 接口 |
| `src/lib/services/task-timer.service.ts` 行 43-72 | `startBlockForTask(taskId, config)` 流程 |

---

## Wave 1：全画布 + 浮动控件 + 节点增强

### 步骤 1a：画布全屏化（可独立验证）

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**改动**：
```diff
- <section className="mt-4 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white dark:...">
-   <div className="h-[560px] w-full">
-     <ReactFlow ...>
+ <div className="relative flex-1 min-h-0">
+   <ReactFlow ...>
```

页面根容器改为：
```tsx
<div className="flex h-full min-h-0 flex-col" data-testid="task-dag-page">
  <header>面包屑（保留现有 TaskBreadcrumb）</header>
  <div className="relative flex-1 min-h-0">
    <ReactFlow ...>
      <Background />
      <Controls className="..." />
      <TaskDagControlPanel ... />
    </ReactFlow>
  </div>
</div>
```

**验证**：打开 `/tasks/dag`，画布应占满面包屑下方全部空间，无固定高度。

### 步骤 1b：移除固定面板 + 图例（可独立验证）

**改动**：
- 删除 `<section data-testid="task-dag-legend">` 图例说明区
- 删除 `<section data-testid="task-dag-selected-panel">` 节点详情卡片
- 图例信息改为 `<TaskDagControlPanel>` 内的 tooltip 图标（hover 显示「实线=硬依赖，虚线=软依赖」）

**验证**：画布区域无任何流式布局卡片，只有浮动控件。

### 步骤 1c：选中高亮 #558（可独立验证）

**文件**：`src/ui/app/pages/task-dag-flow.ts`, `src/ui/app/pages/TaskDagPage.tsx`

**改动**：`TaskDagFlowNodeData` 增加 `isSelected: boolean`：
```ts
// task-dag-flow.ts
export type TaskDagFlowNodeData = {
  // ...现有字段
  isSelected: boolean;  // 新增
};
```

`TaskDagNode` 组件根据 `data.isSelected` 添加样式：
```tsx
// TaskDagPage.tsx 的 TaskDagNode 组件
<div className={cn(
  "rounded-xl border px-3 py-2 text-xs ...",
  data.isSelected && "ring-2 ring-[#C75B3A] shadow-[0_0_12px_rgba(199,91,58,0.3)]"
)}>
```

`buildVisibleTaskDagFlow` 或 flow graph 构建时传入 `selectedTaskId` 参数。

**验证**：单击任一节点，该节点出现橙色发光边框；点击空白处取消。

### 步骤 1d：过滤终态节点 #559（可独立验证）

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**伪代码**：
```ts
const [hideTerminal, setHideTerminal] = useState(false);

// 在构建 flow graph 之前过滤
const filteredGraph = useMemo(() => {
  if (!hideTerminal) return visibleGraph;
  return {
    ...visibleGraph,
    nodes: visibleGraph.nodes.filter(n => n.status !== 'completed' && n.status !== 'cancelled'),
    edges: visibleGraph.edges.filter(e =>
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    ),
  };
}, [visibleGraph, hideTerminal]);
```

TaskDagControlPanel 增加 toggle：
```tsx
<button onClick={() => setHideTerminal(prev => !prev)}>
  {hideTerminal ? <Eye size={12} /> : <EyeOff size={12} />}
  {hideTerminal ? '显示已结束' : '隐藏已结束'}
</button>
```

**验证**：点击「隐藏已结束」，已完成/已取消节点消失；再点击恢复。

### 步骤 1e：搜索过滤 #573（可独立验证）

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**伪代码**：
```ts
const [searchQuery, setSearchQuery] = useState('');
const debouncedQuery = useDebounce(searchQuery, 300);

// 在节点渲染时应用搜索匹配
const searchMatchIds = useMemo(() => {
  if (!debouncedQuery.trim()) return null; // null = 不过滤
  const q = debouncedQuery.toLowerCase();
  return new Set(
    filteredGraph.nodes
      .filter(n => n.title.toLowerCase().includes(q))
      .map(n => n.id)
  );
}, [filteredGraph, debouncedQuery]);
```

节点组件读取 `data.isSearchMatch`：
```tsx
// 匹配 = 正常显示，不匹配 = opacity-30
<div className={cn(
  "...",
  data.isSearchMatch === false && "opacity-30"
)}>
```

搜索输入框浮动在控件区：
```tsx
<input
  type="text"
  value={searchQuery}
  onChange={e => setSearchQuery(e.target.value)}
  placeholder="搜索节点..."
  className="rounded-full border ... px-3 py-1 text-[11px] ..."
/>
```

**验证**：输入「测试」→ 包含「测试」的节点正常显示，其他变半透明；清空恢复。

### Wave 1 测试场景

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 全画布 | 打开 /tasks/dag | 画布占满，无 560px 限制 |
| 高亮 | 单击节点 A | A 有发光边框，其他无 |
| 高亮取消 | 单击空白处 | 所有节点无发光 |
| 过滤 | 点击「隐藏已结束」 | 已完成节点消失 |
| 过滤恢复 | 再点击 | 节点恢复 |
| 搜索 | 输入「买菜」 | 含「买菜」的节点正常，其他半透明 |
| 搜索清空 | 清空输入 | 全部恢复正常 |
| 深色模式 | 切换深色 | 控件/搜索框/画布颜色正确 |

---

## Wave 2：详情侧栏/抽屉

### 步骤 2a：TaskDagDetailPanel 组件（可独立验证）

**新建文件**：`src/ui/app/components/TaskDagDetailPanel.tsx`

**组件接口**：
```tsx
interface TaskDagDetailPanelProps {
  task: TaskNode;
  graphNode: TaskGraphNode;  // isBlocked, isExecutable 等
  allTasks: TaskNode[];      // 用于解析依赖名称
  isDesktop: boolean;
  onClose: () => void;
  onNavigateToDetail: () => void;
}
```

**横屏渲染**（`isDesktop === true`）：
```tsx
<aside className="absolute right-0 top-0 h-full w-[340px] border-l border-[#E7E5E4] bg-white p-4 shadow-lg
  dark:border-[#292524] dark:bg-[#1C1917]
  transition-transform duration-200
  {open ? 'translate-x-0' : 'translate-x-full'}">
  <button onClick={onClose}>✕</button>
  <h3>{task.title}</h3>
  <StatusBadge status={task.status} />
  <ExecutionHint node={graphNode} />
  <DependencyList task={task} allTasks={allTasks} />
  <EstimateInfo task={task} />
  <button onClick={onNavigateToDetail}>查看详情</button>
</aside>
```

**竖屏渲染**（`isDesktop === false`）：
```tsx
<div className="absolute bottom-0 left-0 right-0 h-[50vh] border-t rounded-t-2xl bg-white shadow-lg
  dark:bg-[#1C1917]
  transition-transform duration-200
  {open ? 'translate-y-0' : 'translate-y-full'}">
  {/* 同样内容，竖向排列 */}
</div>
```

**验证**：窗口宽度 > 768px 时右侧栏滑出；< 768px 时底部抽屉滑出。

### 步骤 2b：集成到 TaskDagPage（可独立验证）

**改动**：
```tsx
// TaskDagPage.tsx
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
const isDesktop = useIsDesktop();

// 单击 = 选中/显示面板
<ReactFlow onNodeClick={(_, node) => setSelectedTaskId(node.id)}>

// 双击 = 导航到详情
<ReactFlow onNodeDoubleClick={(_, node) => {
  void navigate({ to: '/tasks/$taskId', params: { taskId: node.id }, search: { from: 'dag' } });
}}>

// 点击空白 = 关闭面板
<ReactFlow onPaneClick={() => setSelectedTaskId(null)}>

// 渲染面板
{selectedTaskId && selectedTask && (
  <TaskDagDetailPanel
    task={selectedTask}
    graphNode={graphNodes.find(n => n.id === selectedTaskId)!}
    allTasks={tasks}
    isDesktop={isDesktop}
    onClose={() => setSelectedTaskId(null)}
    onNavigateToDetail={() => {
      void navigate({ to: '/tasks/$taskId', params: { taskId: selectedTaskId }, search: { from: 'dag' } });
    }}
  />
)}
```

**验证**：单击节点→面板打开；双击→跳转详情页；点空白→面板关闭。

### Wave 2 测试场景

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 横屏打开 | 宽度>768px，单击节点 | 右侧栏从右滑入 |
| 竖屏打开 | 宽度<768px，单击节点 | 底部抽屉从下滑入 |
| 关闭 | 点击画布空白 | 面板关闭 |
| 关闭按钮 | 点击面板 ✕ 按钮 | 面板关闭 |
| 双击导航 | 双击节点 | 导航到 /tasks/:id?from=dag |
| 面板缩放 | 面板打开时双指缩放画布 | 画布正常缩放，面板不动 |
| 切换选中 | 面板打开时单击另一节点 | 面板内容切换为新节点 |

---

## Wave 3：三模式（浏览/连接/执行）

### 步骤 3a：模式切换器 + 状态管理（可独立验证）

**新建文件**：`src/ui/app/components/TaskDagModeSelector.tsx`

**组件接口**：
```tsx
type DagMode = 'browse' | 'connect' | 'execute';

interface TaskDagModeSelectorProps {
  mode: DagMode;
  onChange: (mode: DagMode) => void;
}

// 三个 pill 按钮，当前模式高亮
// 样式参考 TaskDagControlPanel 的 pill 按钮
```

**TaskDagPage 集成**：
```tsx
const STORAGE_KEY = 'exomind:dag-mode';
const [dagMode, setDagMode] = useState<DagMode>(() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'connect' || saved === 'execute' ? saved : 'browse';
});

const handleModeChange = (mode: DagMode) => {
  setDagMode(mode);
  localStorage.setItem(STORAGE_KEY, mode);
};
```

**验证**：三按钮可切换，刷新后恢复上次模式。

### 步骤 3b：连接模式（可独立验证）

**连接模式状态机**：
```
                    ┌───────────────────┐
                    │   idle（无选中）   │
                    └───────┬───────────┘
                            │ 单击节点 A
                            ▼
                    ┌───────────────────┐
              ┌─────│ selected_hard(A)  │──── 单击 B ──→ 建立 A→B 硬依赖 → idle
              │     │ （实线高亮预览）   │
              │     └───────────────────┘
              │             │ 再单击 A
     单击空白  │             ▼
       → idle │     ┌───────────────────┐
              │     │ selected_soft(A)  │──── 单击 B ──→ 建立 A→B 软依赖 → idle
              │     │ （虚线高亮预览）   │
              │     └───────────────────┘
              │             │ 再单击 A
              └─────────────┘ → idle（取消选择）
```

**handleConnect 伪代码**（拖拽连线完成时）：
```ts
function handleConnect(connection: Connection, event: MouseEvent) {
  const sourceId = connection.source;
  const targetId = connection.target;
  if (!sourceId || !targetId || sourceId === targetId) return;

  const isShift = event.shiftKey;
  const newType: 'hard' | 'soft' = isShift ? 'soft' : 'hard';

  const targetTask = taskById.get(targetId);
  if (!targetTask) return;

  const existingDep = targetTask.dependsOn.find(d => d.taskId === sourceId);

  let newDependsOn: Dependency[];
  if (existingDep) {
    if (existingDep.type === newType) {
      // 同类型 → 删除（toggle off）
      newDependsOn = targetTask.dependsOn.filter(d => d.taskId !== sourceId);
    } else {
      // 异类型 → 覆盖
      newDependsOn = targetTask.dependsOn.map(d =>
        d.taskId === sourceId ? { ...d, type: newType } : d
      );
    }
  } else {
    // 新建
    newDependsOn = [...targetTask.dependsOn, { taskId: sourceId, type: newType }];
  }

  void getTaskService().updateTask(targetId, { dependsOn: newDependsOn })
    .then(() => reloadTasks())
    .catch(err => {
      // 循环依赖等后端拒绝：toast 提示
      toast.error(err.message.includes('cycle') ? '不允许循环依赖' : '操作失败');
    });
}
```

**handleClickConnect 伪代码**（点击连线）：
```ts
type ConnectState = { phase: 'idle' } | { phase: 'selected'; sourceId: string; type: 'hard' | 'soft' };

const [connectState, setConnectState] = useState<ConnectState>({ phase: 'idle' });

function handleNodeClickInConnectMode(nodeId: string) {
  if (connectState.phase === 'idle') {
    // 选中 A，预览硬依赖
    setConnectState({ phase: 'selected', sourceId: nodeId, type: 'hard' });
    return;
  }

  if (connectState.phase === 'selected') {
    if (connectState.sourceId === nodeId) {
      // 再次点击同一节点：hard→soft→idle 循环
      if (connectState.type === 'hard') {
        setConnectState({ phase: 'selected', sourceId: nodeId, type: 'soft' });
      } else {
        setConnectState({ phase: 'idle' }); // 取消
      }
      return;
    }

    // 点击了不同节点 B → 建立依赖
    applyDependency(connectState.sourceId, nodeId, connectState.type);
    setConnectState({ phase: 'idle' });
  }
}
```

**验证**：拖拽A→B建立硬依赖；Shift+拖拽建立软依赖；点击A→再点B建立；Toggle 规则正确。

### 步骤 3c：执行模式（分 3 个子步骤）

#### 执行模式状态机

```
┌─────────────────────────────────────────────────┐
│                    无活跃时间块                    │
│                                                   │
│  单击可执行节点 A                                 │
│  └→ 计算剩余时间 = estimated - spent              │
│  └→ startBlockForTask(A.id, { mode, minutes })   │
│  └→ A.status → in_progress                       │
│  └→ 进入「有活跃块」状态                          │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              有活跃时间块（taskIds: [A]）          │
│                                                   │
│  单击可执行节点 B（非已关联）                     │
│  └→ patchActiveTaskAssociation: taskIds += B      │
│  └→ B.status → in_progress                       │
│  └→ taskIds: [A, B]                              │
│                                                   │
│  单击已关联节点 A                                 │
│  └→ patchActiveTaskAssociation: taskIds -= A      │
│  └→ A.status → suspended                         │
│  └→ taskIds 还有其他？→ 是 → 继续                │
│                       → 否 → 弹出结束对话框       │
│                                                   │
│  右键任意节点 →「结束时间块」                     │
│  └→ 弹出多任务反馈对话框                          │
│                                                   │
│  双击任意节点                                     │
│  └→ 导航到 /tasks/:id?from=dag                   │
└─────────────────────────────────────────────────┘
```

#### 子步骤 3c-i：节点视觉状态（可独立验证）

`TaskDagNode` 组件根据 `dagMode === 'execute'` 和节点状态渲染不同样式：

```tsx
// task-dag-flow.ts 中增加 executeState 字段
export type TaskDagFlowNodeData = {
  // ...现有
  executeState?: 'active' | 'executable' | 'blocked' | 'terminal';
};

// TaskDagNode 渲染逻辑
if (data.executeState === 'active') {
  // 脉动边框：animate-pulse + ring-2 ring-[#C75B3A]
} else if (data.executeState === 'blocked') {
  // opacity-50 + cursor-not-allowed
} else if (data.executeState === 'terminal') {
  // opacity-30 + 灰色
}
```

**验证**：切换到执行模式，活跃节点脉动，阻塞节点半透明，终态灰色。

#### 子步骤 3c-ii：单击启动/关联/取消关联（可独立验证）

**handleNodeClickInExecuteMode 伪代码**：
```ts
async function handleNodeClickInExecuteMode(nodeId: string) {
  const node = graphNodes.find(n => n.id === nodeId);
  const task = taskById.get(nodeId);
  if (!node || !task) return;

  // 终态/阻塞 → 不响应
  if (node.status === 'completed' || node.status === 'cancelled') return;
  if (node.isBlocked) return;

  const activeBlock = await getTimeBlockService().loadActiveBlock();
  const currentTaskIds = resolveAssociatedTaskIds(activeBlock);
  const isAssociated = currentTaskIds.includes(nodeId);

  if (isAssociated) {
    // === 取消关联 ===
    const newTaskIds = currentTaskIds.filter(id => id !== nodeId);
    await getTimeBlockService().patchActiveTaskAssociation({
      taskIds: newTaskIds,
      taskAssociationLog: [...(activeBlock?.taskAssociationLog ?? []), {
        taskId: nodeId, action: 'removed', timestamp: Date.now()
      }],
    });
    await getTaskService().transitionTask(nodeId, 'suspended');

    if (newTaskIds.length === 0) {
      // 最后一个 → 弹出结束对话框
      setShowEndDialog(true);
    }
  } else if (activeBlock) {
    // === 关联到现有块 ===
    const newTaskIds = [...new Set([...currentTaskIds, nodeId])];
    await getTimeBlockService().patchActiveTaskAssociation({
      taskIds: newTaskIds,
      taskAssociationLog: [...(activeBlock.taskAssociationLog ?? []), {
        taskId: nodeId, action: 'added', timestamp: Date.now()
      }],
    });
    if (task.status === 'pending' || task.status === 'suspended') {
      await getTaskService().transitionTask(nodeId, 'in_progress');
    }
  } else {
    // === 无活跃块 → 启动新块 ===
    const spentMinutes = await getTaskTimerService().calculateSpentMinutes(nodeId);
    const remaining = task.estimatedMinutes
      ? Math.max(1, task.estimatedMinutes - spentMinutes)
      : undefined;
    const config: TimerConfig = remaining
      ? { mode: 'countdown', minutes: remaining }
      : { mode: 'countup' };
    await getTaskTimerService().startBlockForTask(nodeId, config);
  }

  await reloadTasks();
}
```

**验证**：无块时单击→启动；有块时单击未关联→关联；单击已关联→取消关联→最后一个弹对话框。

#### 子步骤 3c-iii：多任务反馈对话框（可独立验证）

**新建组件**：`src/ui/app/components/MultiTaskEndDialog.tsx`

**组件接口**：
```tsx
interface MultiTaskEndDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskIds: string[];
  taskById: Map<string, TaskNode>;
  onSubmit: (feedback: string, outcomes: Map<string, TaskStatusChoice>) => Promise<void>;
}
```

**JSX 结构**（参考 FocusTimerWidget 行 540-620）：
```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>结束时间块</DialogTitle>
    </DialogHeader>
    <Textarea placeholder="记录反馈..." value={feedback} onChange={...} />

    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">关联任务状态</p>
      {taskIds.map(taskId => {
        const task = taskById.get(taskId);
        return (
          <div key={taskId}>
            <p className="text-sm">{task?.title}</p>
            <TaskStatusSelector
              value={outcomes.get(taskId) ?? 'continue'}
              onChange={choice => setOutcomes(prev => new Map(prev).set(taskId, choice))}
            />
          </div>
        );
      })}
    </div>

    <DialogFooter>
      <Button onClick={handleSubmit}>提交</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**handleSubmit 伪代码**：
```ts
async function handleSubmit() {
  await getTimeBlockService().endBlock(feedback);
  for (const [taskId, status] of outcomes) {
    if (status !== 'continue') {
      await getTaskService().transitionTask(taskId, status as TaskStatus);
    }
  }
  onOpenChange(false);
}
```

**关键**：
- `TaskStatusSelector` 是现有组件，直接 import，不要复制代码
- `Dialog` / `DialogContent` 等是现有 shadcn/ui 组件
- 每个任务独立的状态选择器，不是统一的

**验证**：对话框弹出→显示所有关联任务→每个有独立状态选择器→提交后时间块结束+任务状态变更。

### Wave 3 测试场景

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 模式切换 | 点击「连接」按钮 | 模式切换，刷新后保持 |
| 拖拽硬依赖 | 连接模式，拖 A→B | A→B 硬依赖建立，实线 |
| Shift拖拽软依赖 | 连接模式，Shift+拖 A→B | A→B 软依赖建立，虚线 |
| Toggle 同类删除 | A→B 已有硬依赖，再拖 A→B（无 Shift） | 依赖被删除 |
| Toggle 异类覆盖 | A→B 已有硬依赖，Shift+拖 A→B | 变为软依赖 |
| 点击建立 | 点 A → 点 B | 硬依赖建立 |
| 点击软依赖 | 点 A → 再点 A → 点 B | 软依赖建立 |
| 循环拒绝 | 已有 A→B，拖 B→A | toast「不允许循环依赖」 |
| 执行-启动 | 无活跃块，单击可执行节点 | 时间块启动，节点脉动 |
| 执行-关联 | 有活跃块，单击未关联节点 | 节点加入 taskIds，变脉动 |
| 执行-取消 | 单击已关联节点 | 节点移出，变 suspended |
| 执行-最后取消 | taskIds 只剩 1 个，单击取消 | 弹出结束对话框 |
| 执行-右键结束 | 有活跃块，右键→结束 | 弹出多任务反馈对话框 |
| 反馈提交 | 填写反馈，选各任务状态，提交 | 时间块结束 + 各任务状态变更 |
| 阻塞不响应 | 执行模式，单击阻塞节点 | 无反应，hover 显示阻塞原因 |

---

## 关键文件索引

| 文件 | 用途 | Wave |
|------|------|------|
| `src/ui/app/pages/TaskDagPage.tsx` | DAG 主页面 | 1,2,3 |
| `src/ui/app/pages/task-dag-flow.ts` | Flow 节点/边构建 | 1,3 |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 浮动控件 | 1 |
| `src/ui/app/components/TaskDagDetailPanel.tsx` | **新建** 详情侧栏/抽屉 | 2 |
| `src/ui/app/components/TaskDagModeSelector.tsx` | **新建** 模式切换器 | 3 |
| `src/ui/app/components/MultiTaskEndDialog.tsx` | **新建** 多任务反馈对话框 | 3 |
| `src/lib/task/task-dag-visibility.ts` | 折叠算法（只调用不改） | 1 |
| `src/lib/task/task-dag-graph.ts` | 图构建（只调用不改） | 1 |
| `src/ui/app/pages/agents/TopologyView.tsx` | 全画布参考（只读） | 1 |
| `src/ui/app/components/FocusTimerWidget.tsx` | 反馈对话框参考（只读） | 3 |
| `src/ui/app/components/TaskStatusSelector.tsx` | 状态选择器（import 复用） | 3 |
| `src/lib/services/task-timer.service.ts` | 时间块启动（调用） | 3 |
| `src/lib/services/timeblock.service.ts` | 时间块操作（调用） | 3 |
| `src/lib/services/task.service.ts` | 依赖/状态更新（调用） | 3 |
| `src/ui/app/hooks/useIsDesktop.ts` | 横竖屏检测（import） | 2 |

---

## 数据模型（已就位，无需 RT 改动）

### 一个时间块多个任务

**已实现**。RT 和前端都已支持：

- RT：`ActiveBlockData.task_ids: Vec<String>` + `task_association_log: Vec<BlockTaskAssociationEvent>`
- RT：`task_id: Option<String>` 已标记 `#[serde(skip_serializing)]` deprecated
- 前端：`ActiveBlockData.taskIds: UUID[]` + `normalizeTaskIdList()` 去重
- 前端：`TimeBlockService.startBlock()` 已支持 `taskBinding: { taskIds: string[] }` 参数
- 前端：`TimeBlockService.patchActiveTaskAssociation(patch)` 可增量修改 taskIds + taskAssociationLog

**执行模式应操作 `taskIds` 数组**，不使用 deprecated 的 `taskId`。增删时用 `Set` 去重。

### 依赖操作

前端通过 `updateTask(taskId, { dependsOn: [...] })` 整体 PUT。连接模式在前端计算 diff 后整体提交。无需新 RT 端点。

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要改动 TasksPage.tsx** | 任务列表页已稳定，本次只改 DAG 页 |
| **不要改动 TaskDetailPage.tsx** | 任务详情页已稳定，双击导航用现有路由 |
| **不要改动 FocusTimerWidget.tsx** | 只读参考，不修改 |
| **不要重写 task-dag-visibility.ts** | 折叠算法已稳定且有测试，只调用不改 |
| **不要改动 Rust RT 结构体** | `ActiveBlockData` 已有 `task_ids` 支持 |
| **不要改动 RT 端点** | 所有接口已够用 |
| **不要引入新依赖** | 只用现有的 ReactFlow + lucide-react + Tailwind + shadcn/ui |
| **不要改动路由结构** | `/tasks/dag` 路由不变 |
| **不要改动导航栏** | 左侧导航栏不在范围 |
| **不要复制 TaskStatusSelector 代码** | 直接 import 复用 |

## ⚠️ 容易出错的关键点

### 连接模式

1. **拖拽连线**：默认 = 硬依赖，**Shift 按住** = 软依赖（不是右键！）
2. **右键菜单**：连接模式下**保留**（不禁用）
3. **Toggle 规则必须严格遵守**：同类型 = 删除，异类型 = 覆盖。参考上方伪代码
4. **`event.shiftKey` 获取**：在 `onConnectEnd` 或 `onConnect` 的 MouseEvent 参数中读取

### 执行模式

5. **单击 = 启动/关联/取消关联**，**双击 = 进入详情页**。两个事件并存
6. **取消关联的最后一个任务时**：必须弹出 MultiTaskEndDialog，不能静默结束
7. **反馈对话框**：用 `MultiTaskEndDialog` 新组件，每个任务独立 `TaskStatusSelector`
8. **阻塞节点**：`opacity-50` + 不可点击 + hover title 提示阻塞原因
9. **关联/取消关联后必须 reloadTasks()**：确保 UI 状态刷新

### 全画布

10. **面包屑保留在画布上方**（固定 header），不是浮动在画布内部
11. **所有浮动控件在 ReactFlow 容器内部**（absolute 定位）

---

## 需要涉及 RT 的改动清单

**结论：本次实施无需任何 RT 改动。** 所有接口均已就绪。

| 改动 | 涉及 RT？ |
|------|-----------|
| 全画布/高亮/过滤/搜索 | ❌ |
| 详情侧栏/抽屉 | ❌ |
| 模式切换器 | ❌ |
| 连接模式依赖操作 | ❌（用 `updateTask({ dependsOn })`) |
| 执行模式时间块操作 | ❌（用 `startBlock` / `patchActiveTaskAssociation` / `endBlock`） |
| 执行模式任务状态变更 | ❌（用 `transitionTask`） |

---

## 测试策略

- 每个步骤完成后运行 `bunx tsc --noEmit`
- 每个 Wave 完成后运行 `bunx vitest run`
- **不需要跑 `cargo test`**（无 RT 改动）
- 每个步骤有独立的验证标准，不要跳过

---

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 执行模式状态机复杂 | 高 | 上方有完整状态机图和伪代码，严格遵守 |
| 连接模式 Shift+拖拽 | 中 | `onConnect` 的 event 参数可读 shiftKey |
| 竖屏抽屉 | 中 | 先做固定 50vh 高度，后续迭代加拖拽 |
| 多任务对话框 | 中 | 上方有完整组件接口和 JSX 结构 |
| 单击/双击冲突 | 中 | ReactFlow 原生支持 onClick + onDoubleClick 分离 |
