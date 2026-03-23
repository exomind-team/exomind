# ExoMind API Reference

> ExoMind Tauri 后端命令 API 文档
> 版本: v1.0
> 更新日期: 2026-02-04

---

## 目录

1. [WebSocket 命令](#websocket-命令)
2. [文件操作命令](#文件操作命令)
3. [配对命令](#配对命令)
4. [网络命令](#网络命令)
5. [使用示例](#使用示例)

---

## WebSocket 命令

> 文件: `src-tauri/src/commands/ws_commands.rs`

用于移动端连接桌面端 WebSocket 服务器。

### 类型定义

```rust
// 连接状态
enum ConnectionState {
    Disconnected,      // 未连接
    Connecting,        // 连接中
    Connected(String), // 已连接 (URL)
}
```

### ws_connect

连接 WebSocket 服务器（手机端连接电脑端）。

**签名:**
```rust
async fn ws_connect(url: String) -> Result<String, String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | String | 是 | WebSocket 服务器地址，如 `ws://192.168.1.100:1949` |

**返回值:**
- `Ok("Connected to <url>")`: 连接成功
- `Err("Already connected")`: 已连接同一地址
- `Err("Invalid URL: <error>")`: URL 格式错误
- `Err("Connection failed: <error>")`: 连接失败

**示例:**
```typescript
import { invoke } from '@tauri-apps/api/core';

try {
  const result = await invoke('ws_connect', {
    url: 'ws://192.168.1.100:1949'
  });
  console.log(result); // "Connected to ws://192.168.1.100:1949"
} catch (e) {
  console.error(e);
}
```

---

### ws_disconnect

断开 WebSocket 连接。

**签名:**
```rust
async fn ws_disconnect() -> Result<String, String>
```

**返回值:**
- `Ok("Disconnected")`: 成功断开

**示例:**
```typescript
await invoke('ws_disconnect');
```

---

### ws_send

发送 WebSocket 消息。

**签名:**
```rust
async fn ws_send(message: String) -> Result<(), String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | String | 是 | 要发送的消息内容 (JSON 字符串) |

**返回值:**
- `Ok(())`: 发送成功
- `Err("Not connected")`: 未连接
- `Err("Still connecting")`: 连接中
- `Err("Send failed: <error>")`: 发送失败

**消息格式:**
```json
{
  "type": "message",
  "payload": {
    "id": "msg_123",
    "content": "Hello",
    "timestamp": 1707062400000,
    "direction": "outgoing",
    "senderId": "device_a",
    "receiverId": "device_b"
  }
}
```

**示例:**
```typescript
const message = JSON.stringify({
  type: 'message',
  payload: {
    id: crypto.randomUUID(),
    content: 'Hello from mobile',
    timestamp: Date.now(),
    direction: 'outgoing',
    senderId: 'my-device',
    receiverId: 'desktop'
  }
});

await invoke('ws_send', { message });
```

---

### ws_get_state

获取当前连接状态。

**签名:**
```rust
async fn ws_get_state() -> Result<String, String>
```

**返回值:**
| 返回值 | 说明 |
|--------|------|
| `"connected:<url>"` | 已连接 |
| `"connecting"` | 连接中 |
| `"disconnected"` | 未连接 |

**示例:**
```typescript
const state = await invoke('ws_get_state');
// "connected:ws://192.168.1.100:1949"
```

---

## 文件操作命令

> 文件: `src-tauri/src/commands/file_commands.rs`

用于消息持久化存储和导出。

### append_file

追加内容到文件（永覆盖）。

**签名:**
```rust
async fn append_file(path: String, content: String) -> Result<(), String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | String | 是 | 文件路径（相对于应用数据目录） |
| content | String | 是 | 要追加的内容 |

**存储目录:**
- Windows: `%APPDATA%/exomind/.exomind/`
- macOS: `~/Library/Application Support/exomind/.exomind/`
- Linux: `~/.local/share/exomind/.exomind/`
- Android: 应用私有目录

**示例:**
```typescript
// 追加消息到消息日志
await invoke('append_file', {
  path: 'messages.jsonl',
  content: JSON.stringify(message)
});
```

---

### write_file

写入文件（覆盖模式）。

**签名:**
```rust
async fn write_file(path: String, content: String) -> Result<(), String>
```

**示例:**
```typescript
// 保存配置文件
await invoke('write_file', {
  path: 'config/settings.json',
  content: JSON.stringify(config)
});
```

---

### read_file

读取文件内容。

**签名:**
```rust
async fn read_file(path: String) -> Result<String, String>
```

**返回值:** 文件内容字符串

**示例:**
```typescript
const messages = await invoke('read_file', {
  path: 'messages.jsonl'
});
```

---

### file_exists

检查文件是否存在。

**签名:**
```rust
async fn file_exists(path: String) -> Result<bool, String>
```

---

### list_files

列出目录中的文件。

**签名:**
```rust
async fn list_files(dir: String) -> Result<Vec<String>, String>
```

---

### append_to_markdown

追加内容到 Markdown 文件。

**签名:**
```rust
async fn append_to_markdown(filename: String, content: String) -> Result<(), String>
```

---

### export_messages_to_markdown

导出消息记录到 Markdown 文件。

**签名:**
```rust
async fn export_messages_to_markdown(
  filename: String,
  title: String,
  messages: String  // JSON 序列化的消息数组
) -> Result<(), String>
```

**消息格式:**
```json
[
  {
    "id": "msg_1",
    "content": "Hello",
    "timestamp": 1707062400000,
    "direction": "outgoing",
    "senderId": "device_a",
    "receiverId": "device_b"
  }
]
```

---

## 配对命令

> 文件: `src-tauri/src/commands/pairing_commands.rs`

用于设备间安全配对。

### 类型定义

```rust
struct PairingRequest {
    code: String,         // 6位数字配对码
    device_name: String,  // 设备名称
    device_ip: String,    // 设备 IP:Port
    public_key: String,   // 公钥
    created_at: DateTime, // 创建时间
}

struct PairedDevice {
    id: String,        // 设备 ID (公钥)
    name: String,     // 设备名称
    ip: String,       // 设备地址
    public_key: String,
    paired_at: DateTime,
}
```

---

### generate_pairing_code

生成 6 位数字配对码。

**签名:**
```rust
async fn generate_pairing_code(
    device_name: String,
    device_ip: String,
    public_key: String
) -> Result<String, String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_name | String | 是 | 本机设备名称 |
| device_ip | String | 是 | 本机地址，如 `192.168.1.100:1949` |
| public_key | String | 是 | 本机公钥（用于加密通信） |

**返回值:**
- `Ok("<6位数字>")`: 配对码
- `Err(...)`: 失败

**有效期:** 5 分钟

**示例:**
```typescript
const code = await invoke('generate_pairing_code', {
  deviceName: 'My Laptop',
  deviceIp: '192.168.1.100:1949',
  publicKey: '-----BEGIN PUBLIC KEY...'
});
// "123456"
```

---

### confirm_pairing

确认配对请求。

**签名:**
```rust
async fn confirm_pairing(code: String, accept: bool) -> Result<bool, String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | String | 是 | 对方显示的 6 位配对码 |
| accept | bool | 是 | true = 接受, false = 拒绝 |

**返回值:**
- `Ok(true)`: 接受成功
- `Ok(false)`: 拒绝成功
- `Err("配对码已过期")`: 超过 5 分钟
- `Err("配对码无效")`: 配对码不存在

---

### get_pairing_requests

获取所有待确认的配对请求。

**签名:**
```rust
async fn get_pairing_requests() -> Result<Vec<PairingRequest>, String>
```

---

### get_paired_devices

获取所有已配对的设备。

**签名:**
```rust
async fn get_paired_devices() -> Result<Vec<PairedDevice>, String>
```

---

### remove_paired_device

移除已配对的设备。

**签名:**
```rust
async fn remove_paired_device(device_id: String) -> Result<bool, String>
```

---

### clear_pairing_requests

清除所有待确认的配对请求。

**签名:**
```rust
async fn clear_pairing_requests() -> Result<(), String>
```

---

## 网络命令

> 文件: `src-tauri/src/commands/network_commands.rs`

用于获取本机网络信息。

### get_local_ip_with_current_port

获取本机 IP（保持当前端口）。

**签名:**
```rust
fn get_local_ip_with_current_port(port: u16) -> Result<String, String>
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| port | number | 是 | 端口号 |

**返回值:**
- `Ok("192.168.1.100:1949")`: 本机地址
- `Err("端口 <port> 不可用")`: 端口被占用
- `Err("无法获取本机 IP")`: 获取失败

**特点:**
- 使用原生 UDP Socket（不依赖外部库）
- 排除 TUN/VPN 虚拟接口 (198.18.x.x)
- 排除回环地址 (127.x.x.x)

**示例:**
```typescript
const result = await invoke('get_local_ip_with_current_port', { port: 1949 });
// "192.168.1.100:1949"
```

---

### get_local_ip_with_random_port

获取本机 IP（随机可用端口）。

**签名:**
```rust
fn get_local_ip_with_random_port() -> Result<String, String>
```

**端口范围:** 1949 - 2026（ExoMind 专用端口段）

**返回值:**
- `Ok("192.168.1.100:2015")`: 本机地址（随机端口）
- `Err("无法找到可用端口")`: 所有端口都被占用

**示例:**
```typescript
const result = await invoke('get_local_ip_with_random_port');
// "192.168.1.100:2015"
```

---

### check_network_status

检查网络连接状态。

**签名:**
```rust
fn check_network_status() -> Result<bool, String>
```

**返回值:**
- `Ok(true)`: 网络可用
- `Err(...)`: 网络不可用

---

## 使用示例

### 完整配对流程

```typescript
// 1. 生成配对码（发起端）
const code = await invoke('generate_pairing_code', {
  deviceName: 'My Phone',
  deviceIp: '192.168.1.105:1949',
  publicKey: publicKey
});

// 2. 显示配对码给用户
console.log(`请在电脑上输入配对码: ${code}`);

// 3. 等待确认...（通过 get_pairing_requests 获取请求）
```

```typescript
// 电脑端：确认配对
const requests = await invoke('get_pairing_requests');
if (requests.length > 0) {
  // 显示请求让用户确认
  await invoke('confirm_pairing', {
    code: requests[0].code,
    accept: true
  });
}
```

### 消息发送流程

```typescript
// 1. 连接
await invoke('ws_connect', { url: 'ws://192.168.1.100:1949' });

// 2. 发送消息
await invoke('ws_send', { message: JSON.stringify(msg) });

// 3. 检查状态
const state = await invoke('ws_get_state');
```

---

## 错误处理

所有命令都返回 `Result<T, String>`，错误信息为中文描述。

```typescript
try {
  await invoke('ws_connect', { url: 'ws://invalid:port' });
} catch (error) {
  // error = "Invalid URL: empty host"
  console.error(error);
}
```

---

## 前端调用方式

```typescript
import { invoke } from '@tauri-apps/api/core';

// 异步调用
const result = await invoke<ReturnType>('command_name', { arg1, arg2 });

// TypeScript 类型
interface WsState {
  state: 'connected' | 'connecting' | 'disconnected';
  url?: string;
}
```
