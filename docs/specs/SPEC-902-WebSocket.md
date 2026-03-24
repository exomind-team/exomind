# SPEC-902: WebSocket 模块重构

> **状态：已废弃** — 对应的 `src/lib/ws/` 模块已于 2026-03-15 删除。WebSocket 客户端功能已被 SSE 信号传输层替代。本规格保留为历史参考。

## 设计理由

当前模块缺乏错误处理、消息队列和重连机制，需要统一重构。

## 功能定义

### WebSocketErrorCode 错误码

```typescript
enum WebSocketErrorCode {
  // 连接错误
  ERR_CONNECTION_FAILED = 'WS_001',
  ERR_CONNECTION_TIMEOUT = 'WS_002',
  ERR_CONNECTION_REFUSED = 'WS_003',
  ERR_INVALID_URL = 'WS_004',

  // 状态错误
  ERR_NOT_CONNECTED = 'WS_010',
  ERR_ALREADY_CONNECTED = 'WS_011',
  ERR_STILL_CONNECTING = 'WS_012',

  // 发送错误
  ERR_SEND_FAILED = 'WS_020',
  ERR_MESSAGE_QUEUE_FULL = 'WS_021',

  // 接收错误
  ERR_MESSAGE_PARSE_FAILED = 'WS_030',
  ERR_MESSAGE_HANDLER_ERROR = 'WS_031',

  // 重连错误
  ERR_RECONNECT_FAILED = 'WS_040',
  ERR_RECONNECT_MAX_ATTEMPTS = 'WS_041',

  // 通用错误
  ERR_UNKNOWN = 'WS_999',
}
```

### MessageQueue 消息队列

```typescript
class MessageQueue<T = string> {
  // 队列操作
  enqueue(message: T, priority?: number): boolean;
  dequeue(): T | null;
  peek(): T | null;
  clear(): void;

  // 状态查询
  size(): number;
  isEmpty(): boolean;
  isFull(): boolean;

  // 批量操作
  flush(): T[];
}
```

### ReconnectPolicy 重连策略

```typescript
interface ReconnectPolicy {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldReconnect(error: WebSocketError): boolean;
}
```

## 输入输出

| 操作 | 输入 | 输出 |
|------|------|------|
| connect | url: string, options?: ConnectOptions | Promise<ConnectionResult> |
| disconnect | reason?: string | Promise<void> |
| send | message: T | Promise<void> |
| on | event: string, handler: Function | Unsubscribe |
| off | event: string, handler?: Function | void |

## 验收标准

- [ ] 统一错误码定义（前端+后端）
- [ ] 消息队列支持优先级
- [ ] 自动重连（指数退避）
- [ ] 事件系统支持订阅/取消
- [ ] 单元测试覆盖 100%

## 依赖

无外部依赖
