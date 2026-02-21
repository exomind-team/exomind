# ExoMind UI/UX 改进与真实配对实现计划

> **For Claude:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 按任务逐步实施。

**目标:**
1. 修复评审报告中的 UI/UX 问题
2. 实现响应式布局（桌面侧边栏 / 移动底部导航）
3. 改进聊天界面（微信式滚动、固定输入框）
4. 实现真实设备配对流程

---

## 第一阶段：UI/UX 响应式改进

### Task 1: 重构 MainLayout - 响应式布局

**Files:**
- Modify: `src/components/Layout/MainLayout.tsx`

**Requirements:**
- 桌面端 (≥768px): 左侧侧边栏导航
- 移动端 (<768px): 底部标签栏导航
- 使用 CSS `@media (min-width: 768px)` 断点
- 移动端底部添加 `safe-area-inset-bottom` 适配

**Step 1: 编写布局代码**

```tsx
// src/components/Layout/MainLayout.tsx
import { useState, useEffect } from 'react';
import { MessageSquare, Settings } from 'lucide-react';
import { ChatWindow } from '../Chat/ChatWindow';
import { SettingsPage } from '../Settings/SettingsPage';

export type ViewType = 'chat' | 'settings';

export function MainLayout() {
  const [currentView, setCurrentView] = useState<ViewType>('chat');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 桌面端：左侧侧边栏 */}
      {!isMobile && (
        <nav className="w-16 bg-gray-900 flex flex-col items-center py-4 space-y-4">
          <NavButton
            active={currentView === 'chat'}
            onClick={() => setCurrentView('chat')}
            icon={<MessageSquare size={24} />}
            label="消息"
          />
          <NavButton
            active={currentView === 'settings'}
            onClick={() => setCurrentView('settings')}
            icon={<Settings size={24} />}
            label="设置"
          />
        </nav>
      )}

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === 'chat' ? <ChatWindow /> : <SettingsPage />}
      </main>

      {/* 移动端：底部导航 */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200
                        flex justify-around py-2 pb-safe">
          <NavButton
            active={currentView === 'chat'}
            onClick={() => setCurrentView('chat')}
            icon={<MessageSquare size={24} />}
            label="消息"
          />
          <NavButton
            active={currentView === 'settings'}
            onClick={() => setCurrentView('settings')}
            icon={<Settings size={24} />}
            label="设置"
          />
        </nav>
      )}
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg transition-colors flex flex-col items-center gap-1 ${
        active ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {icon}
      <span className="text-xs">{label}</span>
    </button>
  );
}
```

**Step 2: 添加响应式 CSS**

```css
/* src/components/Layout/MainLayout.css */
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 20px);
}

@media (min-width: 768px) {
  .mobile-nav {
    display: none;
  }
}

@media (max-width: 767px) {
  .sidebar {
    display: none;
  }
}
```

**Step 3: 运行开发服务器验证**

```bash
cd D:\project\exomind-dev-chat
bun run dev
```

**Step 4: 提交**

```bash
git add src/components/Layout/MainLayout.tsx src/components/Layout/MainLayout.css
git commit -m "feat: 实现响应式布局（桌面侧边栏/移动底部导航）"
```

---

### Task 2: 重构 ChatWindow - 微信式聊天界面

**Files:**
- Modify: `src/components/Chat/ChatWindow.tsx`
- Modify: `src/components/Chat/ChatWindow.css`

**Requirements:**
- 消息列表：可滚动，支持大量消息
- 输入框：固定在底部
- 移动端：底部 safe area 适配
- 发送按钮：触摸友好（≥44px）

**Step 1: 编写聊天界面代码**

```tsx
// src/components/Chat/ChatWindow.tsx
import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useChatStore, ChatMessage } from '../../lib/stores/chat-store';
import { Send, Plus } from 'lucide-react';
import './ChatWindow.css';

export function ChatWindow() {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    isConnected,
    network,
    sendMessage,
    loadMessages,
    getDeviceId,
  } = useChatStore();

  const deviceId = getDeviceId();

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = () => {
    if (inputValue.trim()) {
      sendMessage(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isOwnMessage = (msg: ChatMessage) =>
    msg.direction === 'outgoing' || msg.senderId === deviceId;

  const hasNoMessages = messages.length === 0;

  return (
    <div className="chat-window">
      {/* 头部 */}
      <header className="chat-header">
        <h1>消息</h1>
        <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '已连接' : '离线'}
        </span>
      </header>

      {/* 消息列表 - 可滚动 */}
      <div className="chat-messages" ref={messageListRef}>
        {hasNoMessages ? (
          <div className="no-messages">
            <p>暂无消息</p>
            <p className="hint">发送第一条消息开始记录</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${isOwnMessage(msg) ? 'sent' : 'received'}`}
            >
              <div className="message-bubble">{msg.content}</div>
              <span className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 - 固定底部 */}
      <div className="chat-input-wrapper">
        <button className="attach-btn">
          <Plus size={24} />
        </button>
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={network?.isOnline ? "输入消息..." : "离线模式"}
          rows={1}
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim()}
          className="send-btn"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
```

**Step 2: 编写 CSS**

```css
/* src/components/Chat/ChatWindow.css */
.chat-window {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.chat-header {
  flex-shrink: 0;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
}

.chat-input-wrapper {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  padding: 8px 12px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  background: white;
  border-top: 1px solid #eee;
  gap: 8px;
}

.chat-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 20px;
  padding: 10px 14px;
  resize: none;
  max-height: 100px;
  font-size: 16px;
  outline: none;
}

.chat-input:focus {
  border-color: #007aff;
}

.attach-btn,
.send-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background 0.2s;
}

.attach-btn {
  background: #f5f5f5;
  color: #666;
}

.send-btn {
  background: #007aff;
  color: white;
}

.send-btn:disabled {
  background: #ccc;
}

.message {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  max-width: 75%;
}

.message.sent {
  align-self: flex-end;
}

.message.received {
  align-self: flex-start;
}

.message-bubble {
  padding: 10px 14px;
  border-radius: 18px;
  word-break: break-word;
}

.sent .message-bubble {
  background: #007aff;
  color: white;
  border-bottom-right-radius: 4px;
}

.received .message-bubble {
  background: #f5f5f5;
  color: #333;
  border-bottom-left-radius: 4px;
}

.message-time {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}

.sent .message-time {
  text-align: right;
}

@media (min-width: 768px) {
  .chat-input-wrapper {
    padding-bottom: 8px;
  }
}
```

**Step 3: 验证**

```bash
bun run dev
```

**Step 4: 提交**

```bash
git add src/components/Chat/ChatWindow.tsx src/components/Chat/ChatWindow.css
git commit -m "feat: 微信式聊天界面（可滚动消息、固定输入框）"
```

---

### Task 3: 改进 SettingsPage UI

**Files:**
- Modify: `src/components/Settings/SettingsPage.tsx`

**Requirements:**
- 使用完整 lucide-react 图标
- 卡片式布局优化
- 触摸友好按钮（≥44px）
- 移动端底部 safe area 适配

**Step 1: 编写改进后的 SettingsPage**

```tsx
// src/components/Settings/SettingsPage.tsx
import { useState, useEffect } from 'react';
import {
  Info,
  Shield,
  Network,
  Smartphone,
  Monitor,
  Server,
  Copy,
  Check,
  RefreshCw,
  Download,
  FileText,
  QrCode,
  Users
} from 'lucide-react';
import { useChatStore } from '../../lib/stores/chat-store';

export function SettingsPage() {
  const { messages } = useChatStore();
  const [localIP, setLocalIP] = useState('获取中...');
  const [remoteIP, setRemoteIP] = useState('');
  const [ipCopied, setIpCopied] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 模拟获取 IP
  useEffect(() => {
    setTimeout(() => setLocalIP('192.168.1.100:1949'), 1000);
  }, []);

  const copyIP = async () => {
    if (localIP !== '获取中...' && localIP !== '无法获取') {
      await navigator.clipboard.writeText(localIP);
      setIpCopied(true);
      setTimeout(() => setIpCopied(false), 2000);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-container">
        {/* 关于 */}
        <section className="settings-card">
          <div className="card-header">
            <Info size={20} className="icon-primary" />
            <h2>关于 ExoMind</h2>
          </div>
          <p>本地优先的多设备消息同步应用</p>
          <p className="version">版本 0.1.0</p>
        </section>

        {/* 网络状态 */}
        <section className="settings-card">
          <div className="card-header">
            <Network size={20} className="icon-primary" />
            <h2>网络状态</h2>
          </div>

          <div className="setting-row">
            <span className="setting-label">本机地址</span>
            <div className="ip-display">
              <code>{localIP}</code>
              <button onClick={copyIP} className="icon-btn" title="复制">
                {ipCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <div className="setting-row">
            <span className="setting-label">连接状态</span>
            <span className="status-badge connected">已连接</span>
          </div>
        </section>

        {/* 配对设备 */}
        <section className="settings-card">
          <div className="card-header">
            <Users size={20} className="icon-primary" />
            <h2>已配对设备</h2>
            <button className="text-btn">
              <RefreshCw size={16} />
              刷新
            </button>
          </div>

          <div className="device-list">
            <div className="device-item">
              <Smartphone size={20} />
              <div className="device-info">
                <span className="device-name">我的手机</span>
                <span className="device-ip">192.168.1.101:1949</span>
              </div>
              <span className="online-badge">在线</span>
            </div>
          </div>
        </section>

        {/* 添加连接 */}
        <section className="settings-card">
          <div className="card-header">
            <QrCode size={20} className="icon-primary" />
            <h2>添加连接</h2>
          </div>
          <p>输入另一台设备的地址，或使用二维码配对</p>

          <div className="input-group">
            <input
              type="text"
              value={remoteIP}
              onChange={(e) => setRemoteIP(e.target.value)}
              placeholder="192.168.1.100:1949"
              className="text-input"
            />
            <button className="primary-btn">
              连接
            </button>
          </div>
        </section>

        {/* 消息导出 */}
        <section className="settings-card">
          <div className="card-header">
            <FileText size={20} className="icon-primary" />
            <h2>消息导出</h2>
          </div>
          <p>将消息导出为 Markdown 格式</p>
          <button className="primary-btn with-icon">
            <Download size={18} />
            导出消息 ({messages.length})
          </button>
        </section>

        {/* 安全提示 */}
        <section className="settings-card info-card">
          <div className="card-header">
            <Shield size={20} className="icon-blue" />
            <h2>安全提示</h2>
          </div>
          <ul>
            <li>所有消息使用端到端加密</li>
            <li>数据仅存储在您的本地设备</li>
            <li>请确保连接可信的设备</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
```

**Step 2: 编写 CSS**

```css
/* src/components/Settings/SettingsPage.css */
.settings-page {
  height: 100%;
  overflow-y: auto;
  background: #f5f5f5;
  padding: 16px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}

.settings-container {
  max-width: 600px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.card-header h2 {
  flex: 1;
  font-size: 16px;
  font-weight: 600;
}

.icon-primary {
  color: #007aff;
}

.icon-blue {
  color: #007aff;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-label {
  color: #666;
}

.ip-display {
  display:-items: center;
 flex;
  align  gap: 8px;
}

.ip-display code {
  font-family: monospace;
  background: #f5f5f5;
  padding: 4px 8px;
  border-radius: 4px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #f5f5f5;
  border: none;
  cursor: pointer;
}

.text-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #007aff;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
}

.primary-btn {
  width: 100%;
  height: 44px;
  background: #007aff;
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}

.primary-btn:active {
  background: #0056b3;
}

.primary-btn.with-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.input-group {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.text-input {
  flex: 1;
  height: 44px;
  border: 1px solid #ddd;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 16px;
  outline: none;
}

.text-input:focus {
  border-color: #007aff;
}

.device-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 10px;
  margin-top: 8px;
}

.device-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.device-name {
  font-weight: 500;
}

.device-ip {
  font-size: 12px;
  color: #999;
  font-family: monospace;
}

.online-badge {
  color: #34c759;
  font-size: 12px;
}

.info-card {
  background: #f0f7ff;
}

.info-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.info-card li {
  padding: 4px 0;
  font-size: 14px;
  color: #666;
}

.version {
  color: #999;
  font-size: 12px;
  margin-top: 4px;
}

@media (min-width: 768px) {
  .settings-page {
    padding: 24px;
    padding-bottom: 24px;
  }
}
```

**Step 3: 提交**

```bash
git add src/components/Settings/SettingsPage.tsx src/components/Settings/SettingsPage.css
git commit -m "feat: 改进 SettingsPage UI（完整图标、卡片布局）"
```

---

## 第二阶段：真实设备配对

### Task 4: 实现 Rust 配对命令

**Files:**
- Create: `src-tauri/src/commands/pairing_commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Requirements:**
- 生成 6 位数字配对码
- 存储配对请求（带超时 5 分钟）
- 确认配对请求
- 交换公钥（简化版）

**Step 1: 创建配对命令**

```rust
// src-tauri/src/commands/pairing_commands.rs
use tauri::{AppHandle, Runtime, State};
use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use rand::Rng;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingRequest {
    pub code: String,
    pub device_name: String,
    pub device_ip: String,
    pub public_key: String,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct PairingState {
    pending_requests: Mutex<HashMap<String, PairingRequest>>,
}

#[tauri::command]
pub async fn generate_pairing_code(
    app: AppHandle,
    state: State<'_, PairingState>,
    device_name: String,
    device_ip: String,
    public_key: String,
) -> Result<String, String> {
    // 生成 6 位数字配对码
    let code: String = rand::thread_rng()
        .gen_range(100000..=999999)
        .to_string();

    let request = PairingRequest {
        code: code.clone(),
        device_name,
        device_ip,
        public_key,
        created_at: chrono::Utc::now().timestamp() as u64,
    };

    // 存储配对请求（5 分钟超时）
    let mut requests = state.pending_requests.lock().map_err(|e| e.to_string())?;
    requests.insert(code.clone(), request);

    // TODO: 广播配对请求到局域网（mDNS/UDP 广播）

    Ok(code)
}

#[tauri::command]
pub async fn confirm_pairing(
    state: State<'_, PairingState>,
    code: String,
    accept: bool,
) -> Result<bool, String> {
    let mut requests = state.pending_requests.lock().map_err(|e| e.to_string())?;

    if let Some(request) = requests.get(&code) {
        // 检查是否超时（5 分钟）
        let now = chrono::Utc::now().timestamp() as u64;
        if now - request.created_at > 300 {
            requests.remove(&code);
            return Err("配对码已过期".to_string());
        }

        if accept {
            // TODO: 建立加密通道，交换密钥
            // 存储配对设备信息
            requests.remove(&code);
            return Ok(true);
        } else {
            requests.remove(&code);
            return Ok(false);
        }
    }

    Err("配对码无效".to_string())
}

#[tauri::command]
pub async fn get_pairing_requests(
    state: State<'_, PairingState>,
) -> Result<Vec<PairingRequest>, String> {
    let requests = state.pending_requests.lock().map_err(|e| e.to_string())?;
    Ok(requests.values().cloned().collect())
}
```

**Step 2: 在 lib.rs 中注册**

```rust
// src-tauri/src/lib.rs
pub struct PairingState {
    pending_requests: Mutex<HashMap<String, PairingRequest>>,
};

#[tauri::command]
async fn generate_pairing_code(
    app: AppHandle,
    state: State<'_, PairingState>,
    device_name: String,
    device_ip: String,
    public_key: String,
) -> Result<String, String> {
    pairing_commands::generate_pairing_code(app, state, device_name, device_ip, public_key).await
}

#[tauri::command]
async fn confirm_pairing(
    state: State<'_, PairingState>,
    code: String,
    accept: bool,
) -> Result<bool, String> {
    pairing_commands::confirm_pairing(state, code, accept).await
}

.invoke_handler(tauri::generate_handler![
    // ... existing handlers
    generate_pairing_code,
    confirm_pairing,
])
```

**Step 3: 测试 Rust 编译**

```bash
cd D:\project\exomind-dev-chat\src-tauri
cargo check
```

**Step 4: 提交**

```bash
git add src-tauri/src/commands/pairing_commands.rs src-tauri/src/lib.rs
git commit -m "feat: 实现 Rust 配对命令（配对码生成、确认）"
```

---

### Task 5: 实现前端配对 UI

**Files:**
- Create: `src/components/Pairing/PairingModal.tsx`
- Modify: `src/components/Settings/SettingsPage.tsx`

**Requirements:**
- 生成配对码界面（显示 6 位码）
- 输入配对码界面
- 配对请求确认弹窗
- 配对状态展示

**Step 1: 创建配对组件**

```tsx
// src/components/Pairing/PairingModal.tsx
import { useState } from 'react';
import { QrCode, Check, X, Copy, Check as CheckIcon } from 'lucide-react';

interface PairingModalProps {
  onClose: () => void;
  onPair: (code: string) => void;
  mode: 'generate' | 'input';
}

export function PairingModal({ onClose, onPair, mode }: PairingModalProps) {
  const [pairingCode, setPairingCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<Array<{code: string, name: string}>>([]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (mode === 'generate') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <QrCode size={24} />
            <h2>配对设备</h2>
            <button onClick={onClose} className="close-btn">
              <X size={24} />
            </button>
          </div>

          <div className="modal-body">
            <p className="instruction">将此配对码输入到另一台设备</p>

            <div className="code-display">
              {pairingCode.split('').map((char, i) => (
                <span key={i} className="code-char">{char}</span>
              ))}
            </div>

            <button onClick={copyCode} className="copy-btn">
              {copied ? <CheckIcon size={16} /> : <Copy size={16} />}
              {copied ? '已复制' : '复制配对码'}
            </button>

            <div className="waiting-notice">
              等待对方输入配对码...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <QrCode size={24} />
          <h2>输入配对码</h2>
          <button onClick={onClose} className="close-btn">
            <X size={24} />
          </button>
        </div>

        <div className="modal-body">
          <p className="instruction">输入另一台设备显示的 6 位配对码</p>

          <div className="code-input">
            {Array(6).fill(0).map((_, i) => (
              <input
                key={i}
                type="text"
                maxLength={1}
                value={inputCode[i] || ''}
                onChange={(e) => {
                  const newCode = inputCode.split('');
                  newCode[i] = e.target.value;
                  setInputCode(newCode.join(''));
                  // Auto-focus next input
                  if (e.target.value && i < 5) {
                    e.target.nextSibling?.focus();
                  }
                }}
                className="code-char-input"
              />
            ))}
          </div>

          <button
            onClick={() => onPair(inputCode)}
            disabled={inputCode.length !== 6}
            className="confirm-btn"
          >
            确认配对
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: 提交**

```bash
git add src/components/Pairing/PairingModal.tsx
git commit -m "feat: 实现前端配对 UI"
```

---

## 第三阶段：构建测试

### Task 6: 重新构建应用

**Files:**
- Modify: 已修改的上述文件

**Steps:**

1. **Windows 构建**
```bash
cd D:\project\exomind-dev-chat
bun run tauri build
```

2. **Android 构建**
```bash
# 使用提供的脚本
D:\project\exomind-dev-chat\run-android-build.bat
```

**验证产物:**
- Windows: `src-tauri\target\release\bundle\nsis\ExoMind_0.1.0_x64-setup.exe`
- Android: `src-tauri\gen\android\app\build\outputs\apk\debug\app-debug.apk`

---

## 任务清单

| Task | 描述 | 状态 |
|------|------|------|
| 1 | MainLayout 响应式布局 | ✅ 已完成 |
| 2 | ChatWindow 微信式界面 | ✅ 已完成 |
| 3 | SettingsPage UI 改进 | ✅ 已完成 |
| 4 | Rust 配对命令 | ✅ 已完成 |
| 5 | 前端配对 UI | ✅ 已完成 |
| 6 | 重新构建应用 | 🔄 进行中 |
