/**
 * EventLogPage - 事件日志页面
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - TimeBlock 控件栏                     │
 * │  - 事件列表（时间排序，最新在顶部）       │
 * │  - 输入区域                            │
 * └─────────────────────────────────────────┘
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { VoiceMessageInput } from '@/components/VoiceMessageInput';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';
import { getEventLogService } from '@/lib/services';
import type { Event } from '@/lib/types/event';

export function ChatPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const listEndRef = useRef<HTMLDivElement>(null);

  // 加载事件并监听变化
  useEffect(() => {
    const eventLogService = getEventLogService();

    const loadEvents = async () => {
      const loaded = await eventLogService.loadEvents();
      console.log('[ChatPage] 加载事件:', loaded.length, '条');
      setEvents(loaded);
    };

    loadEvents();

    // 监听新事件
    const unsubscribe = eventLogService.onEvent((newEvent) => {
      console.log('[ChatPage] 收到新事件:', newEvent.id);
      setEvents(prev => {
        // 检查是否已存在
        const exists = prev.some(e => e.id === newEvent.id);
        if (exists) {
          console.log('[ChatPage] 事件已存在，忽略:', newEvent.id);
          return prev;
        }
        return [newEvent, ...prev];  // 最新在前（顶部）
      });
    });

    return unsubscribe;
  }, []);

  // 滚动到顶部（最新事件在顶部）
  useEffect(() => {
    if (events.length > 0) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [events]);

  // 处理发送消息
  const handleSend = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    console.log('[ChatPage] 发送事件:', trimmed);
    const eventLogService = getEventLogService();
    await eventLogService.addEvent(trimmed);
  }, []);

  // 格式化时间
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

  // 获取事件图标
  const getEventIcon = (event: Event) => {
    if (event.tags.has('block_start')) return '🔷';
    if (event.tags.has('block_end')) return '🔴';
    if (event.tags.has('block_feedback')) return '📝';
    return '📝';
  };

  // 获取事件背景色
  const getEventBgColor = (event: Event) => {
    if (event.tags.has('block_start')) return 'bg-blue-100 text-blue-800 rounded-br-md';
    if (event.tags.has('block_end')) return 'bg-red-100 text-red-800 rounded-br-md';
    return 'bg-muted rounded-bl-md';
  };

  // 获取事件前缀
  const getEventPrefix = (event: Event) => {
    if (event.tags.has('block_start')) return '🔷';
    if (event.tags.has('block_end')) return '🔴';
    if (event.tags.has('block_feedback')) return '📝';
    return null;
  };

  // 按日期分组
  const groupedEvents = events.reduce((groups, event) => {
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
    return groups;
  }, new Map<string, Event[]>());

  return (
    <div className="flex flex-col h-full max-h-[100dvh] lg:max-h-screen">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg sm:text-2xl font-bold">事件日志</h2>
        </div>
        <Badge variant="secondary" className="text-xs">
          {events.length} 条事件
        </Badge>
      </div>

      {/* TimeBlock 控件栏 */}
      <TimeBlockWidget />

      {/* 事件列表 */}
      <div className="flex-1 overflow-auto p-3 sm:p-6" data-testid="event-list">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4">
              <span className="text-2xl sm:text-3xl">📝</span>
            </div>
            <p className="text-base sm:text-lg font-medium mb-1">暂无事件记录</p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              开始计时或输入内容记录事件
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
                  {dateEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex gap-2 sm:gap-3"
                    >
                      <Avatar className="h-6 w-6 sm:h-8 sm:w-8 shrink-0">
                        <AvatarFallback className={getEventBgColor(event)}>
                          {getEventIcon(event)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[75%] sm:max-w-[70%]">
                        <div
                          className={`inline-block px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl ${getEventBgColor(event)}`}
                        >
                          {getEventPrefix(event) && (
                            <span className="text-xs opacity-75 mr-1">
                              {getEventPrefix(event)}
                            </span>
                          )}
                          <p className="text-xs sm:text-sm break-words">{event.content}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">
                          {formatTime(event.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* 输入区域 */}
      <VoiceMessageInput
        onSend={handleSend}
        placeholder="输入内容记录事件..."
        buttonSize={40}
      />
    </div>
  );
}
