import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useChatStore, ChatMessage } from '../../lib/stores/chat-store';
import './ChatWindow.css';

// 简化的 ChatWindow Props
interface ChatWindowProps {
  onConnectionChange?: (status: 'connected' | 'connecting' | 'disconnected') => void;
}

// 按日期分组消息
function groupMessagesByDate(messages: ChatMessage[]): Map<string, ChatMessage[]> {
  const groups = new Map<string, ChatMessage[]>();

  for (const msg of messages) {
    const date = new Date(msg.timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(msg);
  }

  return groups;
}

export function ChatWindow({ onConnectionChange }: ChatWindowProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isConnected,
    isConnecting,
    network,
    sendMessage,
    loadMessages,
    getDeviceId,
    connectedDeviceCount
  } = useChatStore();

  const deviceId = getDeviceId();

  // 按日期分组消息
  const groupedMessages = useMemo(() => groupMessagesByDate(messages), [messages]);

  // 通知连接状态变化
  useEffect(() => {
    if (onConnectionChange) {
      if (isConnecting) {
        onConnectionChange('connecting');
      } else if (isConnected) {
        onConnectionChange('connected');
      } else {
        onConnectionChange('disconnected');
      }
    }
  }, [isConnected, isConnecting, onConnectionChange]);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 加载消息
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

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

  const getConnectionStatusText = () => {
    if (connectedDeviceCount > 0) {
      if (isConnecting) return '连接中...';
      if (isConnected) return `已连接 ${connectedDeviceCount} 个设备`;
    }
    if (!network?.isOnline) return '离线模式';
    return '准备就绪';
  };

  const getConnectionStatusClass = () => {
    if (connectedDeviceCount > 0) {
      return isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected';
    }
    return network?.isOnline ? 'ready' : 'offline';
  };

  const isOwnMessage = (msg: ChatMessage) => {
    return msg.direction === 'outgoing' || msg.senderId === deviceId;
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

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const hasNoMessages = messages.length === 0;

  return (
    <div className="chat-window">
      {/* 头部 */}
      <header className="chat-header">
        <div className="chat-title">
          <h1>消息</h1>
          <span className={`connection-badge ${getConnectionStatusClass()}`}>
            {getConnectionStatusText()}
          </span>
        </div>
      </header>

      {/* 消息区域 */}
      <div className="chat-content">
        <div className="message-list" data-testid="message-list">
          {hasNoMessages ? (
            <div className="no-messages">
              <div className="empty-icon">💬</div>
              <p>暂无消息记录</p>
              <p className="hint">发送第一条消息开始记录</p>
            </div>
          ) : (
            <>
              {Array.from(groupedMessages.entries()).map(([date, dateMessages]) => (
                <div key={date} className="message-group">
                  <div className="date-divider">
                    <span className="date-label">{date}</span>
                  </div>
                  {dateMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`message ${msg.status === 'pending' ? 'pending' : ''} ${isOwnMessage(msg) ? 'sent' : 'received'}`}
                      data-testid={`message-${msg.status}`}
                    >
                      <div className="message-bubble">
                        <div className="message-content">{msg.content}</div>
                      </div>
                      <div className="message-meta">
                        <span className="message-time">{formatTime(msg.timestamp)}</span>
                        {isOwnMessage(msg) && (
                          <span className={`message-status ${msg.status}`}>
                            {getStatusIcon(msg.status)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div className="message-input-wrapper" data-testid="message-input">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={network?.isOnline ? "输入消息... (按 Enter 发送)" : "离线模式 - 消息稍后发送"}
            rows={1}
            disabled={!network?.isOnline && hasNoMessages}
            enterKeyHint="send"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || (!network?.isOnline && hasNoMessages)}
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
