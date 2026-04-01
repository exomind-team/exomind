# 批次 Q：任务 DAG 交互增强

> **状态**：待执行
> **分支**：`feature/batch-q-task-dag`
> **关联 Issue**：#501, #700, #698, #701, #639, #660, #653
> **执行顺序**：#700 → #698 → #701 → #639 → #660 → #653
> **排除**：#591（已转向产品架构讨论，等 Hailaylin 参与设计后再定）

---

## Context

### 当前代码状态

**主文件**：`src/ui/app/pages/TaskDagPage.tsx`（2188 行）

**三模式体系**（已实现）：
- `browse`：只读浏览，点击侧边栏，双击进入详情
- `connect`：点击建立/删除依赖（hard/soft），空白双击/右键创建
- `execute`：专注切换，时间块管理

**布局引擎**：Dagre 自动布局（`task-dag-layout.ts`），方向可选 TB/LR/auto。节点 `draggable={false}`，无手动布局。

**搜索**：`task-title-fuzzy-search.ts` 按字符重复度 + 最长公共子串 + 标题字典序排序。不考虑任务状态。

**关键组件**：

| 文件 | 行数 | 职责 |
|------|------|------|
| `TaskDagPage.tsx` | 2188 | 主页面，三模式协调 |
| `task-dag-flow.ts` | 284 | ReactFlow 数据构建 |
| `task-dag-layout.ts` | 196 | Dagre 布局 |
| `task-title-fuzzy-search.ts` | 130 | 搜索排序 |
| `TaskDagModeSelector.tsx` | 86 | 模式切换器 |
| `TaskDagControlPanel.tsx` | 288 | 搜索/方向/过滤工具栏 |
| `task-dag-visibility.ts` | ~200 | 折叠/展开/终态过滤 |
| `DagreRoutedEdge.tsx` | ~150 | 自定义边渲染 |

**依赖库**：
- `@xyflow/react`: `^12.10.1` (ReactFlow v12)
- `@dagrejs/dagre`: 自动布局引擎

### 本批次范围

7 个 issue，全部在 `src/ui/app/pages/TaskDag*` 和 `src/ui/app/components/TaskDag*` 内完成。纯前端，不涉及 Rust RT 代码，与当前进行中的 Codex 工作（RT auth 修复 + config bugs）无文件域冲突。

分三个 Phase：
- **Phase A**（低风险高价值）：#700 文案收敛 + #698 搜索排序
- **Phase B**（中复杂度）：#701 句柄拖拽创建 + #639 手动布局
- **Phase C**（高复杂度）：#660 聚焦系列 + #653 标签过滤

---

## 步骤 0：代码探索（执行前必读）

在开始任何改动前，先执行以下探索步骤以获取代码定位锚点：

### 0.1 确认依赖版本

```bash
grep "@xyflow/react" package.json
# 预期输出：^12.10.1 (ReactFlow v12)
```

### 0.2 定位关键代码区域

```bash
# 1. 查找 TaskDagPage 的 state 定义区域（约 770-788 行）
grep -n "useState" src/ui/app/pages/TaskDagPage.tsx | head -20

# 2. 查找模式切换器的模式定义（约 3-10 行）
grep -n "MODE_OPTIONS" src/ui/app/components/TaskDagModeSelector.tsx

# 3. 查找搜索排序逻辑（约 123-127 行）
grep -n "\.sort" src/ui/app/pages/task-title-fuzzy-search.ts

# 4. 确认是否已有 onConnectEnd 回调
grep -n "onConnectEnd" src/ui/app/pages/TaskDagPage.tsx

# 5. 确认是否已有快速创建对话框
grep -n "QuickCreate\|quickCreate" src/ui/app/pages/TaskDagPage.tsx
```

### 0.3 读取参考实现

```bash
# 手动布局参考：NetworkPage 的 TopologyView
grep -n "nodesDraggable\|onNodeDragStop" src/ui/app/pages/NetworkPage.tsx
```

### 0.4 确认类型定义

```bash
# TaskNode 类型定义（包含 status, createdAt, tags 字段）
grep -n "interface TaskNode\|type TaskNode" src/lib/types/task.ts

# TaskDagVisibilityState 类型定义
grep -n "interface TaskDagVisibilityState" src/lib/task/task-dag-visibility.ts
```

---

## Phase A：低风险高价值

### 步骤 1：#700 连接模式 → 编辑模式（文案收敛）

#### 1.0 前置检查

```bash
# 确认模式定义位置
grep -n "MODE_OPTIONS" src/ui/app/components/TaskDagModeSelector.tsx
# 预期输出：第 3-10 行，包含 { key: 'connect', label: '连接' }

# 搜索所有 "连接" 文案出现位置
grep -n "连接" src/ui/app/pages/TaskDagPage.tsx
grep -n "连接" src/ui/app/components/TaskDagModeSelector.tsx
```

#### 1.1 改动

**文件**：`src/ui/app/components/TaskDagModeSelector.tsx`

**位置**：第 3-10 行，`MODE_OPTIONS` 常量定义

**现有代码**：
```tsx
const MODE_OPTIONS: ReadonlyArray<{
  key: TaskDagMode;
  label: string;
}> = [
  { key: 'browse', label: '浏览' },
  { key: 'connect', label: '连接' },  // ← 改这里
  { key: 'execute', label: '执行' },
];
```

**改为**：
```tsx
const MODE_OPTIONS: ReadonlyArray<{
  key: TaskDagMode;
  label: string;
}> = [
  { key: 'browse', label: '浏览' },
  { key: 'connect', label: '编辑' },  // ★ 改动：'连接' → '编辑'
  { key: 'execute', label: '执行' },
];
```

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

搜索所有包含 "连接" 的用户可见文案，统一改为"编辑"：
- 第 66 行附近：`title={isEnabled ? '${option.label}模式' : ...}` （自动跟随 MODE_OPTIONS）
- 搜索 tooltip、提示文本、右键菜单中的 "连接模式" 文案

**不改**：
- 内部变量名 `'connect'` 保持不变
- 类型定义 `type TaskDagMode = 'browse' | 'connect' | 'execute'` 保持不变

#### 1.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

手动验证：
1. 启动 `npx vite --host 0.0.0.0 --port 5173`
2. 在浏览器中打开任务 DAG 页面
3. 确认模式切换器显示"浏览 / 编辑 / 执行"
4. 鼠标悬停在"编辑"按钮上，确认 tooltip 显示"编辑模式"

---

### 步骤 2：#698 搜索按状态优先排序

#### 2.0 前置检查

```bash
# 确认排序逻辑位置
grep -n "\.sort" src/ui/app/pages/task-title-fuzzy-search.ts
# 预期输出：第 77-81 行（filterTasksByTitleFuzzySearch）和第 123-127 行（filterTasksBySearch）

# 确认 TaskNode 类型包含 status 和 createdAt 字段
grep -n "status\|createdAt" src/lib/types/task.ts | head -10
```

#### 2.1 改动

**文件**：`src/ui/app/pages/task-title-fuzzy-search.ts`

**位置 1**：第 77-81 行，`filterTasksByTitleFuzzySearch` 函数的 `.sort()` 调用

**现有代码**：
```typescript
.sort((left, right) => (
  right.longestSubstringLength - left.longestSubstringLength
  || right.score - left.score
  || left.task.title.localeCompare(right.task.title, 'zh-CN')
))
```

**改为**：
```typescript
// ★ 新增：状态优先级映射（文件顶部）
const STATUS_PRIORITY: Record<string, number> = {
  in_progress: 0,  // 最高：正在做的
  suspended: 1,    // 次高：挂起的
  pending: 2,      // 中间：待做的
  completed: 3,    // 低：已完成
  cancelled: 4,    // 最低：已取消
};

// ★ 改动：排序逻辑增加两级前置
.sort((left, right) => (
  (STATUS_PRIORITY[left.task.status] ?? 5) - (STATUS_PRIORITY[right.task.status] ?? 5)
  || (right.task.createdAt ?? 0) - (left.task.createdAt ?? 0)  // 同状态按创建时间倒序
  || right.longestSubstringLength - left.longestSubstringLength
  || right.score - left.score
  || left.task.title.localeCompare(right.task.title, 'zh-CN')
))
```

**位置 2**：第 123-127 行，`filterTasksBySearch` 函数的 `.sort()` 调用

应用相同的排序逻辑改动。

#### 2.2 验证

**单元测试**：

创建测试文件 `tests/unit/ui/task-title-fuzzy-search.issue698.test.tsx`：

```typescript
import { describe, it, expect } from 'vitest';
import { filterTasksByTitleFuzzySearch } from '@/ui/app/pages/task-title-fuzzy-search';
import type { TaskNode } from '@/lib/types/task';

describe('Issue #698: 搜索按状态优先排序', () => {
  it('in_progress 任务排在 pending 前面', () => {
    const tasks: TaskNode[] = [
      { id: '1', title: 'test task', status: 'pending', createdAt: 100, /* ... */ },
      { id: '2', title: 'test task', status: 'in_progress', createdAt: 200, /* ... */ },
    ];
    const results = filterTasksByTitleFuzzySearch(tasks, 'test');
    expect(results[0].id).toBe('2'); // in_progress 排第一
    expect(results[1].id).toBe('1');
  });

  it('同状态任务按 createdAt 倒序', () => {
    const tasks: TaskNode[] = [
      { id: '1', title: 'test', status: 'pending', createdAt: 100, /* ... */ },
      { id: '2', title: 'test', status: 'pending', createdAt: 200, /* ... */ },
    ];
    const results = filterTasksByTitleFuzzySearch(tasks, 'test');
    expect(results[0].id).toBe('2'); // 新任务排前面
  });

  it('处理 createdAt 为空的情况', () => {
    const tasks: TaskNode[] = [
      { id: '1', title: 'test', status: 'pending', createdAt: undefined, /* ... */ },
      { id: '2', title: 'test', status: 'pending', createdAt: 200, /* ... */ },
    ];
    const results = filterTasksByTitleFuzzySearch(tasks, 'test');
    expect(results[0].id).toBe('2'); // 有时间戳的排前面
  });
});
```

运行测试：
```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-title-fuzzy-search.issue698.test.tsx
```

手动验证：
1. 启动 `npx vite --host 0.0.0.0 --port 5173`
2. 在任务 DAG 页面搜索框输入关键词
3. 确认搜索结果中 in_progress 任务排在最前面
4. 确认同状态任务按创建时间倒序排列

---

## Phase B：中复杂度

### 步骤 3：#701 编辑模式句柄拖到空白创建任务

#### 3.0 前置检查

```bash
# 确认是否已有 onConnectEnd 回调
grep -n "onConnectEnd" src/ui/app/pages/TaskDagPage.tsx
# 预期：无输出（需要新增）

# 确认是否已有快速创建对话框
grep -n "QuickCreate\|quickCreate\|createTask" src/ui/app/pages/TaskDagPage.tsx | head -10

# 确认 ReactFlow v12 的 onConnectEnd API
# 参考文档：https://reactflow.dev/api-reference/react-flow#on-connect-end
```

#### 3.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**位置**：在 `useCallback` 定义区域（约 790-900 行）新增回调

**新增代码**：
```typescript
// ★ 新增：拖到空白区域时创建新任务
const onConnectEnd = useCallback(
  (event: MouseEvent | TouchEvent, connectionState: Connection) => {
    // ReactFlow v12: connectionState 是 Connection 类型
    // 如果 target 为 null，说明拖到了空白区域
    if (!connectionState.target && connectionState.source) {
      const sourceNodeId = connectionState.source;
      const sourceHandleId = connectionState.sourceHandle;

      // 根据句柄 ID 推断依赖方向
      // 假设句柄 ID 格式为 "bottom" 或 "top"
      const isDownstream = sourceHandleId === 'bottom' || sourceHandleId === 'right';

      // TODO: 实现或复用快速创建对话框
      // 如果已有 openQuickCreateDialog，直接调用
      // 如果没有，需要先实现该功能
      console.log('Create new task from', sourceNodeId, isDownstream ? 'downstream' : 'upstream');

      // 示例：打开创建对话框
      // openQuickCreateDialog({
      //   parentTaskId: isDownstream ? sourceNodeId : undefined,
      //   childTaskId: isDownstream ? undefined : sourceNodeId,
      //   dependencyType: event.shiftKey ? 'soft' : 'hard',
      // });
    }
  },
  [], // 依赖项根据实际情况添加
);
```

**位置**：在 `<ReactFlow>` 组件（约 1500-1700 行）添加 prop

**现有代码**：
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  onConnect={onConnect}
  // ... 其他 props
>
```

**改为**：
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  onConnect={onConnect}
  onConnectEnd={onConnectEnd}  // ★ 新增
  // ... 其他 props
>
```

**注意事项**：
1. ReactFlow v12 的 `onConnectEnd` 参数是 `(event, connectionState: Connection)` 而非 `OnConnectEnd` 类型
2. `Connection` 类型定义：`{ source: string | null; sourceHandle: string | null; target: string | null; targetHandle: string | null }`
3. 需要确认项目中是否已有快速创建对话框组件，如果没有，需要先实现

#### 3.2 验证

```bash
npx tsc --noEmit
# 如果有类型错误，检查 Connection 类型导入
```

手动验证：
1. 启动 `npx vite --host 0.0.0.0 --port 5173`
2. 切换到编辑模式
3. 从任意节点的句柄拖拽到空白区域
4. 确认触发创建逻辑（查看 console.log 或对话框弹出）
5. 按住 Shift 拖拽，确认可以创建 soft 依赖

---

### 步骤 4：#639 手动布局 + 快照持久化

#### 4.0 前置检查

```bash
# 查找 NetworkPage 的手动布局参考实现
grep -n "nodesDraggable\|onNodeDragStop\|localStorage" src/ui/app/pages/NetworkPage.tsx | head -20

# 确认 TaskDagPage 的 state 定义区域
grep -n "useState" src/ui/app/pages/TaskDagPage.tsx | grep -A 2 "770:"

# 确认 ReactFlow 组件位置
grep -n "<ReactFlow" src/ui/app/pages/TaskDagPage.tsx
```

#### 4.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

**位置 1**：在 state 定义区域（约 770-788 行）新增布局模式状态

**新增代码**：
```typescript
// ★ 新增：布局模式状态（auto: Dagre 自动布局, manual: 手动拖拽）
const [layoutMode, setLayoutMode] = useState<'auto' | 'manual'>('auto');

// ★ 新增：手动布局位置快照
const [manualPositions, setManualPositions] = useState<Record<string, { x: number; y: number }>>(() => {
  const stored = localStorage.getItem('exomind:dag-manual-layout');
  return stored ? JSON.parse(stored) : {};
});
```

**位置 2**：在 `useCallback` 区域新增拖拽结束回调

**新增代码**：
```typescript
// ★ 新增：手动布局拖拽结束回调
const handleNodeDragStop = useCallback(
  (event: React.MouseEvent, node: Node) => {
    if (layoutMode !== 'manual') return;

    setManualPositions((prev) => {
      const next = { ...prev, [node.id]: { x: node.position.x, y: node.position.y } };
      localStorage.setItem('exomind:dag-manual-layout', JSON.stringify(next));
      return next;
    });
  },
  [layoutMode],
);
```

**位置 3**：在 `<ReactFlow>` 组件（约 1500-1700 行）修改 props

**现有代码**：
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodesDraggable={false}  // ← 当前是固定的 false
  // ... 其他 props
>
```

**改为**：
```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodesDraggable={layoutMode === 'manual'}  // ★ 改动：根据布局模式动态设置
  onNodeDragStop={handleNodeDragStop}       // ★ 新增：拖拽结束回调
  // ... 其他 props
>
```

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

**位置**：在工具栏（约 100-200 行）新增布局模式切换按钮

**新增代码**：
```tsx
{/* ★ 新增：布局模式切换 */}
<div className="flex items-center gap-1 rounded-md border border-gray-200 p-1 dark:border-gray-700">
  <button
    type="button"
    onClick={() => onLayoutModeChange('auto')}
    className={[
      'rounded px-2 py-1 text-xs transition-colors',
      layoutMode === 'auto'
        ? 'bg-brand-accent/15 text-brand-accent'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    ].join(' ')}
  >
    自动
  </button>
  <button
    type="button"
    onClick={() => onLayoutModeChange('manual')}
    className={[
      'rounded px-2 py-1 text-xs transition-colors',
      layoutMode === 'manual'
        ? 'bg-brand-accent/15 text-brand-accent'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
    ].join(' ')}
  >
    手动
  </button>
</div>
```

**接口修改**：在 `TaskDagControlPanel` 的 props 中新增：
```typescript
interface TaskDagControlPanelProps {
  // ... 现有 props
  layoutMode: 'auto' | 'manual';
  onLayoutModeChange: (mode: 'auto' | 'manual') => void;
}
```

**文件**：`src/ui/app/pages/task-dag-flow.ts`

**位置**：在 `buildFlow` 函数中（约 50-100 行），应用手动位置快照

**现有代码**：
```typescript
// 使用 Dagre 计算的位置
node.position = { x: dagreNode.x, y: dagreNode.y };
```

**改为**：
```typescript
// ★ 改动：优先使用手动位置快照
if (manualPositions[node.id]) {
  node.position = manualPositions[node.id];
} else {
  node.position = { x: dagreNode.x, y: dagreNode.y };
}
```

**函数签名修改**：
```typescript
export function buildFlow(
  tasks: TaskNode[],
  // ... 其他参数
  manualPositions?: Record<string, { x: number; y: number }>,  // ★ 新增参数
): { nodes: Node[]; edges: Edge[] } {
  // ...
}
```

#### 4.2 验证

```bash
npx tsc --noEmit
```

手动验证：
1. 启动 `npx vite --host 0.0.0.0 --port 5173`
2. 在任务 DAG 页面，点击工具栏的"手动"按钮
3. 拖拽任意节点到新位置
4. 刷新页面，确认节点位置保留（localStorage 持久化）
5. 点击"自动"按钮，确认 Dagre 重新计算布局
6. 再次点击"手动"，确认之前的手动位置恢复（快照未丢失）
7. 切换布局模式时，确认视口不跳变（不调用 `fitView()`）

---

## Phase C：高复杂度

### 步骤 5：#660 聚焦任务系列

#### 5.1 改动

**文件**：`src/lib/task/task-dag-visibility.ts`

新增聚焦系列状态和连通集计算：

```typescript
// ★ 新增：聚焦系列状态
export interface TaskDagVisibilityState {
  collapsedUpstreamOf: string[];
  collapsedDownstreamOf: string[];
  focusedSeriesRoots: string[];  // ★ 新增：聚焦系列的根节点 ID 集
}

// ★ 新增：计算连通集
export function computeConnectedComponent(
  taskId: string,
  adjacency: Map<string, string[]>,  // 无向邻接表
): Set<string> {
  const visited = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return visited;
}
```

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

1. 右键菜单增加"聚焦此系列"入口
2. 非聚焦节点/边设置 `style.opacity = 0.25`
3. 键盘 `J` 切换聚焦/取消

**文件**：`src/ui/app/pages/task-dag-flow.ts`

在构建节点时，根据聚焦状态设置节点样式。

#### 5.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

新增测试：
- 3 节点链 A→B→C，聚焦 B，A 和 C 可见，独立节点 D 弱化
- 取消聚焦后全部恢复

---

### 步骤 6：#653 标签/领域过滤 + 幽灵节点

#### 6.1 改动

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

在工具栏增加标签多选过滤器：

```tsx
// ★ 新增：标签过滤 chip 多选
<TagFilterChips
  availableTags={allTaskTags}
  selectedTags={filterTags}
  onToggle={(tag) => toggleFilterTag(tag)}
/>
```

**文件**：`src/ui/app/pages/task-dag-flow.ts`

在 `buildFlow` 的节点过滤逻辑中增加标签匹配：

```typescript
// ★ 新增：标签过滤
const matchesTagFilter = filterTags.length === 0 ||
  task.tags.some(tag => filterTags.includes(tag));

// 不匹配的节点变为"幽灵节点"而非完全隐藏
if (!matchesTagFilter) {
  // 幽灵节点：半透明 + 虚线边框，保持拓扑结构完整
  node.style = { ...node.style, opacity: 0.2, borderStyle: 'dashed' };
  node.data = { ...node.data, isGhost: true };
}
```

#### 6.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

手动验证：选择标签 → 不匹配的节点变为幽灵 → 取消过滤 → 恢复。

---

## 关键文件索引

| 文件 | 改动类型 | Issue | Phase |
|------|---------|-------|-------|
| `src/ui/app/components/TaskDagModeSelector.tsx` | 修改文案 | #700 | A |
| `src/ui/app/pages/task-title-fuzzy-search.ts` | 修改排序逻辑 | #698 | A |
| `src/ui/app/pages/TaskDagPage.tsx` | 新增交互+状态 | #701, #639, #660 | B, C |
| `src/ui/app/components/TaskDagControlPanel.tsx` | 新增控件 | #639, #653 | B, C |
| `src/ui/app/pages/task-dag-flow.ts` | 修改节点构建 | #639, #660, #653 | B, C |
| `src/lib/task/task-dag-visibility.ts` | 扩展状态+算法 | #660 | C |

---

## ⚠️ 不要做清单

| 禁止项 | 原因 |
|--------|------|
| 不要改内部变量名 `'connect'` 为 `'edit'` | #700 仅改 UI 文案，内部标识保持稳定 |
| 不要引入新布局库（如 ELK、force-directed） | Dagre 足够，手动布局不需要新引擎 |
| 不要改动 `DagreRoutedEdge.tsx` 的边路由算法 | 跨层边路由已稳定，不在本批次范围 |
| 不要改动执行模式（execute）的逻辑 | 不在本批次范围 |
| 不要碰 `src/services/` 或 `crates/` 目录 | 本批次纯前端，避免与 Codex 冲突 |
| 不要为手动布局引入新的 IndexedDB 存储 | 用 localStorage 足够 |

---

## ⚠️ 容易出错的关键点

### API 兼容性

1. **ReactFlow v12 `onConnectEnd` API 差异**
   - v11: `connectionState: OnConnectEnd` 包含 `isValid`, `fromNode`, `fromHandle`
   - v12: `connectionState: Connection` 只包含 `source`, `sourceHandle`, `target`, `targetHandle`
   - **解决方案**：用 `!connectionState.target` 判断是否拖到空白区域
   - **验证**：检查 `@xyflow/react` 版本（当前 ^12.10.1），查阅官方文档

2. **ReactFlow v12 Node 类型**
   - `Node` 类型从 `@xyflow/react` 导入，不是 `ReactFlowNode`
   - `node.data` 的类型需要在 `buildFlow` 中正确声明
   - **验证**：`npx tsc --noEmit` 确认无类型错误

### 数据完整性

3. **搜索排序中 `createdAt` 可能为空**
   - 旧任务可能没有 `createdAt` 字段（历史数据）
   - **解决方案**：使用 `(right.task.createdAt ?? 0) - (left.task.createdAt ?? 0)`
   - **验证**：测试用例覆盖 `createdAt: undefined` 场景

4. **手动布局快照与任务 ID 变化**
   - 如果任务被删除后重建，ID 可能变化，导致快照失效
   - **解决方案**：快照中不存在的 ID 自动回退到 Dagre 布局
   - **验证**：删除任务后重建，确认布局不崩溃

### 状态同步

5. **手动布局 + 自动布局切换时的视口跳变**
   - 切换布局模式时不应调用 `fitView()`，否则会改变用户的缩放级别
   - **解决方案**：切换模式时只更新 `layoutMode` state，不触发视口操作
   - **验证**：手动缩放到特定级别 → 切换模式 → 确认缩放级别不变

6. **手动布局快照与 Dagre 布局的位置不连续**
   - 用户在自动模式下看到的布局，切换到手动模式后可能跳变
   - **解决方案**：切换到手动模式时，先用当前 Dagre 位置初始化快照
   - **实现**：在 `setLayoutMode('manual')` 时，如果快照为空，用当前节点位置填充

### 图算法

7. **聚焦系列的连通集计算必须用无向图**
   - 依赖关系是有向的（A → B），但"系列"概念是无向连通（A 和 B 互相关联）
   - **解决方案**：构建无向邻接表，BFS 遍历连通分量
   - **验证**：测试 A→B→C 链，聚焦 B 时 A 和 C 都可见

8. **连通集计算的性能问题**
   - 大型 DAG（1000+ 节点）的 BFS 可能卡顿
   - **解决方案**：使用 `useMemo` 缓存连通集计算结果，依赖项为 `[tasks, focusedSeriesRoots]`
   - **验证**：在 1000 节点的 DAG 上测试聚焦性能

### UI 渲染

9. **标签过滤的幽灵节点必须保留在 DAG 中**
   - 完全移除节点会导致拓扑断裂（A→B→C，隐藏 B 后 A 和 C 失去连接）
   - **解决方案**：用样式弱化（`opacity: 0.2`, `borderStyle: 'dashed'`），不用 `display: none`
   - **验证**：过滤后确认边的连接关系完整

10. **幽灵节点的交互禁用**
    - 幽灵节点应该不可点击、不可拖拽
    - **解决方案**：在 `node.data` 中添加 `isGhost: true`，在事件处理中过滤
    - **验证**：点击幽灵节点，确认不触发选中或详情面板

### 性能优化

11. **TaskDagPage.tsx 文件过大（2188 行）**
    - 新增状态和回调可能影响渲染性能
    - **解决方案**：使用 `useCallback` 和 `useMemo` 避免不必要的重渲染
    - **验证**：使用 React DevTools Profiler 检查渲染次数

12. **localStorage 写入频率过高**
    - 每次拖拽节点都写 localStorage 可能影响性能
    - **解决方案**：使用 debounce（300ms）延迟写入
    - **验证**：快速拖拽多个节点，确认不卡顿

### 测试覆盖

13. **现有测试可能不覆盖三模式体系**
    - `task-dag-page.issue394.test.tsx` 可能只测试了 browse 模式
    - **解决方案**：为每个新功能补充测试用例，覆盖 connect 和 execute 模式
    - **验证**：运行测试，确认覆盖率不下降

14. **ReactFlow 组件的 mock 复杂度**
    - ReactFlow 依赖 DOM 和 Canvas，单元测试需要 mock
    - **解决方案**：使用 `vitest` 的 `vi.mock` mock ReactFlow 组件
    - **参考**：查看现有测试中的 ReactFlow mock 实现

### 类型安全

15. **`node.data.isGhost` 需要类型声明**
    - 直接在 `node.data` 上添加属性会导致类型错误
    - **解决方案**：扩展 `Node` 类型或使用 `Node<{ isGhost?: boolean }>`
    - **验证**：`npx tsc --noEmit` 确认无类型错误

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 模式切换器 | 查看三个模式标签 | 显示"浏览/编辑/执行" | #700 |
| 搜索混合状态 | 搜索关键词 | in_progress 排在 pending 前 | #698 |
| 同状态搜索 | 搜索同状态任务 | createdAt 新的排前面 | #698 |
| 句柄拖到空白 | 编辑模式拖出句柄到空白 | 弹出创建对话框 | #701 |
| Shift 句柄拖拽 | 按住 Shift 拖出 | 创建 soft 依赖 | #701 |
| 手动布局拖拽 | 切换手动布局拖拽节点 | 位置即时更新 | #639 |
| 手动布局刷新 | 拖拽后刷新页面 | 位置保留（localStorage） | #639 |
| 切换回自动 | 手动→自动布局 | Dagre 重算，手动快照保留 | #639 |
| 聚焦系列 | 右键节点→聚焦此系列 | 非连通节点 opacity 0.25 | #660 |
| 取消聚焦 | 按 J 或右键取消 | 全部节点恢复正常 | #660 |
| 标签过滤 | 选择"UI"标签 | 无该标签的节点变幽灵 | #653 |
| 取消标签 | 清空过滤 | 全部恢复 | #653 |
| `npx tsc --noEmit` | 运行 | 0 errors | all |
| `npx vitest run` DAG 测试 | 运行 | 0 failed | all |

---

## 完成回填

（执行后填写）

| Phase | 步骤 | 状态 | commit | 备注 |
|-------|------|------|--------|------|
| A | 步骤 1 #700 | | | |
| A | 步骤 2 #698 | | | |
| B | 步骤 3 #701 | | | |
| B | 步骤 4 #639 | | | |
| C | 步骤 5 #660 | | | |
| C | 步骤 6 #653 | | | |
