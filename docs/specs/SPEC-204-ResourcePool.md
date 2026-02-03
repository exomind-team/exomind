# SPEC-204: ResourcePool 资源池

> **功能名称**: ResourcePool 资源管理系统
> **创建日期**: 2026-01-30
> **优先级**: P1
> **状态**: ✅ 已完成

---

## 1. 用户需求

### 1.1 问题描述

ExoMind 作为自主生命体系统，需要统一管理各类资源：
- MiniMax API Token 额度（每日/每月）
- VPS 计算资源（CPU、内存、存储）
- 第三方服务配额
- 本地缓存容量

### 1.2 使用场景

- 监控 API 调用剩余额度
- 自动限制资源使用
- 资源告警与自动扩容
- 成本追踪与优化

### 1.3 期望行为

- 实时资源监控与展示
- 资源使用阈值告警
- 自动资源分配与回收
- 历史数据统计与可视化

---

## 2. 功能定义

### 2.1 资源类型

| 资源类型 | 描述 | 单位 | 刷新周期 |
|----------|------|------|----------|
| minimax_tokens | MiniMax API Token | tokens | 每日重置 |
| vps_cpu | VPS CPU 使用率 | % | 实时 |
| vps_memory | VPS 内存使用率 | % | 实时 |
| vps_storage | VPS 存储使用率 | GB | 实时 |
| requests | API 请求次数 | 次 | 每日重置 |
| cache_size | 缓存容量 | MB | 手动清理 |

### 2.2 ResourcePool 接口

```typescript
interface ResourcePool {
  // 获取资源当前状态
  get(resourceType: string): ResourceStatus | null;

  // 获取所有资源状态
  getAll(): Map<string, ResourceStatus>;

  // 消耗资源
  consume(resourceType: string, amount: number): boolean;

  // 补充资源
  replenish(resourceType: string, amount: number): void;

  // 设置阈值告警
  setThreshold(resourceType: string, threshold: number): void;

  // 检查是否需要告警
  checkThresholds(): ResourceAlert[];

  // 获取资源历史
  getHistory(resourceType: string, range: string): ResourceHistory[];
}
```

### 2.3 资源状态

```typescript
interface ResourceStatus {
  type: string;
  current: number;
  max: number;
  unit: string;
  percentage: number;
  lastUpdated: number;
  alertLevel: 'normal' | 'warning' | 'critical';
}
```

---

## 3. 验收标准

- [x] ResourcePool 核心类实现
- [x] MiniMax Token 配额管理
- [x] VPS 资源监控（CPU/内存/存储）
- [x] 资源告警机制
- [x] 资源使用历史记录
- [x] 单元测试覆盖 >80% (18 tests pass)
- [x] 集成到 Interface 层（API 端点）

---

## 4. 架构设计

### 4.1 文件结构

```
src/resources/
├── types.ts           # 资源类型定义
├── pool.ts            # ResourcePool 实现
├── monitors/
│   ├── minimax.ts     # MiniMax API 监控
│   └── vps.ts         # VPS 系统监控
└── __tests__/
    └── pool.test.ts
```

### 4.2 数据流

```
ResourcePool
    ↓
Monitors (MiniMax, VPS)
    ↓
ResourceStatus
    ↓
Interface Layer → Dashboard UI
```

---

## 5. 实施计划

### Step 1: 基础架构
- [x] 创建 src/resources/types.ts
- [x] 创建 src/resources/pool.ts
- [x] 定义资源类型和状态接口

### Step 2: 资源监控器
- [x] 实现 MiniMax Token 监控
- [x] 实现 VPS 系统监控
- [x] 添加资源更新机制

### Step 3: 告警机制
- [x] 实现阈值检查
- [x] 添加告警级别判断
- [x] 集成告警通知

### Step 4: API 集成
- [x] 添加 /api/resource/* 端点
- [x] 集成到 Dashboard UI
- [x] 添加实时更新

### Step 5: 测试
- [x] 单元测试 18 pass (>80%)
- [x] 集成测试 (Dashboard API)

---

## 6. 下一步优化

- [ ] 自动扩容策略
- [ ] 成本分析报告
- [ ] 预测性资源管理
- [ ] 多云资源整合

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-30 | 1.0 | 初始版本 | ExoMind Agent |
