# 批次 B：事件时间线计划

> **状态**：已完成
> **分支**：直接在 `dev` 上开发（无独立分支）
> **关联 Issue**：#585, #583, #584
> **依赖链**：#585 → #584，#583 → #584（#585 和 #583 可并行，但本计划顺序执行）

---

## Context

当前任务系统缺少生命周期事件追踪——`createTask`、`transitionTask` 只触发内存 `notifyChangeListeners()`，不写入 EventLog。这导致：
- 无法回溯任务的状态变更历史
- 无法构建以任务为主语的时间线视图
- 任务与时间块的关联事件（link/unlink）分散在 `taskAssociationLog` 内嵌数组中，不在 EventLog 中

本批次分三步：
1. **#585**：补齐 `task.*` 事件类型，写入 EventLog
2. **#583**：修正「当下>今日」时间块详情的路由归属
3. **#584**：基于 task.* 事件构建任务时间线泳道图页面

---

## 步骤 1：#585 补齐 task.* 事件类型

### 1.1 定义事件类型常量

**文件**：`src/lib/types/event.ts`

在 `SYSTEM_TAGS` 对象中新增任务相关标签：

```ts
export const SYSTEM_TAGS = {
  // ... 已有 block_start / block_end / block_pause / block_resume / block_feedback / agent_feedback / note
  TASK_CREATED: 'task_created' as Tag,
  TASK_STARTED: 'task_started' as Tag,
  TASK_RESUMED: 'task_resumed' as Tag,
  TASK_SUSPENDED: 'task_suspended' as Tag,
  TASK_COMPLETED: 'task_completed' as Tag,
  TASK_CANCELLED: 'task_cancelled' as Tag,
  TASK_LINKED: 'task_linked' as Tag,
  TASK_UNLINKED: 'task_unlinked' as Tag,
} as const;
```

### 1.2 定义事件 metadata 接口

**文件**：`src/lib/types/event.ts`

```ts
/** task.* 事件的 metadata 扩展 */
export interface TaskEventMetadata extends EventMetadata {
  taskId: string;
  taskTitle: string;
}

/** 状态变更事件的 metadata */
export interface TaskTransitionEventMetadata extends TaskEventMetadata {
  fromStatus: string;
  toStatus: string;
}

/** 关联事件的 metadata */
export interface TaskLinkEventMetadata extends TaskEventMetadata {
  blockId: string;
  blockName?: string;
}
```

### 1.3 新建事件发射工具函数

**新建文件**：`src/lib/services/task-event-emitter.ts`

**关键**：必须使用 `appendEventWithEcsReplication`（与 timeblock.service.ts 一致），而**不是** `getEventLogService().appendEventData()`。两者数据格式不同——ECS 版用 `{ createdAt: string, type: string }`，EventLogService 版用 `{ timestamp: number, tags: string[] }`。

```ts
import { createUuidV4 } from '@/lib/utils/uuid';
import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata';
import { appendEventWithEcsReplication } from './ecs-eventlog-replication.service';
import { SYSTEM_TAGS } from '@/lib/types/event';

function tryEmit(type: string, content: string, metadata: Record<string, unknown>): void {
  void appendEventWithEcsReplication({
    id: createUuidV4(),
    content,
    createdAt: new Date().toISOString(),
    type,
    metadata: {
      source: getEventSourceMetadata(),
      ...metadata,
    },
  }).catch(() => {
    // 事件发射失败不应阻塞主流程
  });
}

// ── 任务生命周期事件 ──

export function emitTaskCreated(taskId: string, taskTitle: string): void {
  tryEmit(
    SYSTEM_TAGS.TASK_CREATED,
    `创建任务「${taskTitle}」`,
    { taskId, taskTitle },
  );
}

export function emitTaskTransition(
  taskId: string,
  taskTitle: string,
  fromStatus: string,
  toStatus: string,
): void {
  const labelMap: Record<string, { tag: string; verb: string }> = {
    in_progress: { tag: SYSTEM_TAGS.TASK_STARTED, verb: '开始' },
    suspended: { tag: SYSTEM_TAGS.TASK_SUSPENDED, verb: '挂起' },
    completed: { tag: SYSTEM_TAGS.TASK_COMPLETED, verb: '完成' },
    cancelled: { tag: SYSTEM_TAGS.TASK_CANCELLED, verb: '取消' },
  };

  // 特殊处理：从 suspended → in_progress 是「恢复」而非「开始」
  const isResume = fromStatus === 'suspended' && toStatus === 'in_progress';
  const entry = isResume
    ? { tag: SYSTEM_TAGS.TASK_RESUMED, verb: '恢复' }
    : labelMap[toStatus];

  if (!entry) return;

  tryEmit(
    entry.tag,
    `${entry.verb}任务「${taskTitle}」`,
    { taskId, taskTitle, fromStatus, toStatus },
  );
}

// ── 关联事件 ──

export function emitTaskLinked(taskId: string, taskTitle: string, blockId: string, blockName?: string): void {
  tryEmit(
    SYSTEM_TAGS.TASK_LINKED,
    `关联任务「${taskTitle}」到时间块`,
    { taskId, taskTitle, blockId, blockName },
  );
}

export function emitTaskUnlinked(taskId: string, taskTitle: string, blockId: string, blockName?: string): void {
  tryEmit(
    SYSTEM_TAGS.TASK_UNLINKED,
    `取消关联任务「${taskTitle}」`,
    { taskId, taskTitle, blockId, blockName },
  );
}
```

**与旧方案的区别**：
- 不再需要 `setTaskEventEmitTarget` 注册机制
- 直接 import `appendEventWithEcsReplication`，与 timeblock.service.ts 完全一致
- 降级机制：`catch(() => {})` 静默吞错误，不阻塞主流程

### 1.4 在 TaskService 中发射生命周期事件

**文件**：`src/lib/services/task.service.ts`

**改动**：在 `createTask`、`transitionTask`、`cancelTask` 中追加事件发射。

```ts
import { emitTaskCreated, emitTaskTransition } from './task-event-emitter';

// createTask 方法（行 51-58）追加：
async createTask(input: CreateTaskInput): Promise<TaskNode> {
  // ... 已有逻辑 ...
  const created = await this.env.task.createTask(input);
  this.notifyChangeListeners();
  emitTaskCreated(created.id, created.title);  // ★ 新增
  return created;
}

// transitionTask 方法（行 77-91）追加：
async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
  // 先读取当前状态用于 fromStatus
  const before = await this.env.task.getTaskById(id);
  if (!before) return null;
  const fromStatus = before.status;

  // ... 已有依赖检查逻辑 ...
  const transitioned = await this.env.task.transitionTask(id, to);
  if (transitioned) {
    this.notifyChangeListeners();
    emitTaskTransition(transitioned.id, transitioned.title, fromStatus, to);  // ★ 新增
  }
  return transitioned;
}

// cancelTask 方法（行 69-75）追加：
async cancelTask(id: string) {
  const before = await this.env.task.getTaskById(id);  // ★ 新增：读取 fromStatus
  const task = await this.env.task.cancelTask(id);
  if (task) {
    this.notifyChangeListeners();
    emitTaskTransition(task.id, task.title, before?.status ?? 'pending', 'cancelled');  // ★ 新增
  }
  return task;
}
```

**注意**：`transitionTask` 当前直接调 `this.env.task.transitionTask(id, to)`，改动后需要先读 `getTaskById` 获取 `fromStatus`。这会多一次读取，但 transitionTask 不是热路径，可接受。

### 1.5 在 TaskTimerService 中发射关联事件

**文件**：`src/lib/services/task-timer.service.ts`

**改动**：在 `startBlockForTasks`、`addTaskToBlock`、`removeTaskFromBlock` 中追加事件发射。

```ts
import { emitTaskLinked, emitTaskUnlinked } from './task-event-emitter';

// startBlockForTasks（行 68-101）— 在 block 创建后发射 task.linked：
async startBlockForTasks(taskIds: string[], config: TimerConfig = { mode: 'countup' }): Promise<ActiveBlockData | null> {
  // ... 已有逻辑 ...
  const block = await this.tbSvc.startBlock(primaryTask.title, config, undefined, { taskIds: normalizedTaskIds });
  // ... 已有 updateActiveBlock ...

  // ★ 新增：为每个关联任务发射 task.linked
  for (const task of tasks) {
    emitTaskLinked(task.id, task.title, block.startId, primaryTask.title);
  }

  return await this.tbSvc.loadActiveBlock() ?? block;
}

// addTaskToBlock（行 103-137）— 在关联后发射：
async addTaskToBlock(taskId: string): Promise<void> {
  // ... 已有逻辑 ...
  await this.tbSvc.updateActiveBlock({ ... });

  // ★ 新增
  emitTaskLinked(normalizedTaskId, task.title, activeBlock.startId, activeBlock.name);
}

// removeTaskFromBlock（行 139-158）— 在取消关联后发射：
async removeTaskFromBlock(taskId: string): Promise<void> {
  // ... 已有逻辑 ...
  await this.tbSvc.updateActiveBlock({ ... });

  // ★ 新增：需要先获取 task title
  const task = await this.taskSvc.getTask(normalizedTaskId);
  emitTaskUnlinked(normalizedTaskId, task?.title ?? normalizedTaskId, activeBlock.startId, activeBlock.name);
}
```

### 1.6 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/lib/ --pool forks --maxWorkers 1 --no-file-parallelism
```

**新增测试**（新建 `tests/unit/lib/task-event-emitter.test.ts`）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  emitTaskCreated,
  emitTaskTransition,
  emitTaskLinked,
  emitTaskUnlinked,
} from '@/lib/services/task-event-emitter';
import { SYSTEM_TAGS } from '@/lib/types/event';

// mock appendEventWithEcsReplication
vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: vi.fn().mockResolvedValue({}),
}));

import { appendEventWithEcsReplication } from '@/lib/services/ecs-eventlog-replication.service';
const mockAppend = vi.mocked(appendEventWithEcsReplication);

describe('task-event-emitter', () => {
  beforeEach(() => {
    mockAppend.mockClear();
  });

  it('emitTaskCreated 发射 task_created 事件', () => {
    emitTaskCreated('t1', '写代码');
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SYSTEM_TAGS.TASK_CREATED,
        content: '创建任务「写代码」',
        metadata: expect.objectContaining({ taskId: 't1', taskTitle: '写代码' }),
      }),
    );
  });

  it('emitTaskTransition pending→in_progress 发射 task_started', () => {
    emitTaskTransition('t1', '写代码', 'pending', 'in_progress');
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SYSTEM_TAGS.TASK_STARTED,
        content: '开始任务「写代码」',
        metadata: expect.objectContaining({ fromStatus: 'pending', toStatus: 'in_progress' }),
      }),
    );
  });

  it('emitTaskTransition suspended→in_progress 发射 task_resumed', () => {
    emitTaskTransition('t1', '写代码', 'suspended', 'in_progress');
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({ type: SYSTEM_TAGS.TASK_RESUMED, content: '恢复任务「写代码」' }),
    );
  });

  it('emitTaskLinked 发射 task_linked 事件', () => {
    emitTaskLinked('t1', '写代码', 'b1', '专注');
    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: SYSTEM_TAGS.TASK_LINKED,
        metadata: expect.objectContaining({ taskId: 't1', blockId: 'b1' }),
      }),
    );
  });

  it('appendEventWithEcsReplication 失败时静默跳过', () => {
    mockAppend.mockRejectedValueOnce(new Error('fail'));
    // 应该不抛异常
    expect(() => emitTaskCreated('t1', '写代码')).not.toThrow();
  });
});
```

---

## 步骤 2：#583 修正「当下>今日」时间块详情路由

### 2.1 新增路由

**文件**：`src/routes.tsx`

在 `/eventlog` 路由组下新增时间块详情路由：

```tsx
// 新增：当下域时间块详情
{
  path: '/eventlog/timeblocks/$blockId',
  component: () => import('./ui/app/pages/TimeBlockDetailPage').then((m) => m.TimeBlockDetailPage),
  // 或者使用 lazy 加载
}
```

**注意**：检查 `routes.tsx` 的路由注册方式（TanStack Router 的具体语法），匹配已有的 `/tasks/block/$blockId` 注册方式。

### 2.2 修改 TimeBlockDetailPage 支持多域

**文件**：`src/ui/app/pages/TimeBlockDetailPage.tsx`

**改动**：根据当前路由判断属于哪个域，调整 breadcrumb 返回语义。

```tsx
// 根据当前路径判断域
const location = useLocation();
const isNowDomain = location.pathname.startsWith('/eventlog/');

// breadcrumb 根据域调整
<TaskBreadcrumb
  segments={[
    isNowDomain
      ? { label: '当下', to: '/eventlog' }
      : { label: '任务', to: '/tasks' },
  ]}
  current={{ label: '时间块详情' }}
/>
```

### 2.3 修改 NowTodayTab 跳转目标

**文件**：`src/ui/app/components/NowTodayTab.tsx`

**当前**（行 100）：

```tsx
to="/tasks/block/$blockId"
```

**改为**：

```tsx
to="/eventlog/timeblocks/$blockId"
```

### 2.4 修改 now-today-blocks-view.ts 的 href

**文件**：`src/ui/app/pages/now-today-blocks-view.ts`

**当前**（行 61）：

```ts
href: `/tasks/block/${block.id}`,
```

**改为**：

```ts
href: `/eventlog/timeblocks/${block.id}`,
```

### 2.5 保留任务域路由

`/tasks/block/$blockId` 保持不变——任务域的时间块详情页（如从 TaskDetailPage 跳入）仍然使用任务域路由。两个域共享同一个 `TimeBlockDetailPage` 组件。

### 2.6 更新测试

**文件**：`tests/e2e/now-tabs-timeblock-detail.issue418-516.test.ts`

将断言的 URL 从 `/tasks/block/...` 改为 `/eventlog/timeblocks/...`。

### 2.7 验证

```bash
npx tsc --noEmit
npx vitest run tests/ --pool forks --maxWorkers 1 --no-file-parallelism
```

**手动验证**：
- Now > 今日 点击时间块 → 进入 `/eventlog/timeblocks/$blockId` ✓
- 详情页 breadcrumb 显示「当下 / 时间块详情」✓
- 点击「当下」返回 → 回到 `/eventlog` ✓
- 从任务详情页进入时间块详情 → 仍然走 `/tasks/block/$blockId` ✓
- 该路径 breadcrumb 显示「任务 / 时间块详情」✓

---

## 步骤 3：#584 任务时间线泳道图

### 3.1 新建路由

**文件**：`src/routes.tsx`

```tsx
// 新增
{
  path: '/tasks/timeline',
  component: () => import('./ui/app/pages/TaskTimelinePage').then((m) => m.TaskTimelinePage),
}

// 旧路由重定向
{
  path: '/tasks/timeblocks',
  // 重定向到 /tasks/timeline
  beforeLoad: () => { throw redirect({ to: '/tasks/timeline' }) },
}
```

**注意**：检查 TanStack Router 的重定向语法，可能是 `redirect` 函数或 `Navigate` 组件。

### 3.2 更新导航入口

**文件**：`src/ui/app/pages/TasksPage.tsx`

**当前**（行 180）：

```tsx
to="/tasks/timeblocks"
```

**改为**：

```tsx
to="/tasks/timeline"
```

**文件**：`src/ui/app/pages/TaskDetailPage.tsx`

**当前**（行 44）：

```ts
timeblocks: { label: '时间块', to: '/tasks/timeblocks' },
```

**改为**：

```ts
timeline: { label: '时间线', to: '/tasks/timeline' },
```

### 3.3 新建时间线视图模型

**新建文件**：`src/ui/app/pages/task-timeline-model.ts`

这是泳道图的核心数据模型。

```ts
import type { Event, TimeBlock, UUID } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import { SYSTEM_TAGS } from '@/lib/types/event';

// ── 类型定义 ──

export type TimelineRange = 'today' | '3d' | '7d' | { start: number; end: number };

export interface TaskStatusSegment {
  taskId: string;
  taskTitle: string;
  status: 'pending' | 'in_progress' | 'suspended';
  startTime: number;
  endTime: number;
  inferred: boolean; // true = 从时间块推导，false = 从 task.* 事件精确
}

export interface TaskTerminalMarker {
  taskId: string;
  taskTitle: string;
  status: 'completed' | 'cancelled';
  timestamp: number;
  inferred: boolean;
}

export interface TaskTimelineEntry {
  taskId: string;
  taskTitle: string;
  currentStatus: TaskNode['status'];
  segments: TaskStatusSegment[];
  terminalMarker: TaskTerminalMarker | null;
}

export interface SwimLane {
  entries: TaskTimelineEntry[];
}

export interface TaskTimelineModel {
  lanes: SwimLane[];
  timeRange: { start: number; end: number };
  entries: TaskTimelineEntry[];
}

// ── 时间范围计算 ──

export function resolveTimeRange(range: TimelineRange, now: number): { start: number; end: number } {
  if (typeof range === 'object') return range;

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const dayMs = 86_400_000;
  const end = now;

  switch (range) {
    case 'today': return { start: todayStart.getTime(), end };
    case '3d': return { start: todayStart.getTime() - 2 * dayMs, end };
    case '7d': return { start: todayStart.getTime() - 6 * dayMs, end };
  }
}

// ── 从 task.* 事件构建精确时间线 ──

const TASK_EVENT_TAGS = new Set([
  SYSTEM_TAGS.TASK_CREATED,
  SYSTEM_TAGS.TASK_STARTED,
  SYSTEM_TAGS.TASK_RESUMED,
  SYSTEM_TAGS.TASK_SUSPENDED,
  SYSTEM_TAGS.TASK_COMPLETED,
  SYSTEM_TAGS.TASK_CANCELLED,
]);

function isTaskEvent(event: Event): boolean {
  for (const tag of event.tags) {
    if (TASK_EVENT_TAGS.has(tag)) return true;
  }
  return false;
}

function buildSegmentsFromEvents(
  taskId: string,
  taskTitle: string,
  events: Event[],
  timeRange: { start: number; end: number },
): { segments: TaskStatusSegment[]; terminalMarker: TaskTerminalMarker | null } {
  // 按时间排序的该任务相关事件
  const taskEvents = events
    .filter((e) => isTaskEvent(e) && (e.metadata as Record<string, unknown>)?.taskId === taskId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (taskEvents.length === 0) return { segments: [], terminalMarker: null };

  const segments: TaskStatusSegment[] = [];
  let terminalMarker: TaskTerminalMarker | null = null;
  let currentStatus: string | null = null;
  let segmentStart: number | null = null;

  for (const event of taskEvents) {
    const meta = event.metadata as Record<string, unknown>;
    const toStatus = meta?.toStatus as string | undefined;

    // task_created → pending
    if (event.tags.has(SYSTEM_TAGS.TASK_CREATED)) {
      currentStatus = 'pending';
      segmentStart = event.timestamp;
      continue;
    }

    // 终态标记
    if (event.tags.has(SYSTEM_TAGS.TASK_COMPLETED) || event.tags.has(SYSTEM_TAGS.TASK_CANCELLED)) {
      // 关闭当前段
      if (currentStatus && segmentStart !== null && currentStatus !== 'completed' && currentStatus !== 'cancelled') {
        segments.push({
          taskId, taskTitle,
          status: currentStatus as TaskStatusSegment['status'],
          startTime: segmentStart,
          endTime: event.timestamp,
          inferred: false,
        });
      }
      terminalMarker = {
        taskId, taskTitle,
        status: event.tags.has(SYSTEM_TAGS.TASK_COMPLETED) ? 'completed' : 'cancelled',
        timestamp: event.timestamp,
        inferred: false,
      };
      currentStatus = null;
      segmentStart = null;
      continue;
    }

    // 状态变更（started/resumed/suspended）
    if (toStatus) {
      // 关闭上一段
      if (currentStatus && segmentStart !== null) {
        segments.push({
          taskId, taskTitle,
          status: currentStatus as TaskStatusSegment['status'],
          startTime: segmentStart,
          endTime: event.timestamp,
          inferred: false,
        });
      }
      currentStatus = toStatus;
      segmentStart = event.timestamp;
    }
  }

  // 如果还有未关闭的段（任务仍在进行中）
  if (currentStatus && segmentStart !== null) {
    segments.push({
      taskId, taskTitle,
      status: currentStatus as TaskStatusSegment['status'],
      startTime: segmentStart,
      endTime: timeRange.end,
      inferred: false,
    });
  }

  return { segments, terminalMarker };
}

// ── 从时间块推导老任务的时间线 ──

function buildSegmentsFromTimeBlocks(
  task: TaskNode,
  timeBlocks: TimeBlock[],
  timeRange: { start: number; end: number },
): { segments: TaskStatusSegment[]; terminalMarker: TaskTerminalMarker | null } {
  const blockIds = new Set(task.timeBlockIds ?? []);
  const relatedBlocks = timeBlocks
    .filter((b) => blockIds.has(b.startId))
    .sort((a, b) => a.startTime - b.startTime);

  if (relatedBlocks.length === 0) {
    // 没有任何时间块关联，只显示一个 pending 段（如果 pending 开关打开）
    return {
      segments: [{
        taskId: task.id,
        taskTitle: task.title,
        status: 'pending',
        startTime: task.createdAt,
        endTime: timeRange.end,
        inferred: true,
      }],
      terminalMarker: null,
    };
  }

  const segments: TaskStatusSegment[] = [];

  // 推导：第一个时间块之前为 pending
  if (relatedBlocks[0].startTime > task.createdAt) {
    segments.push({
      taskId: task.id,
      taskTitle: task.title,
      status: 'pending',
      startTime: task.createdAt,
      endTime: relatedBlocks[0].startTime,
      inferred: true,
    });
  }

  // 推导：每个时间块为一个 in_progress 段
  for (const block of relatedBlocks) {
    segments.push({
      taskId: task.id,
      taskTitle: task.title,
      status: 'in_progress',
      startTime: block.startTime,
      endTime: block.endTime,
      inferred: true,
    });
  }

  // 终态推导
  let terminalMarker: TaskTerminalMarker | null = null;
  if (task.status === 'completed' || task.status === 'cancelled') {
    const lastBlock = relatedBlocks[relatedBlocks.length - 1];
    terminalMarker = {
      taskId: task.id,
      taskTitle: task.title,
      status: task.status,
      timestamp: lastBlock?.endTime ?? task.updatedAt,
      inferred: true,
    };
  }

  return { segments, terminalMarker };
}

// ── 泳道分配 ──

function assignLanes(entries: TaskTimelineEntry[]): SwimLane[] {
  // 按最早 segment 的 startTime 排序
  const sorted = [...entries].sort((a, b) => {
    const aStart = a.segments[0]?.startTime ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.segments[0]?.startTime ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
  });

  const lanes: SwimLane[] = [];

  for (const entry of sorted) {
    const entryStart = entry.segments[0]?.startTime ?? 0;
    const entryEnd = entry.terminalMarker?.timestamp
      ?? entry.segments[entry.segments.length - 1]?.endTime
      ?? 0;

    // 找到第一个空闲泳道
    let assigned = false;
    for (const lane of lanes) {
      const laneEnd = Math.max(
        ...lane.entries.map((e) =>
          e.terminalMarker?.timestamp
          ?? e.segments[e.segments.length - 1]?.endTime
          ?? 0
        ),
      );
      if (entryStart >= laneEnd) {
        lane.entries.push(entry);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      lanes.push({ entries: [entry] });
    }
  }

  return lanes;
}

// ── 主构建函数 ──

export function buildTaskTimelineModel(
  tasks: TaskNode[],
  events: Event[],
  timeBlocks: TimeBlock[],
  range: TimelineRange,
  options: { showPending: boolean } = { showPending: false },
): TaskTimelineModel {
  const now = Date.now();
  const timeRange = resolveTimeRange(range, now);

  const entries: TaskTimelineEntry[] = [];

  for (const task of tasks) {
    // 检查是否有 task.* 事件
    const taskEvents = events.filter((e) =>
      isTaskEvent(e) && (e.metadata as Record<string, unknown>)?.taskId === task.id
    );

    let result: { segments: TaskStatusSegment[]; terminalMarker: TaskTerminalMarker | null };

    if (taskEvents.length > 0) {
      result = buildSegmentsFromEvents(task.id, task.title, events, timeRange);
    } else {
      result = buildSegmentsFromTimeBlocks(task, timeBlocks, timeRange);
    }

    // 过滤：只保留与 timeRange 有交集的 segments
    const filteredSegments = result.segments.filter((seg) =>
      seg.endTime > timeRange.start && seg.startTime < timeRange.end
    );

    // 过滤 pending（默认隐藏）
    const visibleSegments = options.showPending
      ? filteredSegments
      : filteredSegments.filter((seg) => seg.status !== 'pending');

    // 过滤终态标记
    const terminalMarker = result.terminalMarker
      && result.terminalMarker.timestamp >= timeRange.start
      && result.terminalMarker.timestamp <= timeRange.end
      ? result.terminalMarker
      : null;

    if (visibleSegments.length > 0 || terminalMarker) {
      entries.push({
        taskId: task.id,
        taskTitle: task.title,
        currentStatus: task.status,
        segments: visibleSegments,
        terminalMarker,
      });
    }
  }

  const lanes = assignLanes(entries);

  return { lanes, timeRange, entries };
}
```

### 3.4 新建 TaskTimelinePage

**新建文件**：`src/ui/app/pages/TaskTimelinePage.tsx`

这是核心页面组件。由于代码量较大，以下给出组件结构和关键实现伪代码：

```tsx
import { Clock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { getEventLogService, getTaskService, getTimeBlockService } from '@/lib/services';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';
import {
  buildTaskTimelineModel,
  resolveTimeRange,
  type TaskTimelineEntry,
  type TaskTimelineModel,
  type TimelineRange,
} from './task-timeline-model';
import { TASKS_LAST_PATH_KEY } from './task-route-memory';

// ── 颜色常量（复用 DAG 体系）──
const STATUS_COLORS = {
  pending: { bg: '#E7E5E4', dark: '#44403C' },
  in_progress: { bg: '#22C55E', dark: '#16A34A' },
  suspended: { bg: '#EAB308', dark: '#CA8A04' },
  completed: { border: '#C75B3A' },
  cancelled: { border: '#D6D3D1', dark: '#57534E' },
} as const;

// ── URL 参数读写 ──
function readUrlParams(search: string): {
  range: TimelineRange;
  selectedTaskId: string | null;
  showPending: boolean;
} {
  const params = new URLSearchParams(search);
  const rangeStr = params.get('range') ?? 'today';
  const selectedTaskId = params.get('task') ?? null;
  const showPending = params.get('pending') === '1';

  let range: TimelineRange;
  if (rangeStr === '3d' || rangeStr === '7d' || rangeStr === 'today') {
    range = rangeStr;
  } else if (rangeStr.includes('~')) {
    const [startStr, endStr] = rangeStr.split('~');
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();
    range = Number.isFinite(start) && Number.isFinite(end) ? { start, end } : 'today';
  } else {
    range = 'today';
  }

  return { range, selectedTaskId, showPending };
}

// ── 泳道渲染组件 ──
function TimelineSwimLane({
  model,
  isHorizontal,
  selectedTaskId,
  onSelectTask,
}: {
  model: TaskTimelineModel;
  isHorizontal: boolean;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
}) {
  const { lanes, timeRange } = model;
  const duration = timeRange.end - timeRange.start;
  if (duration <= 0) return null;

  // 将时间戳映射到百分比位置
  const toPercent = (timestamp: number) =>
    Math.max(0, Math.min(100, ((timestamp - timeRange.start) / duration) * 100));

  return (
    <div className={`relative ${isHorizontal ? 'w-full' : 'h-full flex'}`}>
      {/* 时间轴刻度 */}
      <TimeAxis timeRange={timeRange} isHorizontal={isHorizontal} />

      {/* 泳道区域 */}
      <div className={isHorizontal ? 'flex flex-col gap-1' : 'flex flex-row gap-1 flex-1'}>
        {lanes.map((lane, laneIndex) => (
          <div
            key={laneIndex}
            className={`relative ${isHorizontal ? 'h-8' : 'w-8'}`}
          >
            {lane.entries.map((entry) => (
              <div key={entry.taskId}>
                {/* 状态色块 */}
                {entry.segments.map((segment, segIndex) => {
                  const startPct = toPercent(segment.startTime);
                  const endPct = toPercent(segment.endTime);
                  const isSelected = entry.taskId === selectedTaskId;
                  const color = STATUS_COLORS[segment.status];

                  return (
                    <div
                      key={segIndex}
                      data-testid={`timeline-segment-${entry.taskId}-${segIndex}`}
                      title={`${entry.taskTitle} · ${segment.status}${segment.inferred ? '（推导）' : ''}`}
                      onClick={() => onSelectTask(entry.taskId)}
                      className={`absolute cursor-pointer rounded-sm transition-all ${
                        isSelected ? 'ring-2 ring-[#C75B3A]/40 z-10' : 'hover:brightness-110'
                      } ${segment.inferred ? 'opacity-60' : ''}`}
                      style={isHorizontal
                        ? { left: `${startPct}%`, width: `${endPct - startPct}%`, top: 0, bottom: 0, backgroundColor: color.bg }
                        : { top: `${startPct}%`, height: `${endPct - startPct}%`, left: 0, right: 0, backgroundColor: color.bg }
                      }
                    />
                  );
                })}

                {/* 终态竖线标记 */}
                {entry.terminalMarker ? (
                  <div
                    data-testid={`timeline-terminal-${entry.taskId}`}
                    title={`${entry.taskTitle} · ${entry.terminalMarker.status === 'completed' ? '完成' : '取消'}`}
                    onClick={() => onSelectTask(entry.taskId)}
                    className="absolute cursor-pointer z-10"
                    style={isHorizontal
                      ? {
                          left: `${toPercent(entry.terminalMarker.timestamp)}%`,
                          top: 0, bottom: 0, width: 2,
                          backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border,
                        }
                      : {
                          top: `${toPercent(entry.terminalMarker.timestamp)}%`,
                          left: 0, right: 0, height: 2,
                          backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border,
                        }
                    }
                  />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 时间轴刻度组件 ──
function TimeAxis({ timeRange, isHorizontal }: { timeRange: { start: number; end: number }; isHorizontal: boolean }) {
  // 根据时间范围生成刻度标记（每小时或每天）
  const duration = timeRange.end - timeRange.start;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;

  const step = duration > 3 * dayMs ? dayMs : hourMs;
  const ticks: Array<{ position: number; label: string }> = [];

  let current = Math.ceil(timeRange.start / step) * step;
  while (current < timeRange.end) {
    const pct = ((current - timeRange.start) / duration) * 100;
    const date = new Date(current);
    const label = step === dayMs
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${date.getHours()}:00`;
    ticks.push({ position: pct, label });
    current += step;
  }

  return (
    <div
      data-testid="timeline-axis"
      className={`relative ${
        isHorizontal
          ? 'h-6 w-full border-b border-[#E7E5E4] dark:border-[#292524]'
          : 'w-12 h-full border-r border-[#E7E5E4] dark:border-[#292524]'
      }`}
    >
      {ticks.map((tick, i) => (
        <span
          key={i}
          className="absolute text-[10px] text-[#78716C] dark:text-[#A8A29E]"
          style={isHorizontal
            ? { left: `${tick.position}%`, top: 2 }
            : { top: `${tick.position}%`, left: 2 }
          }
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

// ── 选中任务详情面板 ──
function TimelineDetailPanel({
  entry,
  onClose,
  onOpenDetail,
}: {
  entry: TaskTimelineEntry;
  onClose: () => void;
  onOpenDetail: () => void;
}) {
  return (
    <div
      data-testid="timeline-detail-panel"
      className="border-t border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
          {entry.taskTitle}
        </h3>
        <button onClick={onClose} className="text-xs text-[#78716C]">关闭</button>
      </div>
      <div className="mt-2 space-y-1">
        {entry.segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-[#57534E] dark:text-[#A8A29E]">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[seg.status].bg }}
            />
            <span>{seg.status}</span>
            <span>{new Date(seg.startTime).toLocaleTimeString()} – {new Date(seg.endTime).toLocaleTimeString()}</span>
            {seg.inferred ? <span className="text-[10px] text-[#A8A29E]">（推导）</span> : null}
          </div>
        ))}
        {entry.terminalMarker ? (
          <div className="flex items-center gap-2 text-xs text-[#57534E] dark:text-[#A8A29E]">
            <div className="h-2 w-0.5" style={{ backgroundColor: STATUS_COLORS[entry.terminalMarker.status].border }} />
            <span>{entry.terminalMarker.status === 'completed' ? '完成' : '取消'}</span>
            <span>{new Date(entry.terminalMarker.timestamp).toLocaleTimeString()}</span>
          </div>
        ) : null}
      </div>
      <button
        onClick={onOpenDetail}
        className="mt-3 text-xs text-[#C75B3A] hover:underline"
      >
        查看任务详情 →
      </button>
    </div>
  );
}

// ── 主页面组件 ──
export function TaskTimelinePage() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const location = useLocation();

  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);

  const urlParams = useMemo(() => readUrlParams(location.searchStr ?? ''), [location.searchStr]);
  const [range, setRange] = useState<TimelineRange>(urlParams.range);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(urlParams.selectedTaskId);
  const [showPending, setShowPending] = useState(urlParams.showPending);

  // 路由记忆
  useEffect(() => {
    sessionStorage.setItem(TASKS_LAST_PATH_KEY, '/tasks/timeline');
  }, []);

  // 数据加载
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const [taskList, eventList, blockList] = await Promise.all([
        getTaskService().listTasks(true),
        getEventLogService().loadEvents(),
        getTimeBlockService().loadTimeBlocks(),
      ]);
      if (disposed) return;
      setTasks(taskList);
      setEvents(eventList);
      setTimeBlocks(blockList);
    };
    void load();
    return () => { disposed = true; };
  }, []);

  // 构建模型
  const model = useMemo(
    () => buildTaskTimelineModel(tasks, events, timeBlocks, range, { showPending }),
    [tasks, events, timeBlocks, range, showPending],
  );

  const selectedEntry = model.entries.find((e) => e.taskId === selectedTaskId) ?? null;
  const isHorizontal = isDesktop;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-timeline-page">
      <header className="px-5 py-4 md:px-8 lg:px-10">
        <TaskBreadcrumb
          segments={[{ label: '任务', to: '/tasks' }]}
          current={{ label: '时间线', icon: Clock }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务时间线</h1>

          {/* 时间范围切换 */}
          <div className="flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm dark:border-[#3C3836] dark:bg-[#1C1917]/90">
            {(['today', '3d', '7d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  range === r
                    ? 'bg-[#FFF7ED] text-[#C75B3A] dark:bg-[#2A231B] dark:text-[#FDBA74]'
                    : 'text-[#57534E] hover:text-[#1C1917] dark:text-[#A8A29E]'
                }`}
              >
                {r === 'today' ? '今日' : r}
              </button>
            ))}
            {/* custom 日期选择器入口 */}
            <button
              onClick={() => {
                // 打开日期选择器（简单实现：两个 input[type=date]）
              }}
              className="rounded-full px-3 py-1 text-[11px] font-medium text-[#57534E] hover:text-[#1C1917] dark:text-[#A8A29E]"
            >
              自定义
            </button>
          </div>

          {/* pending 开关 */}
          <button
            onClick={() => setShowPending((v) => !v)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              showPending
                ? 'border-[#C75B3A] bg-[#FFF7ED] text-[#C75B3A]'
                : 'border-[#E7E3E0] text-[#57534E]'
            }`}
          >
            {showPending ? '隐藏待办段' : '显示待办段'}
          </button>
        </div>
      </header>

      {/* 泳道图区域 */}
      <div className="relative flex-1 min-h-0 overflow-auto border-t border-[#F0ECE8] p-4 dark:border-[#292524]">
        <TimelineSwimLane
          model={model}
          isHorizontal={isHorizontal}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
        />
      </div>

      {/* 选中任务详情面板 */}
      {selectedEntry ? (
        <TimelineDetailPanel
          entry={selectedEntry}
          onClose={() => setSelectedTaskId(null)}
          onOpenDetail={() => navigate({ to: '/tasks/$taskId', params: { taskId: selectedEntry.taskId } })}
        />
      ) : null}
    </div>
  );
}
```

### 3.5 验证

```bash
npx tsc --noEmit
npx vitest run tests/ --pool forks --maxWorkers 1 --no-file-parallelism
```

**新增测试**（新建 `tests/unit/ui/task-timeline-model.test.ts`）：

```ts
describe('task-timeline-model', () => {
  describe('resolveTimeRange', () => {
    it('today 范围从今天 0 点到当前时间', () => { ... });
    it('3d 范围从 3 天前到当前时间', () => { ... });
    it('custom 范围直接使用传入值', () => { ... });
  });

  describe('buildTaskTimelineModel', () => {
    it('有 task.* 事件的任务构建精确时间线', () => { ... });
    it('没有事件的老任务从时间块推导', () => { ... });
    it('推导的段标记 inferred=true', () => { ... });
    it('pending 段默认隐藏', () => { ... });
    it('showPending=true 时显示 pending 段', () => { ... });
    it('completed/cancelled 只产生 terminalMarker 不产生 segment', () => { ... });
    it('泳道分配：并发任务放在不同泳道', () => { ... });
    it('泳道分配：顺序任务复用同一泳道', () => { ... });
  });
});
```

---

## 关键文件索引

| 文件 | 改动类型 | Issue |
|------|---------|-------|
| `src/lib/types/event.ts` | 新增 SYSTEM_TAGS + metadata 接口 | #585 |
| `src/lib/services/task-event-emitter.ts` | **新建**（使用 appendEventWithEcsReplication） | #585 |
| `src/lib/services/task.service.ts` | 追加事件发射调用 | #585 |
| `src/lib/services/task-timer.service.ts` | 追加 link/unlink 事件发射 | #585 |
| `tests/unit/lib/task-event-emitter.test.ts` | **新建** | #585 |
| `src/routes.tsx` | 新增 /eventlog/timeblocks/$blockId + /tasks/timeline + 重定向 | #583 #584 |
| `src/ui/app/pages/TimeBlockDetailPage.tsx` | breadcrumb 根据域调整 | #583 |
| `src/ui/app/components/NowTodayTab.tsx` | 跳转目标改为 /eventlog/timeblocks/ | #583 |
| `src/ui/app/pages/now-today-blocks-view.ts` | href 改为 /eventlog/timeblocks/ | #583 |
| `src/ui/app/pages/task-timeline-model.ts` | **新建** 泳道图数据模型 | #584 |
| `src/ui/app/pages/TaskTimelinePage.tsx` | **新建** 时间线页面 | #584 |
| `src/ui/app/pages/TasksPage.tsx` | 导航入口改为 /tasks/timeline | #584 |
| `src/ui/app/pages/TaskDetailPage.tsx` | breadcrumb 链接改为 /tasks/timeline | #584 |
| `tests/unit/ui/task-timeline-model.test.ts` | **新建** | #584 |
| `tests/e2e/now-tabs-timeblock-detail.issue418-516.test.ts` | URL 断言更新 | #583 |

---

## ⚠️ 不要做清单（Codex 必读）

| 禁止项 | 原因 |
|--------|------|
| **不要改动 task-dag-graph.ts** | DAG 图算法与时间线无关 |
| **不要改动 TaskDagPage.tsx** | DAG 页面不变 |
| **不要改动 task-dag-flow.ts** | DAG 布局不变 |
| **不要改动 RT 后端 (Rust)** | task.* 事件是纯前端 EventLog 写入 |
| **不要删除 /tasks/block/$blockId 路由** | 任务域的时间块详情仍然需要 |
| **不要删除 TaskTimeblocksPage.tsx** | 旧页面可以保留作为重定向中转或后备 |
| **不要引入新的图表库** | 泳道图用 HTML div + Tailwind 实现 |
| **不要改动 timeblock.service.ts 的 startBlock/endBlock** | 时间块服务逻辑不变 |
| **不要在 EventLog 事件中使用英文 content** | content 必须是中文可读叙述 |

## ⚠️ 容易出错的关键点

1. **事件发射必须在主操作成功后**：`emitTaskCreated` 放在 `createTask` 成功之后，不是之前。如果写入失败则不发事件
2. **transitionTask 需要先读 fromStatus**：当前实现直接调 `env.task.transitionTask(id, to)`，改动后需要先 `getTaskById` 读取旧状态。注意 `cancelTask` 也需要
3. **事件发射是 fire-and-forget**：`tryEmit` 用 `void appendEventWithEcsReplication(...).catch()`，不阻塞主流程。不要 await
4. **必须使用 `appendEventWithEcsReplication`**：不要用 `getEventLogService().appendEventData()`！两者数据格式不同。timeblock.service.ts 用的是前者，task 事件也必须用前者以保持一致
5. **suspended→in_progress 是「恢复」不是「开始」**：`emitTaskTransition` 必须特判 `fromStatus === 'suspended'`
6. **泳道分配算法的排序**：按最早 segment 的 startTime 排序，不是按 taskId
7. **百分比位置计算要 clamp 到 [0, 100]**：`toPercent` 必须 `Math.max(0, Math.min(100, ...))`
8. **isHorizontal 控制两套样式**：每个定位属性（left/top, width/height）都要根据方向切换。漏一个就会错位
9. **TanStack Router 重定向语法**：检查项目中已有的重定向写法，可能是 `redirect()` 函数或 `Navigate` 组件
10. **URL 参数同步**：range/task/pending 变化时需要更新 URL（`navigate({ search: ... })`），否则刷新丢失状态

---

## 验证总表

| 场景 | 操作 | 期望结果 | Issue |
|------|------|---------|-------|
| 事件-创建 | createTask('新任务') | EventLog 出现「创建任务「新任务」」 | #585 |
| 事件-开始 | transitionTask(id, 'in_progress') | EventLog 出现「开始任务「…」」 | #585 |
| 事件-恢复 | suspended→in_progress | EventLog 出现「恢复任务「…」」 | #585 |
| 事件-完成 | transitionTask(id, 'completed') | EventLog 出现「完成任务「…」」 | #585 |
| 事件-关联 | startBlockForTask | EventLog 出现「关联任务「…」到时间块」 | #585 |
| 事件-取消关联 | removeTaskFromBlock | EventLog 出现「取消关联任务「…」」 | #585 |
| 事件-降级 | 无 EventLogService 时 | 不抛异常，事件静默跳过 | #585 |
| 路由-Now 今日 | 点击时间块 | 跳转到 /eventlog/timeblocks/$blockId | #583 |
| 路由-面包屑 | Now 域详情页 | 显示「当下 / 时间块详情」 | #583 |
| 路由-Tasks 域 | 从任务详情进时间块 | 仍走 /tasks/block/$blockId | #583 |
| 路由-重定向 | 访问 /tasks/timeblocks | 重定向到 /tasks/timeline | #584 |
| 时间线-精确 | 有 task.* 事件的任务 | 显示精确状态色块 | #584 |
| 时间线-推导 | 老任务无事件 | 从时间块推导，标记「推导」 | #584 |
| 时间线-pending | 默认 | pending 段隐藏 | #584 |
| 时间线-pending | 点击「显示待办段」 | pending 灰色段出现 | #584 |
| 时间线-终态 | completed 任务 | 只显示竖线标记，无色块 | #584 |
| 时间线-泳道 | 2 个并发任务 | 分配到不同泳道 | #584 |
| 时间线-选中 | 点击色块 | 下方面板显示任务详情 | #584 |
| 时间线-横竖 | 横屏 | 水平时间轴 | #584 |
| 时间线-横竖 | 竖屏 | 垂直时间轴 | #584 |
| 时间线-范围 | 切换到 7d | 显示 7 天数据 | #584 |
| tsc | `npx tsc --noEmit` | 零错误 | 全部 |
| 测试 | `npx vitest run` | 通过 | 全部 |

---

## 完成回填

已按计划顺序完成 `#585 -> #583 -> #584`，且每一步完成后都单独执行了类型检查与相关单测。

### 实际完成情况

- `#585` 已完成：
  - 在 `src/lib/types/event.ts` 补齐 `task_created / task_started / task_resumed / task_suspended / task_completed / task_cancelled / task_linked / task_unlinked`
  - 新建 `src/lib/services/task-event-emitter.ts`，统一通过 `appendEventWithEcsReplication` 发射 ECS 事件
  - `src/lib/services/task.service.ts` 已在 `createTask / transitionTask / cancelTask` 成功后发射生命周期事件
  - `src/lib/services/task-timer.service.ts` 已在 `startBlockForTasks / addTaskToBlock / removeTaskFromBlock` 成功后发射关联事件
  - 额外修正了 `fromStatus` 读取时机，避免底层 port 原地修改对象时把旧状态覆盖掉

- `#583` 已完成：
  - 在 `src/routes.tsx` 新增 `/eventlog/timeblocks/$blockId`
  - `src/ui/app/pages/TimeBlockDetailPage.tsx` 已根据当前路径切换返回语义
  - `src/ui/app/components/NowTodayTab.tsx` 与 `src/ui/app/pages/now-today-blocks-view.ts` 已改为跳转 `/eventlog/timeblocks/$blockId`
  - `/tasks/block/$blockId` 任务域路由保持保留

- `#584` 已完成：
  - 在 `src/routes.tsx` 新增 `/tasks/timeline`
  - `/tasks/timeblocks` 现通过路由层 `navigate(...replace)` 重定向到 `/tasks/timeline`
  - 新建 `src/ui/app/pages/task-timeline-model.ts`，实现 task.* 精确建模、旧任务时间块推导、泳道分配与 pending 过滤
  - 新建 `src/ui/app/pages/TaskTimelinePage.tsx`，用 HTML div + Tailwind 实现泳道图，不引入新图表库
  - `src/ui/app/pages/TasksPage.tsx` 顶部入口已改为“时间线”
  - `src/ui/app/pages/TaskDetailPage.tsx` 已支持从 `timeline` 来源返回

### 实际验证命令

- `#585`
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/services/task-event-emitter.test.ts tests/unit/services/task-hierarchy.issue336.test.ts tests/unit/services/task-timer.issue337.test.ts`

- `#583`
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/now-today-blocks-view.issue516.test.ts tests/unit/ui/task-routing.issue213.test.ts tests/unit/ui/timeblock-detail-domain.issue583.test.tsx`

- `#584`
  - `bunx tsc --noEmit`
  - `bunx vitest run tests/unit/ui/task-timeline-model.test.ts tests/unit/ui/tasks-page-today-view.test.tsx tests/unit/ui/task-routing.issue213.test.ts`
