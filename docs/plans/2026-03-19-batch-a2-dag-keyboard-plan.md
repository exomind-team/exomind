# 批次 A'：DAG 二期打磨计划（键盘导航 + 交互增强）

> **状态**：待执行
> **分支**：直接在 `dev` 上开发（无独立分支）
> **关联 Issue**：#600, #601, #598, #599
> **依赖链**：#600 → #601 → #598 → #599（#599 依赖 #598 的键盘焦点基础设施）

---

## Context

DAG 一期（批次 A）已完成 Sugiyama 布局、三模式交互、搜索/过滤/折叠/详情栏/沉浸模式/快速建任务。本批次聚焦四个遗留项：

1. **#600**（bug）：隐藏已结束开关缺少 localStorage 持久化
2. **#601**（feature）：连接模式下已选起点后，空白单击改为带依赖语义的快速创建
3. **#598**（feature）：基础键盘导航——模式切换、画布平移、WASD 节点方向导航
4. **#599**（feature）：连接模式高级键盘建边——Enter/Space 建边、Tab/Shift+Tab 快速创建上下游

---

## 步骤 1：#600 隐藏已结束开关持久化

### 1.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前**：`hideTerminal` 是 `useState(false)` 内存态。

**改为**：与 `mode`、`dagDirection` 一致，从 localStorage 读写。

```ts
const TASK_DAG_HIDE_TERMINAL_KEY = 'exomind:dag-hide-terminal';

function readStoredHideTerminal(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(TASK_DAG_HIDE_TERMINAL_KEY) === '1';
  } catch {
    return false;
  }
}

// 替换原来的 useState(false)：
const [hideTerminal, setHideTerminal] = useState(() => readStoredHideTerminal());

// 新增 effect 持久化：
useEffect(() => {
  try {
    window.localStorage.setItem(TASK_DAG_HIDE_TERMINAL_KEY, hideTerminal ? '1' : '0');
  } catch {
    // Ignore storage failures.
  }
}, [hideTerminal]);
```

### 1.2 验证

```bash
npx tsc --noEmit
```

**手动验证**：
- 打开隐藏已结束 → 离开 DAG → 返回 → 仍然隐藏 ✓
- 刷新页面 → 仍然隐藏 ✓
- 关闭隐藏已结束 → 刷新 → 不隐藏 ✓

---

## 步骤 2：#601 起点已设后空白单击建带依赖任务

### 2.1 修改 onPaneClick 行为

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前** `onPaneClick`（行 1035-1044）：

```tsx
onPaneClick={() => {
  if (mode === 'browse') { setSelectedTaskId(null); }
  if (mode === 'connect') { setConnectState(null); }  // ← 直接清空
  setContextMenu(null);
  setPaneContextMenu(null);
}}
```

**改为**：连接模式下，如果已有起点，空白单击改为打开快速创建对话框（带依赖语义）。

```tsx
onPaneClick={() => {
  if (mode === 'browse') {
    setSelectedTaskId(null);
  }
  if (mode === 'connect') {
    if (connectState) {
      // ★ 已有起点 → 改为带依赖的快速创建
      // 默认：新任务是下游（dependsOn 起点）
      // Shift+单击：新任务是上游（起点 dependsOn 新任务）
      const isUpstream = (event as unknown as MouseEvent).shiftKey ?? false;
      setQuickCreateOpen(true);
      setQuickCreateDependency({
        sourceTaskId: connectState.sourceId,
        type: connectState.type,
        direction: isUpstream ? 'upstream' : 'downstream',
      });
    }
    // 没有起点时不做任何事（双击/右键仍可打开无依赖创建）
  }
  setContextMenu(null);
  setPaneContextMenu(null);
}}
```

### 2.2 新增 quickCreateDependency 状态

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

```tsx
const [quickCreateDependency, setQuickCreateDependency] = useState<{
  sourceTaskId: string;
  type: 'hard' | 'soft';
  direction: 'upstream' | 'downstream';
} | null>(null);
```

### 2.3 修改 handleQuickCreateTask

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**当前** `handleQuickCreateTask` 只创建任务，不加依赖。

**改为**：创建后自动建立依赖关系。

```tsx
async function handleQuickCreateTask(title: string, description: string) {
  try {
    const created = await getTaskService().createTask({
      title,
      description: description || undefined,
    });

    // ★ 如果带依赖语义，自动建立依赖
    if (quickCreateDependency) {
      if (quickCreateDependency.direction === 'downstream') {
        // 新任务是下游 → 新任务 dependsOn 起点
        await getTaskService().addDependency(
          created.id,
          quickCreateDependency.sourceTaskId,
          quickCreateDependency.type,
        );
      } else {
        // 新任务是上游 → 起点 dependsOn 新任务
        await getTaskService().addDependency(
          quickCreateDependency.sourceTaskId,
          created.id,
          quickCreateDependency.type,
        );
      }
      // 建完清空连接状态
      setConnectState(null);
      setQuickCreateDependency(null);
    }

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

### 2.4 清理：对话框关闭时重置依赖上下文

```tsx
<TaskQuickCreateDialog
  open={quickCreateOpen}
  onOpenChange={(open) => {
    setQuickCreateOpen(open);
    if (!open) {
      setQuickCreateDependency(null);
    }
  }}
  onSubmit={handleQuickCreateTask}
/>
```

### 2.5 取消起点的方式

用户可通过以下方式取消连接起点：
1. **Esc 键**：将在步骤 3 的 `useTaskDagKeyboard` hook 中统一处理（**本步骤不写 Esc 处理**）
2. **再次点击同一起点节点**：已有行为（hard→soft→清空循环），不需要改

> **注意**：步骤 2 完成后 Esc 暂时不可用于清空连接状态。步骤 3 的 hook 会统一接管所有键盘事件（含 Esc）。

### 2.6 验证

```bash
npx tsc --noEmit
```

**手动验证**：
- 连接模式，无起点，空白单击 → 不触发任何事 ✓
- 连接模式，选中起点（hard），空白单击 → 打开创建对话框 ✓
- 提交后新任务自动依赖起点（hard） ✓
- 选中起点（soft），空白单击 → 创建后自动 soft 依赖 ✓
- Esc 可清空起点 ✓
- 再次点击起点节点 → hard→soft→清空循环 ✓

---

## 步骤 3：#598 基础键盘导航

### 3.1 键盘事件中枢 hook

**新建文件**：`src/ui/app/hooks/useTaskDagKeyboard.ts`

这个 hook 集中处理 DAG 页面的所有键盘事件，避免散落在多个 useEffect 中。

```ts
import { useEffect, useCallback } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';
import type { TaskDagFlowNode, TaskDagFlowEdge } from '@/ui/app/pages/task-dag-flow';

const MODE_ORDER: TaskDagMode[] = ['browse', 'connect', 'execute'];

export interface TaskDagKeyboardOptions {
  mode: TaskDagMode;
  immersive: boolean;
  selectedTaskId: string | null;
  connectState: { sourceId: string; type: 'hard' | 'soft' } | null;
  flowNodes: TaskDagFlowNode[];
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null;
  panSpeed: number; // px per keydown

  onModeChange: (mode: TaskDagMode) => void;
  onImmersiveChange: (immersive: boolean) => void;
  onSelectedTaskIdChange: (taskId: string | null) => void;
  onConnectStateChange: (state: { sourceId: string; type: 'hard' | 'soft' } | null) => void;
}

function isInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (active as HTMLElement).isContentEditable;
}

// ── 方向寻找算法：±45° 扇形 + 最近欧氏距离 ──
type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_ANGLES: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

function findNearestNodeInDirection(
  currentNodeId: string,
  direction: Direction,
  nodes: TaskDagFlowNode[],
): string | null {
  const current = nodes.find((n) => n.id === currentNodeId);
  if (!current) return null;

  const cx = current.position.x + (current.measured?.width ?? 256) / 2;
  const cy = current.position.y + (current.measured?.height ?? 140) / 2;
  const targetAngle = DIRECTION_ANGLES[direction];
  const halfCone = Math.PI / 4; // ±45°

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const node of nodes) {
    if (node.id === currentNodeId) continue;

    const nx = node.position.x + (node.measured?.width ?? 256) / 2;
    const ny = node.position.y + (node.measured?.height ?? 140) / 2;

    const dx = nx - cx;
    const dy = ny - cy;
    const angle = Math.atan2(dy, dx);

    // 角度差（处理环绕）
    let diff = angle - targetAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) > halfCone) continue;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = node.id;
    }
  }

  return bestId;
}

/**
 * 只在节点即将移出视口时才平移，保持当前缩放不变。
 * 不用 fitView（会改变缩放），而是手动 setViewport。
 */
function ensureNodeVisible(
  nodeId: string,
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null,
  nodes: TaskDagFlowNode[],
): void {
  if (!flowInstance) return;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const viewport = flowInstance.getViewport();
  const { zoom } = viewport;
  const nodeWidth = node.measured?.width ?? 256;
  const nodeHeight = node.measured?.height ?? 140;

  // 节点在屏幕坐标中的位置
  const screenX = node.position.x * zoom + viewport.x;
  const screenY = node.position.y * zoom + viewport.y;
  const screenW = nodeWidth * zoom;
  const screenH = nodeHeight * zoom;

  // 获取画布容器尺寸（ReactFlow 的 DOM 容器）
  const container = document.querySelector('[data-testid="task-dag-canvas-shell"]');
  if (!container) return;
  const { clientWidth: cw, clientHeight: ch } = container;

  const margin = 40; // 边距
  let dx = 0;
  let dy = 0;

  if (screenX < margin) dx = margin - screenX;
  if (screenX + screenW > cw - margin) dx = (cw - margin) - (screenX + screenW);
  if (screenY < margin) dy = margin - screenY;
  if (screenY + screenH > ch - margin) dy = (ch - margin) - (screenY + screenH);

  if (dx !== 0 || dy !== 0) {
    flowInstance.setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom }, { duration: 150 });
  }
}

const WASD_DIRECTION: Record<string, Direction> = {
  w: 'up', W: 'up',
  a: 'left', A: 'left',
  s: 'down', S: 'down',
  d: 'right', D: 'right',
};

const ARROW_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function useTaskDagKeyboard(options: TaskDagKeyboardOptions): void {
  const {
    mode, immersive, selectedTaskId, connectState, flowNodes, flowInstance, panSpeed,
    onModeChange, onImmersiveChange, onSelectedTaskIdChange, onConnectStateChange,
  } = options;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // 输入框聚焦时不抢占
    if (isInputFocused()) return;

    const key = event.key;

    // ── Esc：退出沉浸 / 清空连接状态 ──
    if (key === 'Escape') {
      if (immersive) { onImmersiveChange(false); event.preventDefault(); return; }
      if (mode === 'connect' && connectState) { onConnectStateChange(null); event.preventDefault(); return; }
      return;
    }

    // ── Ctrl + ← / →：模式循环切换 ──
    if (event.ctrlKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const currentIndex = MODE_ORDER.indexOf(mode);
      const delta = key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + MODE_ORDER.length) % MODE_ORDER.length;
      onModeChange(MODE_ORDER[nextIndex]);
      return;
    }

    // ── WASD 双模行为（★ 关键）──
    // 无焦点节点（selectedTaskId === null）→ 画布平移
    // 有焦点节点（selectedTaskId !== null）→ 节点方向导航
    const wasdDir = WASD_DIRECTION[key];
    if (wasdDir) {
      const focusNodeId = (mode === 'connect' && connectState)
        ? null // connect 模式下起点已设时，WASD 移动"连接终点候选"，后续步骤 4 实现
        : selectedTaskId;

      if (focusNodeId) {
        const nextId = findNearestNodeInDirection(focusNodeId, wasdDir, flowNodes);
        if (nextId) {
          onSelectedTaskIdChange(nextId);
          // ★ 只在节点即将移出视口时才平移，保持当前缩放不变
          ensureNodeVisible(nextId, flowInstance, flowNodes);
        }
        event.preventDefault();
        return;
      }

      // 没有焦点节点 → 画布平移
      if (flowInstance) {
        const viewport = flowInstance.getViewport();
        const panMap: Record<Direction, { x: number; y: number }> = {
          up: { x: 0, y: panSpeed },
          down: { x: 0, y: -panSpeed },
          left: { x: panSpeed, y: 0 },
          right: { x: -panSpeed, y: 0 },
        };
        const pan = panMap[wasdDir];
        flowInstance.setViewport({
          x: viewport.x + pan.x,
          y: viewport.y + pan.y,
          zoom: viewport.zoom,
        });
        event.preventDefault();
      }
      return;
    }

    // ── 方向键：始终画布平移 ──
    const arrowDir = ARROW_DIRECTION[key];
    if (arrowDir && flowInstance) {
      const viewport = flowInstance.getViewport();
      const panMap: Record<Direction, { x: number; y: number }> = {
        up: { x: 0, y: panSpeed },
        down: { x: 0, y: -panSpeed },
        left: { x: panSpeed, y: 0 },
        right: { x: -panSpeed, y: 0 },
      };
      const pan = panMap[arrowDir];
      flowInstance.setViewport({
        x: viewport.x + pan.x,
        y: viewport.y + pan.y,
        zoom: viewport.zoom,
      });
      event.preventDefault();
      return;
    }
  }, [mode, immersive, selectedTaskId, connectState, flowNodes, flowInstance, panSpeed, onModeChange, onImmersiveChange, onSelectedTaskIdChange, onConnectStateChange]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

### 3.2 平移速度设置项

**读写 localStorage**：

```ts
const DAG_PAN_SPEED_KEY = 'exomind:dag-pan-speed';
const DEFAULT_PAN_SPEED = 40; // px per keydown

export function readDagPanSpeed(): number {
  try {
    const saved = window.localStorage.getItem(DAG_PAN_SPEED_KEY);
    if (saved) {
      const value = Number(saved);
      if (Number.isFinite(value) && value >= 10 && value <= 200) return value;
    }
  } catch { /* ignore */ }
  return DEFAULT_PAN_SPEED;
}
```

**设置页 UI**：在现有设置页中新增一个 DAG 键盘平移速度设置项（滑块，范围 10-200，默认 40）。只是在已有设置页中追加一个设置项，**不要新建设置页或重组设置页分组**。具体 UI 参考设置页已有的滑块或输入控件风格。

### 3.3 集成到 TaskDagPage

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

```tsx
import { useTaskDagKeyboard } from '@/ui/app/hooks/useTaskDagKeyboard';

// 在 TaskDagPage 组件内：
const panSpeed = useMemo(() => readDagPanSpeed(), []);

useTaskDagKeyboard({
  mode,
  immersive,
  selectedTaskId,
  connectState,
  flowNodes: flowGraph.nodes,
  flowInstance: flowInstanceRef.current,
  panSpeed,
  onModeChange: setMode,
  onImmersiveChange: setImmersive,
  onSelectedTaskIdChange: setSelectedTaskId,
  onConnectStateChange: setConnectState,
});
```

**注意**：移除步骤 2 中单独的 Esc useEffect，因为 `useTaskDagKeyboard` 已统一处理 Esc。

### 3.4 扩展 selectedTaskId 到 connect 模式

**当前**（行 487-490）：

```tsx
useEffect(() => {
  if (mode !== 'browse') { setSelectedTaskId(null); }
}, [mode]);
```

**改为**：browse 和 connect 都保留 selectedTaskId（作为键盘焦点），只有 execute 模式清空。

```tsx
useEffect(() => {
  if (mode === 'execute') { setSelectedTaskId(null); }
}, [mode]);
```

### 3.5 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/ --pool forks --maxWorkers 1 --no-file-parallelism
```

**新增测试**（新建 `tests/unit/ui/task-dag-keyboard.test.ts`）：

```ts
describe('findNearestNodeInDirection', () => {
  it('向右找到最近节点', () => { ... });
  it('±45° 扇形外的节点不选中', () => { ... });
  it('没有候选时返回 null', () => { ... });
});
```

**手动验证**：
- Ctrl+→ 切换模式：浏览→连接→执行→浏览 循环 ✓
- 方向键平移画布 ✓
- WASD 无焦点时平移画布 ✓
- WASD 有焦点节点时方向导航 ✓
- 搜索框输入时键盘不抢占 ✓

---

## 步骤 4：#599 键盘建边 + 快速创建上下游

### 4.1 扩展 useTaskDagKeyboard：连接模式键盘建边

**文件**：`src/ui/app/hooks/useTaskDagKeyboard.ts`

在 `handleKeyDown` 中新增 connect 模式的 Enter/Space/Tab 处理：

```ts
// 新增 options 属性：
export interface TaskDagKeyboardOptions {
  // ... 已有 ...
  onConnectExecute: (sourceId: string, targetId: string, type: 'hard' | 'soft') => void;
  onQuickCreateUpstream: (fromNodeId: string) => void;
  onQuickCreateDownstream: (fromNodeId: string) => void;
}

// 在 handleKeyDown 中追加：

// ── Enter / Space：连接模式建边 ──
if ((key === 'Enter' || key === ' ') && mode === 'connect') {
  event.preventDefault();

  if (!connectState && selectedTaskId) {
    // 无起点 → 设为连接起点 (hard)
    onConnectStateChange({ sourceId: selectedTaskId, type: 'hard' });
    return;
  }

  if (connectState && selectedTaskId === connectState.sourceId) {
    // 同一节点 → 循环 hard → soft → 清空
    if (connectState.type === 'hard') {
      onConnectStateChange({ sourceId: connectState.sourceId, type: 'soft' });
    } else {
      onConnectStateChange(null);
    }
    return;
  }

  if (connectState && selectedTaskId && selectedTaskId !== connectState.sourceId) {
    // 起点+目标不同 → 建立依赖
    onConnectExecute(connectState.sourceId, selectedTaskId, connectState.type);
    onConnectStateChange(null);
    // 焦点落在目标节点
    return;
  }

  return;
}

// ── Tab / Shift+Tab：快速创建上下游 ──
if (key === 'Tab' && mode === 'connect' && selectedTaskId) {
  event.preventDefault();
  if (event.shiftKey) {
    onQuickCreateUpstream(selectedTaskId);
  } else {
    onQuickCreateDownstream(selectedTaskId);
  }
  return;
}
```

### 4.2 连接模式下 WASD 移动连接终点候选

在步骤 3 的 WASD 处理中，connect 模式下已设起点时的行为需要补全：

```ts
// 替换步骤 3 中的占位注释：
const focusNodeId = (mode === 'connect' && connectState)
  ? selectedTaskId ?? connectState.sourceId  // 从当前焦点或起点出发
  : selectedTaskId;
```

即：connect 模式已设起点后，WASD 在节点间移动 `selectedTaskId`（作为连接终点候选），Enter/Space 完成连接。

### 4.3 TaskDagPage 集成

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

新增 quick create 上下游的状态和处理：

```tsx
const [quickCreateDirection, setQuickCreateDirection] = useState<'upstream' | 'downstream' | null>(null);
const [quickCreateFromNodeId, setQuickCreateFromNodeId] = useState<string | null>(null);
const [pendingFocusTaskId, setPendingFocusTaskId] = useState<string | null>(null);

// Tab 触发的快速创建
function handleQuickCreateUpstream(fromNodeId: string) {
  setQuickCreateFromNodeId(fromNodeId);
  setQuickCreateDirection('upstream');
  setQuickCreateOpen(true);
}

function handleQuickCreateDownstream(fromNodeId: string) {
  setQuickCreateFromNodeId(fromNodeId);
  setQuickCreateDirection('downstream');
  setQuickCreateOpen(true);
}

// 修改 handleQuickCreateTask 支持方向语义：
async function handleQuickCreateTask(title: string, description: string) {
  try {
    const created = await getTaskService().createTask({
      title,
      description: description || undefined,
    });

    // ★ 方向依赖（Tab/Shift+Tab 触发）
    if (quickCreateDirection && quickCreateFromNodeId) {
      if (quickCreateDirection === 'downstream') {
        // 新任务依赖当前节点（当前节点是上游）
        await getTaskService().addDependency(created.id, quickCreateFromNodeId, 'hard');
      } else {
        // 当前节点依赖新任务（新任务是上游）
        await getTaskService().addDependency(quickCreateFromNodeId, created.id, 'hard');
      }
      setPendingFocusTaskId(created.id);
    }

    // ★ 连接起点依赖（#601 空白单击触发）
    if (quickCreateDependency) {
      await getTaskService().addDependency(
        created.id,
        quickCreateDependency.sourceTaskId,
        quickCreateDependency.type,
      );
      setConnectState(null);
      setPendingFocusTaskId(created.id);
    }

    setQuickCreateDependency(null);
    setQuickCreateDirection(null);
    setQuickCreateFromNodeId(null);
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

### 4.4 pendingFocusTaskId 自动聚焦

```tsx
// 监听新节点出现，自动聚焦
useEffect(() => {
  if (!pendingFocusTaskId) return;
  if (visibleNodeIdSet.has(pendingFocusTaskId)) {
    setSelectedTaskId(pendingFocusTaskId);
    setPendingFocusTaskId(null);
    // 滚入视口
    setTimeout(() => {
      flowInstanceRef.current?.fitView({
        nodes: [{ id: pendingFocusTaskId }],
        duration: 200,
        padding: 0.5,
      });
    }, 50);
  }
}, [pendingFocusTaskId, visibleNodeIdSet]);
```

### 4.5 TaskQuickCreateDialog 支持 Ctrl/Cmd+Enter

**文件**：`src/ui/app/components/TaskQuickCreateDialog.tsx`

在 textarea 的 onKeyDown 中新增：

```tsx
onKeyDown={(event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    // 触发表单提交
    const form = event.currentTarget.closest('form');
    form?.requestSubmit();
  }
}}
```

同理在 title input 上也加同样的快捷键。

### 4.6 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/ --pool forks --maxWorkers 1 --no-file-parallelism
```

**手动验证**：
- 连接模式，WASD 移到节点 A，Enter → A 成为起点（hard） ✓
- 再按 Enter → 切换为 soft ✓
- 再按 Enter → 清空起点 ✓
- 设起点后 WASD 移到节点 B，Enter → 建立 A→B 依赖 ✓
- Tab → 打开创建对话框（下游语义） ✓
- 创建后新节点自动聚焦 ✓
- Shift+Tab → 上游语义 ✓
- Ctrl/Cmd+Enter 提交对话框 ✓

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/ui/app/pages/TaskDagPage.tsx` | 持久化 + 空白建任务 + 集成键盘 | #600 #601 #598 #599 |
| `src/ui/app/hooks/useTaskDagKeyboard.ts` | **新建** 键盘事件中枢 | #598 #599 |
| `src/ui/app/components/TaskQuickCreateDialog.tsx` | 加 Ctrl+Enter 快捷键 | #599 |
| 设置页相关文件 | 新增平移速度设置项 | #598 |
| `tests/unit/ui/task-dag-keyboard.test.ts` | **新建** | #598 |

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要改动 task-dag-graph.ts** | 图算法不变 |
| **不要改动 task-dag-flow.ts** | 布局和节点数据不变 |
| **不要改动 task-dag-visibility.ts** | 折叠算法不变 |
| **不要改动 task-dag-layout.ts** | Sugiyama 布局不变 |
| **不要改动 TaskDagDetailPanel.tsx** | 详情面板不变 |
| **不要改动 RT 后端** | 纯前端改动 |
| **不要引入新的键盘快捷键库** | 原生 addEventListener 即可 |
| **不要改动 addDependency/removeDependency 的业务逻辑** | 依赖管理逻辑不变，只调用 |

## ⚠️ 容易出错的关键点

1. **isInputFocused 必须检查 contentEditable**：不只是 input/textarea，还有 `isContentEditable`
2. **WASD 方向导航的角度计算**：`Math.atan2(dy, dx)` 返回 `[-π, π]`，角度差要处理环绕
3. **Ctrl+← 和 Ctrl+→**：注意不要与浏览器默认行为冲突（Ctrl+← 通常是"后退一个单词"），需要 `event.preventDefault()`
4. **Tab 键默认行为**：Tab 会在 DOM 元素间移动焦点，必须 `event.preventDefault()` 阻止
5. **pendingFocusTaskId 的时序**：创建任务后 graph 需要重新加载（通过 `onTaskChange` 触发），新节点出现需要一个渲染周期。useEffect 监听 `visibleNodeIdSet` 变化是稳妥方案
6. **连接模式 selectedTaskId 不再清空**：步骤 3.4 改了 mode change effect，确保 connect 模式也保留 selectedTaskId
7. **quickCreateDependency 与 quickCreateDirection 互斥**：一个来自空白单击（#601），一个来自 Tab（#599），两者不会同时存在，但代码中应有清晰的分支
8. **addDependency 的参数顺序**：`addDependency(taskId, depTaskId, type)` — taskId 依赖于 depTaskId。下游新增是 `addDependency(新任务, 当前节点, hard)`；上游新增是 `addDependency(当前节点, 新任务, hard)`
9. **ensureNodeVisible 不要用 fitView**：fitView 会改变缩放级别。用 `setViewport` 手动平移，只在节点即将移出视口时才触发，保持当前 zoom 不变
10. **#601 Shift+单击反转依赖方向**：默认新任务是下游（dependsOn 起点），Shift 时新任务是上游（起点 dependsOn 新任务）。`addDependency` 参数顺序不要搞反

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 持久化 | 开启隐藏已结束 → 离开 → 返回 | 仍然隐藏 | #600 |
| 持久化 | 刷新页面 | 仍然保持 | #600 |
| 空白建任务 | 连接模式，选起点(hard)，空白单击 | 打开创建对话框 | #601 |
| 空白建任务 | 提交后 | 新任务自动依赖起点(hard)，新任务是下游 | #601 |
| 空白建任务 | 选起点(soft)，空白单击 | soft 依赖 | #601 |
| 空白建任务-上游 | Shift+空白单击 | 新任务是上游（起点 dependsOn 新任务） | #601 |
| 取消起点 | Esc（步骤3生效后） | 起点清空 | #601 |
| 模式切换 | Ctrl+→ | 浏览→连接 | #598 |
| 模式切换 | Ctrl+← | 浏览→执行（循环） | #598 |
| 画布平移 | 方向键 | 画布移动 | #598 |
| WASD 平移 | 无焦点，按 W | 画布向上移 | #598 |
| WASD 导航 | 有焦点，按 D | 焦点移到右侧最近节点 | #598 |
| WASD 无候选 | 按 W 但上方无节点 | 不移动 | #598 |
| 输入框 | 搜索框输入时按 W | 正常输入 W 字符 | #598 |
| Enter 建边 | 连接模式，焦点在 A，Enter | A 成为起点 | #599 |
| 循环切换 | 起点 A，再 Enter | hard→soft→清空 | #599 |
| 键盘连接 | 起点 A，WASD 到 B，Enter | A→B 依赖建立 | #599 |
| Tab 下游 | 焦点在 A，Tab | 打开创建对话框（下游） | #599 |
| Shift+Tab 上游 | 焦点在 A，Shift+Tab | 打开创建对话框（上游） | #599 |
| 新节点焦点 | Tab 创建后 | 焦点自动落到新节点 | #599 |
| Ctrl+Enter | 对话框 textarea 中 | 提交表单 | #599 |
| tsc | `npx tsc --noEmit` | 零错误 | 全部 |
| 测试 | `npx vitest run` | 通过 | 全部 |

---

## 完成回填

（Codex 执行完毕后在此填写）
