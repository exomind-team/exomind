# ADR-004: 重构 WebSocket 模块 - 统一错误码 + 消息队列 + 重连机制

> **状态：已废弃** — `src/lib/ws/` WebSocket 客户端模块已于 2026-03-15 删除，信号传输已迁移至 SSE (Server-Sent Events)。本 ADR 保留为历史决策记录。

## 状态

已批准

## 背景

当前 WebSocket 模块 (`src/lib/sync/websocket-client.ts`, `src-tauri/src/commands/ws_commands.rs`) 存在以下问题：
1. 缺乏统一的错误码定义
2. 没有消息队列管理
3. 没有自动重连机制
4. 事件回调系统不完整
5. 前后端错误处理不一致

## 决策

创建统一的 WebSocket 模块，包含：
1. 错误码枚举 (`WebSocketErrorCode`)
2. 消息队列 (`MessageQueue`)
3. 自动重连机制 (`ReconnectPolicy`)
4. 事件系统 (`EventEmitter`)
5. 统一的状态机 (`WebSocketState`)

## 影响

- 新增文件：`src/lib/sync/ws-errors.ts`, `src/lib/sync/ws-queue.ts`, `src/lib/sync/ws-events.ts`
- 修改文件：`src/lib/sync/websocket-client.ts`, `src-tauri/src/commands/ws_commands.rs`
