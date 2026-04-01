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

**依赖库**：`@xyflow/react`（ReactFlow）、`@dagrejs/dagre`

### 本批次范围

7 个 issue，全部在 `src/ui/app/pages/TaskDag*` 和 `src/ui/app/components/TaskDag*` 内完成。纯前端，不涉及 Rust RT 代码，与当前进行中的 Codex 工作（RT auth 修复 + config bugs）无文件域冲突。

分三个 Phase：
- **Phase A**（低风险高价值）：#700 文案收敛 + #698 搜索排序
- **Phase B**（中复杂度）：#701 句柄拖拽创建 + #639 手动布局
- **Phase C**（高复杂度）：#660 聚焦系列 + #653 标签过滤

---

## Phase A：低风险高价值

### 步骤 1：#700 连接模式 → 编辑模式（文案收敛）

#### 1.1 改动

**文件**：`src/ui/app/components/TaskDagModeSelector.tsx`

将 `connect` 模式的显示标签从"连接"改为"编辑"：
```tsx
// ★ 改动：label 从 '连接' → '编辑'
{ mode: 'connect', label: '编辑', icon: Pencil }
```

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

搜索所有 `connect` 模式相关的用户可见文案（tooltip、提示文本），统一改为"编辑"语义：
- 模式切换提示
- 键盘提示面板中的模式名称
- 右键菜单中的模式相关文案

**不改**：内部变量名 `'connect'` 保持不变，仅改 UI 文案。

#### 1.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

手动验证：启动 `npx vite --host`，在浏览器中确认模式切换器显示"编辑"。

---

### 步骤 2：#698 搜索按状态优先排序

#### 2.1 改动

**文件**：`src/ui/app/pages/task-title-fuzzy-search.ts`

在现有排序逻辑前增加状态优先级层：

```typescript
// ★ 新增：状态优先级映射
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

#### 2.2 验证

```bash
npx vitest run tests/unit/ui/tasks-page.issue546-fuzzy-search.test.tsx
```

新增测试用例：
- 混合状态任务搜索，断言 in_progress 排在 pending 前面
- 同状态任务按 createdAt 倒序

---

## Phase B：中复杂度

### 步骤 3：#701 编辑模式句柄拖到空白创建任务

#### 3.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

在 ReactFlow 的 `onConnectEnd` 回调中增加逻辑：

```typescript
// ★ 新增：拖到空白区域时创建新任务
const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: OnConnectEnd) => {
  if (!connectionState.isValid) {
    // 用户把句柄拖到了空白区域（而非已有节点）
    const sourceNodeId = connectionState.fromNode?.id;
    const sourceHandlePosition = connectionState.fromHandle?.position;
    if (!sourceNodeId) return;

    // 根据句柄位置推断依赖方向
    const isDownstream = sourceHandlePosition === 'bottom' || sourceHandlePosition === 'right';

    // 复用现有的快速创建 dialog
    openQuickCreateDialog({
      parentTaskId: isDownstream ? sourceNodeId : undefined,
      childTaskId: isDownstream ? undefined : sourceNodeId,
      dependencyType: event.shiftKey ? 'soft' : 'hard',
    });
  }
}, [openQuickCreateDialog]);
```

**注意**：需检查 ReactFlow 的 `onConnectEnd` API 是否支持 `connectionState.fromHandle.position`，可能需要用 `getHandleConnectionInfo` 替代。

#### 3.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

手动验证：编辑模式下拖动句柄到空白区域，应弹出创建对话框。

---

### 步骤 4：#639 手动布局 + 快照持久化

#### 4.1 改动

**文件**：`src/ui/app/pages/TaskDagPage.tsx`

1. 新增布局模式状态：
```typescript
const [layoutMode, setLayoutMode] = useState<'auto' | 'manual'>('auto');
```

2. `layoutMode === 'manual'` 时，设置 `nodesDraggable={true}`：
```tsx
<ReactFlow
  nodesDraggable={layoutMode === 'manual'}
  onNodeDragStop={handleNodeDragStop}
  ...
/>
```

3. 拖拽结束后保存位置快照到 localStorage：
```typescript
const LAYOUT_SNAPSHOT_KEY = 'exomind:dag-manual-layout';

const handleNodeDragStop = useCallback((event, node) => {
  setManualPositions(prev => {
    const next = { ...prev, [node.id]: { x: node.position.x, y: node.position.y } };
    localStorage.setItem(LAYOUT_SNAPSHOT_KEY, JSON.stringify(next));
    return next;
  });
}, []);
```

**文件**：`src/ui/app/components/TaskDagControlPanel.tsx`

在工具栏新增布局模式切换按钮（自动/手动）。

**文件**：`src/ui/app/pages/task-dag-flow.ts`

在 `buildFlow` 中，如果有手动位置快照，优先使用手动位置而非 Dagre 计算位置。

**参考**：`src/ui/app/pages/NetworkPage.tsx` 的 `TopologyView` 已有成熟的手动拖拽+持久化实现。

#### 4.2 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx
```

手动验证：
1. 切换到手动布局 → 拖拽节点 → 刷新页面 → 位置保留
2. 切换回自动布局 → Dagre 重新计算 → 手动快照不丢（切回手动时恢复）

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

1. **ReactFlow `onConnectEnd` API 版本差异**：v11/v12 的 `connectionState` 结构不同，需检查 `@xyflow/react` 版本对应的 API
2. **搜索排序中 `createdAt` 可能为空**：旧任务可能没有 `createdAt` 字段，需要 fallback 到 0
3. **手动布局 + 自动布局切换时的视口跳变**：切换布局模式时不应调用 `fitView()`，否则会改变用户的缩放级别
4. **聚焦系列的连通集计算必须用无向图**：依赖关系是有向的，但"系列"概念是无向连通——需要构建无向邻接表
5. **标签过滤的幽灵节点必须保留在 DAG 中**：完全移除会导致拓扑断裂，应该用样式弱化而非 `display:none`

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
