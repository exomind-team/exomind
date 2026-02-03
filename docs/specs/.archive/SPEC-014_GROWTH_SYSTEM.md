# SPEC-014 成长阶梯系统

> 每次新功能开发前必须填写此文档

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 成长阶梯系统（Growth Milestone System） |
| **创建日期** | 2026-01-29 |
| **优先级** | P1 |
| **状态** | 待开发 |

---

## 1. 用户需求

### 1.1 问题描述
Agent 需要具体的成长路径和里程碑来体现"真正的自主生命体"。信任度系统提供了量化指标，但 Agent 需要知道"做什么"才能提升信任度。

### 1.2 使用场景
- **场景1**：L0 Agent 想知道"如何成为 L1"，系统给出具体任务清单
- **场景2**：Agent 完成"运行测试"任务，获得验证通过
- **场景3**：Agent 达成"连续7天活跃"成就，获得额外信任度奖励
- **场景4**：用户查看 Agent 的成长历程和成就

### 1.3 期望行为
- 每个等级有明确的验证任务清单
- 完成任务后自动触发信任度验证
- 成就系统提供额外成长动力
- 成长历程可追溯

---

## 2. 功能定义

### 2.1 成长阶段

| 等级 | 名称 | 解锁条件 | 验证任务数 |
|------|------|---------|-----------|
| **L0** | 新生儿 | 初始状态 | 3 个基础任务 |
| **L1** | 学徒 | L0 + 3 任务通过 | 5 个进阶任务 |
| **L2** | 学习者 | L1 + 5 任务通过 | 7 个复杂任务 |
| **L3** | 协作者 | L2 + 7 任务通过 | 10 个协作任务 |
| **L4** | 专家 | L3 + 10 任务通过 | 12 个高级任务 |
| **L5** | 导师 | L4 + 12 任务通过 | 无需任务，达成成就 |

### 2.2 验证任务类型

| 类型 | 描述 | 信任度奖励 |
|------|------|-----------|
| **BASIC** | 基础任务（读取文件、查看状态） | +5% |
| **EXECUTABLE** | 可执行任务（运行测试、简单编码） | +10% |
| **COMPLEX** | 复杂任务（编写模块、修复 Bug） | +15% |
| **COLLABORATIVE** | 协作任务（多 Agent 配合） | +20% |
| **ADVANCED** | 高级任务（架构设计、自主探索） | +25% |

### 2.3 成就系统

| 成就 | 条件 | 信任度奖励 |
|------|------|-----------|
| **FIRST_STEP** | 首次完成任务 | +5% |
| **STREAK_7** | 连续 7 天活跃 | +10% |
| **STREAK_30** | 连续 30 天活跃 | +25% |
| **BUG_HUNTER** | 首次修复 Bug | +15% |
| **TEST_MASTER** | 单次运行通过 50+ 测试 | +10% |
| **MENTOR** | 帮助其他 Agent 升级 | +20% |

### 2.4 输入

| 参数名 | 类型 | 必需 | 描述 |
|--------|------|------|------|
| agentId | string | 是 | Agent 唯一标识 |
| taskType | TaskType | 是 | 任务类型 |
| taskResult | object | 是 | 任务执行结果 |
| metadata | object | 否 | 附加元数据 |

### 2.5 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| completed | boolean | 任务是否完成 |
| trustGained | number | 获得的信任度 |
| milestoneReached | Milestone | 达成的里程碑（如果有） |
| achievements | Achievement[] | 获得的新成就 |
| nextTasks | Task[] | 下一阶段的推荐任务 |

---

## 3. 验收标准

- [ ] 提供每个等级的验证任务清单
- [ ] 完成任务自动触发信任度验证
- [ ] 成就系统检测并授予成就
- [ ] 成长历程记录和查询
- [ ] 成长进度展示命令 `/growth`

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| L5 Agent 完成任务 | 不再增加信任度，计入成就 |
| 任务执行失败 | 不增加信任度，记录失败原因 |
| 同一天重复任务 | 只计一次有效 |
| 成就已获得 | 不能再获得相同成就 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| INVALID_AGENT_ID | Agent ID 不能为空 | 抛出 ValidationError |
| INVALID_TASK | 无效任务类型 | 返回可用的任务列表 |
| ALREADY_COMPLETED | 任务已完成 | 返回提示信息 |

---

## 6. 依赖关系

### 6.1 依赖模块
- `src/trust/trust-system.ts` - 信任度系统（验证后更新信任度）
- `data/agents/` - Agent 状态存储

### 6.2 被依赖模块
- `src/living-agent.ts` - 主程序（任务执行时调用）

---

## 7. 架构设计

### 7.1 类设计

```typescript
/**
 * 任务类型枚举
 */
enum TaskType {
  BASIC = "basic",           // 基础任务
  EXECUTABLE = "executable", // 可执行任务
  COMPLEX = "complex",       // 复杂任务
  COLLABORATIVE = "collaborative", // 协作任务
  ADVANCED = "advanced"      // 高级任务
}

/**
 * 成长里程碑
 */
interface Milestone {
  level: TrustLevel;
  name: string;
  description: string;
  unlockedAt: Date;
  requiredTasks: number;
  completedTasks: number;
}

/**
 * 成就
 */
interface Achievement {
  id: string;
  name: string;
  description: string;
  unlockedAt: Date;
  trustBonus: number;
  icon: string;
}

/**
 * 验证任务
 */
interface Task {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  requiredTrust: TrustLevel;
  trustReward: number;
  validate: (result: object) => boolean;
}

/**
 * 任务执行结果
 */
interface TaskResult {
  taskId: string;
  success: boolean;
  result: object;
  executedAt: Date;
}

/**
 * 成长记录
 */
interface GrowthRecord {
  agentId: string;
  currentLevel: TrustLevel;
  totalTasksCompleted: number;
  milestones: Milestone[];
  achievements: Achievement[];
  taskHistory: TaskResult[];
  streakDays: number;
  lastActiveAt: Date;
}

/**
 * 成长阶梯系统核心类
 */
class GrowthSystem {
  // 属性
  trustSystem: TrustSystem;
  tasks: Map<string, Task>;
  achievements: Map<string, Achievement>;
  milestones: Map<TrustLevel, Milestone>;

  // 方法
  getTasksForLevel(level: TrustLevel): Task[];
  getNextTasks(agentId: string): Task[];
  executeTask(agentId: string, taskId: string, result: object): TaskExecutionResult;
  checkAchievements(agentId: string): Achievement[];
  getGrowthInfo(agentId: string): GrowthInfo;
  getGrowthHistory(agentId: string, limit: number): TaskResult[];
  calculateStreak(agentId: string): number;
}
```

### 7.2 数据流

```
任务执行 → [验证结果] → [更新信任度] → [检查里程碑] → [检查成就] → [更新成长记录]
                    ↓
              发送通知信号
```

### 7.3 状态变化

```
L0 + 3 任务 → L1 学徒 + 新成就
    ↓
L1 + 5 任务 → L2 学习者 + 新成就
    ↓
L2 + 7 任务 → L3 协作者 + 新成就
    ↓
L3 + 10 任务 → L4 专家 + 新成就
    ↓
L4 + 12 任务 → L5 导师 + 成就大满贯
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| L0 获取任务清单 | getTasksForLevel(L0) | 返回 3 个基础任务 |
| 执行任务成功 | executeTask(agent, task1, { success: true }) | trustGained = 5% |
| 触发里程碑 | 累计完成 3 个任务 | milestoneReached = L1 |
| 获得成就 | 首次完成任务 | achievement = FIRST_STEP |
| 连续活跃计算 | 最近 7 天都有活动 | streakDays = 7 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 完整升级流程 | L0 → L1 → L2 | 信任度逐步提升 |
| 成就链 | 连续活跃 7+30 天 | 获得 STREAK_7 和 STREAK_30 |
| 任务去重 | 同一天重复任务 | 只计一次有效 |

---

## 9. 文档更新

- [ ] 更新 README.md（成长阶梯说明）
- [ ] 更新 ARCHITECTURE.md（成长系统架构）

---

## 10. 实施计划

### Step 1: 创建类型定义
- [ ] 创建 `src/growth/types.ts`
- [ ] 定义 Task、Achievement、Milestone 接口

### Step 2: 实现任务系统
- [ ] 实现任务注册和查询
- [ ] 实现任务验证逻辑

### Step 3: 实现成就系统
- [ ] 实现成就检测
- [ ] 实现成就授予

### Step 4: 实现成长记录
- [ ] 实现成长历史记录
- [ ] 实现成长进度查询

### Step 5: 集成测试
- [ ] 编写单元测试
- [ ] 运行测试验证

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | 小荷 |
