# SPEC-401: 移动端 WebSocket 客户端

## 概述
在移动端实现 WebSocket 客户端，用于连接桌面端 WebSocket 服务端

## 设计理由
- 移动端需要与桌面端实时通信
- 使用 Tauri 插件调用原生 WebSocket 实现
- 统一协议，与桌面端服务端兼容

## 功能定义
1. 连接管理：建立、断开、重连
2. 消息发送：文本、二进制
3. 消息接收：回调处理
4. 状态管理：连接状态、错误处理

## 接口定义

### Rust 端 (Tauri Command)
```rust
#[tauri::command]
async fn ws_connect(url: String) -> Result<String, String>

#[tauri::command]
async fn ws_disconnect() -> Result<(), String>

#[tauri::command]
async fn ws_send(message: String) -> Result<(), String>
```

### 前端调用
```typescript
import { invoke } from '@tauri-apps/api/core';

await invoke('ws_connect', { url: 'ws://192.168.1.100:8080' });
await invoke('ws_send', { message: JSON.stringify(msg) });
```

## 验收标准
- [ ] 能成功连接桌面端 WebSocket 服务端
- [ ] 能发送和接收消息
- [ ] 断线后能自动重连
- [ ] 单元测试覆盖率 100%
