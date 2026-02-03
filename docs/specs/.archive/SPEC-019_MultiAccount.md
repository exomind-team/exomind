# SPEC-019: MiniMax 多账户支持

> **版本**: v1.0
> **创建时间**: 2026-01-29
> **状态**: 待开始
> **优先级**: P1

## 1. 用户需求

### 1.1 问题描述

当前 MiniMax 资源监控仅支持单一账户，需要扩展为多账户支持：
- **default**: 默认账户
- **agent1**: Agent 1 账户
- **agent2**: Agent 2 账户

### 1.2 使用场景

- **场景1**: 查看单个账户的额度使用情况
- **场景2**: 一次性查看所有账户的汇总数据
- **场景3**: 对比不同账户的资源使用率

### 1.3 期望行为

| 功能 | 期望行为 |
|------|----------|
| 账户切换 | 通过 `?account=xxx` 参数切换账户 |
| 汇总展示 | `/api/resource/minimax/all` 返回所有账户汇总 |
| 错误处理 | 单个账户失败不影响其他账户 |

---

## 2. 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| account | string | 否 | 账户名称，默认 `default` |

## 3. 输出

### 3.1 单账户响应

```json
{
  "success": true,
  "data": {
    "account": "default",
    "usage": {
      "model": "M2.1-coding-plan",
      "total": 1000000,
      "used": 250000,
      "remaining": 750000,
      "percentage": 25.0,
      "resetInSeconds": 86400
    }
  },
  "timestamp": "2026-01-29T14:30:00"
}
```

### 3.2 汇总响应

```json
{
  "success": true,
  "data": {
    "accounts": {
      "default": {
        "used": 250000,
        "remaining": 750000,
        "percentage": 25.0
      },
      "agent1": {
        "used": 180000,
        "remaining": 820000,
        "percentage": 18.0
      },
      "agent2": {
        "used": 900000,
        "remaining": 100000,
        "percentage": 90.0
      }
    },
    "summary": {
      "total_used": 1330000,
      "total_remaining": 2670000,
      "total_percentage": 33.3
    }
  },
  "timestamp": "2026-01-29T14:30:00"
}
```

---

## 4. 验收标准

- [ ] `GET /api/resource/minimax?account=default` 返回 default 账户数据
- [ ] `GET /api/resource/minimax?account=agent1` 返回 agent1 账户数据
- [ ] `GET /api/resource/minimax/all` 返回所有账户汇总
- [ ] 账户不存在时返回友好错误信息
- [ ] 单元测试覆盖多账户逻辑

---

## 5. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 账户不存在 | 返回错误，不崩溃 |
| 单个账户 API 失败 | 跳过该账户，其他账户正常返回 |
| 所有账户都失败 | 返回错误信息 |
| 无效的 account 参数 | 返回参数验证错误 |

---

## 6. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| ACCOUNT_NOT_FOUND | "Account 'xxx' not configured" | 返回 400 |
| ALL_ACCOUNTS_FAILED | "All accounts failed to fetch" | 返回 500 |
| SINGLE_ACCOUNT_FAILED | "Account 'xxx' failed" | 在汇总中标记为失败 |

---

## 7. 依赖关系

### 7.1 依赖模块

- `src/resource/monitor.ts` - 现有监控器
- `src/resource/types.ts` - 现有类型定义
- `src/api-server.ts` - API 服务

### 7.2 外部依赖

- **Cookie 文件**: `xhs-scraper/profile/minimaxi/cookies_{account}.json`

---

## 8. 架构设计

### 8.1 目录结构

```
src/resource/
├── index.ts           # 模块导出
├── monitor.ts         # 监控器（修改）
├── types.ts           # 类型定义（扩展）
└── accounts.ts        # 多账户管理 ⭐ 新增
```

### 8.2 类设计

```typescript
/**
 * 账户配置
 */
interface AccountConfig {
  name: string;
  cookiePath: string;
  enabled: boolean;
}

/**
 * 多账户管理器
 */
class MultiAccountManager {
  private accounts: Map<string, AccountConfig>;
  private monitors: Map<string, MiniMaxMonitor>;

  constructor(configPath?: string);

  getAccount(name: string): AccountConfig | undefined;
  getAllAccounts(): AccountConfig[];
  getMonitor(account: string): MiniMaxMonitor;
  async getAllUsage(): Promise<Map<string, MiniMaxUsage>>;
}

/**
 * 汇总响应
 */
interface UsageSummary {
  accounts: {
    [key: string]: {
      used: number;
      remaining: number;
      percentage: number;
      error?: string;
    };
  };
  summary: {
    total_used: number;
    total_remaining: number;
    total_percentage: number;
  };
}
```

### 8.3 数据流

```
用户请求 /api/resource/minimax/all
    ↓
MultiAccountManager.getAllUsage()
    ↓
并行获取所有账户数据
    ↓
汇总计算
    ↓
返回格式化响应
```

### 8.4 配置

```typescript
interface MultiAccountConfig {
  /** 账户配置列表 */
  accounts: {
    name: string;
    cookiePath: string;
    enabled: boolean;
  }[];
  /** 默认账户 */
  defaultAccount: string;
}
```

---

## 9. API 端点设计

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/resource/minimax` | GET | 默认账户额度（兼容） |
| `/api/resource/minimax?account=xxx` | GET | 指定账户额度 |
| `/api/resource/minimax/all` | GET | 所有账户汇总 |
| `/api/resource/minimax/accounts` | GET | 账户列表 |

---

## 10. 测试用例

### 10.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 单账户查询 | account=default | default 账户数据 |
| 汇总查询 | /all | 所有账户汇总 |
| 账户列表 | /accounts | 账户配置列表 |
| 账户不存在 | account=invalid | 错误信息 |

### 10.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 单账户 API | 获取单个账户 | 200 + JSON |
| 汇总 API | 获取所有账户 | 200 + 汇总数据 |
| 错误处理 | 账户不存在 | 400 + 错误信息 |

---

## 11. 实施计划

### Step 1: 扩展类型定义
- [ ] 更新 `types.ts` 添加多账户相关类型
- [ ] 添加 `AccountConfig`、`UsageSummary` 等

### Step 2: 实现账户管理
- [ ] 创建 `accounts.ts`
- [ ] 实现 `MultiAccountManager` 类
- [ ] 支持配置文件加载

### Step 3: 扩展监控器
- [ ] 修改 `monitor.ts` 支持账户参数
- [ ] 添加 `getUsage(account)` 方法

### Step 4: 添加 API 端点
- [ ] 在 `api-server.ts` 添加 `/api/resource/minimax/all`
- [ ] 添加 `/api/resource/minimax/accounts`

### Step 5: 测试验证
- [ ] 编写单元测试
- [ ] 运行测试
- [ ] 手动验证 API

---

## 12. 参考资料

| 文件 | 路径 |
|------|------|
| MiniMax 额度 API | `ExoMind-Team/Projects/ExoBuffer/minimax_usage.py` |
| Cookie 管理 | `xhs-scraper/profile/minimaxi/` |
| 现有监控器 | `src/resource/monitor.ts` |

---

*创建时间: 2026-01-29*
*版本: v1.0*
