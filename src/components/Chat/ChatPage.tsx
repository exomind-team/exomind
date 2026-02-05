import { useState, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '@/lib/stores/chat-store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Send, Circle, Plus } from 'lucide-react';

// 按日期分组消息
function groupMessagesByDate(messages: ReturnType<typeof useChatStore.getState>['messages']) {
  const groups = new Map<string, typeof messages>();

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

export function ChatPage() {
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
    connectedDeviceCount,
  } = useChatStore();

  const deviceId = getDeviceId();

  // 按日期分组消息
  const groupedMessages = useMemo(() => groupMessagesByDate(messages), [messages]);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  const isOwnMessage = (msg: typeof messages[0]) => {
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

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  const hasNoMessages = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="text-2xl font-bold">消息</h2>
          <p className="text-sm text-muted-foreground">
            {connectedDeviceCount > 0 ? (
              <span className="flex items-center gap-2">
                <Circle size={8} fill="currentColor" className={isConnected ? "text-green-500" : "text-yellow-500"} />
                {getConnectionStatusText()}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Circle size={8} fill="currentColor" className="text-gray-400" />
                {getConnectionStatusText()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={network.isOnline ? "default" : "secondary"}>
            {network.isOnline ? "在线" : "离线"}
          </Badge>
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            新建对话
          </Button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-auto p-6" ref={messagesEndRef as React.RefObject<HTMLDivElement>}>
        {hasNoMessages ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-lg font-medium mb-1">暂无消息记录</p>
            <p className="text-sm text-muted-foreground">发送第一条消息开始记录</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Array.from(groupedMessages.entries()).map(([date, dateMessages]) => (
              <div key={date}>
                <div className="flex items-center justify-center mb-4">
                  <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    {date}
                  </span>
                </div>
                <div className="space-y-3">
                  {dateMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${isOwnMessage(msg) ? 'flex-row-reverse' : ''}`}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className={isOwnMessage(msg) ? "bg-primary text-primary-foreground" : "bg-muted"}>
                          {getInitials(msg.senderId || 'ME')}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`max-w-[70%] ${isOwnMessage(msg) ? 'text-right' : ''}`}>
                        <div
                          className={`inline-block px-4 py-2 rounded-2xl ${
                            isOwnMessage(msg)
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : "bg-muted rounded-bl-md"
                          }`}
                        >
                          <p className="text-sm">{msg.content}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatTime(msg.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="px-6 py-4 border-t bg-card">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Plus className="h-5 w-5" />
          </Button>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={network.isOnline ? "输入消息..." : "离线模式 - 消息稍后发送"}
            className="flex-1"
            disabled={!network.isOnline && hasNoMessages}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || (!network.isOnline && hasNoMessages)}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
