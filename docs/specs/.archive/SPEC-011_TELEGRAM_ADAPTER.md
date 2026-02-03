# SPEC-011: Telegram 适配器

> 版本：v1.0
> 创建日期：2026-01-29
> 优先级：P0
> 状态：待开发

---

## 基本信息

| 字段 | 内容 |
|------|------|
| **功能名称** | Telegram 平台适配器 |
| **创建日期** | 2026-01-29 |
| **优先级** | P0 |
| **状态** | 待开发 |
| **依赖** | grammY, ProxyAgent |

---

## 1. 用户需求

### 1.1 问题描述

需要实现 Telegram Bot 的完整适配器，使 Agent 能够：
- 实时接收用户消息（文本、图片、语音、文件）
- 发送消息回复用户
- 解析并执行命令（/start、/status 等）
- 在国内网络环境下通过代理访问 Telegram API

### 1.2 使用场景

- **场景1**：用户通过 Telegram 发送文字消息，Agent 接收并处理
- **场景2**：用户发送图片/语音，Agent 下载并处理
- **场景3**：用户发送命令（/start /status），Agent 执行对应操作
- **场景4**：Agent 回复用户消息（文本、图片、文件）
- **场景5**：网络断开后自动重连，恢复通信

### 1.3 期望行为

- 消息接收延迟 < 1秒
- 消息发送成功率 > 99%
- 支持 HTTP/SOCKS5 代理（国内环境必备）
- 自动重连（指数退避策略）
- 消息去重（防止重复处理）

---

## 2. 功能定义

### 2.1 输入

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| botToken | string | 是 | - | Telegram Bot Token |
| proxyUrl | string | 否 | - | 代理地址（HTTP/SOCKS5） |
| webhookUrl | string | 否 | - | Webhook URL（可选） |
| allowedUpdates | UpdateType[] | 否 | 所有类型 | 允许的更新类型 |
| maxConnections | number | 否 | 100 | 最大连接数 |

### 2.2 输出

| 参数名 | 类型 | 描述 |
|--------|------|------|
| messages | ReceivedMessage[] | 接收到的消息数组 |
| messageId | number | 发送消息的消息 ID |
| filePath | string | 下载文件的本地路径 |
| error | Error | 错误信息（失败时） |

### 2.3 处理逻辑

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Telegram 适配器处理流程                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  初始化阶段                                                         │
│  ┌───────────────┐                                                  │
│  │ 创建 Bot 实例  │───→ 配置 ProxyAgent                             │
│  └───────────────┘                                                  │
│         │                                                           │
│         ▼                                                           │
│  ┌───────────────┐                                                  │
│  │ 选择连接模式  │───→ Webhook / Long Polling                        │
│  └───────────────┘                                                  │
│         │                                                           │
│         ▼                                                           │
│  消息接收阶段                                                        │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 接收 Update   │───→│  消息类型解析 │───→│  信号转换     │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│         │                          │                    │            │
│         ▼                          ▼                    ▼            │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 命令路由      │    │  文件下载     │    │  消息去重     │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│                                                                     │
│  消息发送阶段                                                        │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │
│  │ 发送请求      │───→│  格式转换     │───→│  结果返回     │      │
│  └───────────────┘    └───────────────┘    └───────────────┘      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 接口设计

### 3.1 类定义

```typescript
/**
 * Telegram 适配器
 * 负责 Telegram Bot 的消息收发和命令处理
 */
export class TelegramAdapter {
  /** Bot 实例 */
  private bot: Bot;

  /** 代理配置 */
  private proxyUrl?: string;

  /** 消息处理器 */
  private messageHandler: (signal: Signal) => Promise<void>;

  /** 命令处理器 */
  private commandHandlers: Map<string, CommandHandler>;

  /** 已处理消息 ID 集合（去重） */
  private processedMessageIds: Set<number>;

  /** 连接模式 */
  private connectionMode: 'webhook' | 'polling';

  /**
   * 创建 Telegram 适配器实例
   * @param config 适配器配置
   */
  constructor(config: TelegramAdapterConfig);

  /**
   * 初始化适配器
   * 配置代理、连接模式、消息处理器
   */
  async initialize(): Promise<void>;

  /**
   * 启动消息监听
   * 根据配置选择 Webhook 或 Long Polling 模式
   */
  async startListening(): Promise<void>;

  /**
   * 停止消息监听
   */
  async stopListening(): Promise<void>;

  /**
   * 发送文本消息
   * @param chatId 聊天 ID
   * @param text 消息内容
   * @param options 可选参数
   * @returns 发送结果
   */
  async sendMessage(
    chatId: number,
    text: string,
    options?: SendMessageOptions
  ): Promise<Message>;

  /**
   * 发送图片消息
   * @param chatId 聊天 ID
   * @param image 图片（路径/URL/InputFile）
   * @param options 可选参数
   * @returns 发送结果
   */
  async sendPhoto(
    chatId: number,
    image: string | InputFile,
    options?: SendPhotoOptions
  ): Promise<Message>;

  /**
   * 下载文件
   * @param fileId 文件 ID
   * @param destination 保存路径
   * @returns 文件本地路径
   */
  async downloadFile(fileId: string, destination: string): Promise<string>;

  /**
   * 注册命令处理器
   * @param command 命令名（不含 /）
   * @param handler 处理器函数
   */
  registerCommand(command: string, handler: CommandHandler): void;

  /**
   * 注册消息处理器
   * @param handler 处理器函数
   */
  onMessage(handler: (signal: Signal) => Promise<void>): void;

  /**
   * 获取 Bot 信息
   */
  getBotInfo(): Promise<User>;

  /**
   * 设置代理
   * @param proxyUrl 代理地址
   */
  setProxy(proxyUrl: string): void;
}

/**
 * 适配器配置
 */
export interface TelegramAdapterConfig {
  /** Bot Token */
  botToken: string;

  /** 代理地址（可选） */
  proxyUrl?: string;

  /** Webhook URL（可选，不设置则使用 Long Polling） */
  webhookUrl?: string;

  /** 允许的更新类型 */
  allowedUpdates?: UpdateType[];

  /** 最大连接数（Webhook 模式） */
  maxConnections?: number;

  /** 消息处理超时（毫秒） */
  messageTimeout?: number;
}

/**
 * 命令处理器类型
 */
export type CommandHandler = (
  chatId: number,
  args: string[],
  signal: Signal
) => Promise<void>;

/**
 * 发送消息选项
 */
export interface SendMessageOptions {
  /** 解析模式 */
  parseMode?: 'HTML' | 'Markdown' | 'None';

  /** 禁用网页预览 */
  disableWebPagePreview?: boolean;

  /** 禁用通知 */
  disableNotification?: boolean;

  /** 回复消息 ID */
  replyToMessageId?: number;

  /** 键盘布局 */
  replyMarkup?: ReplyMarkup;
}

/**
 * 发送图片选项
 */
export interface SendPhotoOptions {
  /** 标题 */
  caption?: string;

  /** 禁用通知 */
  disableNotification?: boolean;

  /** 回复消息 ID */
  replyToMessageId?: number;

  /** 键盘布局 */
  replyMarkup?: ReplyMarkup;
}

/**
 * 接收到的消息
 */
export interface ReceivedMessage {
  /** 消息 ID */
  id: number;

  /** 聊天 ID */
  chatId: number;

  /** 消息类型 */
  type: 'text' | 'image' | 'voice' | 'file' | 'command';

  /** 文本内容（文本消息） */
  text?: string;

  /** 文件路径（文件消息） */
  filePath?: string;

  /** 文件 ID（用于下载） */
  fileId?: string;

  /** 发送者 ID */
  senderId: number;

  /** 发送时间 */
  timestamp: Date;

  /** 命令参数（命令消息） */
  args?: string[];

  /** 原始消息对象 */
  raw: Update;
}

/**
 * 信号类型（与信号池系统对接）
 */
export interface Signal {
  /** 信号 ID */
  id: string;

  /** 信号类型 */
  type: SignalType;

  /** 信号来源 */
  source: SignalSource;

  /** 信号内容 */
  payload: Record<string, unknown>;

  /** 优先级 */
  priority: number;

  /** 创建时间 */
  createdAt: Date;

  /** 信任度要求 */
  requiredTrust: number;
}

export type SignalType = 'USER_INPUT' | 'COMMAND' | 'FILE' | 'SYSTEM';
export type SignalSource = 'telegram';
```

### 3.2 错误处理

```typescript
/**
 * Telegram 适配器错误类型
 */
export enum TelegramAdapterError {
  /** 无效的 Bot Token */
  INVALID_TOKEN = 'INVALID_TOKEN',

  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',

  /** 代理错误 */
  PROXY_ERROR = 'PROXY_ERROR',

  /** 消息发送失败 */
  SEND_FAILED = 'SEND_FAILED',

  /** 文件下载失败 */
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',

  /** Webhook 配置错误 */
  WEBHOOK_ERROR = 'WEBHOOK_ERROR',

  /** 消息处理超时 */
  MESSAGE_TIMEOUT = 'MESSAGE_TIMEOUT',

  /** 未知错误 */
  UNKNOWN = 'UNKNOWN'
}

/**
 * 适配器异常
 */
export class TelegramAdapterException extends Error {
  code: TelegramAdapterError;
  details?: Record<string, unknown>;

  constructor(code: TelegramAdapterError, message: string, details?: Record<string, unknown>);
}
```

---

## 4. 实现要求

### 4.1 性能要求

| 指标 | 要求 | 测量方式 |
|------|------|----------|
| 消息接收延迟 | < 1秒 | 从消息发送到信号发出的时间 |
| 消息发送成功率 | > 99% | 成功发送数 / 总发送数 |
| 并发处理能力 | > 10 条/秒 | 压力测试 |
| 内存占用 | < 100MB | 持续运行监控 |

### 4.2 可靠性要求

- 自动重连：断线后 5 秒内重试，指数退避（1s, 2s, 4s, 8s...）
- 消息去重：24 小时内相同 messageId 不重复处理
- 超时控制：单消息处理超时 30 秒
- 错误恢复：记录错误日志，自动恢复

### 4.3 安全要求

- Token 安全存储（环境变量）
- 代理认证支持（BasicAuth）
- 输入验证（防止注入攻击）
- 速率限制（防止滥用）

---

## 5. 测试策略

### 5.1 单元测试

| 测试项 | 测试内容 |
|--------|----------|
| 消息解析 | 文本、图片、语音、文件、命令 |
| 命令路由 | /start /status /allowance 等 |
| 消息去重 | 重复消息不重复处理 |
| 错误处理 | 网络错误、Token 错误等 |

### 5.2 集成测试

| 测试项 | 测试内容 |
|--------|----------|
| 消息收发 | 发送消息并验证接收 |
| 代理连接 | 通过代理连接 Telegram |
| 命令执行 | 完整命令处理流程 |
| 并发处理 | 多消息并发处理 |

### 5.3 E2E 测试（Playwright）

| 测试场景 | 验证点 |
|----------|--------|
| 消息发送 | 发送文本/图片，验证接收 |
| 命令响应 | 发送命令，验证响应 |
| 长时间运行 | 24 小时持续运行测试 |
| 网络恢复 | 模拟断线，验证重连 |

---

## 6. 验收标准

- [ ] 消息接收延迟 < 1秒
- [ ] 消息发送成功率 > 99%
- [ ] 支持 HTTP/SOCKS5 代理
- [ ] 自动重连（指数退避策略）
- [ ] 消息去重（防止重复处理）
- [ ] 命令注册机制（动态注册命令）
- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 测试通过

---

## 7. 相关文档

| 文档 | 路径 |
|------|------|
| Telegram Bot API | https://core.telegram.org/bots/api |
| GrammY 文档 | https://grammy.dev/ |
| PRD 需求 | pm/PRD.md (3.10 节) |
| 信号池系统 | docs/specs/SPEC-001_SIGNAL_POOL.md |

---

*创建日期：2026-01-29*
*版本：v1.0*
