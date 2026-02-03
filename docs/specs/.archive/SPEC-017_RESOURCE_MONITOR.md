# 资源监控模块 - MiniMax 额度展示

> 获取并展示 MiniMax API 使用额度，支持实时监控和告警

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | 资源监控模块 |
| **创建日期** | 2026-01-29 |
| **优先级** | P1 |
| **状态** | 待开发 |
| **Spec 编号** | SPEC-017 |

---

## 1. 用户需求

### 1.1 问题描述

用户需要实时了解 MiniMax API 的使用额度，包括：
- 当前已使用量
- 剩余额度
- 使用百分比
- 下次重置时间

### 1.2 使用场景

- **场景1**：用户打开 exomind-web，查看 MiniMax 额度状态
- **场景2**：用户在使用过程中，额度即将耗尽时收到告警
- **场景3**：管理员通过 API 获取资源使用数据

### 1.3 期望行为

| 功能 | 期望行为 |
|------|----------|
| 额度展示 | 显示已使用/剩余/总额度 |
| 使用率 | 显示百分比进度条 |
| 倒计时 | 显示距离下次重置时间 |
| 实时刷新 | 自动更新数据（可配置间隔） |

---

## 2. 功能定义

### 2.1 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/resource/minimax` | GET | 获取 MiniMax 额度信息 |
| `/api/resource/usage` | GET | 获取使用率汇总 |

### 2.2 响应格式

```typescript
interface MiniMaxUsage {
  model: string;           // 模型名称
  total: number;           // 总额度
  used: number;            // 已使用
  remaining: number;       // 剩余
  percentage: number;      // 使用百分比 (0-100)
  resetInSeconds: number;  // 距离重置秒数
  resetInMinutes: number;  // 距离重置分钟数
  resetInHours: number;    // 距离重置小时数
}

interface ResourceStatus {
  minimax: MiniMaxUsage | null;
  timestamp: string;
}
```

### 2.3 告警阈值

| 级别 | 阈值 | 行为 |
|------|------|------|
| **NORMAL** | < 80% | 正常显示绿色 |
| **WARNING** | 80-95% | 显示黄色，提示快用完 |
| **CRITICAL** | > 95% | 显示红色，紧急告警 |

---

## 3. 验收标准

- [ ] `/api/resource/minimax` 返回正确格式
- [ ] 显示已使用/剩余/总额度
- [ ] 显示使用百分比
- [ ] 显示距离重置时间
- [ ] 单元测试覆盖核心逻辑
- [ ] 集成测试验证 API 响应

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| API 返回空数据 | 返回 null，不报错 |
| 网络错误 | 返回错误信息，不崩溃 |
| 总额度为 0 | 避免除以零错误 |
| 未配置 API | 使用模拟数据 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| NETWORK_ERROR | "无法连接 MiniMax" | 返回错误，不崩溃 |
| NOT_LOGGED_IN | "未登录 MiniMax" | 提示用户登录 |
| API_ERROR | "API 返回错误" | 记录日志，返回错误 |

---

## 6. 依赖关系

### 6.1 依赖模块

- `src/api-server.ts` - API 服务入口
- `src/config.ts` - 配置管理

### 6.2 外部依赖

- **MiniMax API** - 额度数据来源
- **Playwright** - 可选：浏览器登录获取 cookie

---

## 7. 架构设计

### 7.1 目录结构

```
src/
├── resource/
│   ├── index.ts           # 模块导出
│   ├── minimax.ts         # MiniMax 额度获取 ⭐
│   ├── types.ts           # 类型定义
│   └── monitor.ts         # 监控管理器
```

### 7.2 类设计

```typescript
/**
 * MiniMax 资源监控器
 * 获取并缓存 MiniMax API 使用额度
 */
class MiniMaxMonitor {
  /** 缓存数据 */
  private cachedUsage: MiniMaxUsage | null = null;
  /** 缓存过期时间（秒） */
  private cacheTTL: number = 300; // 5分钟

  /**
   * 获取 MiniMax 使用额度
   * @returns 额度信息或 null
   */
  async getUsage(): Promise<MiniMaxUsage | null>;

  /**
   * 获取使用率告警级别
   * @param percentage - 使用百分比
   * @returns 告警级别
   */
  getAlertLevel(percentage: number): 'NORMAL' | 'WARNING' | 'CRITICAL';
}

/**
 * 资源 API 处理器
 */
class ResourceHandler {
  private monitor: MiniMaxMonitor;

  /** GET /api/resource/minimax */
  async handleMinimaxRequest(req: Request): Promise<Response>;

  /** GET /api/resource/usage */
  async handleUsageRequest(req: Request): Promise<Response>;
}
```

### 7.3 数据流

```
用户请求 /api/resource/minimax
    ↓
ResourceHandler
    ↓
MiniMaxMonitor.getUsage()
    ├── 缓存有效 → 返回缓存
    └── 缓存过期 → 调用 API → 更新缓存 → 返回
```

### 7.4 配置

```typescript
interface ResourceConfig {
  /** MiniMax Cookie 文件路径 */
  minimaxCookiePath?: string;
  /** 缓存过期时间（秒） */
  cacheTTL: number;
  /** 刷新间隔（秒） */
  refreshInterval: number;
  /** 告警阈值 */
  warningThreshold: number;   // 80
  criticalThreshold: number;  // 95
}
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 正常额度 | percentage: 50 | alertLevel: "NORMAL" |
| 警告阈值 | percentage: 85 | alertLevel: "WARNING" |
| 紧急阈值 | percentage: 97 | alertLevel: "CRITICAL" |
| 边界值 | percentage: 80 | alertLevel: "WARNING" |
| 边界值 | percentage: 95 | alertLevel: "CRITICAL" |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| API 响应 | GET /api/resource/minimax | 200 + JSON |
| 格式验证 | 响应包含 required 字段 | 通过 |
| 错误处理 | API 错误时 | 返回错误信息 |

---

## 9. 文档更新

- [ ] 更新 API.md（新增端点）
- [ ] 更新 README.md（资源监控说明）

---

## 10. 实施计划

### Step 1: 创建模块目录和类型定义
- [ ] 创建 `src/resource/` 目录
- [ ] 创建 `src/resource/types.ts`

### Step 2: 实现 MiniMaxMonitor
- [ ] 实现 `getUsage()` 方法
- [ ] 实现缓存逻辑
- [ ] 实现 `getAlertLevel()` 方法

### Step 3: 实现 API 路由
- [ ] 在 api-server.ts 添加 `/api/resource/*` 路由
- [ ] 实现 `handleMinimaxRequest()`
- [ ] 实现 `handleUsageRequest()`

### Step 4: 测试验证
- [ ] 编写单元测试
- [ ] 运行测试
- [ ] 手动验证 API

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | 小荷 |
