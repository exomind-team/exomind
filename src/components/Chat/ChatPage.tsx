/**
 * EventLogPage - 事件日志页面
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - TimeBlock 控件栏                     │
 * │  - 事件列表（时间排序，最新在顶部）       │
 * │  - 输入区域                            │
 * │  - 同步状态显示                         │
 * └─────────────────────────────────────────┘
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { VoiceMessageInput } from '@/components/VoiceMessageInput';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';
import type { Event } from '@/lib/types/event';
import { getEventStorage, type Event as StorageEvent, type EventStorage } from '@/lib/storage/event-storage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { resolveSyncServerUrl } from '@/config/port-env';

export function ChatPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'disconnected' | 'syncing'>('disconnected');
  const listEndRef = useRef<HTMLDivElement>(null);
  const storageRef = useRef<EventStorage | null>(null);
  const { currentUser, isLoggedIn } = useSyncStore();

  // 初始化 EventStorage 和加载事件
  useEffect(() => {
    // 使用共享的 EventStorage 单例，与 TimeBlockService 保持一致
    const storage = getEventStorage(currentUser || undefined);
    storageRef.current = storage;

    const loadEvents = async () => {
      const loaded = await storage.getEvents();

      // 转换为 UI 使用的 Event 格式
      const converted: Event[] = loaded.map((e: StorageEvent) => ({
        id: e.id,
        timestamp: new Date(e.createdAt).getTime(),
        content: e.content,
        tags: new Set<string>(e.type ? [e.type] : []),
      }));

      // 反转为升序 [最旧, ..., 最新]
      setEvents([...converted].reverse());
    };

    loadEvents();

    // 监听变更（本地和远程）
    const unsubscribe = storage.onRemoteChange(() => {
      loadEvents();
    });

    // 如果已登录，连接到远程同步
    if (isLoggedIn && currentUser) {
      setSyncStatus('syncing');
      const syncServerUrl = resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>);
      const remoteUrl = `${syncServerUrl}/database/${currentUser}`;
      storage.syncToRemote(remoteUrl).then(() => {
        setSyncStatus('connected');
        console.log('[ChatPage] 远程同步已启动');
      }).catch((err) => {
        console.error('[ChatPage] 同步启动失败:', err);
        setSyncStatus('disconnected');
      });
    }

    return () => {
      unsubscribe();
      storage.stopSync();
      // 注意：不调用 storage.close()，因为 EventStorage 是共享的单例
      // 其他组件（如 TimeBlockService）可能还在使用它
    };
  }, [currentUser, isLoggedIn]);

  // 滚动到底部（最新事件在底部）
  useEffect(() => {
    if (events.length > 0) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events]);

  // 处理发送消息
  const handleSend = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    // 使用 EventStorage 保存到 PouchDB
    if (storageRef.current) {
      await storageRef.current.addEvent({
        id: crypto.randomUUID(),
        content: trimmed,
        createdAt: new Date().toISOString(),
      });

      // 刷新事件列表
      const loaded = await storageRef.current.getEvents();
      const converted: Event[] = loaded.map((e: StorageEvent) => ({
        id: e.id,
        timestamp: new Date(e.createdAt).getTime(),
        content: e.content,
        tags: new Set<string>(e.type ? [e.type] : []),
      }));
      setEvents([...converted].reverse());
    }
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
          {/* 同步状态 */}
          <Badge
            variant={syncStatus === 'connected' ? 'default' : syncStatus === 'syncing' ? 'outline' : 'secondary'}
            className="text-xs"
          >
            {syncStatus === 'connected' ? '已同步' : syncStatus === 'syncing' ? '同步中...' : '未同步'}
          </Badge>
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
