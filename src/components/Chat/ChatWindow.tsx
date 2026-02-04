import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useChatStore, ChatMessage } from '../../lib/stores/chat-store';
import { Send, Plus, Circle } from 'lucide-react';
import './ChatWindow.css';

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

export function ChatWindow() {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

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

  const getConnectionStatusText = () => {
    if (connectedDeviceCount > 0) {
      if (isConnecting) return '连接中...';
      if (isConnected) return `已连接 ${connectedDeviceCount} 个设备`;
    }
    if (!network?.isOnline) return '离线模式';
    return '准备就绪';
  };

  const isOwnMessage = (msg: ChatMessage) => {
    return msg.direction === 'outgoing' || msg.senderId === deviceId;
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
          <div className={`connection-status ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
            <Circle size={8} fill="currentColor" />
            <span>{getConnectionStatusText()}</span>
          </div>
        </div>
      </header>

      {/* 消息列表 - 可滚动 */}
      <div className="chat-messages" ref={messageListRef}>
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
                    className={`message-item ${isOwnMessage(msg) ? 'sent' : 'received'} ${msg.status === 'pending' ? 'pending' : ''}`}
                  >
                    <div className="message-bubble">
                      <div className="message-content">{msg.content}</div>
                    </div>
                    <div className="message-meta">
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 - 固定底部 */}
      <div className="chat-input-wrapper">
        <button className="attach-button">
          <Plus size={24} />
        </button>
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={network?.isOnline ? "输入消息..." : "离线模式 - 消息稍后发送"}
          rows={1}
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || (!network?.isOnline && hasNoMessages)}
          className="send-button"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
