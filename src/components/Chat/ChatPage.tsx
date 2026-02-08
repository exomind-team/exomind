import { useState, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '@/lib/stores/chat-store';
import { useTimeBlockStore, parseTimeBlockCommand } from '@/lib/stores/timeblock-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Send, Circle, Plus, Clock } from 'lucide-react';

export function ChatPage() {
  const [inputValue, setInputValue] = useState('');
  const [showTimeBlocks, setShowTimeBlocks] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Chat Store
  const {
    messages,
    pendingMessages,
    isConnected,
    isConnecting,
    network,
    sendMessage,
    loadMessages,
    getDeviceId,
    connectedDeviceCount,
  } = useChatStore();

  // TimeBlock Store
  const {
    events,
    timeBlocks,
    activeBlock,
    addEvent,
    startBlock,
    endBlock,
    getEventsInBlock,
    getTimeBlocksByStartTime,
    load: loadTimeBlocks,
    save: saveTimeBlocks,
  } = useTimeBlockStore();

  const deviceId = getDeviceId();
  const pendingCount = pendingMessages.length;

  // 合并显示：消息 + 时间块事件
  const allEvents = useMemo(() => {
    const messageEvents = network?.isOnline
      ? messages
      : [...pendingMessages, ...messages];

    // 将消息转换为事件格式
    const eventViews = messageEvents.map((msg) => ({
      id: msg.id,
      timestamp: msg.timestamp,
      content: msg.content,
      tags: new Set<string>(),
      type: 'message' as const,
      status: msg.status,
    }));

    // 时间块事件
    const timeBlockEvents = events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      content: event._content,
      tags: new Set(event._tags),
      type: 'timeblock' as const,
    }));

    // 合并并按时间排序
    const all = [...eventViews, ...timeBlockEvents].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    return all;
  }, [messages, pendingMessages, network?.isOnline, events]);

  // 按日期分组
  const groupedEvents = useMemo(() => {
    const groups = new Map<string, typeof allEvents>();

    for (const event of allEvents) {
      const date = new Date(event.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });

      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date)!.push(event);
    }

    return groups;
  }, [allEvents]);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    loadMessages();
    loadTimeBlocks();
  }, [loadMessages, loadTimeBlocks]);

  useEffect(() => {
    scrollToBottom();
  }, [allEvents]);

  // 处理发送/命令
  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // 解析时间块命令
    const command = parseTimeBlockCommand(trimmed);

    if (command.type === 'start' && command.name) {
      // 开始时间块
      startBlock(command.name);
      await saveTimeBlocks();
      // 添加事件到消息列表
      await sendMessage(`🔷 开始时间块: ${command.name}`);
    } else if (command.type === 'end') {
      // 结束时间块
      const block = endBlock();
      if (block) {
        await saveTimeBlocks();
        await sendMessage(`🔴 结束时间块: ${block.name}`);
      } else {
        await sendMessage('⚠️ 没有活跃的时间块');
      }
    } else {
      // 普通消息/笔记
      await sendMessage(trimmed);

      // 如果有活跃时间块，也添加到时间块记录
      if (activeBlock) {
        addEvent(trimmed);
        await saveTimeBlocks();
      }
    }

    setInputValue('');
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

  const hasNoEvents = allEvents.length === 0;

  // 获取活跃时间块信息
  const activeBlockInfo = useMemo(() => {
    if (!activeBlock) return null;
    const startEvent = events.find((e) => e.id === activeBlock.startId);
    if (!startEvent) return null;

    const duration = Date.now() - startEvent.timestamp;
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return {
      name: activeBlock.name,
      duration: hours > 0 ? `${hours}小时${remainingMinutes}分钟` : `${minutes}分钟`,
      isLong: duration > 4 * 60 * 60 * 1000, // 超过4小时
    };
  }, [activeBlock, events]);

  return (
    <div className="flex flex-col h-full max-h-[100dvh] lg:max-h-screen">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg sm:text-2xl font-bold">事件记录</h2>
          <p className="text-xs sm:text-sm text-muted-foreground" data-testid="connection-status">
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
        <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
          {/* 活跃时间块显示 */}
          {activeBlockInfo && (
            <Badge variant="default" className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" />
              <span className={activeBlockInfo.isLong ? "text-red-300" : ""}>
                {activeBlockInfo.name} ({activeBlockInfo.duration})
              </span>
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" data-testid="pending-count" className="text-xs">
              {pendingCount} 条待发送
            </Badge>
          )}
          <Badge variant={network.isOnline ? "default" : "secondary"} className="text-xs">
            {network.isOnline ? "在线" : "离线"}
          </Badge>
          <Button
            variant={showTimeBlocks ? "default" : "outline"}
            size="sm"
            onClick={() => setShowTimeBlocks(!showTimeBlocks)}
            className="text-xs px-2 sm:px-3"
          >
            <Clock className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            <span className="hidden sm:inline">时间块</span>
          </Button>
          <Button variant="outline" size="sm" className="text-xs px-2 sm:px-3">
            <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
            <span className="hidden sm:inline">新建</span>
          </Button>
        </div>
      </div>

      {/* 消息/事件列表 */}
      <div className="flex-1 overflow-auto p-3 sm:p-6" ref={messagesEndRef as React.RefObject<HTMLDivElement>} data-testid="message-list">
        {hasNoEvents ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4">
              <span className="text-2xl sm:text-3xl">📝</span>
            </div>
            <p className="text-base sm:text-lg font-medium mb-1">暂无事件记录</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              输入内容开始记录<br />
              <code className="text-xs bg-muted px-1 rounded">开始xxx</code> 开始时间块，<code className="text-xs bg-muted px-1 rounded">结束</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {Array.from(groupedEvents.entries()).map(([date, dateEvents]) => (
              <div key={date}>
                <div className="flex items-center justify-center mb-3 sm:mb-4">
                  <span className="text-xs text-muted-foreground bg-muted px-2 sm:px-3 py-1 rounded-full">
                    {date}
                  </span>
                </div>
                <div className="space-y-2 sm:space-y-3">
                  {dateEvents.map((event) => {
                    const isTimeBlockEvent = event.tags.has('block_start') || event.tags.has('block_end');
                    const isStart = event.tags.has('block_start');

                    return (
                      <div
                        key={event.id}
                        className={`flex gap-2 sm:gap-3 ${isOwnMessage(event as any) ? 'flex-row-reverse' : ''}`}
                        data-testid={`message-${(event as any).status || 'sent'}`}
                      >
                        <Avatar className="h-6 w-6 sm:h-8 sm:w-8 shrink-0">
                          <AvatarFallback className={isTimeBlockEvent
                            ? (isStart ? "bg-blue-500 text-white" : "bg-red-500 text-white")
                            : (isOwnMessage(event as any) ? "bg-primary text-primary-foreground" : "bg-muted")
                          }>
                            {getInitials(event.content.slice(0, 2) || 'EV')}
                          </AvatarFallback>
                        </Avatar>
                        <div className={`max-w-[75%] sm:max-w-[70%] ${isOwnMessage(event as any) ? 'text-right' : ''}`}>
                          <div
                            className={`inline-block px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl ${
                              isTimeBlockEvent
                                ? (isStart
                                    ? "bg-blue-100 text-blue-800 rounded-br-md"
                                    : "bg-red-100 text-red-800 rounded-br-md")
                                : (isOwnMessage(event as any)
                                    ? "bg-primary text-primary-foreground rounded-br-md"
                                    : "bg-muted rounded-bl-md")
                            }`}
                          >
                            {isTimeBlockEvent && (
                              <span className="text-xs opacity-75 mr-1">
                                {isStart ? '🔷' : '🔴'}
                              </span>
                            )}
                            <p className="text-xs sm:text-sm break-words">{event.content}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                            {formatTime(event.timestamp)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 时间块面板 */}
      {showTimeBlocks && (
        <div className="border-t bg-muted/30 p-3 sm:p-4 max-h-[40vh] sm:max-h-[50vh] overflow-auto">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            时间块历史
          </h3>
          {timeBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无时间块记录</p>
          ) : (
            <div className="space-y-2">
              {getTimeBlocksByStartTime().slice(-5).reverse().map((block) => {
                const startEvent = events.find((e) => e.id === block.startId);
                const blockEvents = getEventsInBlock(block);

                return (
                  <div key={block.id} className="bg-background rounded-lg p-3 border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">🔷 {block.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {startEvent && formatTime(startEvent.timestamp)}
                      </span>
                    </div>
                    {block._note && (
                      <p className="text-xs sm:text-sm text-muted-foreground mb-2">📝 {block._note}</p>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {blockEvents.length} 条事件
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 输入区域 */}
      <div className="px-3 sm:px-6 py-3 border-t bg-card shrink-0 safe-area-pb">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="shrink-0">
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              activeBlock
                ? `记录中: ${activeBlock.name}...`
                : network.isOnline
                  ? "输入消息... ('开始xxx' 开始时间块)"
                  : "离线模式 - 消息稍后发送"
            }
            className="flex-1 min-w-0 text-xs sm:text-sm"
            disabled={!network.isOnline && hasNoEvents}
            data-testid="message-input"
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || (!network.isOnline && hasNoEvents)}
            size="icon"
            className="shrink-0"
            data-testid="send-button"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
