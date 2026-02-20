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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { VoiceMessageInput, type VoiceMessageInputHandle } from '@/components/VoiceMessageInput';
import { TimeBlockWidget, type TimeBlockWidgetHandle } from '@/components/TimeBlockWidget';
import { NewFocusTimerWidget, type NewFocusTimerWidgetHandle } from '@/ui/new/components/NewFocusTimerWidget';
import { EventMarkdown } from '@/components/Chat/EventMarkdown';
import { NewNowInputRow } from '@/ui/new/components/NewNowInputRow';
import type { Event } from '@/lib/types/event';
import { getEventStorage, type EventPageCursor, type EventStorage } from '@/lib/storage/event-storage';
import { getEventLogService } from '@/lib/services/eventlog.service';
import { buildRemoteDbUrl } from '@/lib/sync/remote-db-url';
import { useSyncStore } from '@/ui/stores/sync-store';
import {
  resolveSyncServerUrl,
  SYNC_SERVER_URL_CHANGED_EVENT,
} from '@/config/port-env';
import {
  mergeLatestEventsAscending,
  normalizeStorageEventsAscending,
  prependOlderEventsAscending,
} from './chat-event-pagination';

const PAGE_SIZE = 50;
const TOP_LOAD_THRESHOLD = 40;
const NEAR_BOTTOM_THRESHOLD = 120;

interface ChatPageProps {
  variant?: 'default' | 'new-mobile'; // new-mobile（新移动端外观）用于 v0.3.0 UI 重构
  hideHeader?: boolean;
}

function resolvePlatformLabel(platform?: string): string {
  if (!platform) {
    return 'Web';
  }

  const normalized = platform.toLowerCase();
  if (normalized.includes('win')) return 'Win';
  if (normalized.includes('mac')) return 'macOS';
  if (normalized.includes('linux')) return 'Linux';
  if (normalized.includes('android')) return 'Android';
  if (normalized.includes('ios') || normalized.includes('iphone') || normalized.includes('ipad')) return 'iOS';
  return platform;
}

function resolveAvatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '我';
  return trimmed.charAt(0).toUpperCase();
}

export function ChatPage({ variant = 'default', hideHeader = false }: ChatPageProps = {}) {
  const envMap = import.meta.env as Record<string, string | undefined>;
  const [events, setEvents] = useState<Event[]>([]);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'disconnected' | 'syncing'>('disconnected');
  const [syncServerUrl, setSyncServerUrl] = useState(() => resolveSyncServerUrl(envMap));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const storageRef = useRef<EventStorage | null>(null);
  const nextCursorRef = useRef<EventPageCursor | null>(null);
  const loadingOlderRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const eventLogService = useRef(getEventLogService());
  const { currentUser, isLoggedIn, credentials } = useSyncStore();
  const voiceMessageInputRef = useRef<VoiceMessageInputHandle | null>(null);
  const timeBlockWidgetRef = useRef<TimeBlockWidgetHandle | null>(null);
  const newFocusTimerWidgetRef = useRef<NewFocusTimerWidgetHandle | null>(null);
  const userDisplayName = currentUser || 'Hailay';
  const userMeta = useMemo(() => {
    const deviceName = credentials?.deviceName?.trim() || '本机设备';
    const platformLabel = resolvePlatformLabel(credentials?.platform);
    return {
      deviceName,
      platformLabel,
      avatarInitial: resolveAvatarInitial(userDisplayName),
    };
  }, [credentials?.deviceName, credentials?.platform, userDisplayName]);
  const assistantDeviceLabel = `· ExoMind · ${userMeta.platformLabel}`;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    listEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  const isNearBottom = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) {
      return true;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceToBottom <= NEAR_BOTTOM_THRESHOLD;
  }, []);

  const loadInitialEvents = useCallback(async (storage: EventStorage) => {
    setIsInitialLoading(true);
    const page = await storage.getEventsPage({ limit: PAGE_SIZE });
    setEvents(normalizeStorageEventsAscending(page.events));
    setHasMore(page.hasMore);
    nextCursorRef.current = page.nextCursor;
    shouldStickToBottomRef.current = true;

    requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    setIsInitialLoading(false);
  }, [scrollToBottom]);

  const refreshLatestEvents = useCallback(async (storage: EventStorage) => {
    const page = await storage.getEventsPage({ limit: PAGE_SIZE });
    const latestAsc = normalizeStorageEventsAscending(page.events);

    setEvents((prev) => mergeLatestEventsAscending(prev, latestAsc));
    setHasMore((prev) => prev || page.hasMore);

    if (!nextCursorRef.current) {
      nextCursorRef.current = page.nextCursor;
    }

    requestAnimationFrame(() => {
      if (shouldStickToBottomRef.current) {
        scrollToBottom('smooth');
      }
    });
  }, [scrollToBottom]);

  const loadOlderEvents = useCallback(async () => {
    const storage = storageRef.current;
    const cursor = nextCursorRef.current;

    if (!storage || !cursor || !hasMore || loadingOlderRef.current) {
      return;
    }

    const container = listContainerRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const page = await storage.getEventsPage({
        limit: PAGE_SIZE,
        cursor,
      });

      const olderAsc = normalizeStorageEventsAscending(page.events);
      setEvents((prev) => prependOlderEventsAscending(prev, olderAsc));
      setHasMore(page.hasMore);
      nextCursorRef.current = page.nextCursor;

      requestAnimationFrame(() => {
        const currentContainer = listContainerRef.current;
        if (!currentContainer) return;

        const nextScrollHeight = currentContainer.scrollHeight;
        currentContainer.scrollTop = Math.max(0, nextScrollHeight - previousScrollHeight);
      });
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [hasMore]);

  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) return;

    if (container.scrollTop <= TOP_LOAD_THRESHOLD) {
      void loadOlderEvents();
    }
  }, [loadOlderEvents]);

  useEffect(() => {
    const refreshSyncServerUrl = () => {
      setSyncServerUrl(resolveSyncServerUrl(import.meta.env as Record<string, string | undefined>));
    };

    refreshSyncServerUrl();
    window.addEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    return () => {
      window.removeEventListener(SYNC_SERVER_URL_CHANGED_EVENT, refreshSyncServerUrl);
    };
  }, []);

  // 初始化 EventStorage 和加载事件
  useEffect(() => {
    const storage = getEventStorage(currentUser || undefined);
    storageRef.current = storage;
    void loadInitialEvents(storage);

    const unsubscribe = storage.onRemoteChange(() => {
      shouldStickToBottomRef.current = isNearBottom();
      void refreshLatestEvents(storage);
    });

    if (isLoggedIn && currentUser) {
      setSyncStatus('syncing');
      const remoteUrl = buildRemoteDbUrl(syncServerUrl, currentUser);
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
    };
  }, [currentUser, isLoggedIn, isNearBottom, loadInitialEvents, refreshLatestEvents, syncServerUrl]);

  // 处理发送消息
  const handleSend = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    if (storageRef.current) {
      shouldStickToBottomRef.current = true;
      await eventLogService.current.addEvent(trimmed);
      await refreshLatestEvents(storageRef.current);
    }
  }, [refreshLatestEvents]);

  // 全局快捷键：未聚焦输入框时 Enter/Shift+Enter/Ctrl+Enter 控制时间块和聚焦
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target instanceof HTMLElement ? target : null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
      return Boolean(el.closest('input, textarea, [contenteditable="true"]'));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key !== 'Enter') return;

      // 如果焦点在按钮/链接上，让默认 Enter 行为触发
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'BUTTON' ||
        activeEl.getAttribute('role') === 'button' ||
        activeEl instanceof HTMLAnchorElement
      )) {
        return;
      }

      if (isEditableTarget(e.target)) return;

      const timerWidget = variant === 'new-mobile'
        ? newFocusTimerWidgetRef.current
        : timeBlockWidgetRef.current;

      // Ctrl+Enter: 弹出反馈对话框（正在计时或暂停中）
      if (e.ctrlKey) {
        e.preventDefault();
        const timerState = timerWidget?.getTimerState();
        if (timerState === 'running' || timerState === 'paused') {
          timerWidget?.endDialog();
        }
        return;
      }

      // Shift+Enter: 暂停/继续时间块，或展开时间块输入框
      if (e.shiftKey) {
        e.preventDefault();
        const timerState = timerWidget?.getTimerState();
        if (timerState === 'running' || timerState === 'paused') {
          // 正在计时或暂停中 → 暂停/继续
          timerWidget?.pauseOrResume();
        } else {
          // 空闲/无时间块 → 展开时间块输入框
          timerWidget?.expandAndFocusTaskName();
        }
        return;
      }

      // Enter: 聚焦输入框
      e.preventDefault();
      voiceMessageInputRef.current?.focusText();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant]);

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
    if (event.tags.has('block_pause')) return '⏸️';
    if (event.tags.has('block_resume')) return '▶️';
    if (event.tags.has('block_end')) return '🔴';
    if (event.tags.has('block_feedback')) return '📝';
    return '📝';
  };

  // 获取事件背景色
  const getEventBgColor = (event: Event) => {
    if (event.tags.has('block_start')) {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100 rounded-br-md';
    }
    if (event.tags.has('block_pause')) {
      return 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100 rounded-br-md';
    }
    if (event.tags.has('block_resume')) {
      return 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100 rounded-br-md';
    }
    if (event.tags.has('block_end')) {
      return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100 rounded-br-md';
    }
    return 'bg-muted rounded-bl-md';
  };

  // 获取事件前缀
  const getEventPrefix = (event: Event) => {
    if (event.tags.has('block_start')) return '🔷';
    if (event.tags.has('block_pause')) return '⏸️';
    if (event.tags.has('block_resume')) return '▶️';
    if (event.tags.has('block_end')) return '🔴';
    if (event.tags.has('block_feedback')) return '📝';
    return null;
  };

  const formatMessageTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const isSystemEvent = (event: Event) => (
    event.tags.has('block_start')
    || event.tags.has('block_pause')
    || event.tags.has('block_resume')
    || event.tags.has('block_end')
    || event.tags.has('block_feedback')
  );

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

  const rootClassName =
    variant === 'new-mobile'
      ? 'flex h-full min-h-0 flex-col bg-[#FAF7F5]'
      : 'flex flex-col h-full max-h-[100dvh] lg:max-h-screen';

  const listClassName =
    variant === 'new-mobile'
      ? 'flex-1 overflow-auto border-y border-[#E8E3DE]'
      : 'flex-1 overflow-auto p-3 sm:p-6';

  return (
    <div className={rootClassName}>
      {/* 头部 */}
      {!hideHeader && (
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
            {events.length}{hasMore ? '+' : ''} 条事件
          </Badge>
        </div>
      )}

      {/* TimeBlock 控件栏 */}
      {variant === 'new-mobile' ? (
        <NewFocusTimerWidget ref={newFocusTimerWidgetRef} />
      ) : (
        <TimeBlockWidget ref={timeBlockWidgetRef} variant="default" />
      )}

      {/* 事件列表 */}
      <div
        ref={listContainerRef}
        className={listClassName}
        data-testid="event-list"
        onScroll={handleListScroll}
      >
        {isInitialLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className={variant === 'new-mobile' ? 'mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF2F7]' : 'w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4'}>
              <span className="text-2xl sm:text-3xl">📝</span>
            </div>
            <p className="mb-1 text-base font-semibold text-stone-800 sm:text-lg">暂无事件记录</p>
            <p className="text-xs text-muted-foreground sm:text-sm">
              开始计时或输入内容记录事件
            </p>
          </div>
        ) : variant === 'new-mobile' ? (
          <div className="space-y-4 px-5 pb-1 pt-3">
            {loadingOlder && (
              <div className="flex justify-center">
                <span className="text-xs text-muted-foreground" data-testid="event-list-loading-more">
                  加载更多...
                </span>
              </div>
            )}
            {events.map((event) => {
              const systemEvent = isSystemEvent(event);
              if (systemEvent) {
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-2"
                    data-testid="new-mobile-system-message-row"
                  >
                    <Avatar className="mt-0.5 h-8 w-8 shrink-0">
                      <AvatarFallback className="rounded-full bg-[#E8EEF8] text-[11px] text-[#40618A]">
                        {getEventIcon(event)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 max-w-[85%] flex-1">
                      <div
                        className="mb-1 flex items-center gap-1 text-[11px] leading-[1.4]"
                        data-testid="new-mobile-message-meta"
                      >
                        <span className="text-xs font-semibold text-[#1C1917]">AI 助理</span>
                        <span className="text-[#B8AFA9]">{assistantDeviceLabel}</span>
                        <span className="text-[#B8AFA9]">{formatMessageTime(event.timestamp)}</span>
                      </div>
                      <div className="rounded-2xl border border-[#F0ECE8] bg-white px-[14px] py-3 text-[13px] leading-[1.6] text-[#44403C]">
                        <EventMarkdown content={event.content} />
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={event.id}
                  className="flex justify-end gap-2"
                  data-testid="new-mobile-user-message-row"
                >
                  <div className="flex max-w-[84%] flex-col items-end">
                    <div
                      className="mb-1 flex items-center justify-end gap-1 text-[11px] leading-[1.4]"
                      data-testid="new-mobile-message-meta"
                    >
                      <span className="text-[#B8AFA9]">{userMeta.deviceName}</span>
                      <span className="text-[#B8AFA9]">· App ·</span>
                      <span className="text-[#A8A29E]">{formatMessageTime(event.timestamp)}</span>
                      <span className="text-xs font-semibold text-[#1C1917]">{userDisplayName}</span>
                    </div>
                    <div className="rounded-2xl bg-[#FDECEA] px-[14px] py-[10px] text-[13px] leading-[1.6] text-[#3D1410]">
                      <EventMarkdown content={event.content} />
                    </div>
                  </div>
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="rounded-full bg-[#F1E3DB] text-[11px] font-semibold text-[#6B2F24]">
                      {userMeta.avatarInitial}
                    </AvatarFallback>
                  </Avatar>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {loadingOlder && (
              <div className="flex justify-center">
                <span className="text-xs text-muted-foreground" data-testid="event-list-loading-more">
                  加载更多...
                </span>
              </div>
            )}
            {Array.from(groupedEvents.entries()).map(([date, dateEvents]) => (
              <div key={date}>
                <div className="flex items-center justify-center mb-3 sm:mb-4">
                  <span className="text-xs text-muted-foreground bg-muted px-2 sm:px-3 py-1 rounded-full">
                    {date}
                  </span>
                </div>
                <div className="space-y-2 sm:space-y-3">
                  {dateEvents.map((event) => (
                    <div key={event.id} className="flex gap-2 sm:gap-3">
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
                          <EventMarkdown content={event.content} />
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
      {variant === 'new-mobile' ? (
        <NewNowInputRow
          ref={voiceMessageInputRef}
          onSend={handleSend}
          placeholder="记录当下的事实..."
        />
      ) : (
        <VoiceMessageInput
          ref={voiceMessageInputRef}
          onSend={handleSend}
          placeholder="输入内容记录事件..."
          buttonSize={40}
          variant="default"
        />
      )}
    </div>
  );
}
