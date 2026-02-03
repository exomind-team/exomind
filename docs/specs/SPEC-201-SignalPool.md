# SPEC-201: SignalPool 信号池实现

> **功能名称**: SignalPool 信号池
> **创建日期**: 2026-01-30
> **优先级**: P0
> **状态**: ✅ 已完成

---

## 1. 用户需求

### 1.1 问题描述
L5-Signals 层需要统一管理所有系统信号（输入信号、输出信号、系统信号），实现发布-订阅模式。

### 1.2 使用场景
- 用户消息 → UserSignal → Agent 处理
- 资源变化 → ResourceSignal → UI 更新
- 能源变化 → EnergySignal → 行为调控

### 1.3 期望行为
信号可以发布、订阅、取消订阅、批量处理。

---

## 2. 功能定义

### 2.1 信号类型

| 类型 | 描述 | 属性 |
|------|------|------|
| Signal | 基类 | id, timestamp, type, payload |
| UserSignal | 用户输入 | message, userId |
| MessageSignal | 消息信号 | content, context |
| ResourceSignal | 资源信号 | resourceType, value, change |
| EnergySignal | 能源信号 | current, delta, reason |
| TrustSignal | 信任度信号 | value, reason, source |
| ResponseSignal | 响应输出 | content, action, confidence |
| CommandSignal | 命令信号 | command, args, priority |

### 2.2 SignalPool 接口

```typescript
interface SignalPool {
  // 发布信号
  publish(signal: Signal): void;
  
  // 订阅信号
  subscribe(type: string, handler: (signal: Signal) => void): () => void;
  
  // 取消订阅
  unsubscribe(handlerId: string): void;
  
  // 获取最新信号
  latest(type?: string): Signal | null;
  
  // 历史信号
  history(type?: string, limit?: number): Signal[];
}
```

---

## 3. 验收标准

- [x] Signal 基类实现
- [x] 所有信号类型定义
- [x] SignalPool 发布-订阅核心功能
- [x] 历史信号记录 (max 100条)
- [x] 单元测试覆盖 >80% (pool.ts: 100%, types.ts: 68%)

---

## 4. 架构设计

### 4.1 文件结构

```
src/signals/
├── types.ts      # 信号类型定义
├── pool.ts       # SignalPool 实现
└── __tests__/
    └── pool.test.ts
```

---

## 5. 实施计划

### Step 1: 信号类型定义
- [x] 创建 src/signals/types.ts
- [x] 定义 Signal 基类
- [x] 定义所有信号类型

### Step 2: SignalPool 实现
- [x] 创建 src/signals/pool.ts
- [x] 实现发布-订阅逻辑
- [x] 实现历史记录功能

### Step 3: 单元测试
- [x] 创建 __tests__/pool.test.ts
- [x] 测试发布-订阅
- [x] 测试历史记录
- [x] 测试信号过滤

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-30 | 1.0 | 初始版本 | ExoMind Agent |
