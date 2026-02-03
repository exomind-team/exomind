# SPEC-018: VPS 资源监控模块

> **版本**: v1.0
> **创建时间**: 2026-01-29
> **状态**: 进行中
> **优先级**: P1

## 1. 用户需求

### 1.1 问题描述

用户需要实时监控 VPS 资源使用情况，包括：
- CPU 状态（运行/停止/限流）
- 内存使用（RAM、Swap）
- 磁盘空间
- 月度流量限额
- IP 地址信息

### 1.2 使用场景

- **场景1**：用户打开 exomind-web，查看 VPS 整体状态
- **场景2**：资源使用率接近阈值时收到可视化告警
- **场景3**：管理员通过 API 获取资源数据进行二次处理

### 1.3 期望行为

| 功能 | 期望行为 |
|------|----------|
| 状态展示 | 显示 Running/Stopped/限流状态 |
| 资源可视化 | 使用率进度条 + 颜色区分 |
| 自动刷新 | 每 30 秒自动更新数据 |
| 错误处理 | API 不可用时显示最后已知状态 |

---

## 2. 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| 无 | - | - | GET 请求无需参数 |

## 3. 输出

| 参数 | 类型 | 描述 |
|------|------|------|
| status | string | VPS 状态 (Running/Stopped/Starting) |
| cpu | object | CPU 信息（状态、负载、限流） |
| memory | object | 内存信息（总量、已用、使用率） |
| disk | object | 磁盘信息（总量、已用、使用率） |
| data | object | 流量信息（已用、总额度、重置日期） |
| network | object | 网络信息（IP 地址列表） |
| timestamp | string | 数据获取时间 |

---

## 4. 验收标准

- [ ] `/api/resource/vps` 返回正确格式
- [ ] 显示 CPU 状态（Running/Stopped/限流）
- [ ] 显示内存使用率
- [ ] 显示磁盘使用率
- [ ] 显示月度流量限额
- [ ] 单元测试覆盖核心逻辑
- [ ] 集成测试验证 API 响应

---

## 5. 边界条件

| 条件 | 预期行为 |
|------|---------|
| API 返回错误 | 返回错误信息，不崩溃 |
| 网络超时 | 返回缓存数据或错误提示 |
| 数据格式异常 | 记录日志，返回部分数据 |
| 限流状态 | 高亮显示限流警告 |

---

## 6. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| NETWORK_ERROR | "无法连接 VPS API" | 返回错误，不崩溃 |
| AUTH_ERROR | "认证失败" | 提示检查 VEID/API Key |
| API_ERROR | "API 返回错误" | 记录日志，返回错误 |

---

## 7. 依赖关系

### 7.1 依赖模块

- `src/api-server.ts` - API 服务入口
- `src/config.ts` - 配置管理

### 7.2 外部依赖

- **64Clouds KiwiVM API** - VPS 数据来源
  - Base URL: `https://api.64clouds.com/v1`
  - 需要 VEID 和 API Key

### 7.3 复用代码

| 源文件 | 复用内容 |
|--------|----------|
| `~/Projects/vps-monitor/src/kiwivm-api.ts` | KiwiVMClient 类 |
| `~/Projects/vps-monitor/src/utils.ts` | formatBytes, getUsageColor 等 |

---

## 8. 架构设计

### 8.1 目录结构

```
src/
└── vps/
    ├── index.ts           # 模块导出
    ├── client.ts          # KiwiVM 客户端 ⭐
    ├── types.ts           # 类型定义
    └── formatter.ts       # 格式化工具 ⭐
```

### 8.2 类设计

```typescript
/**
 * KiwiVM 客户端
 * 复用 vps-monitor 的 kiwivm-api.ts
 */
class VPSClient {
  private veid: string;
  private apiKey: string;

  constructor(veid: string, apiKey: string);

  async getServiceInfo(): Promise<VPSInfo>;
  async getLiveServiceInfo(): Promise<LiveVPSInfo>;
}

/**
 * VPS 资源格式化器
 * 复用 vps-monitor 的 utils.ts
 */
class VPSFormatter {
  static formatBytes(bytes: number): string;
  static formatLoadAverage(load: number[]): string;
  static getUsageColor(percent: number): string;
  static getCpuStatusColor(status: string, isThrottled: boolean): string;
}

/**
 * VPS 资源处理器
 */
class VPSResourceHandler {
  private client: VPSClient;
  private formatter: VPSFormatter;

  async handleVPSRequest(req: Request): Promise<Response>;
}
```

### 8.3 数据流

```
用户请求 /api/resource/vps
    ↓
VPSResourceHandler
    ↓
VPSClient.getLiveServiceInfo()
    ↓
VPSFormatter.format()
    ↓
返回格式化数据
```

### 8.4 配置

```typescript
interface VPSConfig {
  /** 64Clouds VEID */
  veid: string;
  /** 64Clouds API Key */
  apiKey: string;
  /** 缓存过期时间（秒） */
  cacheTTL: number;
  /** 自动刷新间隔（秒） */
  refreshInterval: number;
}
```

---

## 9. API 端点设计

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/resource/vps` | GET | 获取 VPS 完整状态 |
| `/api/resource/vps/status` | GET | 仅获取运行状态 |
| `/api/resource/vps/usage` | GET | 仅获取资源使用率 |

---

## 10. 测试用例

### 10.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 格式化字节 | bytes: 1073741824 | "1 GB" |
| 格式化负载 | [0.15, 0.10, 0.05] | "0.15, 0.10, 0.05" |
| 使用率颜色 | percent: 85 | "#ffc107" (黄色) |
| CPU 状态颜色 | status: "Running" | "#28a745" (绿色) |

### 10.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| API 响应 | GET /api/resource/vps | 200 + JSON |
| 格式验证 | 响应包含 required 字段 | 通过 |
| 错误处理 | API 错误时 | 返回错误信息 |

---

## 11. 文档更新

- [ ] 更新 API.md（新增端点）
- [ ] 更新 README.md（VPS 监控说明）

---

## 12. 实施计划

### Step 1: 创建模块目录和类型定义
- [ ] 创建 `src/vps/` 目录
- [ ] 创建 `src/vps/types.ts`

### Step 2: 实现 KiwiVM 客户端
- [ ] 复用 kiwivm-api.ts 到 `src/vps/client.ts`
- [ ] 实现配置读取

### Step 3: 实现格式化工具
- [ ] 复用 utils.ts 到 `src/vps/formatter.ts`
- [ ] 添加颜色主题适配

### Step 4: 实现 API 路由
- [ ] 在 api-server.ts 添加 `/api/resource/vps` 路由
- [ ] 实现 `handleVPSRequest()`

### Step 5: 测试验证
- [ ] 编写单元测试
- [ ] 运行测试
- [ ] 手动验证 API

---

## 13. 参考资料

| 文件 | 路径 |
|------|------|
| KiwiVM API | https://api.64clouds.com/v1/ |
| vps-monitor | ~/Projects/vps-monitor/ |
| minimax_usage.py | ExoMind-Team/Projects/ExoBuffer/minimax_usage.py |

---

*创建时间: 2026-01-29*
*版本: v1.0*
