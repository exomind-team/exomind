import React, { useRef, useEffect, useMemo } from 'react';
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

  // 按日期分组消息
  const groupedMessages = useMemo(() => groupMessagesByDate(messages), [messages]);

  // 滚动到底部
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
    if (!selectedDevice) return '未选择设备';
    if (!network?.isOnline) return '离线模式';
    if (isConnecting) return '连接中...';
    if (isConnected) return '已连接';
    return '连接断开';
  };

  // 判断是否是自己的消息
  const isOwnMessage = (msg: ChatMessage) => {
    // 如果有选中的设备，判断是否发给该设备
    if (selectedDevice) {
      return msg.receiverId === selectedDevice.id;
    }
    // 没有选中设备时，检查 senderId 是否是本地设备
    // 这里简化处理：发送出去的消息都是"自己的"
    return msg.direction === 'outgoing' || msg.senderId === msg.deviceId;
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

  // 没有消息时的空状态
  const hasNoMessages = messages.length === 0;

  return (
    <div className="chat-window">
      {/* 设备选择提示头部 */}
      {!selectedDevice && (
        <header className="chat-header device-select-header">
          <div className="device-info">
            <span className="device-name">💡 提示</span>
          </div>
          <div className="connection-badge disconnected">
            未选择设备
          </div>
        </header>
      )}

      {/* 已选设备头部 */}
      {selectedDevice && (
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
      )}

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
              {/* 日期分组 */}
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
