# SPEC-003: 输出信号执行器

> 文档版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发
> 依赖：SPEC-001

---

## 1. 用户需求

### 1.1 问题描述

信号池需要将 Agent 的决策转化为实际行动。每种输出类型需要对应的 **执行器（Executor）** 来执行具体操作：

- **用户响应**：发送消息到 Telegram、QQ、微信
- **系统执行**：执行 bash 命令、调用 API
- **信息获取**：执行搜索、读取文件、查询数据库
- **物理操作**：控制硬件设备（未来扩展）

### 1.2 使用场景

- **场景1**：Agent 回复用户消息到 Telegram
- **场景2**：Agent 执行 `git status` 获取仓库状态
- **场景3**：Agent 搜索网络获取最新信息
- **场景4**：Agent 通过 bash 控制 LED 灯（未来）

### 1.3 期望行为

每种输出类型都有对应的 **OutputExecutor**，负责：
1. 接收 OutputSignal
2. 执行具体操作
3. 返回执行结果
4. 处理错误和超时

---

## 2. 功能定义

### 2.1 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| signal | OutputSignal | 是 | 输出信号（包含操作内容和目标） |

### 2.2 输出

| 参数 | 类型 | 描述 |
|------|------|------|
| success | boolean | 是否执行成功 |
| result | unknown | 执行结果 |
| error | string | 错误信息（如果失败） |
| executionTime | number | 执行耗时（ms） |

### 2.3 处理逻辑

```
OutputSignal → [验证权限] → [执行操作] → [返回结果] → 更新信号状态
                    ↑
              根据信任度验证操作权限
```

---

## 3. 验收标准

- [ ] 用户消息正确发送到 Telegram
- [ ] Bash 命令正确执行并返回结果
- [ ] 网络请求正确执行并返回数据
- [ ] 权限验证正确阻止未授权操作
- [ ] 超时控制防止执行器卡住
- [ ] 单元测试覆盖率 > 80%

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 权限不足 | 拒绝执行，返回权限错误 |
| 命令超时 | 中止执行，返回超时错误 |
| 命令失败 | 返回错误信息，不抛异常 |
| 权限为 0 | 仅允许读取操作 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| 权限不足 | "Insufficient trust level" | 返回错误，不执行 |
| 执行超时 | "Execution timeout" | 中止并返回超时 |
| 命令失败 | "Command failed: {error}" | 返回错误信息 |
| 目标不可达 | "Target unavailable" | 记录并返回错误 |

---

## 6. 依赖关系

### 6.1 依赖模块

- `SignalPool` - 信号池
- `TrustLevel` - 信任度系统

### 6.2 外部依赖

- `child_process` - Bash 命令执行
- `fetch` - 网络请求
- `undici` - HTTP 客户端（已有）

---

## 7. 架构设计

### 7.1 接口设计

```typescript
/**
 * 输出执行器接口
 */
interface OutputExecutor {
  /** 支持的信号类型 */
  readonly supportedTypes: SignalType[];

  /** 执行信号 */
  execute(signal: OutputSignal): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTime: number;
  }>;

  /** 检查是否可以执行 */
  canExecute(signal: OutputSignal, trustLevel: number): boolean;
}
```

### 7.2 执行器路由器

```typescript
/**
 * 执行器路由器
 */
class ExecutorRouter {
  private executors: Map<SignalType, OutputExecutor> = new Map();

  constructor(private trustLevel: number = 0) {}

  /** 注册执行器 */
  register(executor: OutputExecutor): void {
    for (const type of executor.supportedTypes) {
      this.executors.set(type, executor);
    }
  }

  /** 路由执行 */
  async route(signal: OutputSignal): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTime: number;
  }> {
    const executor = this.executors.get(signal.type);
    if (!executor) {
      return {
        success: false,
        error: `No executor for signal type: ${signal.type}`,
        executionTime: 0,
      };
    }

    // 检查权限
    if (!executor.canExecute(signal, this.trustLevel)) {
      return {
        success: false,
        error: "Insufficient trust level for this operation",
        executionTime: 0,
      };
    }

    // 执行
    return await executor.execute(signal);
  }
}
```

### 7.3 Telegram 输出执行器

```typescript
/**
 * Telegram 输出执行器
 */
class TelegramOutputExecutor implements OutputExecutor {
  readonly supportedTypes = [SignalType.USER_RESPONSE];

  constructor(
    private bot: Bot,
    private defaultChatId?: string
  ) {}

  async execute(signal: OutputSignal): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTime: number;
  }> {
    const startTime = Date.now();
    const payload = signal.payload as {
      text: string;
      chatId?: string;
      replyToMessageId?: number;
      parseMode?: "Markdown" | "HTML";
    };

    try {
      const chatId = signal.target || this.defaultChatId;
      if (!chatId) {
        return {
          success: false,
          error: "No chat ID specified",
          executionTime: Date.now() - startTime,
        };
      }

      const result = await this.bot.api.sendMessage(chatId, payload.text, {
        reply_to_message_id: payload.replyToMessageId,
        parse_mode: payload.parseMode,
      });

      return {
        success: true,
        result: { messageId: result.message_id },
        executionTime: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  canExecute(signal: OutputSignal, trustLevel: number): boolean {
    // Telegram 响应需要 L1 信任度（读写）
    return trustLevel >= 20;
  }
}
```

### 7.4 Bash 命令执行器

```typescript
/**
 * Bash 命令执行器
 */
class BashExecutor implements OutputExecutor {
  readonly supportedTypes = [SignalType.SYSTEM_EXEC, SignalType.INFO_FETCH];

  constructor(
    private trustLevel: number = 0,
    private timeout: number = 30000  // 默认 30 秒超时
  ) {}

  async execute(signal: OutputSignal): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTime: number;
  }> {
    const startTime = Date.now();
    const payload = signal.payload as {
      command: string;
      timeout?: number;
    };

    const effectiveTimeout = payload.timeout || this.timeout;

    try {
      const { execSync } = require("child_process");

      const result = execSync(payload.command, {
        encoding: "utf-8",
        timeout: effectiveTimeout,
        maxBuffer: 10 * 1024 * 1024,  // 10MB
      });

      return {
        success: true,
        result: { output: result },
        executionTime: Date.now() - startTime,
      };
    } catch (err) {
      const error = err as Error & { status?: number };
      return {
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  canExecute(signal: OutputSignal, trustLevel: number): boolean {
    // Bash 执行需要 L2 信任度（读写 + 安全命令）
    return trustLevel >= 40;
  }
}
```

### 7.5 网络请求执行器

```typescript
/**
 * 网络请求执行器
 */
class NetworkExecutor implements OutputExecutor {
  readonly supportedTypes = [SignalType.INFO_FETCH];

  constructor(
    private trustLevel: number = 0,
    private proxyUrl?: string
  ) {}

  async execute(signal: OutputSignal): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    executionTime: number;
  }> {
    const startTime = Date.now();
    const payload = signal.payload as {
      url: string;
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    };

    try {
      const response = await fetch(payload.url, {
        method: payload.method || "GET",
        headers: payload.headers || {},
        body: payload.body,
      });

      const contentType = response.headers.get("content-type") || "";
      let result: unknown;

      if (contentType.includes("application/json")) {
        result = await response.json();
      } else {
        result = await response.text();
      }

      return {
        success: true,
        result: {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          content: result,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  canExecute(signal: OutputSignal, trustLevel: number): boolean {
    // 网络请求需要 L1 信任度
    return trustLevel >= 20;
  }
}
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| Telegram 消息发送 | 有效 chatId 和消息 | success: true, messageId |
| Bash 命令执行 | 有效命令 | success: true, output |
| 权限验证失败 | 信任度 0 | success: false |
| 命令超时处理 | 超时命令 | error: "timeout" |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| 信号完整流转 | OutputSignal → executor → result | 完成执行 |

---

## 9. 文档更新

- [ ] 更新 API.md（各 Executor 文档）

---

## 10. 实施计划

### Step 1: 基础接口
- [ ] 定义 OutputExecutor 接口
- [ ] 实现 ExecutorRouter

### Step 2: Telegram 执行器
- [ ] 实现 TelegramOutputExecutor
- [ ] 测试消息发送

### Step 3: Bash 执行器
- [ ] 实现 BashExecutor
- [ ] 实现超时控制

### Step 4: 网络执行器
- [ ] 实现 NetworkExecutor
- [ ] 测试网络请求

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | Ralph |

---

*文档创建：2026-01-29*
*状态：待开发*
