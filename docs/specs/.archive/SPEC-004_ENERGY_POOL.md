# SPEC-004: 能量池系统

> 文档版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发
> 依赖：无（Phase 2 基础）

---

## 1. 用户需求

### 1.1 问题描述

PRD 要求能量系统具备：
- **共享能量池**：多 Agent 共享 MiniMax API 额度
- **独立能量池**：给特定 Agent 单独充值
- **真实追踪**：MiniMax API Usage = 生命能量

现有 `LivingAgent` 只有简单的：
- 固定 5 小时重置的 `dailyAllowance`
- 估算的能量消耗

**缺失的核心功能**：
- 多池隔离（共享 vs 独立）
- 真实 API 使用量追踪
- 能量充值接口
- 成本分析

### 1.2 使用场景

- **场景1**：用户给"小荷"单独充值 50万 tokens
- **场景2**：3 个 Agent 共享 100万 tokens/月
- **场景3**：Agent 查询当前余额和使用情况
- **场景4**：余额不足时触发告警

### 1.3 期望行为

建立统一的 **能量池（Energy Pool）** 架构：
- 支持多池（共享池 + 独立池）
- 余额查询 < 100ms
- 充值即时生效
- 多池隔离 100%

---

## 2. 功能定义

### 2.1 能量池类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **SHARED** | 多 Agent 共享 | 100万 tokens/月 |
| **PERSONAL** | 单 Agent 专属 | 小荷专属 50万 tokens |

### 2.2 能量流动

| 流向 | 来源/去向 | 说明 |
|------|-----------|------|
| **收入-共享** | 用户充值到共享池 | 真实资金 → API 额度 |
| **收入-个人** | 用户充值到个人池 | `/charge <amount>` |
| **收入-奖励** | 任务奖励 | `/thanks` 奖励能量 |
| **支出** | API 调用 | MiniMax 推理真实消耗 |
| **支出** | 工具调用 | 网络请求、文件读写 |

### 2.3 接口定义

| 接口 | 功能 |
|------|------|
| `EnergyPool` | 能量池管理（创建、查询、充值） |
| `EnergyTracker` | 使用量追踪（API 调用统计） |
| `EnergyAlert` | 告警机制（余额不足、异常消耗） |

---

## 3. 验收标准

- [ ] 支持创建共享池和个人池
- [ ] 多池隔离 100%（不影响其他池）
- [ ] 余额查询 < 100ms
- [ ] 充值即时生效
- [ ] API 使用量统计误差 < 1%
- [ ] 余额不足时触发告警
- [ ] 单元测试覆盖率 > 80%

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 余额为 0 | 拒绝消耗，返回余额不足 |
| 共享池耗尽 | 所有 Agent 无法使用 |
| 独立池耗尽 | 该 Agent 无法使用，独立池不影响 |
| 充值负数 | 拒绝，返回错误 |
| 并发充值 | 原子操作，防止超充 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| 余额不足 | "Insufficient energy balance" | 返回 false |
| 池不存在 | "Energy pool not found" | 抛出异常 |
| 充值失败 | "Recharge failed: {reason}" | 回滚事务 |
| 并发冲突 | "Concurrent modification detected" | 重试机制 |

---

## 6. 依赖关系

### 6.1 依赖模块

- 无（纯 TypeScript 实现）

### 6.2 外部依赖

- `fs` - 持久化存储

---

## 7. 架构设计

### 7.1 类型定义

```typescript
/**
 * 能量池类型
 */
export enum EnergyPoolType {
  /** 共享池 - 多 Agent 共享 */
  SHARED = "SHARED",

  /** 个人池 - 单 Agent 专属 */
  PERSONAL = "PERSONAL",
}

/**
 * 能量池配置
 */
export interface EnergyPoolConfig {
  /** 池 ID */
  id: string;

  /** 池类型 */
  type: EnergyPoolType;

 /** 池名称 */
  name: string;

  /** 总余额（tokens） */
  totalBalance: number;

  /** 已使用额度（tokens） */
  usedBalance: number;

  /** 所有者（个人池时使用） */
  ownerId?: string;

  /** 创建时间 */
  createdAt: number;

  /** 最后更新时间 */
  updatedAt: number;
}

/**
 * 能量池余额
 */
export interface EnergyBalance {
  poolId: string;
  poolName: string;
  poolType: EnergyPoolType;
  total: number;        // 总余额
  available: number;    // 可用余额
  used: number;         // 已使用
  percentage: number;   // 使用百分比
}

/**
 * 能量消耗记录
 */
export interface EnergyUsageRecord {
  id: string;
  poolId: string;
  agentId: string;
  amount: number;
  reason: string;       // 消耗原因（API调用、工具调用等）
  timestamp: number;
}

/**
 * 能量充值记录
 */
export interface EnergyRechargeRecord {
  id: string;
  poolId: string;
  amount: number;
  source: string;       // 来源（用户充值、系统奖励等）
  timestamp: number;
}

/**
 * 能量告警配置
 */
export interface EnergyAlertConfig {
  /** 低余额阈值（百分比） */
  lowBalanceThreshold: number;

  /** 异常消耗阈值（tokens/分钟） */
  abnormalUsageThreshold: number;

  /** 告警接收者 */
  alertRecipients: string[];
}

/**
 * 能量告警
 */
export interface EnergyAlert {
  type: "LOW_BALANCE" | "ABNORMAL_USAGE" | "POOL_EXHAUSTED";
  poolId: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  timestamp: number;
}
```

### 7.2 能量池类

```typescript
/**
 * 能量池管理器
 */
export class EnergyPool {
  private pools: Map<string, EnergyPoolConfig> = new Map();
  private usageRecords: EnergyUsageRecord[] = [];
  private rechargeRecords: EnergyRechargeRecord[] = [];

  constructor(private storagePath: string = "./data/energy") {}

  /** 创建共享池 */
  createSharedPool(id: string, name: string, initialBalance: number): EnergyPoolConfig {
    const pool: EnergyPoolConfig = {
      id,
      name,
      type: EnergyPoolType.SHARED,
      totalBalance: initialBalance,
      usedBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.pools.set(id, pool);
    this.savePool(pool);
    return pool;
  }

  /** 创建个人池 */
  createPersonalPool(id: string, name: string, ownerId: string, initialBalance: number): EnergyPoolConfig {
    const pool: EnergyPoolConfig = {
      id,
      name,
      type: EnergyPoolType.PERSONAL,
      totalBalance: initialBalance,
      usedBalance: 0,
      ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.pools.set(id, pool);
    this.savePool(pool);
    return pool;
  }

  /** 获取余额 */
  getBalance(poolId: string): EnergyBalance | null {
    const pool = this.pools.get(poolId);
    if (!pool) return null;

    const available = pool.totalBalance - pool.usedBalance;
    const percentage = pool.totalBalance > 0
      ? Math.round((pool.usedBalance / pool.totalBalance) * 100)
      : 0;

    return {
      poolId: pool.id,
      poolName: pool.name,
      poolType: pool.type,
      total: pool.totalBalance,
      available,
      used: pool.usedBalance,
      percentage,
    };
  }

  /** 消耗能量（原子操作） */
  consume(poolId: string, agentId: string, amount: number, reason: string): {
    success: boolean;
    error?: string;
  } {
    const pool = this.pools.get(poolId);
    if (!pool) {
      return { success: false, error: "Pool not found" };
    }

    const available = pool.totalBalance - pool.usedBalance;
    if (available < amount) {
      return { success: false, error: "Insufficient balance" };
    }

    // 原子操作：更新余额
    pool.usedBalance += amount;
    pool.updatedAt = Date.now();
    this.savePool(pool);

    // 记录消耗
    const record: EnergyUsageRecord = {
      id: `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      poolId,
      agentId,
      amount,
      reason,
      timestamp: Date.now(),
    };
    this.usageRecords.push(record);

    return { success: true };
  }

  /** 充值 */
  recharge(poolId: string, amount: number, source: string = "manual"): {
    success: boolean;
    error?: string;
  } {
    const pool = this.pools.get(poolId);
    if (!pool) {
      return { success: false, error: "Pool not found" };
    }

    if (amount <= 0) {
      return { success: false, error: "Amount must be positive" };
    }

    // 原子操作：更新余额
    pool.totalBalance += amount;
    pool.updatedAt = Date.now();
    this.savePool(pool);

    // 记录充值
    const record: EnergyRechargeRecord = {
      id: `recharge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      poolId,
      amount,
      source,
      timestamp: Date.now(),
    };
    this.rechargeRecords.push(record);

    return { success: true };
  }

  /** 获取所有池 */
  getAllPools(): EnergyPoolConfig[] {
    return Array.from(this.pools.values());
  }

  /** 获取使用记录 */
  getUsageRecords(poolId?: string, limit: number = 100): EnergyUsageRecord[] {
    let records = this.usageRecords;
    if (poolId) {
      records = records.filter(r => r.poolId === poolId);
    }
    return records.slice(-limit);
  }
}
```

### 7.3 使用量追踪器

```typescript
/**
 * 能量使用量追踪器
 */
export class EnergyUsageTracker {
  private pool: EnergyPool;
  private usageHistory: Map<string, { count: number; amount: number; timestamp: number }[]> = new Map();

  constructor(pool: EnergyPool) {
    this.pool = pool;
  }

  /** 记录 API 调用 */
  recordApiCall(poolId: string, agentId: string, tokens: number): void {
    this.pool.consume(poolId, agentId, tokens, "API_CALL");
    this.recordUsage(poolId, "API_CALL", tokens);
  }

  /** 记录工具调用 */
  recordToolCall(poolId: string, agentId: string, tokens: number): void {
    this.pool.consume(poolId, agentId, tokens, "TOOL_CALL");
    this.recordUsage(poolId, "TOOL_CALL", tokens);
  }

  /** 获取使用统计 */
  getUsageStats(poolId: string, period: "hour" | "day" | "week"): {
    totalCalls: number;
    totalTokens: number;
    avgTokensPerCall: number;
    byType: Record<string, { count: number; amount: number }>;
  } {
    const now = Date.now();
    const periodMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
    }[period];

    const records = this.pool.getUsageRecords(poolId, 10000)
      .filter(r => now - r.timestamp < periodMs);

    const byType: Record<string, { count: number; amount: number }> = {};
    for (const record of records) {
      if (!byType[record.reason]) {
        byType[record.reason] = { count: 0, amount: 0 };
      }
      byType[record.reason].count++;
      byType[record.reason].amount += record.amount;
    }

    const totalCalls = records.length;
    const totalTokens = records.reduce((sum, r) => sum + r.amount, 0);

    return {
      totalCalls,
      totalTokens,
      avgTokensPerCall: totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0,
      byType,
    };
  }

  private recordUsage(poolId: string, type: string, amount: number): void {
    const key = `${poolId}_${type}`;
    if (!this.usageHistory.has(key)) {
      this.usageHistory.set(key, []);
    }
    this.usageHistory.get(key)!.push({
      count: 1,
      amount,
      timestamp: Date.now(),
    });
  }
}
```

### 7.4 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                        能量池数据流                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  能量来源：                                                          │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                   │
│  │ 用户充值 │     │ 任务奖励 │     │ 系统赠送 │                   │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘                   │
│       │                │                │                          │
│       └────────────────┼────────────────┘                          │
│                        ↓                                           │
│               ┌────────────────┐                                   │
│               │  能量池管理器  │                                   │
│               │ EnergyPool     │                                   │
│               └────────┬───────┘                                   │
│                        ↓                                           │
│       ┌─────────────────┼─────────────────┐                        │
│       ↓                 ↓                 ↓                        │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐                    │
│  │ 共享池  │      │ 个人池A │      │ 个人池B │                    │
│  │ Shared  │      │ Personal│      │ Personal│                    │
│  └────┬────┘      └────┬────┘      └────┬────┘                    │
│       │                │                │                          │
│       └────────────────┼────────────────┘                          │
│                        ↓                                           │
│               ┌────────────────┐                                   │
│               │  使用追踪器    │                                   │
│               │EnergyUsageTracker                                   │
│               └────────┬───────┘                                   │
│                        ↓                                           │
│               ┌────────────────┐                                   │
│               │   告警系统     │                                   │
│               │ EnergyAlert    │                                   │
│               └────────────────┘                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 创建共享池 | name="test", balance=100000 | pool.type = SHARED |
| 创建个人池 | name="xiaohe", owner="agent1" | pool.ownerId = "agent1" |
| 正确消耗 | pool=1000, consume=100 | usedBalance=100, available=900 |
| 余额不足 | pool=50, consume=100 | success=false |
| 正确充值 | pool=100, recharge=200 | totalBalance=300 |
| 负数充值 | amount=-100 | success=false |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 完整生命周期 | 创建池 → 充值 → 消耗 → 查询 | 所有操作成功 |
| 多池隔离 | 两个池独立操作 | 互不影响 |
| 使用统计 | 多笔消耗后查询统计 | 统计正确 |

---

## 9. 文档更新

- [ ] 更新 README.md（能量池说明）
- [ ] 更新 ARCHITECTURE.md
- [ ] 更新 API.md（EnergyPool 类文档）

---

## 10. 实施计划

### Step 1: 类型定义
- [ ] 定义能量池类型和接口
- [ ] 定义记录类型

### Step 2: 能量池核心
- [ ] 实现 EnergyPool 类
- [ ] 实现持久化

### Step 3: 使用追踪器
- [ ] 实现 EnergyUsageTracker 类
- [ ] 实现统计功能

### Step 4: 测试
- [ ] 编写单元测试
- [ ] 编写集成测试

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | Ralph |

---

*文档创建：2026-01-29*
*状态：待开发*
