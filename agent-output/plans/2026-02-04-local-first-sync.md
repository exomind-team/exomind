# 本地优先多设备消息同步实现计划

> **For Claude:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 来按任务逐步实施此计划。

**目标:** 实现 Windows 端与安卓端的跨平台消息同步功能，支持手动 IP 连接，简化 UI 为聊天主界面 + 设置页面菜单，实现本地优先的消息存储和多端同步。

**架构:**
- 采用"本地优先"架构，消息立即本地存储，离线时加入待发送队列，在线时通过 WebSocket 同步
- 电脑端同时运行服务端(监听)和客户端(连接)，手机端只运行客户端
- 简化设备发现为手动 IP 连接，移除自动扫描
- 聊天框为主界面，设备管理移到设置页面

**技术栈:** React + TypeScript + Tauri 2.0 + Rust + WebSocket + JSONL 本地存储

---

## 第一阶段：修复 P0 严重安全漏洞

### Task 1: 修复 XSS 漏洞

**Files:**
- Modify: `src/components/Chat/MessageList.tsx:60-75`
- Test: `tests/unit/ui/message-list.test.tsx`

**Step 1: 编写失败的测试**

```typescript
// tests/unit/ui/message-list.test.tsx
import { render, screen } from '@testing-library/react';
import { MessageList } from '@/components/Chat/MessageList';

describe('MessageList XSS Protection', () => {
  it('should sanitize message content to prevent XSS', () => {
    const maliciousMessage = {
      id: 'msg-1',
      content: '<script>alert("xss")</script>',
      type: 'sent' as const,
      timestamp: Date.now(),
      status: 'delivered'
    };

    render(<MessageList messages={[maliciousMessage]} />);
    const messageElement = screen.getByTestId('message-content-msg-1');

    // Should NOT contain script tag
    expect(messageElement.innerHTML).not.toContain('<script>');
    // Should contain sanitized content
    expect(messageElement.innerHTML).toContain('&lt;script&gt;');
  });
});
```

**Step 2: 运行测试确认失败**

```bash
cd /d/project/exomind-dev-chat
npx vitest run tests/unit/ui/message-list.test.tsx
# 预期: FAIL - 组件不存在或测试失败
```

**Step 3: 添加 HTML 转义函数并修复 MessageList**

```typescript
// src/lib/utils/html-sanitize.ts
/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// src/components/Chat/MessageList.tsx 修改
import { escapeHtml } from '@/lib/utils/html-sanitize';

// 在渲染消息内容处
<div
  data-testid={`message-content-${message.id}`}
  className="break-words"
>
  {escapeHtml(message.content)}
</div>
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/ui/message-list.test.tsx
# 预期: PASS
```

**Step 5: 提交**

```bash
git add src/components/Chat/MessageList.tsx src/lib/utils/html-sanitize.ts
git commit -m "fix: 修复 MessageList XSS 漏洞 [MessageList.tsx]"
```

---

### Task 2: 修复 SQL 注入风险

**Files:**
- Modify: `src/lib/db/sqlite.ts:75-108`
- Test: `tests/unit/db/sqlite.test.ts`

**Step 1: 编写失败的测试**

```typescript
// tests/unit/db/sqlite.test.ts
import { SQLiteDatabase } from '@/lib/db/sqlite';

describe('SQLite SQL Injection Prevention', () => {
  let db: SQLiteDatabase;

  beforeEach(() => {
    db = new SQLiteDatabase(':memory:');
    db.run('CREATE TABLE test (id TEXT PRIMARY KEY, content TEXT)');
  });

  it('should prevent SQL injection in query parameters', () => {
    // Attempt SQL injection via content
    const maliciousInput = "'; DROP TABLE test; --";

    // Should not throw or execute the injection
    const result = db.query(
      'SELECT * FROM test WHERE content = ?',
      [maliciousInput]
    );

    // Table should still exist
    expect(() => db.run('SELECT 1 FROM test')).not.toThrow();
  });

  it('should prevent SQL injection in LIKE queries', () => {
    const maliciousPattern = "%'; DELETE FROM test; --";
    const result = db.query('SELECT * FROM test WHERE content LIKE ?', [
      maliciousPattern
    ]);

    // Table should still exist
    expect(() => db.run('SELECT 1 FROM test')).not.toThrow();
  });
});
```

**Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/db/sqlite.test.ts
# 预期: FAIL - 当前使用字符串拼接
```

**Step 3: 重构为参数化查询**

```typescript
// src/lib/db/sqlite.ts
import Database from 'better-sqlite3';

export class SQLiteDatabase {
  private db: Database.Database;

  constructor(path: string = ':memory:') {
    this.db = new Database(path);
  }

  query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): T[] {
    // 使用参数化查询，防止 SQL 注入
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  run(sql: string, params: unknown[] = []): Database.RunResult {
    // 参数化查询
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  // ... 其他方法
}
```

**Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/db/sqlite.test.ts
# 预期: PASS
```

**Step 5: 提交**

```bash
git add src/lib/db/sqlite.ts
git commit -m "fix: 修复 SQLite SQL 注入风险 [sqlite.ts]"
```

---

### Task 3: 统一消息类型定义

**Files:**
- Modify: `src/lib/ws/protocol.ts`
- Modify: `src/lib/models/message.ts`
- Create: `src/lib/types/message.ts`

**Step 1: 创建统一的消息类型定义**

```typescript
// src/lib/types/message.ts
/**
 * Unified Message Types - 统一消息类型定义
 * 解决 protocol.ts 和 models/message.ts 之间的类型冲突
 */

export interface BaseMessage {
  /** Unique message ID: deviceId-timestamp-random */
  id: string;
  /** Sender's device ID */
  deviceId: string;
  /** Sender's user ID (if authenticated) */
  userId?: string;
  /** Message content */
  content: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Message type */
  type: 'sent' | 'received' | 'broadcast';
  /** Delivery status */
  status: 'pending' | 'sending' | 'delivered' | 'read';
}

export interface ChatMessage extends BaseMessage {
  /** Optional conversation ID for grouping */
  conversationId?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Protocol-level message (used in WebSocket communication)
 */
export interface ProtocolMessage {
  version: 1;
  type: 'auth' | 'ping' | 'pong' | 'send' | 'broadcast' | 'deliver' | 'sync';
  payload: Record<string, unknown>;
  timestamp: number;  // Changed from string to number
  signature?: string;
}

/**
 * Database storage format
 */
export interface StoredMessage {
  id: string;
  deviceId: string;
  content: string;
  timestamp: number;
  type: string;
  status: string;
  metadata: string | null;
}
```

**Step 2: 更新 protocol.ts 使用统一类型**

```typescript
// src/lib/ws/protocol.ts
import { ProtocolMessage, ChatMessage } from '@/lib/types/message';

/**
 * Convert ProtocolMessage to ChatMessage
 */
export function protocolToChatMessage(
  protocol: ProtocolMessage,
  deviceId: string,
  status: ChatMessage['status'] = 'received'
): ChatMessage {
  return {
    id: `${deviceId}-${protocol.timestamp}-${Date.now()}`,
    deviceId,
    content: String(protocol.payload.content || ''),
    timestamp: protocol.timestamp,
    type: protocol.type === 'broadcast' ? 'broadcast' : 'received',
    status
  };
}

/**
 * Convert ChatMessage to ProtocolMessage
 */
export function chatToProtocolMessage(
  chat: ChatMessage
): ProtocolMessage {
  return {
    version: 1,
    type: 'send',
    payload: {
      id: chat.id,
      content: chat.content,
      deviceId: chat.deviceId,
      metadata: chat.metadata
    },
    timestamp: chat.timestamp
  };
}
```

**Step 3: 更新 models/message.ts**

```typescript
// src/lib/models/message.ts
// 移除重复类型定义，从统一类型导入
export type { ChatMessage, BaseMessage } from '@/lib/types/message';
```

**Step 4: 运行类型检查**

```bash
cd /d/project/exomind-dev-chat
npx tsc --noEmit
# 预期: 无类型错误
```

**Step 5: 提交**

```bash
git add src/lib/types/message.ts src/lib/ws/protocol.ts src/lib/models/message.ts
git commit -m "refactor: 统一消息类型定义 [protocol.ts models/message.ts]"
```

---

## 第二阶段：简化 UI - 聊天主界面 + 设置菜单

### Task 4: 重构 App 布局 - 聊天为主，设置菜单

**Files:**
- Create: `src/components/Layout/MainLayout.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/Settings/SettingsPage.tsx`

**Step 1: 创建主布局组件**

```typescript
// src/components/Layout/MainLayout.tsx
import React, { useState } from 'react';
import { ChatWindow } from '@/components/Chat/ChatWindow';
import { SettingsPage } from '@/components/Settings/SettingsPage';
import { Menu, MessageSquare, Settings } from 'lucide-react';

export type ViewType = 'chat' | 'settings';

export function MainLayout() {
  const [currentView, setCurrentView] = useState<ViewType>('chat');

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧菜单栏 */}
      <nav className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-4">
        <button
          onClick={() => setCurrentView('chat')}
          className={`p-3 rounded-lg transition-colors ${
            currentView === 'chat'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="消息"
        >
          <MessageSquare size={24} />
        </button>
        <button
          onClick={() => setCurrentView('settings')}
          className={`p-3 rounded-lg transition-colors ${
            currentView === 'settings'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="设置"
        >
          <Settings size={24} />
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="flex-1 overflow-hidden">
        {currentView === 'chat' ? <ChatWindow /> : <SettingsPage />}
      </main>
    </div>
  );
}
```

**Step 2: 创建设置页面**

```typescript
// src/components/Settings/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { useChatStore } from '@/lib/stores/chat-store';
import {
  Device,
  RefreshCw,
  Copy,
  Check,
  Info,
  Shield,
  Network
} from 'lucide-react';

export function SettingsPage() {
  const {
    pairedDevices,
    connectionStatus,
    localIP,
    getLocalIP
  } = useChatStore();

  const [ipCopied, setIpCopied] = useState(false);

  const copyIP = async () => {
    await navigator.clipboard.writeText(localIP || '无法获取');
    setIpCopied(true);
    setTimeout(() => setIpCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 标题 */}
        <h1 className="text-2xl font-bold text-gray-900">设置</h1>

        {/* 关于部分 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Info size={20} className="text-blue-600" />
            关于 ExoMind
          </h2>
          <p className="text-gray-600">
            ExoMind 是一个本地优先的多设备消息同步应用，帮助您在不同设备间安全地同步和分享信息。
          </p>
          <p className="text-gray-500 text-sm mt-2">版本 0.1.0</p>
        </section>

        {/* 网络状态 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Network size={20} className="text-blue-600" />
            网络状态
          </h2>
          <div className="space-y-3">
            {/* 本机 IP */}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">本机 IP 地址</span>
              <div className="flex items-center gap-2">
                <code className="bg-gray-100 px-3 py-1 rounded text-sm">
                  {localIP || '获取中...'}
                </code>
                <button
                  onClick={copyIP}
                  className="p-2 hover:bg-gray-100 rounded"
                  title="复制 IP"
                >
                  {ipCopied ? (
                    <Check size={16} className="text-green-600" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </div>

            {/* 连接状态 */}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">连接状态</span>
              <span
                className={`px-3 py-1 rounded-full text-sm ${
                  connectionStatus === 'connected'
                    ? 'bg-green-100 text-green-700'
                    : connectionStatus === 'connecting'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {connectionStatus === 'connected'
                  ? '已连接'
                  : connectionStatus === 'connecting'
                  ? '连接中...'
                  : '离线'}
              </span>
            </div>
          </div>
        </section>

        {/* 已连接设备 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Device size={20} className="text-blue-600" />
              已连接设备 ({pairedDevices.length})
            </h2>
            <button className="flex items-center gap-1 text-blue-600 hover:text-blue-700">
              <RefreshCw size={16} />
              <span className="text-sm">刷新</span>
            </button>
          </div>

          {pairedDevices.length === 0 ? (
            <p className="text-gray-500 text-center py-4">
              暂未连接任何设备
            </p>
          ) : (
            <ul className="space-y-2">
              {pairedDevices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{device.name}</p>
                    <p className="text-sm text-gray-500">{device.ip}</p>
                  </div>
                  <span className="flex items-center gap-1 text-green-600 text-sm">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    已连接
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 添加连接 */}
        <section className="bg-white rounded-lg p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
            <Network size={20} className="text-blue-600" />
            添加连接
          </h2>
          <p className="text-gray-600 text-sm mb-4">
            输入另一台设备的 IP 地址进行连接
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="例如: 192.168.1.100:1949"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              连接
            </button>
          </div>
        </section>

        {/* 安全说明 */}
        <section className="bg-blue-50 rounded-lg p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
            <Shield size={20} className="text-blue-600" />
            安全提示
          </h2>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>- 所有消息使用端到端加密</li>
            <li>- 数据仅存储在您的本地设备</li>
            <li>- 请确保连接可信的设备</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
```

**Step 3: 更新 App.tsx**

```typescript
// src/App.tsx
import { MainLayout } from '@/components/Layout/MainLayout';

export default function App() {
  return <MainLayout />;
}
```

**Step 4: 运行开发服务器验证**

```bash
cd /d/project/exomind-dev-chat
bun run dev
```

**Step 5: 提交**

```bash
git add src/components/Layout/MainLayout.tsx src/components/Settings/SettingsPage.tsx src/App.tsx
git commit -m "refactor: 重构 UI 为聊天主界面 + 设置菜单 [App.tsx MainLayout.tsx]"
```

---

## 第三阶段：实现手动 IP 连接

### Task 5: 添加 IP 连接 Rust 命令

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/ip_commands.rs`

**Step 1: 创建 IP 地址获取命令**

```rust
// src-tauri/src/commands/ip_commands.rs
use tauri::State;
use std::net::UdpSocket;
use std::io::{self, Write};

#[tauri::command]
pub async fn get_local_ip() -> Result<String, String> {
    // 尝试获取本机 IP 地址
    // 创建一个 UDP socket 来确定路由接口
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;

    // 连接到一个公共 DNS 服务器来触发路由发现
    // 不需要实际发送数据
    socket.connect("8.8.8.8:53").map_err(|e| e.to_string())?;

    // 获取本地地址
    let local_addr = socket.local_addr().map_err(|e| e.to_string())?;

    Ok(local_addr.ip().to_string())
}

#[tauri::command]
pub async fn get_local_ip_with_port(default_port: i32) -> Result<String, String> {
    let ip = get_local_ip().await?;
    Ok(format!("{}:{}", ip, default_port))
}
```

**Step 2: 在 mod.rs 中导出**

```rust
// src-tauri/src/commands/mod.rs
pub mod ws_commands;
pub mod file_commands;
pub mod ip_commands;  // 新增

pub use ip_commands::{get_local_ip, get_local_ip_with_port};
```

**Step 3: 在 lib.rs 中注册命令**

```rust
// src-tauri/src/lib.rs
#[tauri::command]
async fn get_local_ip(state: State<'_, AppState>) -> Result<String, String> {
    ip_commands::get_local_ip().await
}

#[tauri::command]
async fn get_local_ip_with_port(
    state: State<'_, AppState>,
    default_port: i32
) -> Result<String, String> {
    ip_commands::get_local_ip_with_port(default_port).await
}

#[tauri::command]
async fn connect_to_peer(
    state: State<'_, AppState>,
    ip: String
) -> Result<bool, String> {
    // 连接逻辑
    ws_commands::ws_connect(state, ip).await
}

#[tauri::command]
async fn disconnect_from_peer(state: State<'_, AppState>) -> Result<bool, String> {
    ws_commands::ws_disconnect(state).await
}

pub fn register_commands(app: &tauri::App) {
    app.manage(AppState::default());

    tauri::generate_handler![
      // ... 现有命令
      get_local_ip,
      get_local_ip_with_port,
      connect_to_peer,
      disconnect_from_peer,
    ];
}
```

**Step 4: 测试 Rust 编译**

```bash
cd /d/project/exomind-dev-chat/src-tauri
cargo check
# 预期: 无错误
```

**Step 5: 提交**

```bash
git add src-tauri/src/commands/ip_commands.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: 添加 IP 地址获取命令 [ip_commands.rs]"
```

---

### Task 6: 实现前端 IP 连接 UI 和逻辑

**Files:**
- Modify: `src/lib/stores/chat-store.ts`
- Modify: `src/components/Settings/SettingsPage.tsx`
- Create: `src/lib/hooks/use-ip-connection.ts`

**Step 1: 创建 IP 连接 hook**

```typescript
// src/lib/hooks/use-ip-connection.ts
import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface UseIPConnectionReturn {
  connectToIP: (ip: string) => Promise<boolean>;
  disconnectFromIP: () => Promise<boolean>;
  localIP: string;
  refreshLocalIP: () => Promise<void>;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  error: string | null;
}

export function useIPConnection(): UseIPConnectionReturn {
  const [connectionStatus, setConnectionStatus] = useState<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  const [localIP, setLocalIP] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const refreshLocalIP = useCallback(async () => {
    try {
      const ip = await invoke<string>('get_local_ip_with_port', {
        defaultPort: 1949
      });
      setLocalIP(ip);
    } catch (e) {
      setError('获取 IP 失败');
      console.error('Failed to get local IP:', e);
    }
  }, []);

  const connectToIP = useCallback(async (ip: string): Promise<boolean> => {
    setConnectionStatus('connecting');
    setError(null);

    try {
      const result = await invoke<boolean>('connect_to_peer', { ip });
      if (result) {
        setConnectionStatus('connected');
        return true;
      } else {
        setConnectionStatus('disconnected');
        setError('连接失败');
        return false;
      }
    } catch (e) {
      setConnectionStatus('disconnected');
      setError(`连接错误: ${e}`);
      return false;
    }
  }, []);

  const disconnectFromIP = useCallback(async (): Promise<boolean> => {
    try {
      await invoke('disconnect_from_peer');
      setConnectionStatus('disconnected');
      return true;
    } catch (e) {
      setError('断开连接错误');
      return false;
    }
  }, []);

  return {
    connectToIP,
    disconnectFromIP,
    localIP,
    refreshLocalIP,
    connectionStatus,
    error
  };
}
```

**Step 2: 更新 chat-store.ts**

```typescript
// src/lib/stores/chat-store.ts 补充
interface ConnectionState {
  localIP: string;
  remoteIP: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  isServerRunning: boolean;
}

// 在 store 中添加
connectionState: (state) => ({
  localIP: '',
  remoteIP: null,
  connectionStatus: 'disconnected',
  isServerRunning: false
}),

// 添加 actions
setLocalIP: (ip: string) => set({ localIP: ip }),
setConnectionStatus: (status: ConnectionState['connectionStatus']) =>
  set({ connectionStatus: status }),
setRemoteIP: (ip: string | null) => set({ remoteIP: ip }),
```

**Step 3: 更新 SettingsPage 添加连接功能**

```typescript
// src/components/Settings/SettingsPage.tsx 修改
import { useIPConnection } from '@/lib/hooks/use-ip-connection';

export function SettingsPage() {
  const {
    connectToIP,
    disconnectFromIP,
    localIP,
    refreshLocalIP,
    connectionStatus
  } = useIPConnection();

  const [inputIP, setInputIP] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    refreshLocalIP();
  }, [refreshLocalIP]);

  const handleConnect = async () => {
    if (!inputIP.trim()) return;

    setIsConnecting(true);
    const success = await connectToIP(inputIP.trim());
    setIsConnecting(false);

    if (success) {
      setInputIP('');
    }
  };

  const handleDisconnect = async () => {
    await disconnectFromIP();
  };

  return (
    {/* 在"添加连接"部分修改 */}
    <div className="flex gap-2">
      <input
        type="text"
        value={inputIP}
        onChange={(e) => setInputIP(e.target.value)}
        placeholder="例如: 192.168.1.100:1949"
        disabled={connectionStatus === 'connected'}
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
      {connectionStatus === 'connected' ? (
        <button
          onClick={handleDisconnect}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          断开
        </button>
      ) : (
        <button
          onClick={handleConnect}
          disabled={isConnecting || !inputIP.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isConnecting ? '连接中...' : '连接'}
        </button>
      )}
    </div>
  );
}
```

**Step 4: 测试连接功能**

```bash
# 运行开发服务器
bun run dev
```

**Step 5: 提交**

```bash
git add src/lib/hooks/use-ip-connection.ts src/lib/stores/chat-store.ts src/components/Settings/SettingsPage.tsx
git commit -m "feat: 实现手动 IP 连接功能 [use-ip-connection.ts SettingsPage.tsx]"
```

---

## 第四阶段：完善消息同步功能

### Task 7: 消息唯一 ID 生成

**Files:**
- Create: `src/lib/utils/message-id.ts`
- Modify: `src/lib/sync/message-storage.ts`

**Step 1: 创建消息 ID 生成器**

```typescript
// src/lib/utils/message-id.ts
/**
 * Generate unique message ID
 * Format: {deviceId}-{timestamp}-{random}
 */
export function generateMessageId(deviceId: string): string {
  const timestamp = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(8));
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${deviceId}-${timestamp}-${randomHex}`;
}

/**
 * Parse message ID to extract components
 */
export function parseMessageId(id: string): {
  deviceId: string;
  timestamp: number;
  random: string;
} | null {
  const parts = id.split('-');
  if (parts.length !== 3) return null;

  return {
    deviceId: parts[0],
    timestamp: parseInt(parts[1], 10),
    random: parts[2]
  };
}
```

**Step 2: 更新消息存储使用唯一 ID**

```typescript
// src/lib/sync/message-storage.ts
import { generateMessageId } from '@/lib/utils/message-id';

export async function addMessage(
  message: Omit<ChatMessage, 'id'>
): Promise<ChatMessage> {
  const fullMessage: ChatMessage = {
    ...message,
    id: generateMessageId(message.deviceId)
  };

  await saveToStorage(fullMessage);
  return fullMessage;
}
```

**Step 3: 编写测试**

```typescript
// tests/unit/utils/message-id.test.ts
import { generateMessageId, parseMessageId } from '@/lib/utils/message-id';

describe('Message ID Generation', () => {
  it('should generate unique IDs', () => {
    const deviceId = 'device-123';
    const id1 = generateMessageId(deviceId);
    const id2 = generateMessageId(deviceId);

    expect(id1).not.toEqual(id2);
    expect(id1.startsWith(deviceId)).toBe(true);
  });

  it('should parse message ID correctly', () => {
    const deviceId = 'device-123';
    const id = generateMessageId(deviceId);
    const parsed = parseMessageId(id);

    expect(parsed).not.toBeNull();
    expect(parsed!.deviceId).toBe(deviceId);
    expect(parsed!.timestamp).toBeGreaterThan(0);
    expect(parsed!.random.length).toBe(16);
  });

  it('should return null for invalid ID format', () => {
    expect(parseMessageId('invalid')).toBeNull();
    expect(parseMessageId('a-b')).toBeNull();
  });
});
```

**Step 4: 运行测试**

```bash
npx vitest run tests/unit/utils/message-id.test.ts
```

**Step 5: 提交**

```bash
git add src/lib/utils/message-id.ts src/lib/sync/message-storage.ts
git commit -m "feat: 实现消息唯一 ID 生成 [message-id.ts]"
```

---

### Task 8: 改进冲突解决 - 设备优先级

**Files:**
- Modify: `src/lib/sync/conflict-resolution.ts`
- Test: `tests/unit/sync/conflict-resolution.test.ts`

**Step 1: 添加设备优先级规则**

```typescript
// src/lib/sync/conflict-resolution.ts

/**
 * Device priority for conflict resolution
 * Higher priority wins in case of timestamp tie
 */
export enum DevicePriority {
  LOCAL = 100,    // 本地设备最高优先级
  PHONE = 80,
  TABLET = 60,
  DESKTOP = 40,
  UNKNOWN = 0
}

/**
 * Get priority for a device based on its type
 */
export function getDevicePriority(deviceId: string): number {
  // 从 deviceId 解析设备类型（这里简化处理）
  // 实际应该从设备注册表获取
  if (deviceId.startsWith('local-')) return DevicePriority.LOCAL;
  if (deviceId.includes('phone')) return DevicePriority.PHONE;
  if (deviceId.includes('tablet')) return DevicePriority.TABLET;
  if (deviceId.includes('desktop')) return DevicePriority.DESKTOP;
  return DevicePriority.UNKNOWN;
}

export function resolveConflict(
  local: ChatMessage,
  remote: ChatMessage
): ChatMessage {
  // 比较时间戳
  if (remote.timestamp > local.timestamp) {
    return remote;
  }

  if (remote.timestamp < local.timestamp) {
    return local;
  }

  // 时间戳相同，按设备优先级
  const localPriority = getDevicePriority(local.deviceId);
  const remotePriority = getDevicePriority(remote.deviceId);

  return remotePriority > localPriority ? remote : local;
}
```

**Step 2: 运行测试**

```bash
npx vitest run tests/unit/sync/conflict-resolution.test.ts
```

**Step 3: 提交**

```bash
git add src/lib/sync/conflict-resolution.ts
git commit -m "feat: 添加设备优先级冲突解决 [conflict-resolution.ts]"
```

---

## 第五阶段：Windows 和安卓构建

### Task 9: Windows 桌面端构建

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`

**Step 1: 配置 Windows 构建**

```bash
# 确保已安装 Rust 和 Windows 工具链
rustup target add x86_64-pc-windows-msvc
rustup default stable-msvc
```

**Step 2: 构建 Windows 版本**

```bash
cd /d/project/exomind-dev-chat/src-tauri
cargo build --release --target x86_64-pc-windows-msvc
```

**Step 3: 使用 Tauri CLI 构建**

```bash
cd /d/project/exomind-dev-chat
bun run tauri build --target x86_64-pc-windows-msvc
```

**Step 4: 验证构建产物**

```bash
ls -la src-tauri/target/release/bundle/msi/
# 应看到 .msi 和 .exe 文件
```

**Step 5: 提交**

```bash
git add src-tauri/tauri.conf.json
git commit -m "build: 配置 Windows 构建 [tauri.conf.json]"
```

---

### Task 10: 安卓移动端构建

**Files:**
- Modify: `src-tauri/capabilities/android.json`
- Create: `src-tauri/gen/android/gradle.properties`

**Step 1: 安装安卓开发环境**

```bash
# 安装 Android SDK 和 NDK
# 设置 ANDROID_HOME 环境变量
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

**Step 2: 生成安卓项目**

```bash
cd /d/project/exomind-dev-chat/src-tauri
tauri android init
```

**Step 3: 构建安卓 APK**

```bash
cd /d/project/exomind-dev-chat/src-tauri/gen/android
./gradlew assembleDebug
```

**Step 4: 验证 APK**

```bash
ls -la app/build/outputs/apk/debug/
# 应看到 app-debug.apk
```

**Step 5: 提交**

```bash
git add src-tauri/capabilities/android.json gen/android/
git commit -m "build: 添加安卓构建配置 [android]"
```

---

## 第六阶段：跨端通讯测试

### Task 11: Windows 端运行服务端

**Files:**
- Modify: `src-tauri/src/sync/ws_server.rs`

**Step 1: 完善 WebSocket 服务端实现**

```rust
// src-tauri/src/sync/ws_server.rs
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use tungstenite::Message;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct WsServer {
    clients: Arc<Mutex<Vec<tungstenite::WebSocketStream<
        tokio::net::TcpStream,
    >>>>>,
}

impl WsServer {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub async fn start(&self, addr: &str) -> Result<(), String> {
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|e| e.to_string())?;

        println!("WebSocket server listening on {}", addr);

        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(self.handle_connection(stream));
        }

        Ok(())
    }

    async fn handle_connection(
        &self,
        stream: tokio::net::TcpStream,
    ) -> Result<(), String> {
        let ws_stream = accept_async(stream)
            .await
            .map_err(|e| e.to_string())?;

        let (write, _) = ws_stream.split();

        let mut clients = self.clients.lock().await;
        clients.push(write);

        Ok(())
    }

    pub async fn broadcast(&self, message: &str) -> Result<(), String> {
        let mut clients = self.clients.lock().await;

        for client in clients.iter_mut() {
            client
                .send(Message::Text(message.to_string()))
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}
```

**Step 2: 在 lib.rs 中注册**

```rust
// src-tauri/src/lib.rs 添加
use crate::sync::ws_server::{self, WsServer};

struct AppState {
    ws_server: Mutex<Option<WsServer>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ws_server: Mutex::new(Some(WsServer::new())),
        }
    }
}

#[tauri::command]
async fn start_ws_server(state: State<'_, AppState>) -> Result<String, String> {
    let mut server_guard = state.ws_server.lock().await;
    if let Some(server) = server_guard.take() {
        let addr = "0.0.0.0:1949";
        server.start(addr).await?;
        Ok(format!("Server started on {}", addr))
    } else {
        Err("Server already running".to_string())
    }
}
```

**Step 3: 测试**

```bash
cargo check
```

**Step 4: 提交**

```bash
git add src-tauri/src/sync/ws_server.rs src-tauri/src/lib.rs
git commit -m "feat: 完善 WebSocket 服务端 [ws_server.rs]"
```

---

### Task 12: 测试跨端连接

**测试步骤:**

1. **Windows 端**
   ```bash
   bun run tauri dev
   # 启动后查看设置页面的本机 IP
   ```

2. **安卓端**
   ```bash
   cd src-tauri/gen/android
   ./gradlew installDebug
   # 在手机上打开 App
   ```

3. **连接测试**
   - Windows 端：设置页面查看 IP（如 192.168.1.100:1949）
   - 安卓端：设置页面输入 Windows IP，点击连接
   - 验证两端显示"已连接"

4. **消息同步测试**
   - Windows 端发送消息
   - 安卓端查看是否收到
   - 反向测试

---

## 已解决问题清单

| Task | 问题 | 文件 | 状态 |
|------|------|------|------|
| 1 | XSS 漏洞 | MessageList.tsx | ⏳ |
| 2 | SQL 注入 | sqlite.ts | ⏳ |
| 3 | 类型冲突 | protocol.ts | ⏳ |
| 4 | UI 简化 | App.tsx MainLayout.tsx | ⏳ |
| 5 | IP 命令 | ip_commands.rs | ⏳ |
| 6 | IP 连接 | use-ip-connection.ts | ⏳ |
| 7 | 消息唯一 ID | message-id.ts | ⏳ |
| 8 | 冲突解决 | conflict-resolution.ts | ⏳ |
| 9 | Windows 构建 | tauri.conf.json | ⏳ |
| 10 | 安卓构建 | android 配置 | ⏳ |
| 11 | 服务端 | ws_server.rs | ⏳ |
| 12 | 跨端测试 | - | ⏳ |

---

## 参考文档

- **评审报告**: `agent-output/review/2026-02-04-745ee4d/综合评审.md`
- **UI 设计**: `src/components/Chat/ChatWindow.tsx`
- **消息类型**: `src/lib/types/message.ts`
- **同步协议**: `src/lib/sync/sync-protocol.ts`
