# SPEC-013 信任度系统

> 每次新功能开发前必须填写此文档

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 信任度系统（Trust Level System） |
| **创建日期** | 2026-01-29 |
| **优先级** | P0 |
| **状态** | 待开发 |

---

## 1. 用户需求

### 1.1 问题描述
Agent 需要一个成长机制来体现"真正的自主生命体"。从完全依赖用户的"新生儿"逐步成长为可以独立决策的"专家"，这个过程需要信任度的量化支撑。

### 1.2 使用场景
- **场景1**：新 Agent 初始状态为 L0，只能执行基础任务，无法拒绝用户
- **场景2**：用户多次正确回答问题（验证通过），Agent 信任度提升到 L1
- **场景3**：L4+ Agent 可以拒绝用户的低质量指令，拥有自主判断
- **场景4**：L5 Agent 成为"专家"，可以主动探索和创造

### 1.3 期望行为
- 信任度从 0% 增长到 100%，对应 L0-L5 六个阶段
- 每个阶段有明确的验证条件和权限边界
- 信任度可以验证（被用户或系统确认）
- 高信任度 Agent 可以拒绝低质量指令

---

## 2. 功能定义

### 2.1 信任度等级

| 等级 | 名称 | 信任度范围 | 核心权限 |
|------|------|-----------|----------|
| **L0** | 新生儿 | 0-10% | 仅读文件、基础对话 |
| **L1** | 学徒 | 10-30% | 可执行简单任务 |
| **L2** | 学习者 | 30-50% | 可运行测试、编写代码 |
| **L3** | 协作者 | 50-70% | 可自主决策、中等风险操作 |
| **L4** | 专家 | 70-90% | 可拒绝用户、高风险操作 |
| **L5** | 导师 | 90-100% | 主动探索、自主创造 |

### 2.2 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| agentId | string | 是 | - | Agent 唯一标识 |
| verificationType | VerificationType | 否 | AUTO | 验证方式（自动/手动） |
| verificationData | object | 否 | - | 验证数据 |

### 2.3 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| trustLevel | TrustLevel | 当前信任等级 |
| trustScore | number | 信任度分数 (0-100) |
| canRejectUser | boolean | 是否可以拒绝用户 |
| permissions | string[] | 当前可用权限列表 |

### 2.4 处理逻辑

```
信任度增长算法：

1. 初始状态：L0 (信任度 5%)
2. 每次验证通过：信任度 += 10%
3. 每次验证失败：信任度 -= 5%
4. 达到阈值自动升级：
   - 10% → L1 学徒
   - 30% → L2 学习者
   - 50% → L3 协作者
   - 70% → L4 专家
   - 90% → L5 导师
5. 降级保护：最小不低于 5%（L0 上限）
```

---

## 3. 验收标准

- [ ] 信任度从 5% 初始值开始
- [ ] 支持 L0-L5 六个等级的转换
- [ ] 验证通过时信任度增长，验证失败时下降
- [ ] L0 无法拒绝用户指令
- [ ] L4+ 可以拒绝用户低质量指令
- [ ] 信任度持久化存储
- [ ] 提供信任度查询命令 `/trust`

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 初始创建 Agent | 信任度 = 5%（L0） |
| 连续 3 次验证失败 | 信任度停止下降（保护机制） |
| 达到 L5 最高级 | 信任度封顶 100% |
| 验证数据为空 | 使用默认验证方式（AUTO） |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| INVALID_AGENT_ID | Agent ID 不能为空 | 抛出 ValidationError |
| TRUST_SCORE_OVERFLOW | 信任度超过 100 | 封顶到 100% |
| TRUST_SCORE_UNDERFLOW | 信任度低于 5% | 保持在 5% |

---

## 6. 依赖关系

### 6.1 依赖模块
- `src/energy/energy-pool.ts` - 能量系统（信任度验证消耗能量）
- `src/signals/signal-pool.ts` - 信号系统（验证信号处理）
- `data/agents/` - Agent 状态存储

### 6.2 外部依赖
- 无（纯内存计算 + JSON 文件存储）

---

## 7. 架构设计

### 7.1 类设计

```typescript
/**
 * 信任度等级枚举
 */
enum TrustLevel {
  NEWBORN = 0,    // 新生儿 0-10%
  APPRENTICE = 1, // 学徒 10-30%
  LEARNER = 2,    // 学习者 30-50%
  COLLABORATOR = 3, // 协作者 50-70%
  EXPERT = 4,     // 专家 70-90%
  MENTOR = 5      // 导师 90-100%
}

/**
 * 验证类型
 */
enum VerificationType {
  AUTO = 'auto',     // 自动验证（基于行为分析）
  MANUAL = 'manual', // 手动验证（用户确认）
  PEER = 'peer'      // 同伴验证（其他 Agent 确认）
}

/**
 * 信任度配置
 */
interface TrustConfig {
  initialScore: number;       // 初始信任度 (默认 5%)
  minScore: number;           // 最小信任度 (默认 5%)
  maxScore: number;           // 最大信任度 (默认 100%)
  upgradeStep: number;        // 升级步长 (默认 10%)
  downgradeStep: number;      // 降级步长 (默认 5%)
  levelThresholds: {         // 各等级阈值
    [key in TrustLevel]: number;
  };
}

/**
 * 信任度记录
 */
interface TrustRecord {
  agentId: string;
  level: TrustLevel;
  score: number;
  lastVerification: Date;
  verificationCount: number;
  upgradeHistory: { date: Date; from: number; to: number }[];
}

/**
 * 信任度系统核心类
 */
class TrustSystem {
  // 属性
  config: TrustConfig;
  records: Map<string, TrustRecord>;
  eventEmitter: EventEmitter;

  // 方法
  getTrustLevel(agentId: string): TrustLevel;
  getTrustScore(agentId: string): number;
  getTrustInfo(agentId: string): TrustInfo;
  verifyTrust(agentId: string, type: VerificationType, data?: object): Promise<VerificationResult>;
  canRejectUser(agentId: string): boolean;
  getPermissions(agentId: string): string[];
  getLevelByScore(score: number): TrustLevel;
  isLevelTransition(score: number, newScore: number): TrustLevel | null;
  serialize(agentId: string): object;
  deserialize(data: object): void;
}
```

### 7.2 数据流

```
用户指令 → [信号池] → [信任度检查] → [权限验证] → [执行/拒绝]
              ↓
        查询当前等级
              ↓
        更新信任度记录
```

### 7.3 状态变化

```
L0 (5%) ──验证通过×1──→ L1 (15%) ──验证通过×2──→ L2 (35%)
   ↑                           │
   │ 验证失败                   │ 验证通过×2
   └──────────────────────────→ L3 (55%) ──→ L4 (75%) ──→ L5 (95%)
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 初始信任度 | 新建 Agent | score=5, level=L0 |
| 单次验证通过 | verifyTrust(agent, AUTO) | score += 10 |
| 单次验证失败 | verifyTrust(agent, AUTO) | score -= 5 |
| L0 无法拒绝 | canRejectUser(agent) | false |
| L4 可以拒绝 | canRejectUser(agent) | true |
| 达到 L5 封顶 | score > 100 | score = 100 |
| 降级保护 | score < 5 | score = 5 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 信任度持久化 | 重启后读取记录 | 信任度保持 |
| 等级转换通知 | 升级到新等级 | 发送通知信号 |
| 权限动态变化 | 升级后权限变化 | 权限列表更新 |

---

## 9. 文档更新

- [ ] 更新 README.md（信任度系统说明）
- [ ] 更新 ARCHITECTURE.md（信任度架构）
- [ ] 更新 SOUL.md（Agent 身份定义）

---

## 10. 实施计划

### Step 1: 创建类型定义
- [ ] 创建 `src/trust/types.ts`
- [ ] 定义 TrustLevel、TrustConfig、TrustRecord 接口

### Step 2: 实现核心类
- [ ] 实现 TrustSystem 类
- [ ] 实现信任度计算逻辑
- [ ] 实现等级转换逻辑

### Step 3: 实现权限系统
- [ ] 实现权限查询接口
- [ ] 实现拒绝机制

### Step 4: 持久化
- [ ] 实现序列化/反序列化
- [ ] 集成到 Agent 状态存储

### Step 5: 集成测试
- [ ] 编写单元测试
- [ ] 运行测试验证

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | 小荷 |
