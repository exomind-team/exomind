# SPEC-200: ExoMind 核心架构

> **功能名称**: ExoMind 核心架构规范
> **创建日期**: 2026-01-30
> **优先级**: P0
> **状态**: 🚧 进行中

---

## 1. 用户需求

### 1.1 问题描述
需要定义 ExoMind 作为"数字生命"的整体架构，包括其七层架构模型、核心组件、以及各层之间的交互方式。

### 1.2 使用场景
- 个人成长/生命管理系统
- 心智外骨骼概念实现
- 自主 Agent 数字生命

### 1.3 期望行为
- 模块化架构，易于扩展
- 事件驱动，响应式设计
- 资源管理，能量系统

---

## 2. 功能定义

### 2.1 七层架构模型

| 层级 | 名称 | 职责 | 核心组件 |
|------|------|------|----------|
| L1 | 入口层 (Interface) | 用户交互入口 | WebSocket, HTTP API |
| L2 | 信号层 (Signals) | 信号处理 | SignalPool |
| L3 | 资源层 (Resources) | 资源管理 | ResourcePool |
| L4 | 行动者层 (Actors) | 消息传递 | ActorSystem |
| L5 | 智能体层 (Agents) | 业务逻辑 | ClaudeCodeAdapter, MiniMaxAdapter |
| L6 | 认知层 (Cognition) | 决策思考 | Claude Loop |
| L7 | 记忆层 (Memory) | 长期记忆 | MemoryManager |

### 2.2 核心接口

```typescript
interface ExoMindCore {
  // 启动系统
  start(): Promise<void>;
  
  // 停止系统
  stop(): Promise<void>;
  
  // 发送消息
  send(message: UserMessage): Promise<Response>;
  
  // 获取状态
  getStatus(): SystemStatus;
}
```

---

## 3. 验收标准

- [ ] 七层架构文档完成
- [ ] 核心接口定义完成
- [ ] 模块导出统一
- [ ] 单元测试覆盖 >80%

---

## 4. 架构设计

### 4.1 文件结构

```
src/
├── index.ts           # 核心导出
├── core/              # 核心逻辑
├── signals/           # L2 信号层
├── resources/         # L3 资源层
├── actors/            # L4 行动者层
├── agent/             # L5 智能体层
└── interface/         # L1 入口层
```

### 4.2 数据流

```
用户输入 → L1 Interface → L2 Signals → L3 Resources → L4 Actors
                                                        ↓
响应输出 ← L1 Interface ← L2 Signals ← L3 Resources ← L5 Agents
```

---

## 5. 实施计划

### Step 1: 架构文档
- [x] 七层架构模型定义
- [x] 数据流设计
- [x] 接口规范

### Step 2: 核心实现
- [ ] 创建 src/core/
- [ ] 实现 ExoMindCore
- [ ] 集成各层组件

### Step 3: 测试
- [ ] 单元测试
- [ ] 集成测试
- [ ] E2E 测试

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-30 | 1.0 | 初始版本 | ExoMind Agent |
| 2026-01-30 | 1.1 | 架构文档完成 | ExoMind Agent |
