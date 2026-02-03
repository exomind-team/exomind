# SPEC-012: API 自动测试系统

> 版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | API 自动测试系统 |
| **创建日期** | 2026-01-29 |
| **优先级** | P0 |
| **状态** | 待开发 |
| **依赖** | Vitest, Node.js Test Runner |

---

## 1. 用户需求

### 1.1 问题描述

需要实现一个自动测试系统，支持：
- 单元测试（单函数/类测试）
- 集成测试（模块间交互测试）
- 端到端测试（完整流程测试）
- API 测试（RESTful API 测试）
- 测试覆盖率统计
- 测试报告生成

### 1.2 使用场景

- **场景1**：开发新功能后，运行单元测试验证
- **场景2**：提交代码前，运行所有测试确保质量
- **场景3**：CI/CD 流水线中，自动运行测试
- **场景4**：生成测试报告，分析测试覆盖率
- **场景5**：定时运行测试，发现性能退化

### 1.3 期望行为

- 测试执行时间 < 5秒（单个测试）
- 测试覆盖率 > 80%
- 支持并行测试执行
- 生成 HTML/JSON 测试报告
- 失败自动重试 1 次
- 支持 CI/CD 集成

---

## 2. 功能定义

### 2.1 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| testPattern | string | 否 | **/*.test.ts | 测试文件匹配模式 |
| reporter | string | 否 | 'default' | 报告器类型 |
| coverage | boolean | 否 | true | 是否收集覆盖率 |
| parallel | boolean | 否 | true | 是否并行执行 |
| retries | number | 否 | 1 | 失败重试次数 |
| timeout | number | 否 | 5000 | 单测试超时（毫秒） |

### 2.2 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| testResults | TestResult[] | 测试结果数组 |
| coverageReport | CoverageReport | 覆盖率报告 |
| summary | TestSummary | 测试汇总统计 |
| reportFile | string | 生成的报告文件路径 |

### 2.3 处理逻辑

```
┌─────────────────────────────────────────────────────────────────────┐
│                     API 自动测试系统流程                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  准备阶段                                                           │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 加载配置      │───→│  扫描测试文件 │───→│  导入测试用例 │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│                                                                     │
│  执行阶段                                                           │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 并发执行      │───→│  收集结果     │───→│  失败重试     │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│                                                                     │
│  报告阶段                                                           │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 覆盖率统计    │───→│  生成报告     │───→│  输出结果     │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 接口设计

### 3.1 核心类定义

```typescript
/**
 * 测试用例定义
 */
export interface TestCase {
  /** 测试 ID */
  id: string;

  /** 测试名称 */
  name: string;

  /** 测试类别 */
  category: 'unit' | 'integration' | 'e2e' | 'api';

  /** 测试描述 */
  description: string;

  /** 输入数据 */
  input: Record<string, unknown>;

  /** 期望输出 */
  expected: Record<string, unknown>;

  /** 超时时间（毫秒） */
  timeout?: number;

  /** 前置条件 */
  setup?: () => Promise<void>;

  /** 清理操作 */
  teardown?: () => Promise<void>;

  /** 依赖的测试 ID（用于排序） */
  dependsOn?: string[];

  /** 标签（用于过滤） */
  tags?: string[];
}

/**
 * 测试结果
 */
export interface TestResult {
  /** 测试 ID */
  testId: string;

  /** 测试名称 */
  name: string;

  /** 测试状态 */
  status: 'pass' | 'fail' | 'skip' | 'error';

  /** 执行时长（毫秒） */
  duration: number;

  /** 实际输出 */
  actual: unknown;

  /** 期望输出 */
  expected: unknown;

  /** 错误信息 */
  error?: TestError;

  /** 重试次数 */
  retries: number;

  /** 执行时间戳 */
  executedAt: Date;

  /** 截图（E2E 测试） */
  screenshots?: string[];

  /** 日志输出 */
  logs?: string[];
}

/**
 * 测试错误
 */
export interface TestError {
  /** 错误类型 */
  type: 'assertion' | 'timeout' | 'network' | 'assertion' | 'runtime';

  /** 错误消息 */
  message: string;

  /** 错误堆栈 */
  stack?: string;

  /** 预期值 */
  expected?: unknown;

  /** 实际值 */
  actual?: unknown;

  /** 差异对比 */
  diff?: {
    expected: string;
    actual: string;
  };
}

/**
 * 覆盖率报告
 */
export interface CoverageReport {
  /** 行覆盖率 */
  lineCoverage: number;

  /** 分支覆盖率 */
  branchCoverage: number;

  /** 函数覆盖率 */
  functionCoverage: number;

  /** 语句覆盖率 */
  statementCoverage: number;

  /** 未覆盖的行 */
  uncoveredLines: number[];

  /** 覆盖率阈值检查 */
  thresholdCheck: {
    line: boolean;
    branch: boolean;
    function: boolean;
    statement: boolean;
  };
}

/**
 * 测试汇总
 */
export interface TestSummary {
  /** 总测试数 */
  total: number;

  /** 通过数 */
  passed: number;

  /** 失败数 */
  failed: number;

  /** 跳过数 */
  skipped: number;

  /** 错误数 */
  errors: number;

  /** 通过率 */
  passRate: number;

  /** 总执行时间（毫秒） */
  totalDuration: number;

  /** 平均执行时间（毫秒） */
  avgDuration: number;
}

/**
 * 测试配置
 */
export interface TestConfig {
  /** 测试文件模式 */
  testPattern: string;

  /** 报告器类型 */
  reporter: 'default' | 'html' | 'json' | 'junit' | 'allure';

  /** 是否收集覆盖率 */
  coverage: boolean;

  /** 是否并行执行 */
  parallel: boolean;

  /** 失败重试次数 */
  retries: number;

  /** 单测试超时（毫秒） */
  timeout: number;

  /** 覆盖率阈值 */
  coverageThreshold: {
    line: number;
    branch: number;
    function: number;
    statement: number;
  };

  /** 测试标签过滤 */
  includeTags?: string[];

  /** 排除的测试标签 */
  excludeTags?: string[];
}

/**
 * 测试运行器
 */
export class TestRunner {
  /**
   * 创建测试运行器实例
   * @param config 测试配置
   */
  constructor(config: TestConfig);

  /**
   * 加载测试用例
   * @param testDir 测试目录
   * @returns 测试用例数组
   */
  async loadTests(testDir: string): Promise<TestCase[]>;

  /**
   * 运行测试
   * @param tests 测试用例数组
   * @returns 测试结果
   */
  async runTests(tests: TestCase[]): Promise<TestResult[]>;

  /**
   * 运行单个测试
   * @param test 测试用例
   * @returns 测试结果
   */
  async runSingleTest(test: TestCase): Promise<TestResult>;

  /**
   * 生成测试报告
   * @param results 测试结果
   * @param coverage 覆盖率报告
   * @returns 报告文件路径
   */
  async generateReport(
    results: TestResult[],
    coverage?: CoverageReport
  ): Promise<string>;

  /**
   * 获取测试汇总
   * @param results 测试结果
   * @returns 测试汇总
   */
  getSummary(results: TestResult[]): TestSummary;

  /**
   * 过滤测试用例
   * @param tests 测试用例数组
   * @param filter 过滤条件
   * @returns 过滤后的测试用例
   */
  filterTests(
    tests: TestCase[],
    filter: { includeTags?: string[]; excludeTags?: string[] }
  ): TestCase[];
}

/**
 * 测试结果验证器
 */
export class ResultValidator {
  /**
   * 验证测试结果
   * @param actual 实际值
   * @param expected 期望值
   * @returns 验证结果（通过/失败信息）
   */
  validate(actual: unknown, expected: unknown): ValidationResult;

  /**
   * 深度比较两个对象
   * @param obj1 对象1
   * @param obj2 对象2
   * @return 差异数组
   */
  deepCompare(obj1: unknown, obj2: unknown): Diff[];
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否通过 */
  passed: boolean;

  /** 错误消息 */
  message?: string;

  /** 差异详情 */
  diff?: Diff;
}

/**
 * 差异详情
 */
export interface Diff {
  /** 路径 */
  path: string;

  /** 期望值 */
  expected: unknown;

  /** 实际值 */
  actual: unknown;
}
```

### 3.2 CLI 接口

```typescript
/**
 * 测试命令行参数
 */
export interface TestCLIArgs {
  /** 运行指定的测试（文件名/测试名） */
  run?: string;

  /** 测试目录 */
  dir?: string;

  /** 报告器类型 */
  reporter?: 'default' | 'html' | 'json';

  /** 启用覆盖率 */
  coverage: boolean;

  /** 禁用并行执行 */
  noParallel: boolean;

  /** 失败重试次数 */
  retries: number;

  /** 超时时间 */
  timeout: number;

  /** 监听模式 */
  watch: boolean;

  /** 生成覆盖率报告 */
  coverageReport: boolean;

  /** 输出报告文件路径 */
  output?: string;
}

/**
 * CLI 入口
 */
export async function runCLI(args: TestCLIArgs): Promise<void>;
```

---

## 4. 测试用例类型

### 4.1 单元测试示例

```typescript
// tests/energy-pool.test.ts
describe('EnergyPool', () => {
  describe('consume()', () => {
    it('should consume tokens correctly', async () => {
      // ARRANGE
      const pool = new EnergyPool({ initial: 1000000 });
      const before = pool.getBalance();

      // ACT
      await pool.consume(1000);

      // ASSERT
      expect(pool.getBalance()).toBe(before - 1000);
    });

    it('should throw when insufficient balance', async () => {
      const pool = new EnergyPool({ initial: 500 });
      await expect(pool.consume(1000)).rejects.toThrow('Insufficient balance');
    });
  });
});
```

### 4.2 API 测试示例

```typescript
// tests/api.test.ts
describe('API /energy/*', () => {
  describe('GET /api/energy/status', () => {
    it('should return energy status', async () => {
      const response = await request(server)
        .get('/api/energy/status')
        .expect(200);

      expect(response.body).toHaveProperty('balance');
      expect(response.body).toHaveProperty('usage');
    });
  });
});
```

---

## 5. 实现要求

### 5.1 性能要求

| 指标 | 要求 | 测量方式 |
|------|------|----------|
| 单测试执行时间 | < 5秒 | Vitest 统计 |
| 并发执行能力 | > 10 并发 | 压力测试 |
| 测试加载时间 | < 2秒 | 启动时间监控 |
| 报告生成时间 | < 1秒 | 生成时间监控 |

### 5.2 覆盖率要求

| 指标 | 要求 |
|------|------|
| 行覆盖率 | > 80% |
| 分支覆盖率 | > 70% |
| 函数覆盖率 | > 80% |
| 语句覆盖率 | > 80% |

### 5.3 报告要求

- 支持 HTML 格式报告
- 支持 JSON 格式报告（机器可读）
- 包含测试结果统计
- 包含覆盖率统计
- 包含失败详情和堆栈

---

## 6. 测试策略

### 6.1 单元测试

| 模块 | 测试类 | 测试内容 |
|------|--------|----------|
| **EnergyPool** | consume(), recharge(), getBalance() | 余额操作、异常处理 |
| **SignalPool** | addSignal(), processSignals(), priorityQueue | 信号添加、处理、优先级 |
| **Actor** | receive(), think(), execute() | 消息处理流程 |
| **ContinuousRunner** | start(), stop(), sleep(), wake() | 运行状态管理 |

### 6.2 集成测试

| 场景 | 测试内容 |
|------|----------|
| 信号处理流程 | 输入信号 → 优先级队列 → Actor 处理 → 输出信号 |
| 能量消耗流程 | API 调用 → 能量消耗 → 余额更新 → 告警触发 |
| 持续运行流程 | 启动 → 监控 → 休眠 → 唤醒 → 重启 |

### 6.3 E2E 测试（Playwright）

| 场景 | 验证点 |
|----------|--------|
| Telegram 消息流程 | 发送消息 → 接收 → 处理 → 响应 |
| 命令执行流程 | 发送命令 → 解析 → 执行 → 返回结果 |
| 长时间运行 | 24 小时持续运行，无内存泄漏 |
| 错误恢复 | 模拟错误，验证自动恢复 |

---

## 7. 验收标准

- [ ] 支持 Vitest 框架
- [ ] 测试覆盖率 > 80%
- [ ] 单个测试执行时间 < 5秒
- [ ] 支持并行测试执行
- [ ] 失败自动重试 1 次
- [ ] 生成 HTML 测试报告
- [ ] 生成 JSON 测试报告
- [ ] 支持 CI/CD 集成
- [ ] 单元测试 > 200 个
- [ ] 集成测试 > 20 个
- [ ] E2E 测试 > 10 个

---

## 8. 相关文档

| 文档 | 路径 |
|------|------|
| Vitest 文档 | https://vitest.dev/ |
| PRD 需求 | pm/PRD.md (3.11 节) |
| 测试模板 | tests/*.test.ts |

---

*创建日期：2026-01-29*
*版本：v1.0*
