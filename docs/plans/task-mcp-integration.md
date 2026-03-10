# feat(mcp): 任务系统通过 MCP 接入 Agent

## 背景

将任务系统通过 MCP（Model Context Protocol）暴露给外部 AI 工具（Claude Code/Codex）和内部 Agent，实现 Agent 自主管理任务的能力。

## 集成方案

### 部署位置
与现有 `exomind-mcp` 服务器集成（`packages/mcp/`）

### 主要客户端
- Claude Code / Codex（外部工具）
- ExoMind 内部 Agent（Governor、Growth Coach）

### 集成点
```
packages/mcp/src/tools/
├── tools-event.ts       ✅ 已有
├── tools-timeblock.ts   ✅ 已有
└── tools-task.ts        🆕 需要创建
```

## 分阶段实施

### MVP (Phase 1) - 基础 CRUD + 状态变更

**Tools 列表：**
- `exomind_create_task` - 创建任务
- `exomind_get_task` - 获取单个任务
- `exomind_list_tasks` - 列出任务（基础版）
- `exomind_update_task` - 更新任务（不包括状态变更）
- `exomind_start_task` - 开始任务
- `exomind_complete_task` - 完成任务
- `exomind_cancel_task` - 取消任务

**典型场景：**
- Claude Code 编码时自动创建子任务
- Governor Agent 定期检查任务状态并提醒

### Phase 2 - 依赖管理 + 时间块关联

**Tools 列表：**
- `exomind_add_task_dependency` - 添加任务依赖
- `exomind_remove_task_dependency` - 移除任务依赖
- `exomind_get_task_dag` - 获取任务 DAG 拓扑
- `exomind_bind_task_timeblock` - 绑定任务与时间块
- `exomind_unbind_task_timeblock` - 解绑任务与时间块

**典型场景：**
- Agent 自动分析任务依赖关系
- 支持复杂任务规划

### Phase 3 - 高级查询 + 统计分析

**Tools 列表：**
- `exomind_query_tasks` - 多维度查询任务
- `exomind_get_task_stats` - 获取任务统计
- `exomind_analyze_task_patterns` - 分析任务模式

**典型场景：**
- Growth Coach 根据任务完成情况给出建议
- Agent 识别任务模式和瓶颈

## 设计决策

### 1. Tool 命名和粒度
- ✅ 采用细粒度命名（每个操作一个 tool）
- ✅ 遵循现有命名风格：`exomind_<verb>_<noun>`

### 2. 状态变更 API
- ✅ 独立状态变更 tools（start/complete/cancel）
- 原因：保留 `transitionTask` 的依赖检查逻辑

### 3. 查询和过滤
- MVP: 简单的 `listTasks(includeAbandoned)`
- 后续: 扩展多维度过滤能力

### 4. 返回值格式
```typescript
// 成功
{ success: true, task: TaskNode }

// 失败
{ success: false, error: string }
```

### 5. 错误处理
- MVP: 简单字符串错误信息
- 后续: 结构化错误码和详细信息

### 6. 数据同步
- MCP 操作后触发 EventBus 事件
- 前端通过 reactive store 自动更新

### 7. 权限和安全
- MVP: 无权限控制（信任所有客户端）
- 后续: 考虑分级权限和审计日志

## 技术实现

### 文件结构
```typescript
// packages/mcp/src/tools/tools-task.ts
export function createTaskTools(
  taskService: TaskService
): Array<{ tool: Tool; handler: ToolHandler }> {
  // 实现各个 tool
}

// packages/mcp/src/tools/tool-registry.ts
import { createTaskTools } from './tools-task';
// 注册 task tools

// packages/mcp/src/utils/mcp-dependencies.ts
export interface McpToolDependencies {
  taskService: TaskService; // 新增
}
```

### 参考实现
- `tools-event.ts` - 事件日志 MCP tools
- `tools-timeblock.ts` - 时间块 MCP tools

## 验收标准

### Phase 1
- [ ] 创建 `tools-task.ts` 并实现 7 个基础 tools
- [ ] 在 `tool-registry.ts` 中注册
- [ ] 在 `mcp-dependencies.ts` 中注入 TaskService
- [ ] 编写单元测试
- [ ] 在 Claude Code 中测试创建任务场景
- [ ] 验证前端实时更新

### Phase 2
- [ ] 实现依赖管理 tools
- [ ] 实现时间块关联 tools
- [ ] 测试复杂依赖场景
- [ ] 验证循环依赖检测

### Phase 3
- [ ] 实现高级查询 tools
- [ ] 实现统计分析 tools
- [ ] 测试 Growth Coach 场景

## 相关文档
- [MCP 认证设计](docs/plans/2026-02-21-mcp-auth-design.md)
- [MCP 认证实现计划](docs/plans/2026-02-21-mcp-auth-impl-plan.md)
- [TaskService 接口](src/lib/services/task.service.ts)

## 不包含的范围
- ❌ 任务导入导出（通过 Settings 页面处理）
- ❌ 任务模板功能
- ❌ 任务批量操作（后续考虑）
