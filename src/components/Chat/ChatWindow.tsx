import React, { useRef, useEffect } from 'react';
import { DiscoveredDevice } from '../../lib/sync/device-discovery';
import { ChatMessage } from '../../lib/stores/chat-store';
import './ChatWindow.css';

interface ChatWindowProps {
  messages: ChatMessage[];
  selectedDevice: DiscoveredDevice | null;
  isConnected: boolean;
  isConnecting: boolean;
  network?: {
    isOnline: boolean;
    isSyncing: boolean;
  };
  onSend: (content: string) => void;
}

export function ChatWindow({
  messages,
  selectedDevice,
  isConnected,
  isConnecting,
  network,
  onSend,
}: ChatWindowProps) {
  const [inputValue, setInputValue] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      const el = messagesEndRef.current;
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (inputValue.trim()) {
      onSend(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getConnectionStatusText = () => {
    // 移动端简化显示
    if (!selectedDevice) return '未选择设备';
    if (!network?.isOnline) return '离线模式';
    if (isConnecting) return '连接中...';
    if (isConnected) return '已连接';
    return '连接断开';
  };

  const isOwnMessage = (msg: ChatMessage) => {
    return msg.senderId === selectedDevice?.id;
  };

  const getStatusIcon = (status: ChatMessage['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'sending': return '...';
      case 'sent': return '✓';
      case 'delivered': return '✓✓';
      case 'failed': return '❌';
      default: return '';
    }
  };

  // 移动端空状态优化
  if (!selectedDevice) {
    return (
      <div className="chat-window">
        <div className="chat-empty-state">
          <div className="empty-icon">💬</div>
          <h3>欢迎使用 ExoMind</h3>
          <p>选择一个设备开始对话，或直接发送消息</p>
          <div className="message-input-wrapper" style={{ marginTop: '1rem', border: 'none' }}>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="记录你的想法..."
              rows={1}
              data-testid="message-input"
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="send-button"
              data-testid="send-button"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <header className="chat-header">
        <div className="device-info">
          <span className="device-name">
            {selectedDevice.name}
            {selectedDevice.type === 'desktop' ? ' 🖥️' : ' 📱'}
          </span>
          <span className="device-ip">{selectedDevice.ip}</span>
        </div>
        <div className={`connection-badge ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
          {getConnectionStatusText()}
        </div>
      </header>

      <div className="chat-content">
        <div className="message-list" data-testid="message-list">
          {messages.length === 0 ? (
            <div className="no-messages">
              <p>暂无消息</p>
              <p className="hint">发送第一条消息开始对话</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`message ${msg.status === 'pending' ? 'pending' : ''} ${isOwnMessage(msg) ? 'sent' : 'received'}`}
                data-testid={`message-${msg.status}`}
              >
                <div className="message-content">{msg.content}</div>
                <div className="message-meta">
                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                  {isOwnMessage(msg) && (
                    <span className={`message-status ${msg.status}`}>
                      {getStatusIcon(msg.status)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="message-input-wrapper" data-testid="message-input">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={network?.isOnline ? "输入消息..." : "离线模式 - 消息稍后发送"}
            rows={1}
            disabled={!network?.isOnline && messages.length === 0}
            enterKeyHint="send"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="send-button"
            data-testid="send-button"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
