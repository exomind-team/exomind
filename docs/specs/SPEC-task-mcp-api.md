# SPEC-task-mcp-api.md

> **规格文档**: 任务系统 MCP API 设计
> **关联 Issue**: #459
> **版本**: v1.0 (MVP Phase 1)
> **状态**: Draft

---

## 概述

本文档定义任务系统通过 MCP（Model Context Protocol）暴露给 Agent 的 API 接口。

### 设计原则

1. **完整性**: 创建时支持所有常用参数，减少多次调用
2. **安全性**: 状态变更独立 tool，保留业务逻辑验证
3. **可用性**: 错误信息包含上下文，帮助 Agent 理解和处理
4. **一致性**: 遵循现有 MCP tools 的命名和返回格式

### 通用约定

#### 时间格式
所有时间字段使用 **ISO 8601 字符串格式**：
```
2026-03-09T10:30:00.000Z
```

#### 返回值格式
```typescript
// 成功
{
  success: true,
  ...data
}

// 失败
{
  success: false,
  error: string,
  ...context  // 可选的上下文信息
}
```

#### 任务 ID
任务 ID 为字符串类型，由系统生成（UUID 或其他格式）。

---

## MVP Phase 1 - 基础 CRUD + 状态变更

### 1. exomind_create_task

创建新任务。

#### 输入参数

```typescript
{
  title: string                    // 必需，任务标题
  description?: string             // 可选，任务描述
  parentId?: string                // 可选，父任务 ID
  estimatedMinutes?: number        // 可选，预计耗时（分钟）
  dueAt?: string                   // 可选，截止时间（ISO 8601）
  priority?: number                // 可选，优先级（数字越大越优先）
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "任务标题",
      "minLength": 1
    },
    "description": {
      "type": "string",
      "description": "任务描述"
    },
    "parentId": {
      "type": "string",
      "description": "父任务 ID"
    },
    "estimatedMinutes": {
      "type": "number",
      "description": "预计耗时（分钟）",
      "minimum": 0
    },
    "dueAt": {
      "type": "string",
      "description": "截止时间（ISO 8601 格式）",
      "format": "date-time"
    },
    "priority": {
      "type": "number",
      "description": "优先级（数字越大越优先）"
    }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  task: {
    id: string
    title: string
    description: string
    status: "pending"  // 新创建的任务默认为 pending
    parentId: string | null
    estimatedMinutes: number | null
    dueAt: string | null
    priority: number | null
    createdAt: string  // ISO 8601
    updatedAt: string  // ISO 8601
    dependencies: Array<{
      taskId: string
      type: "soft" | "hard"
    }>
  }
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 标题为空 | title 为空字符串 | `{ success: false, error: "title is required" }` |
| 父任务不存在 | parentId 指向不存在的任务 | `{ success: false, error: "Parent task {id} not found" }` |
| 时间格式错误 | dueAt 不是有效的 ISO 8601 | `{ success: false, error: "Invalid dueAt format" }` |

#### 使用示例

```typescript
// Claude Code 自动创建子任务
const result = await mcp.callTool("exomind_create_task", {
  title: "实现用户登录功能",
  description: "使用 JWT 认证，支持记住登录状态",
  parentId: "task-parent-123",
  estimatedMinutes: 120,
  dueAt: "2026-03-15T18:00:00.000Z",
  priority: 5
});
```

---

### 2. exomind_get_task

获取单个任务的详细信息。

#### 输入参数

```typescript
{
  taskId: string  // 必需，任务 ID
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": ["taskId"],
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  task: {
    id: string
    title: string
    description: string
    status: "pending" | "in_progress" | "suspended" | "completed" | "cancelled"
    parentId: string | null
    estimatedMinutes: number | null
    dueAt: string | null
    priority: number | null
    createdAt: string
    updatedAt: string
    dependencies: Array<{
      taskId: string
      type: "soft" | "hard"
    }>
  }
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 任务不存在 | taskId 不存在 | `{ success: false, error: "Task {id} not found" }` |

#### 使用示例

```typescript
// Governor Agent 检查任务状态
const result = await mcp.callTool("exomind_get_task", {
  taskId: "task-123"
});

if (result.success && result.task.status === "in_progress") {
  // 检查是否超期
}
```

---

### 3. exomind_list_tasks

列出所有任务，按更新时间倒序排列（最近修改的在前）。

#### 输入参数

```typescript
{
  includeCancelled?: boolean  // 可选，是否包含已取消的任务，默认 false
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "includeCancelled": {
      "type": "boolean",
      "description": "是否包含已取消的任务",
      "default": false
    }
  },
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  count: number,  // 任务总数
  tasks: Array<{
    id: string
    title: string
    description: string
    status: "pending" | "in_progress" | "suspended" | "completed" | "cancelled"
    parentId: string | null
    estimatedMinutes: number | null
    dueAt: string | null
    priority: number | null
    createdAt: string
    updatedAt: string
    dependencies: Array<{
      taskId: string
      type: "soft" | "hard"
    }>
  }>
}
```

#### 排序规则

任务按 `updatedAt` 倒序排列（最近修改的在前）。

#### 使用示例

```typescript
// Growth Coach 分析最近活跃的任务
const result = await mcp.callTool("exomind_list_tasks", {
  includeCancelled: false
});

const recentTasks = result.tasks.slice(0, 10);
```

---

### 4. exomind_update_task

更新任务的基本信息。

**注意**: 不能通过此接口修改任务状态，状态变更请使用专门的 start/complete/cancel tools。

#### 输入参数

```typescript
{
  taskId: string                   // 必需，任务 ID
  title?: string                   // 可选，任务标题
  description?: string             // 可选，任务描述
  parentId?: string                // 可选，父任务 ID
  estimatedMinutes?: number        // 可选，预计耗时（分钟）
  dueAt?: string                   // 可选，截止时间（ISO 8601）
  priority?: number                // 可选，优先级
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    },
    "title": {
      "type": "string",
      "description": "任务标题",
      "minLength": 1
    },
    "description": {
      "type": "string",
      "description": "任务描述"
    },
    "parentId": {
      "type": "string",
      "description": "父任务 ID"
    },
    "estimatedMinutes": {
      "type": "number",
      "description": "预计耗时（分钟）",
      "minimum": 0
    },
    "dueAt": {
      "type": "string",
      "description": "截止时间（ISO 8601 格式）",
      "format": "date-time"
    },
    "priority": {
      "type": "number",
      "description": "优先级"
    }
  },
  "required": ["taskId"],
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  task: {
    // 完整的任务对象（同 get_task）
  }
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 任务不存在 | taskId 不存在 | `{ success: false, error: "Task {id} not found" }` |
| 标题为空 | title 为空字符串 | `{ success: false, error: "title cannot be empty" }` |
| 父任务不存在 | parentId 指向不存在的任务 | `{ success: false, error: "Parent task {id} not found" }` |

#### 使用示例

```typescript
// Agent 调整任务的预计时间
const result = await mcp.callTool("exomind_update_task", {
  taskId: "task-123",
  estimatedMinutes: 180,
  priority: 8
});
```

---

### 5. exomind_start_task

开始或恢复任务（状态变更：pending / suspended → in_progress）。

**业务规则**: 如果任务有未完成的 hard 依赖，则无法开始。

#### 输入参数

```typescript
{
  taskId: string  // 必需，任务 ID
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": ["taskId"],
  "additionalProperties": false
}
```

#### 返回值（成功）

```typescript
{
  success: true,
  task: {
    // 完整的任务对象，status 为 "in_progress"
  }
}
```

#### 返回值（失败 - 有阻塞依赖）

```typescript
{
  success: false,
  error: "Cannot start: hard dependencies not met",
  blocking: Array<{
    taskId: string
    type: "hard"
    status: "pending" | "in_progress" | "suspended" | "cancelled"
    title: string
  }>
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 任务不存在 | taskId 不存在 | `{ success: false, error: "Task {id} not found" }` |
| 有 hard 依赖未完成 | 存在未完成的 hard 依赖 | 见上方"返回值（失败）" |
| 状态不允许 | 任务已完成或已取消 | `{ success: false, error: "Cannot transition from {status} to in_progress" }` |

#### 使用示例

```typescript
// Agent 尝试开始任务
const result = await mcp.callTool("exomind_start_task", {
  taskId: "task-123"
});

if (!result.success && result.blocking) {
  // 提示用户：需要先完成依赖任务
  console.log("阻塞任务:", result.blocking.map(b => b.title));
}
```

---

### 6. exomind_complete_task

完成任务（状态变更：in_progress / suspended → completed）。

#### 输入参数

```typescript
{
  taskId: string  // 必需，任务 ID
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": ["taskId"],
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  task: {
    // 完整的任务对象，status 为 "completed"
  }
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 任务不存在 | taskId 不存在 | `{ success: false, error: "Task {id} not found" }` |
| 状态不允许 | 任务不处于进行中或挂起态 | `{ success: false, error: "Cannot transition from {status} to completed" }` |

#### 使用示例

```typescript
// Agent 完成任务
const result = await mcp.callTool("exomind_complete_task", {
  taskId: "task-123"
});
```

---

### 7. exomind_cancel_task

取消任务（状态变更：in_progress / suspended → cancelled）。

#### 输入参数

```typescript
{
  taskId: string  // 必需，任务 ID
}
```

#### JSON Schema

```json
{
  "type": "object",
  "properties": {
    "taskId": {
      "type": "string",
      "description": "任务 ID"
    }
  },
  "required": ["taskId"],
  "additionalProperties": false
}
```

#### 返回值

```typescript
{
  success: true,
  task: {
    // 完整的任务对象，status 为 "cancelled"
  }
}
```

#### 错误情况

| 错误 | 原因 | 返回值 |
|------|------|--------|
| 任务不存在 | taskId 不存在 | `{ success: false, error: "Task {id} not found" }` |
| 状态不允许 | 任务不处于进行中或挂起态 | `{ success: false, error: "Cannot transition from {status} to cancelled" }` |

#### 使用示例

```typescript
// Agent 取消任务
const result = await mcp.callTool("exomind_cancel_task", {
  taskId: "task-123"
});
```

---

## 数据类型定义

### TaskNode

```typescript
interface TaskNode {
  id: string
  title: string
  description: string
  status: TaskStatus
  parentId: string | null
  estimatedMinutes: number | null
  dueAt: string | null  // ISO 8601
  priority: number | null
  createdAt: string      // ISO 8601
  updatedAt: string      // ISO 8601
  dependencies: TaskDependency[]
}

type TaskStatus = "pending" | "in_progress" | "suspended" | "completed" | "cancelled"

interface TaskDependency {
  taskId: string
  type: "soft" | "hard"
}
```

---

## 状态转换规则

```
pending ──────> in_progress ──────> completed
                  │    ▲
                  │    │
                  ▼    │
              suspended
                  │
                  ├──────────────> completed
                  └──────────────> cancelled
```

### 转换约束

| 从 | 到 | 约束 |
|----|----|----|
| pending | in_progress | hard 依赖必须已完成 |
| in_progress | suspended / completed / cancelled | 无约束 |
| suspended | in_progress / completed / cancelled | 无约束 |

---

## 实现注意事项

### 1. 数据同步

MCP 操作后应触发 EventBus 事件，确保前端实时更新：

```typescript
// 在 tool handler 中
const task = await taskService.createTask(input);
eventBus.emit('task:created', { taskId: task.id });
return { success: true, task };
```

### 2. 错误处理

使用 Zod 进行参数验证：

```typescript
import { z } from 'zod';
import { parseToolArgs } from '../utils/zod-tool-parse';

const createTaskArgsSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  // ...
}).strict();

const input = parseToolArgs(createTaskArgsSchema, args);
```

### 3. 时间处理

确保时间字段的序列化和反序列化：

```typescript
// 输入：接受 ISO 8601 字符串
dueAt: z.string().datetime().optional()

// 输出：转换为 ISO 8601 字符串
dueAt: task.dueAt?.toISOString() ?? null
```

---

## 测试场景

### 单元测试

- [ ] 创建任务（完整参数）
- [ ] 创建任务（最小参数）
- [ ] 创建任务（父任务不存在，应失败）
- [ ] 获取任务（存在）
- [ ] 获取任务（不存在，应失败）
- [ ] 列出任务（默认不包含已取消）
- [ ] 列出任务（包含已取消）
- [ ] 更新任务（修改标题）
- [ ] 更新任务（修改多个字段）
- [ ] 开始任务（无依赖）
- [ ] 开始任务（有 hard 依赖未完成，应失败）
- [ ] 完成任务
- [ ] 取消任务

### 集成测试

- [ ] Claude Code 创建任务 → 前端实时显示
- [ ] Agent 开始任务 → 前端状态更新
- [ ] Agent 完成任务 → 前端状态更新

---

## 后续扩展（Phase 2/3）

### Phase 2 - 依赖管理 + 时间块关联

- `exomind_add_task_dependency`
- `exomind_remove_task_dependency`
- `exomind_get_task_dag`
- `exomind_bind_task_timeblock`
- `exomind_unbind_task_timeblock`

### Phase 3 - 高级查询 + 统计分析

- `exomind_query_tasks`（多维度过滤）
- `exomind_get_task_stats`（统计信息）
- `exomind_analyze_task_patterns`（模式识别）

---

## 参考文档

- [Issue #459: feat(mcp): 任务系统通过 MCP 接入 Agent](https://github.com/exomind-team/exomind/issues/459)
- [TaskService 接口](../../src/lib/services/task.service.ts)
- [MCP SDK 文档](https://github.com/modelcontextprotocol/sdk)
- [现有 MCP Tools 参考](../../packages/mcp/src/tools/)

---

*文档版本: v1.0*
*最后更新: 2026-03-09*
