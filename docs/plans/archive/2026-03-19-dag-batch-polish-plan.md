# DAG 批次打磨计划

> **状态**：已完成
> **分支**：直接在 `dev` 上开发（无独立分支）
> **关联 Issue**：#588, #586, #592, #557
> **前置完成**：#564（Sugiyama 布局）、#563（全画布主视图）、#558（选中高亮）、#559（过滤终态）、#560（详情栏）、#573（节点搜索）

---

## Context

当前 DAG 页面已完成交互式三波次（#501）和 Sugiyama 布局（#564），具备浏览/连接/执行三模式、搜索过滤、折叠、详情栏等能力。本批次处理四个遗留 issue：

1. **#588 软阻塞视觉修正**（bug）：软依赖上游仍为 `pending` 时，下游节点同时有 `isBlocked=true` + `isExecutable=true`，视觉和文案与"受阻"不一致
2. **#586 连接模式快速建任务**（feature）：连接模式下双击/右键空白区创建任务，减少跳转成本
3. **#592 模式切换条滑动胶囊**（UI）：将「浏览/连接/执行」切换条从三个独立按钮改为带滑动指示器的分段控件，与设置页风格统一
4. **#557 沉浸模式**（feature）：隐藏所有浮层控件，让画布最大化纵览

**执行顺序说明**：#592 必须在 #557 之前，因为 #557 要给 `TaskDagModeSelector` 加 `immersive` prop，而 #592 会重写该组件的渲染结构。先完成 #592 的结构重写，再在其基础上追加 #557 的 `immersive` 逻辑。

---

## 步骤 1：#588 软阻塞节点视觉修正

### 1.1 修正图算法：软阻塞节点不标记为 `isExecutable`

**文件**：`src/lib/task/task-dag-graph.ts`

**问题分析**：
- `isDependencyBlocking()` 行 45-61：当软依赖上游为 `pending` 时返回 `true` → `isBlocked = true` ✓
- `isTaskExecutable()` 行 64-81：只检查硬依赖 → 软阻塞节点仍然 `isExecutable = true` ✗
- 结果：节点同时 `isBlocked=true, isExecutable=true`，语义矛盾

**改动**：在 `isTaskExecutable` 中加入软依赖检查：

```ts
// src/lib/task/task-dag-graph.ts — isTaskExecutable 函数
function isTaskExecutable(task: TaskNode, taskById: Map<string, TaskNode>): boolean {
  if (task.status !== 'pending') {
    return false;
  }

  // 检查硬依赖：前置必须 completed
  const hasBlockingHardDep = task.dependsOn.some((dependency) => {
    if (dependency.type !== 'hard') {
      return false;
    }
    const predecessor = taskById.get(dependency.taskId);
    if (!predecessor) {
      return false;
    }
    return predecessor.status !== 'completed';
  });

  if (hasBlockingHardDep) {
    return false;
  }

  // ★ 新增：检查软依赖 — 如果软依赖上游仍为 pending，节点不可执行
  const hasPendingSoftDep = task.dependsOn.some((dependency) => {
    if (dependency.type !== 'soft') {
      return false;
    }
    const predecessor = taskById.get(dependency.taskId);
    if (!predecessor) {
      return false;
    }
    return predecessor.status === 'pending';
  });

  return !hasPendingSoftDep;
}
```

### 1.2 修正执行标签

**文件**：`src/ui/app/pages/task-dag-flow.ts`

**当前** `resolveExecutionLabel` 行 27-35：

```ts
function resolveExecutionLabel(node: TaskGraph['nodes'][number]): string {
  if (node.status === 'completed') return '已完成';
  if (node.status === 'cancelled') return '已取消';
  if (node.status === 'in_progress') return '进行中';
  if (node.status === 'suspended') return '已挂起';
  if (node.isBlocked) return '受阻';
  if (node.isExecutable) return '可执行';
  return '待处理';
}
```

**改动**：无需修改。修正 `isTaskExecutable` 后，软阻塞节点 `isBlocked=true, isExecutable=false`，`resolveExecutionLabel` 返回 `'受阻'`，语义正确。

### 1.3 修正执行模式状态映射

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前** `resolveExecuteState` 行 201-221：

```ts
function resolveExecuteState(...): TaskDagFlowNodeData['executeState'] {
  if (activeTaskIdSet.has(task.id)) return 'active';
  if (isTerminalStatus(task.status)) return 'terminal';
  if (isExecutable) return 'executable';     // ← 修正后软阻塞不再走这里
  if (isBlocked) return 'blocked';
  return 'blocked';
}
```

**改动**：无需修改。修正 `isTaskExecutable` 后，软阻塞节点 `isExecutable=false`，自然落入 `'blocked'` 分支。

### 1.4 修正当前根候选一致性

**文件**：`src/lib/task/task-dag-graph.ts`

`resolveCurrentRootCandidateNodeIds` 行 83-104 已经使用 `!isDependencyBlocking(task, taskById)` 排除软阻塞节点，与修正后的 `isExecutable` 一致。**无需修改**。

### 1.5 验证

```bash
bunx vitest run tests/unit/ui/task-dag-graph.issue394.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-detail-view.issue395.test.ts tests/unit/ui/task-dag-visibility.issue395.test.ts
bunx tsc --noEmit
```

**新增测试**（追加到 `tests/unit/ui/task-dag-graph.issue394.test.ts`）：

```ts
describe('#588 软阻塞节点不标记为可执行', () => {
  it('软依赖上游为 pending 时，下游节点 isExecutable=false, isBlocked=true', () => {
    const tasks = createTasks([
      { id: 'A', status: 'pending' },
      { id: 'B', status: 'pending', dependsOn: [{ taskId: 'A', type: 'soft' }] },
    ]);
    const graph = buildTaskGraph(tasks);
    const nodeB = graph.nodes.find((n) => n.id === 'B')!;
    expect(nodeB.isBlocked).toBe(true);
    expect(nodeB.isExecutable).toBe(false);
  });

  it('软依赖上游离开 pending 后，下游节点恢复 isExecutable=true', () => {
    const tasks = createTasks([
      { id: 'A', status: 'in_progress' },
      { id: 'B', status: 'pending', dependsOn: [{ taskId: 'A', type: 'soft' }] },
    ]);
    const graph = buildTaskGraph(tasks);
    const nodeB = graph.nodes.find((n) => n.id === 'B')!;
    expect(nodeB.isBlocked).toBe(false);
    expect(nodeB.isExecutable).toBe(true);
  });

  it('软阻塞节点不出现在当前根候选中', () => {
    const tasks = createTasks([
      { id: 'A', status: 'pending' },
      { id: 'B', status: 'pending', dependsOn: [{ taskId: 'A', type: 'soft' }] },
    ]);
    const graph = buildTaskGraph(tasks);
    expect(graph.currentRootCandidateNodeIds).not.toContain('B');
  });
});
```

> **注意**：测试中的 `createTasks` 辅助函数需要匹配已有测试文件中的工厂函数签名。如果不存在，仿照已有测试的任务构造方式创建。

---

## 步骤 2：#586 连接模式空白区快速创建任务

### 2.1 新建快速创建对话框组件

**新建文件**：`src/ui/app/components/TaskQuickCreateDialog.tsx`

```tsx
import { useState, type FormEvent } from 'react';

export interface TaskQuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, description: string) => void;
}

export function TaskQuickCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: TaskQuickCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setError('任务名称不能为空');
      return;
    }
    onSubmit(trimmedTitle, description.trim());
    // 重置
    setTitle('');
    setDescription('');
    setError(null);
    onOpenChange(false);
  }

  function handleCancel() {
    setTitle('');
    setDescription('');
    setError(null);
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div
      data-testid="task-quick-create-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(event) => {
        // 点击蒙层关闭
        if (event.target === event.currentTarget) handleCancel();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="mx-4 w-full max-w-md rounded-2xl border border-[#E7E5E4] bg-white p-6 shadow-xl dark:border-[#292524] dark:bg-[#1C1917]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
          快速创建任务
        </h2>

        <label className="mt-4 block">
          <span className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
            任务名称 <span className="text-[#EF4444]">*</span>
          </span>
          <input
            data-testid="task-quick-create-title"
            autoFocus
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
            placeholder="输入任务标题..."
            className="mt-1 block w-full rounded-lg border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:text-[#FAFAF9]"
          />
        </label>

        {error ? (
          <p className="mt-1 text-xs text-[#EF4444]">{error}</p>
        ) : null}

        <label className="mt-3 block">
          <span className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
            描述（可选）
          </span>
          <textarea
            data-testid="task-quick-create-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="输入任务描述..."
            rows={3}
            className="mt-1 block w-full resize-y rounded-lg border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:text-[#FAFAF9]"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="task-quick-create-cancel"
            onClick={handleCancel}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            取消
          </button>
          <button
            type="submit"
            data-testid="task-quick-create-submit"
            className="rounded-lg bg-[#C75B3A] px-4 py-2 text-xs font-medium text-white hover:bg-[#B24D2F]"
          >
            创建
          </button>
        </div>
      </form>
    </div>
  );
}
```

### 2.2 集成到 TaskDagPage

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**新增 state**：

```tsx
const [quickCreateOpen, setQuickCreateOpen] = useState(false);
```

**新增 handler**：

```tsx
async function handleQuickCreateTask(title: string, description: string) {
  try {
    await getTaskService().createTask({ title, description: description || undefined });
    toast({ title: '任务已创建', description: title });
  } catch (error) {
    toast({
      title: '创建任务失败',
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
  }
}
```

**修改 `onPaneClick`**（行 948-956）：

```tsx
onPaneClick={() => {
  if (mode === 'browse') {
    setSelectedTaskId(null);
  }
  if (mode === 'connect') {
    setConnectState(null);
  }
  setContextMenu(null);
}}
```

**新增空白区双击处理**：

```tsx
// ★ 只在连接模式下生效
onCanvasDoubleClick={() => {
  if (mode !== 'connect') return;
  setQuickCreateOpen(true);
}}
```

**注意**：实际实现没有直接使用 `ReactFlow` 的 `onPaneDoubleClick`。虽然项目依赖是 `@xyflow/react@12.10.1`，但当前类型定义和测试桩都不稳定支持该属性，因此最终落地为：在 `TaskDagPage` 的外层画布容器上监听双击/右键，再通过 `event.target` 判断是否命中了空白区。

**新增右键菜单项**：在 `onPaneClick` 旁新增 `onPaneContextMenu`：

```tsx
// ★ 需要在 ReactFlow 上新增一个事件处理器
// 用 state 记住空白区右键的位置
const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null);

// 外层画布容器上新增：
onCanvasContextMenu={(event) => {
  if (mode !== 'connect') return;
  event.preventDefault();
  setPaneContextMenu({ x: event.clientX, y: event.clientY });
}}
```

**空白区右键菜单渲染**（在 `contextMenu` 渲染之后、`TaskDagDetailPanel` 之前）：

```tsx
{paneContextMenu && mode === 'connect' ? (
  <div
    data-testid="task-dag-pane-context-menu"
    className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
    style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
  >
    <button
      type="button"
      data-testid="task-dag-pane-context-create"
      className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
      onClick={() => {
        setPaneContextMenu(null);
        setQuickCreateOpen(true);
      }}
    >
      快速创建任务
    </button>
  </div>
) : null}
```

**空白区右键菜单关闭逻辑**：在已有的 `paneClick` 中清除，并复用 document click 关闭：

```tsx
// 在 onPaneClick 中追加：
setPaneContextMenu(null);

// 在 contextMenu 的 document click listener effect 中也清除 paneContextMenu：
useEffect(() => {
  if (!paneContextMenu) return;
  const handler = () => setPaneContextMenu(null);
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
}, [paneContextMenu]);
```

**渲染对话框**（在 `<MultiTaskEndDialog>` 之后）：

```tsx
<TaskQuickCreateDialog
  open={quickCreateOpen}
  onOpenChange={setQuickCreateOpen}
  onSubmit={handleQuickCreateTask}
/>
```

### 2.3 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 浏览模式下双击空白区：不触发创建 ✓
- 执行模式下双击空白区：不触发创建 ✓
- 连接模式下双击空白区：打开创建对话框 ✓
- 连接模式下右键空白区：出现"快速创建任务"菜单项 ✓
- 提交空标题：显示错误提示 ✓
- 提交有效标题：创建任务，DAG 刷新显示新节点 ✓
- 点击蒙层或取消按钮：关闭对话框 ✓

---

## 步骤 3：#592 模式切换条滑动胶囊风格

### 3.1 背景与参考

当前 `TaskDagModeSelector.tsx` 的三模式切换条是三个独立 `<button>`，选中态靠 `bg-[#C75B3A] text-white` 填充色切换，没有滑动动画。

**参考实现**：`EstimatedTimeEditor.tsx` 行 150-153 的滑动指示器模式：
- 一个 `absolute` 定位的指示器 div，用 `transition-transform duration-200` 动画
- `width: 100/N%`，`translateX(activeIndex * 100%)` 实现滑动
- 按钮用 `relative z-10` 浮在指示器上方

### 3.2 重写 TaskDagModeSelector

**文件**：`src/ui/app/components/TaskDagModeSelector.tsx`

**完整重写伪代码**：

```tsx
export type TaskDagMode = 'browse' | 'connect' | 'execute';

const MODE_OPTIONS: ReadonlyArray<{
  key: TaskDagMode;
  label: string;
}> = [
  { key: 'browse', label: '浏览' },
  { key: 'connect', label: '连接' },
  { key: 'execute', label: '执行' },
];

interface TaskDagModeSelectorProps {
  mode: TaskDagMode;
  enabledModes?: ReadonlyArray<TaskDagMode>;
  onChange: (mode: TaskDagMode) => void;
}

function modeOptionClass(isActive: boolean, isEnabled: boolean): string {
  return [
    'relative z-10 h-8 rounded-full px-3 text-[11px] font-medium transition-colors duration-200',
    isActive
      ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
      : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]',
    !isEnabled ? 'cursor-not-allowed opacity-50 hover:text-inherit' : '',
  ].join(' ');
}

export function TaskDagModeSelector({
  mode,
  enabledModes = ['browse'],
  onChange,
}: TaskDagModeSelectorProps) {
  const enabledModeSet = new Set(enabledModes);
  const activeIndex = MODE_OPTIONS.findIndex((option) => option.key === mode);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <div className="pointer-events-auto relative overflow-hidden rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
        {/* ★ 滑动指示器 */}
        <div
          data-testid="task-dag-mode-active-indicator"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{
            width: `${100 / MODE_OPTIONS.length}%`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />

        {/* ★ 按钮网格 */}
        <div className="relative z-10 flex items-center gap-0">
          {MODE_OPTIONS.map((option) => {
            const isActive = option.key === mode;
            const isEnabled = enabledModeSet.has(option.key);
            return (
              <button
                key={option.key}
                type="button"
                data-testid={`task-dag-mode-${option.key}`}
                title={isEnabled ? `${option.label}模式` : `${option.label}模式将在后续 Wave 激活`}
                disabled={!isEnabled}
                onClick={() => onChange(option.key)}
                className={modeOptionClass(isActive, isEnabled)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

### 3.3 关键实现细节

**指示器宽度计算**：`width: ${100 / MODE_OPTIONS.length}%` = `33.333%`（3 个选项）

**指示器位置计算**：`translateX(${activeIndex * 100}%)` — 当 `activeIndex=0` 时 `translateX(0%)`，`activeIndex=1` 时 `translateX(100%)`，`activeIndex=2` 时 `translateX(200%)`

**指示器边界对齐**：
- 指示器用 `absolute inset-y-1 left-1` 与外层 `p-1` 对齐
- 注意 `width` 是基于**父容器**（外层 `div`）的百分比，而不是按钮宽度。由于外层有 `p-1`（4px padding），指示器宽度需要适配。
- **更稳妥的方案**：用固定像素宽度代替百分比。计算方式：`(容器内宽 - 2 * padding) / 3`。但由于按钮宽度由文字决定不完全等宽，推荐用 `calc((100% - 8px) / 3)` 配合 `left: calc(4px + activeIndex * (100% - 8px) / 3)`。
- **最简方案**：让按钮等宽。给每个按钮加 `flex-1`，然后指示器用 `width: calc(100% / 3)` + `translateX`。外层从 `flex` 改为 `grid grid-cols-3`。

**推荐最终方案（grid 等宽，与 EstimatedTimeEditor 一致）**：

```tsx
// 外层改为 grid
<div className="pointer-events-auto relative overflow-hidden rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
  {/* 指示器 */}
  <div
    data-testid="task-dag-mode-active-indicator"
    className="pointer-events-none absolute inset-y-1 left-1 rounded-full border border-brand-accent/40 bg-brand-accent/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
    style={{
      width: `calc((100% - 8px) / ${MODE_OPTIONS.length})`,
      transform: `translateX(${activeIndex * 100}%)`,
    }}
  />
  {/* 按钮网格 */}
  <div className={`relative z-10 grid grid-cols-${MODE_OPTIONS.length} gap-0`}>
    {/* ... buttons ... */}
  </div>
</div>
```

> **注意**：Tailwind 的 `grid-cols-3` 是静态类，可以直接写 `grid-cols-3`。不要用动态拼接 `grid-cols-${N}`，Tailwind 不会识别。

### 3.4 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 三个模式切换有连续滑动动画，不是跳变 ✓
- 选中胶囊有 `brand-accent` 边框和半透明填充 ✓
- 禁用态（如果有）仍清晰可区分 ✓
- 深色模式下指示器和文字对比度正常 ✓
- 模式语义、持久化逻辑、交互入口位置均不变 ✓

---

## 步骤 4：#557 沉浸模式

### 4.1 沉浸模式状态

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**新增 state**：

```tsx
const [immersive, setImmersive] = useState(false);
```

### 4.2 修改页面壳层：沉浸模式下隐藏 chrome

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前页面结构**（行 893-1055）：

```
<div className="flex h-full min-h-0 flex-col">
  <header>                          ← 页面标题区
    <TaskBreadcrumb />
    <h1>任务依赖 DAG</h1>
  </header>
  <div className="relative flex-1">  ← 画布壳层
    <TaskDagModeSelector />          ← 左上：模式切换
    <TaskDagControlPanel />          ← 右上：控制面板
    <ReactFlow>
      <Background />
      <Controls />                   ← 左下：缩放控件
    </ReactFlow>
    (contextMenu)
    (TaskDagDetailPanel)
    (MultiTaskEndDialog)
  </div>
</div>
```

**改动伪代码**：

```tsx
// header: 沉浸模式下隐藏
<header className={`px-5 py-4 md:px-8 lg:px-10 transition-all duration-300 ${
  immersive ? 'h-0 overflow-hidden opacity-0 py-0' : ''
}`}>
  ...
</header>

// TaskDagModeSelector: 沉浸模式下淡入淡出
// 包一层 wrapper div 实现 hover 显现
{immersive ? (
  <div className="group pointer-events-auto absolute left-3 top-3 z-10">
    <div className="opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <TaskDagModeSelector ... />
    </div>
  </div>
) : (
  <TaskDagModeSelector ... />
)}

// TaskDagControlPanel: 沉浸模式下淡入淡出
// 同理包一层 hover wrapper
{immersive ? (
  <div className="group pointer-events-auto absolute right-3 top-3 z-10">
    <div className="opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <TaskDagControlPanel ... />
    </div>
  </div>
) : (
  <TaskDagControlPanel ... />
)}

// Controls (ReactFlow 左下角): 沉浸模式下隐藏
{immersive ? null : (
  <Controls className="..." />
)}
```

**更优雅的方案**：不逐个包 wrapper，而是给画布壳层加一个 CSS 类来统一控制：

```tsx
<div
  data-testid="task-dag-canvas-shell"
  className={[
    'relative flex-1 min-h-0 overflow-hidden border-t border-[#F0ECE8] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]',
    immersive ? 'task-dag-immersive' : '',
  ].join(' ')}
>
```

然后在全局 CSS 或行内用 Tailwind 的 `group` 实现：

```css
/* 在沉浸模式下，所有浮层默认透明，hover 时显现 */
.task-dag-immersive [data-dag-chrome] {
  opacity: 0;
  transition: opacity 300ms;
}
.task-dag-immersive [data-dag-chrome]:hover {
  opacity: 1;
}
```

**推荐方案**：使用 Tailwind 的 `group/immersive` + `data-*` 属性实现，不写全局 CSS。具体实现：

1. 画布壳层 div 添加 `group/immersive` 和 `data-immersive={immersive}`
2. 各浮层组件添加条件 class：`immersive ? 'opacity-0 hover:opacity-100 transition-opacity duration-300' : ''`

**由于 Tailwind 的 `group` 仅支持 hover 传播到子元素而非同级元素，推荐最简方案**：直接在各浮层组件上用 `immersive` prop 控制 class：

```tsx
// TaskDagModeSelector — 新增 immersive prop（在步骤 3 重写后的组件上追加）
interface TaskDagModeSelectorProps {
  mode: TaskDagMode;
  enabledModes?: ReadonlyArray<TaskDagMode>;
  onChange: (mode: TaskDagMode) => void;
  immersive?: boolean;  // ★ 新增
}

// 步骤 3 重写后的根 div 上追加条件 class：
<div className={`pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 ${
  immersive ? 'opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-auto' : ''
}`}>
```

```tsx
// TaskDagControlPanel — 新增 immersive prop
interface TaskDagControlPanelProps {
  // ... 已有 props
  immersive?: boolean;  // ★ 新增
}

// 根 div 上追加条件 class：
<div className={`pointer-events-none absolute right-3 top-3 z-10 flex max-w-... ${
  immersive ? 'opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-auto' : ''
}`}>
```

### 4.3 沉浸模式入口

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

**改动**：将"适配视口"按钮替换为"沉浸模式"按钮，并把 fitView 移到沉浸模式旁边或与 Controls 合并（Controls 自带 fitView）。

**替换行 84-92 的适配视口按钮**：

```tsx
// 移除原"适配视口"按钮（行 84-92）
// 替换为"沉浸模式"切换按钮
<button
  type="button"
  data-testid="task-dag-immersive-toggle"
  onClick={onToggleImmersive}
  className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-[11px] font-medium shadow-sm transition-colors ${
    immersive
      ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A] dark:border-[#FDBA74] dark:bg-[#2A231B] dark:text-[#FDBA74]'
      : 'border-[#E7E3E0] bg-white/80 text-[#57534E] dark:border-[#3C3836] dark:bg-[#120F0D] dark:text-[#A8A29E]'
  }`}
>
  <Maximize2 size={12} />
  {immersive ? '退出沉浸' : '沉浸模式'}
</button>
```

**Props 新增**：

```tsx
interface TaskDagControlPanelProps {
  // ... 已有 props
  immersive: boolean;              // ★ 新增
  onToggleImmersive: () => void;   // ★ 新增
}
```

**新增 import**：

```tsx
import { Crosshair, EyeOff, GitBranch, LocateFixed, Maximize2, Search } from 'lucide-react';
//                                                     ^^^^^^^^^ 新增
```

### 4.4 沉浸模式快捷键

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

```tsx
// Esc 退出沉浸模式
useEffect(() => {
  if (!immersive) return;

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setImmersive(false);
    }
  }

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [immersive]);
```

### 4.5 移除 Wave 1 提示标签

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

**删除行 148-154 的 Wave 1 标签**：

```tsx
// 删除以下代码：
<span
  title="当前波次只开放浏览模式；连接/执行模式将在后续 Wave 激活。"
  className="..."
>
  <GitBranch size={12} />
  Wave 1
</span>
```

三模式已全部可用，该提示已过时。

### 4.6 TaskDagPage 集成

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

传入控制面板：

```tsx
<TaskDagControlPanel
  direction={dagDirection}
  searchValue={searchDraft}
  searchMatchCount={searchMatchCount}
  hideTerminal={hideTerminal}
  immersive={immersive}                        // ★ 新增
  onDirectionChange={setDagDirection}
  onSearchValueChange={setSearchDraft}
  onToggleHideTerminal={() => setHideTerminal((value) => !value)}
  onToggleImmersive={() => setImmersive((value) => !value)}  // ★ 新增
  onFitView={() => {
    void flowInstanceRef.current?.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
  }}
  onJumpToCurrentRoot={...}
  hasCurrentRoot={...}
/>

<TaskDagModeSelector
  mode={mode}
  enabledModes={['browse', 'connect', 'execute']}
  onChange={setMode}
  immersive={immersive}   // ★ 新增
/>
```

**header 隐藏**：

```tsx
<header className={`px-5 py-4 md:px-8 lg:px-10 ${
  immersive ? 'hidden' : ''
}`}>
```

**Controls 隐藏**：

```tsx
// ReactFlow 内部
{immersive ? null : (
  <Controls className="..." />
)}
```

### 4.7 验证

```bash
bunx tsc --noEmit
```

**手动验证**：
- 点击"沉浸模式"：header 隐藏，模式切换和控制面板淡出，Controls 隐藏
- 鼠标移到右上角：控制面板淡入
- 鼠标移到左上角：模式切换淡入
- 鼠标移开：淡出
- 点击"退出沉浸"：恢复正常布局
- 按 Esc：退出沉浸模式
- 沉浸模式下选中节点：详情栏仍可正常展示
- 沉浸模式下右键折叠：上下文菜单仍可正常弹出

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/lib/task/task-dag-graph.ts` | 修改 `isTaskExecutable` | #588 |
| `tests/unit/ui/task-dag-graph.issue394.test.ts` | 新增软阻塞测试 | #588 |
| `src/ui/app/components/TaskQuickCreateDialog.tsx` | **新建** | #586 |
| `src/ui/app/pages/TaskDagPage.tsx` | 集成快速创建 + 沉浸模式 | #586 #557 |
| `src/ui/app/components/TaskDagModeSelector.tsx` | **重写**：滑动胶囊 + immersive prop | #592 #557 |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 新增沉浸按钮 + 移除 Wave 1 | #557 |

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要改动 `task-dag-visibility.ts`** | 折叠算法不变 |
| **不要改动 `TaskDagDetailPanel.tsx`** | 详情面板不变 |
| **不要改动 `task-dag-layout.ts`** | Sugiyama 布局不变 |
| **不要改动 `task-dag-flow.ts` 的 `buildEdges`** | 边线样式不变 |
| **不要改动 RT 后端** | 所有改动都是纯前端 |
| **不要让节点可拖拽** | `draggable: false` 保持不变 |
| **不要改动 `MultiTaskEndDialog.tsx`** | 结束对话框不变 |
| **不要加浏览器全屏 API（`requestFullscreen`）** | 沉浸模式是应用内最大化，不是浏览器全屏 |
| **不要删除 `onFitView` prop** | 即使替换了按钮，fitView 功能仍通过 Controls 和跳到根节点使用 |
| **不要改动模式切换的语义/持久化/入口位置** | #592 只改视觉，三模式行为逻辑不动 |
| **不要用 Tailwind 动态类拼接（如 `grid-cols-${N}`）** | Tailwind 编译时需要完整类名，直接写 `grid-cols-3` |

## ⚠️ 容易出错的关键点

1. **`isTaskExecutable` 改动会影响所有 DAG 节点的执行状态**：确保改动后只有"软依赖上游为 pending"的情况受影响，硬依赖逻辑不变
2. **ReactFlow 空白区双击/右键处理**：当前 `@xyflow/react` 为 v12.10.1，但实际落地没有使用 `onPaneDoubleClick`，而是在外层容器上做事件委托并判定 `event.target` 是否命中 pane，避免类型和测试桩不一致
3. **右键菜单两套并存**：节点右键（`onNodeContextMenu`）和空白区右键（`onPaneContextMenu`）互不干扰。两个 state 独立
4. **滑动指示器宽度必须与按钮等宽**：用 `grid grid-cols-3` 让三个按钮等宽，指示器 `width: calc((100% - 8px) / 3)` 配合 `translateX`。`8px` = 外层 `p-1`（4px）× 2。参考 `EstimatedTimeEditor.tsx` 行 150-153 的实现
5. **滑动指示器的 `activeIndex` 计算**：`MODE_OPTIONS.findIndex(o => o.key === mode)`。如果 `mode` 不在列表中（不应发生），fallback 到 0
6. **沉浸模式下 `pointer-events`**：淡出的控件需要同时设 `pointer-events-none`，hover 显现时恢复 `pointer-events-auto`，否则透明控件会挡住画布点击
7. **`immersive ? 'hidden' : ''` vs `opacity-0`**：header 用 `hidden`（不占空间），浮层控件用 `opacity-0`（占空间，可 hover 显现）
8. **Esc 快捷键冲突**：沉浸模式的 Esc 退出应只在 `immersive=true` 时注册。搜索输入框的 Esc 由 input 自身 `onKeyDown` 处理，不会冒泡到 document
9. **测试中的任务构造**：`task-dag-graph.test.ts` 中可能使用特定的工厂函数（如 `createTasks` 或直接构造 `TaskNode[]`），新增测试需匹配已有模式
10. **#592 和 #557 改同一个文件**：先做 #592 重写结构，再在新结构上追加 #557 的 `immersive` prop。不要跳步

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 软阻塞标签 | 创建 A→(soft)→B，A 为 pending | B 显示"受阻"而非"可执行" | #588 |
| 软阻塞解除 | A 改为 in_progress | B 变为"可执行" | #588 |
| 软阻塞视觉 | 浏览模式查看软阻塞节点 | 边框黄色/60，与硬阻塞一致 | #588 |
| 执行模式软阻塞 | 执行模式查看软阻塞节点 | 黄色边框 + opacity-60 | #588 |
| 根候选一致性 | A pending, B soft-dep on A | B 不在根候选中 | #588 |
| 双击创建-浏览 | 浏览模式双击空白 | 无反应 | #586 |
| 双击创建-连接 | 连接模式双击空白 | 打开创建对话框 | #586 |
| 右键创建-连接 | 连接模式右键空白 | 出现"快速创建任务"菜单 | #586 |
| 创建-空标题 | 提交空标题 | 显示错误 | #586 |
| 创建-有效 | 提交"新任务" | DAG 刷新，新节点出现 | #586 |
| 滑动切换-浏览→连接 | 点击"连接" | 指示器从左滑到中间，200ms 动画 | #592 |
| 滑动切换-连接→执行 | 点击"执行" | 指示器从中间滑到右侧 | #592 |
| 滑动-选中色 | 观察选中胶囊 | brand-accent 边框 + 半透明填充 | #592 |
| 滑动-深色模式 | 切换深色模式 | 指示器和文字对比度正常 | #592 |
| 滑动-禁用态 | 设置某模式 disabled | 禁用项半透明、cursor-not-allowed | #592 |
| 沉浸进入 | 点击"沉浸模式" | header 隐藏，控件淡出 | #557 |
| 沉浸 hover | 鼠标移到右上 | 控制面板淡入 | #557 |
| 沉浸退出-按钮 | 点击"退出沉浸" | 恢复正常 | #557 |
| 沉浸退出-Esc | 按 Esc | 恢复正常 | #557 |
| 沉浸+详情 | 沉浸模式下选中节点 | 详情栏正常展示 | #557 |
| tsc | `bunx tsc --noEmit` | 零错误 | 全部 |
| 测试 | `bunx vitest run tests/unit/ui/task-dag-graph.issue394.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-detail-view.issue395.test.ts tests/unit/ui/task-dag-visibility.issue395.test.ts` | 通过 | 全部 |

---

## 完成回填

- 已完成 `#588`：软依赖上游为 `pending` 时，下游节点改为 `isBlocked=true` 且 `isExecutable=false`，并补了图层回归测试。
- 已完成 `#592`：三模式切换条改为滑动胶囊样式，增加活动指示器测试。
- 已完成 `#557`：支持沉浸模式、隐藏 header 与 React Flow controls、`Esc` 退出，并补页面回归测试。
- 已完成 `#586`：连接模式支持空白区双击/右键快速创建任务，新增 `TaskQuickCreateDialog` 并补页面交互测试。
- 实际验证已通过：
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/task-dag-graph.issue394.test.ts tests/unit/ui/task-dag-flow.issue564.test.ts tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-detail-view.issue395.test.ts tests/unit/ui/task-dag-visibility.issue395.test.ts`
  - 结果：5 个测试文件、43 个测试全部通过。
