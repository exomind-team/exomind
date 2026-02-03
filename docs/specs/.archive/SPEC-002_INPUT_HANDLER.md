# SPEC-002: 输入信号处理器

> 文档版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发
> 依赖：SPEC-001

---

## 1. 用户需求

### 1.1 问题描述

信号池需要从多种来源接收信号，每种来源的信号格式和协议都不同。需要一个统一的 **输入处理器（Input Handler）** 接口来处理：

- **Telegram**：grammY 框架的 Update 对象
- **QQ**：OneBot 协议的 JSON 消息
- **微信**：微信协议的 XML/JSON 消息
- **系统通知**：进程信号、文件监控事件
- **网络信号**：搜索 API 结果、RSS 订阅

### 1.2 使用场景

- **场景1**：用户通过 Telegram 发送文字消息
- **场景2**：用户通过 QQ 发送图片消息
- **场景3**：服务器磁盘空间不足，触发系统通知
- **场景4**：Agent 需要主动搜索网络获取信息

### 1.3 期望行为

每种信号源都有对应的 **InputHandler**，负责：
1. 接收原始信号
2. 转换为统一的 `InputSignal` 格式
3. 添加元数据（来源、时间戳、优先级）
4. 提交到信号池

---

## 2. 功能定义

### 2.1 输入

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| rawSignal | unknown | 是 | 原始信号（取决于信号源） |
| sourceId | string | 是 | 信号源标识 |
| metadata | Partial\<SignalMetadata\> | 否 | 额外元数据 |

### 2.2 输出

| 参数 | 类型 | 描述 |
|------|------|------|
| signal | InputSignal | 统一格式的输入信号 |
| success | boolean | 是否成功转换 |
| error | string | 错误信息（如果失败） |

### 2.3 处理逻辑

```
原始信号 → [验证格式] → [提取内容] → [添加元数据] → 统一 InputSignal
                                      ↑
                              注入优先级、来源、时间戳
```

---

## 3. 验收标准

- [ ] Telegram 消息正确转换为 InputSignal
- [ ] 消息类型（文本/图片/语音）正确识别
- [ ] 元数据完整（source, timestamp, priority）
- [ ] 格式错误的信号被拒绝并记录
- [ ] 单元测试覆盖率 > 80%

---

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 空消息 | 拒绝，返回错误 |
| 格式不支持 | 拒绝，返回错误 |
| 消息过长 | 自动截断或拒绝 |
| 特殊字符 | 正确转义处理 |

---

## 5. 错误处理

| 错误类型 | 错误信息 | 处理方式 |
|----------|----------|----------|
| 空信号 | "Empty signal received" | 记录并拒绝 |
| 格式错误 | "Invalid signal format" | 记录并拒绝 |
| 解析失败 | "Failed to parse signal" | 记录原始信号，返回错误 |

---

## 6. 依赖关系

### 6.1 依赖模块

- `SignalPool` - 信号池
- `SignalType` - 信号类型枚举
- `SignalPriority` - 优先级枚举

### 6.2 外部依赖

- `grammY` - Telegram 处理
- `chokidar` - 文件监控（可选）

---

## 7. 架构设计

### 7.1 接口设计

```typescript
/**
 * 输入处理器接口
 */
interface InputHandler {
  /** 信号源类型 */
  readonly sourceType: SignalType;

  /** 信号源标识 */
  readonly sourceId: string;

  /** 是否可用 */
  isAvailable(): boolean;

  /** 启动监听 */
  startListening(): Promise<void>;

  /** 停止监听 */
  stopListening(): Promise<void>;

  /** 处理原始信号 */
  process(rawSignal: unknown, metadata?: Partial<SignalMetadata>): Promise<{
    success: boolean;
    signal?: InputSignal;
    error?: string;
  }>;
}
```

### 7.2 Telegram 输入处理器

```typescript
/**
 * Telegram 输入处理器
 */
class TelegramInputHandler implements InputHandler {
  readonly sourceType = SignalType.PLATFORM_MSG;
  readonly sourceId = "telegram";

  constructor(
    private bot: Bot,
    private signalPool: SignalPool,
    private trustLevel: number = 0  // 根据信任度设置
  ) {}

  isAvailable(): boolean {
    return !!this.bot;
  }

  async startListening(): Promise<void> {
    this.bot.on("message", async (ctx) => {
      const rawSignal = ctx.update;
      const result = await this.process(rawSignal, {
        platform: "telegram",
        userId: String(ctx.from?.id),
        sessionId: String(ctx.chat?.id),
      });

      if (result.success && result.signal) {
        await this.signalPool.submitInput(result.signal);
      }
    });
  }

  async stopListening(): Promise<void> {
    // 移除监听器
  }

  async process(
    rawSignal: unknown,
    metadata?: Partial<SignalMetadata>
  ): Promise<{ success: boolean; signal?: InputSignal; error?: string }> {
    try {
      // 验证格式
      if (!rawSignal || typeof rawSignal !== "object") {
        return { success: false, error: "Invalid Telegram update format" };
      }

      const update = rawSignal as TelegramUpdate;

      // 提取消息内容
      const content = this.extractContent(update);
      if (!content) {
        return { success: false, error: "No message content found" };
      }

      // 确定消息类型
      const messageType = this.getMessageType(update);

      // 确定优先级（根据信任度）
      const priority = this.determinePriority(messageType, this.trustLevel);

      // 构建 InputSignal
      const signal: InputSignal = {
        id: this.generateSignalId(),
        type: SignalType.USER_INPUT,
        payload: {
          content,
          messageType,
          raw: update,
        },
        metadata: {
          source: this.sourceId,
          timestamp: Date.now(),
          priority,
          platform: "telegram",
          userId: String(update.message?.from?.id),
          sessionId: String(update.message?.chat?.id),
          ...metadata,
        },
        receivedAt: Date.now(),
      };

      return { success: true, signal };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private extractContent(update: TelegramUpdate): string | null {
    const message = update.message;
    if (!message) return null;

    // 文本消息
    if (message.text) return message.text;

    // 图片消息（返回文件 ID）
    if (message.photo) {
      const photo = message.photo[message.photo.length - 1];
      return `[图片:${photo.file_id}]`;
    }

    // 语音消息
    if (message.voice) return `[语音:${message.voice.file_id}]`;

    // 其他类型
    return `[${message.chat.type}]`;
  }

  private getMessageType(update: TelegramUpdate): string {
    const message = update.message;
    if (!message) return "unknown";

    if (message.text) return "text";
    if (message.photo) return "photo";
    if (message.voice) return "voice";
    if (message.document) return "document";
    return "unknown";
  }

  private determinePriority(messageType: string, trustLevel: number): SignalPriority {
    // 高信任度用户的消息优先处理
    if (trustLevel >= 80) return SignalPriority.CRITICAL;
    if (trustLevel >= 40) return SignalPriority.HIGH;

    // 根据消息类型确定优先级
    if (messageType === "text") return SignalPriority.NORMAL;
    return SignalPriority.LOW;
  }

  private generateSignalId(): string {
    return `tg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### 7.3 信号分类器

```typescript
/**
 * 信号分类器
 */
class SignalClassifier {
  /**
   * 分类信号类型
   */
  classify(
    payload: unknown,
    metadata: SignalMetadata
  ): { type: SignalType; priority: SignalPriority } {
    // 根据来源和内容确定类型
    if (metadata.source === "telegram" || metadata.source === "qq") {
      return {
        type: SignalType.USER_INPUT,
        priority: SignalPriority.HIGH,
      };
    }

    if (metadata.source === "system") {
      return {
        type: SignalType.SYSTEM_NOTIF,
        priority: SignalPriority.NORMAL,
      };
    }

    if (metadata.source === "network") {
      return {
        type: SignalType.NETWORK_SIGNAL,
        priority: SignalPriority.LOW,
      };
    }

    // 默认返回用户输入
    return {
      type: SignalType.USER_INPUT,
      priority: SignalPriority.NORMAL,
    };
  }
}
```

---

## 8. 测试用例

### 8.1 单元测试

| 用例 | 输入 | 预期输出 |
|------|------|----------|
| 文本消息转换 | Telegram text update | 正确的 InputSignal |
| 图片消息转换 | Telegram photo update | 包含文件 ID 的 InputSignal |
| 空消息处理 | null | success: false |
| 优先级计算 | 高信任度用户 | CRITICAL 优先级 |

### 8.2 集成测试

| 用例 | 描述 | 预期结果 |
|------|------|----------|
| Telegram 消息流转 | Mock Telegram update → handler → signal pool | 信号进入队列 |

---

## 9. 文档更新

- [ ] 更新 API.md（TelegramInputHandler 文档）

---

## 10. 实施计划

### Step 1: 基础接口
- [ ] 定义 InputHandler 接口
- [ ] 定义 TelegramUpdate 类型

### Step 2: Telegram 处理器
- [ ] 实现 TelegramInputHandler
- [ ] 实现消息内容提取
- [ ] 实现优先级计算

### Step 3: 信号分类器
- [ ] 实现 SignalClassifier
- [ ] 测试分类准确性

---

## 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-29 | 1.0 | 初始版本 | Ralph |

---

*文档创建：2026-01-29*
*状态：待开发*
