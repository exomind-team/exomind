# SPEC-202: L6-Agent 业务逻辑层

> **功能名称**: L6-Agent 业务逻辑层
> **创建日期**: 2026-01-30
> **优先级**: P0
> **状态**: ✅ 已完成（83 tests pass）

---

## 1. 用户需求

### 1.1 问题描述

L6-Agent 层是 7 层架构的业务逻辑核心，负责协调 L5-Signals 的信号处理、L4-Actor 的消息传递，以及调用外部 Agent 服务（Claude Code、MiniMax）。

### 1.2 使用场景

- 用户消息 → SignalPool → AgentCoordinator → Claude Code → 回复
- 资源查询 → AgentCoordinator → MiniMax API → 结果展示
- 任务调度 → AgentCoordinator → Claude Code CLI → 异步执行

---

## 2. 功能定义

### 2.1 核心组件

| 组件 | 描述 | 职责 |
|------|------|------|
| AgentCoordinator | 协调器 | 信号路由、Agent 选择、结果处理 |
| ClaudeCodeAdapter | Claude Code 适配器 | CLI 调用、结果解析 |
| MiniMaxAdapter | MiniMax 适配器 | API 调用、响应处理 |
| TaskScheduler | 任务调度器 | 异步任务管理、优先级队列 |

### 2.2 接口设计

```typescript
interface AgentCoordinator {
  // 处理用户消息
  handleMessage(signal: UserSignal): Promise<ResponseSignal>;
  
  // 调度任务
  scheduleTask(task: Task): Promise<TaskId>;
  
  // 执行查询
  executeQuery(query: string): Promise<QueryResult>;
}
```

---

## 3. 验收标准

- [x] AgentCoordinator 核心类实现
- [x] ClaudeCodeAdapter 集成（进程调用）
- [x] MiniMaxAdapter 集成（API 调用）
- [x] TaskScheduler 实现
- [x] 与 SignalPool 集成
- [x] 单元测试覆盖 >80% (83 tests pass)
- [x] 集成测试通过

---

## 4. 架构设计

### 4.1 文件结构

```
src/agent/
├── index.ts           # 模块导出
├── coordinator.ts     # AgentCoordinator 实现
├── claude-code.ts     # ClaudeCodeAdapter
├── minimax.ts         # MiniMaxAdapter
├── scheduler.ts       # TaskScheduler
└── __tests__/
    └── agent.test.ts
```

### 4.2 数据流

```
UserSignal → SignalPool.publish()
            ↓
     AgentCoordinator.subscribe()
            ↓
    Agent 选择 (Claude/MiniMax)
            ↓
    执行调用
            ↓
    ResponseSignal → SignalPool.publish()
```

---

## 5. 实施计划

### Step 1: AgentCoordinator 核心
- [x] 创建 src/agent/coordinator.ts
- [x] 实现信号路由逻辑
- [x] 实现 Agent 选择策略

### Step 2: ClaudeCodeAdapter
- [x] 创建 src/agent/claude-code.ts
- [x] 实现 CLI 调用封装
- [x] 实现结果解析

### Step 3: MiniMaxAdapter
- [x] 创建 src/agent/minimax.ts
- [x] 实现 API 调用封装
- [x] 实现错误处理

### Step 4: TaskScheduler
- [x] 创建 src/agent/scheduler.ts
- [x] 实现优先级队列
- [x] 实现异步任务管理

### Step 5: 集成测试
- [x] 与 SignalPool 集成测试 (11 tests pass)
- [x] 端到端测试 (SignalPool + AgentCoordinator)

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-30 | 1.0 | 初始版本 | ExoMind Agent |
| 2026-01-30 | 1.1 | Step 1 完成：AgentCoordinator 核心实现 | ExoMind Agent |
| 2026-01-30 | 1.2 | **全部完成**<br>- Step 2: ClaudeCodeAdapter 集成<br>- Step 3: MiniMaxAdapter 集成<br>- Step 4: TaskScheduler 实现<br>- 83 tests pass<br>- 集成测试通过 | ExoMind Agent |
