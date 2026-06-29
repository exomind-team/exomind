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
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Play, Pause, Square, FileText, NotepadText, Bot, Mic, Link2, ListTodo } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { VoiceMessageInput, type VoiceMessageInputHandle } from '@/components/VoiceMessageInput';
import { TimeBlockWidget, type TimeBlockWidgetHandle } from '@/components/TimeBlockWidget';
import { FocusTimerWidget, type FocusTimerWidgetHandle } from '@/ui/app/components/FocusTimerWidget';
import { EventMarkdown } from '@/components/Chat/EventMarkdown';
import { MessageActions } from '@/components/Chat/MessageActions';
import { NowInputRow } from '@/ui/app/components/NowInputRow';
import { PageMoreMenu } from '@/ui/app/components/PageMoreMenu';
import type { Event, EventRef } from '@/lib/types/event';
import { getEventLogService, type EventLogLoadResult } from '@/lib/services/eventlog.service';
import { useSyncStore } from '@/ui/stores/sync-store';
import { log } from '@/lib/logger';
import { PerfTrace, logPerfInfo, perfNow, waitForNextPaint } from '@/lib/utils/perf-trace';
import { registerMainWindowFocusTarget } from '@/services/main-window-focus-targets';
import { MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT } from '@/services/main-window-shortcut.service';
import { mergeLatestEventsAscending, prependOlderEventsAscending } from './chat-event-pagination';
import {
  extractEventPermalinksFromContent,
  normalizeEventRefs,
  summarizeEventRefExcerpt,
  summarizeEventRefContent,
} from '@/lib/eventlog/event-refs';
import {
  buildEventlogRecordLocatePath,
  buildEventlogRecordPermalink,
  parseEventlogLocateSearch,
} from '@/ui/app/pages/eventlog-route-memory';

const PAGE_SIZE = 50;
// 初次加载只拉最近 N 条（而非全量），其余更早历史按需向后端分页拉取。
// 避免账号事件量达数万条时一次性拉取 + 解析 + 排序造成十几秒的首屏卡顿。
const INITIAL_LOAD_LIMIT = 200;
// 向上滚动越过内存头部时，单次向后端拉取的更早历史页大小。
const OLDER_PAGE_SIZE = 50;
// permalink 定位到很旧的事件时，向后端回溯分页的最大页数（防止失控循环）。
const MAX_LOCATE_OLDER_PAGES = 40;
const TOP_LOAD_THRESHOLD = 40;
const NEAR_BOTTOM_THRESHOLD = 120;
const EVENT_HIGHLIGHT_DURATION_MS = 2_000;
const RT_REFRESH_INTERVAL_MS = 10_000;
const RT_FULL_RECONCILE_INTERVAL_MS = 60_000;
const TASK_CREATED_EVENT_TAGS = [
  'task_created',
] as const;
const TASK_LIFECYCLE_EVENT_TAGS = [
  'task_started',
  'task_resumed',
  'task_suspended',
  'task_completed',
  'task_cancelled',
  // Backward compatibility for historical RT task transition events. Remove after migration.
  'task_transition',
] as const;
const TASK_RELATION_EVENT_TAGS = [
  'task_linked',
  'task_unlinked',
] as const;
const TASK_SYSTEM_EVENT_TAGS = [
  ...TASK_CREATED_EVENT_TAGS,
  ...TASK_LIFECYCLE_EVENT_TAGS,
  ...TASK_RELATION_EVENT_TAGS,
] as const;

function sortEventsAscending(events: Event[]): Event[] {
  return [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.id.localeCompare(b.id);
  });
}

function getLatestEventCursor(events: Event[]): { id: string; timestamp: number } | null {
  const latestEvent = events[events.length - 1];
  if (!latestEvent) {
    return null;
  }

  return {
    id: latestEvent.id,
    timestamp: latestEvent.timestamp,
  };
}

interface ChatPageProps {
  variant?: 'default' | 'new-mobile'; // new-mobile（新移动端外观）用于 v0.3.0 UI 重构
  hideHeader?: boolean;
  showTimerWidget?: boolean;
  initialKeepAliveState?: ChatPageKeepAliveState | null;
  onKeepAliveStateChange?: (state: ChatPageKeepAliveState) => void;
}

type RefreshTrigger = 'poll' | 'event' | 'external-refresh';

export interface ChatPageKeepAliveState {
  profileId: string | null;
  eventsAsc: Event[];
  visibleCount: number;
  snapshotRevision?: string | null;
  lastFullRefreshAt: number;
}

const UNKNOWN_DEVICE_LABEL = '未知设备';
const UNKNOWN_PLATFORM_LABEL = '未知平台';
const CLOSED_PROFILE_EVENTLOG_NAME = '未名';

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

function resolveEventLogUserDisplayName(currentUser?: string | null): string {
  if (typeof currentUser !== 'string') {
    return CLOSED_PROFILE_EVENTLOG_NAME;
  }

  const trimmed = currentUser.trim();
  return trimmed.length > 0 ? trimmed : CLOSED_PROFILE_EVENTLOG_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRefreshOnlyEvent(event: Event): boolean {
  if (!isRecord(event.metadata)) {
    return false;
  }

  return event.metadata.refreshOnly === true;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatEventSourceLabel(event: Event): string {
  if (!isRecord(event.metadata)) {
    return UNKNOWN_DEVICE_LABEL;
  }

  const sourceRaw = event.metadata.source;
  if (!isRecord(sourceRaw)) {
    return UNKNOWN_DEVICE_LABEL;
  }

  const platform = readNonEmptyString(sourceRaw.platform);
  const deviceName = readNonEmptyString(sourceRaw.deviceName);
  const platformLabel = platform ? resolvePlatformLabel(platform) : UNKNOWN_PLATFORM_LABEL;

  if (!platform && !deviceName) {
    return UNKNOWN_DEVICE_LABEL;
  }

  const resolvedDeviceName = deviceName ?? (platform ? `${platformLabel} Device` : UNKNOWN_DEVICE_LABEL);
  return `${resolvedDeviceName} · ${platformLabel}`;
}

function isVoiceInputEvent(event: Event): boolean {
  return isRecord(event.metadata) && event.metadata.inputSource === 'voice';
}

function hasAnyTag(event: Event, tags: readonly string[]): boolean {
  return tags.some((tag) => event.tags.has(tag));
}

function isTaskCreatedEvent(event: Event): boolean {
  return hasAnyTag(event, TASK_CREATED_EVENT_TAGS);
}

function isTaskLifecycleEvent(event: Event): boolean {
  return hasAnyTag(event, TASK_LIFECYCLE_EVENT_TAGS);
}

function isTaskRelationEvent(event: Event): boolean {
  return hasAnyTag(event, TASK_RELATION_EVENT_TAGS);
}

function resolveTaskLifecycleStatus(event: Event): string | null {
  if (event.tags.has('task_started') || event.tags.has('task_resumed')) return 'in_progress';
  if (event.tags.has('task_suspended')) return 'suspended';
  if (event.tags.has('task_completed')) return 'completed';
  if (event.tags.has('task_cancelled')) return 'cancelled';
  if (!event.tags.has('task_transition') || !isRecord(event.metadata)) {
    return null;
  }

  return readNonEmptyString(event.metadata.new_status) ?? readNonEmptyString(event.metadata.newStatus);
}

function VoiceInputBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
      <Mic size={10} />
      语音输入
    </span>
  );
}

export function ChatPage({
  variant = 'default',
  hideHeader = false,
  showTimerWidget = true,
  initialKeepAliveState = null,
  onKeepAliveStateChange,
}: ChatPageProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [quotedRefs, setQuotedRefs] = useState<EventRef[]>([]);
  const [expandedForwardRefsEventId, setExpandedForwardRefsEventId] = useState<string | null>(null);
  const [pendingLocateEventId, setPendingLocateEventId] = useState<string | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const allEventsRef = useRef<Event[]>([]);
  const nextStartIndexRef = useRef(0);
  const visibleCountRef = useRef(PAGE_SIZE);
  const loadingOlderRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshQueuedTriggerRef = useRef<RefreshTrigger>('poll');
  const lastFullRefreshAtRef = useRef(0);
  const lastAppliedSnapshotRevisionRef = useRef<string | null | undefined>(undefined);
  // 后端是否仍有比内存中最早事件更旧的历史。初次/分页加载后据返回量更新，
  // 用于让 hasMore 同时反映「内存里还有未展开」与「后端还有更早页」。
  const hasMoreOlderFromBackendRef = useRef(true);
  // 后端更早页拉取的并发护栏（滚动触发与 permalink 定位可能同时调用）。
  const olderBackendFetchInFlightRef = useRef(false);
  const eventRowRefs = useRef(new Map<string, HTMLDivElement>());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventLogService = useRef(getEventLogService());
  const { currentUser, isLoggedIn, activeProfileId } = useSyncStore();
  const syncStatus: 'connected' | 'disconnected' | 'syncing' = isLoggedIn && Boolean(currentUser)
    ? 'connected'
    : 'disconnected';
  const voiceMessageInputRef = useRef<VoiceMessageInputHandle | null>(null);
  const timeBlockWidgetRef = useRef<TimeBlockWidgetHandle | null>(null);
  const focusTimerWidgetRef = useRef<FocusTimerWidgetHandle | null>(null);
  const userDisplayName = useMemo(() => resolveEventLogUserDisplayName(currentUser), [currentUser]);
  const userAvatarInitial = useMemo(() => resolveAvatarInitial(userDisplayName), [userDisplayName]);
  const keepAliveProfileId = useMemo(() => {
    const normalized = activeProfileId?.trim();
    return normalized && normalized.length > 0 ? normalized : null;
  }, [activeProfileId]);
  const locateTarget = useMemo(
    () => location.pathname === '/eventlog/record' ? parseEventlogLocateSearch(location.searchStr ?? '') : { eventId: null, shouldLocate: false },
    [location.pathname, location.searchStr],
  );

  useEffect(() => registerMainWindowFocusTarget(
    MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT,
    () => {
      voiceMessageInputRef.current?.focusText();
    },
  ), []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    listEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  const assignEventRowRef = useCallback((eventId: string) => (node: HTMLDivElement | null) => {
    if (node) {
      eventRowRefs.current.set(eventId, node);
      return;
    }

    eventRowRefs.current.delete(eventId);
  }, []);

  const resolveEventRefSummary = useCallback((eventId: string): string | undefined => {
    const matched = allEventsRef.current.find((event) => event.id === eventId);
    return matched ? summarizeEventRefContent(matched.content) : undefined;
  }, []);

  const buildRefsFromContent = useCallback((content: string, seededRefs: readonly EventRef[] = []): EventRef[] => {
    const seededById = new Map(normalizeEventRefs(seededRefs).map((ref) => [ref.eventId, ref]));
    const contentRefs = extractEventPermalinksFromContent(content).map((item) => ({
      kind: 'event' as const,
      eventId: item.eventId,
      summary: seededById.get(item.eventId)?.summary ?? item.label ?? resolveEventRefSummary(item.eventId),
    }));
    return normalizeEventRefs(contentRefs);
  }, [resolveEventRefSummary]);

  const locateEventInRecord = useCallback((eventId: string, syncUrl = false) => {
    setExpandedForwardRefsEventId(null);
    if (syncUrl) {
      void navigate({
        to: buildEventlogRecordLocatePath(eventId) as never,
      });
    }
    setPendingLocateEventId(eventId);
  }, [navigate]);

  const handleQuoteEvent = useCallback((event: Event) => {
    if (variant !== 'new-mobile') {
      return;
    }

    setQuotedRefs((current) => normalizeEventRefs([
      ...current,
      {
        kind: 'event',
        eventId: event.id,
        summary: summarizeEventRefContent(event.content),
      },
    ]));
    voiceMessageInputRef.current?.focusText();
  }, [variant]);

  const resolveQuotedRefExcerpt = useCallback((eventId: string): string | undefined => {
    const matched = allEventsRef.current.find((event) => event.id === eventId);
    return matched ? summarizeEventRefExcerpt(matched.content) : undefined;
  }, []);

  const isNearBottom = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) {
      return true;
    }

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceToBottom <= NEAR_BOTTOM_THRESHOLD;
  }, []);

  const persistKeepAliveState = useCallback((eventsAsc: Event[], visibleCount = visibleCountRef.current) => {
    if (!onKeepAliveStateChange) {
      return;
    }

    onKeepAliveStateChange({
      profileId: keepAliveProfileId,
      eventsAsc: [...eventsAsc],
      visibleCount,
      snapshotRevision: lastAppliedSnapshotRevisionRef.current ?? null,
      lastFullRefreshAt: lastFullRefreshAtRef.current,
    });
  }, [keepAliveProfileId, onKeepAliveStateChange]);

  const applyVisibleWindow = useCallback((eventsAsc: Event[], requestedVisibleCount = visibleCountRef.current) => {
    allEventsRef.current = eventsAsc;
    const safeVisibleCount = Math.max(PAGE_SIZE, requestedVisibleCount);
    const nextStartIndex = Math.max(0, eventsAsc.length - safeVisibleCount);
    visibleCountRef.current = safeVisibleCount;
    nextStartIndexRef.current = nextStartIndex;
    setEvents(eventsAsc.slice(nextStartIndex));
    // 还有更早可展开 = 内存里有未进入窗口的更早事件，或后端仍有更旧历史可拉。
    setHasMore(nextStartIndex > 0 || hasMoreOlderFromBackendRef.current);
    persistKeepAliveState(eventsAsc, safeVisibleCount);
  }, [persistKeepAliveState]);

  const hydrateFromKeepAliveState = useCallback(() => {
    if (!initialKeepAliveState) {
      return false;
    }

    if (initialKeepAliveState.profileId !== keepAliveProfileId) {
      return false;
    }

    const trace = new PerfTrace('ChatPage hydrateKeepAlive', {
      page: 'eventlog-record',
      cached: initialKeepAliveState.eventsAsc.length,
    });
    shouldStickToBottomRef.current = true;
    lastAppliedSnapshotRevisionRef.current = initialKeepAliveState.snapshotRevision ?? null;
    lastFullRefreshAtRef.current = initialKeepAliveState.lastFullRefreshAt;
    // 从缓存恢复时无法确知后端是否还有更旧历史，乐观置 true；
    // 首次向后端回溯若返回不足一页会自我纠正为 false。
    hasMoreOlderFromBackendRef.current = true;
    applyVisibleWindow(initialKeepAliveState.eventsAsc, initialKeepAliveState.visibleCount);
    trace.step('apply-visible-window', {
      visibleCount: Math.min(initialKeepAliveState.eventsAsc.length, Math.max(PAGE_SIZE, initialKeepAliveState.visibleCount)),
    });
    setIsInitialLoading(false);
    void (async () => {
      await waitForNextPaint();
      trace.step('paint-visible-window', {
        visibleCount: Math.min(initialKeepAliveState.eventsAsc.length, Math.max(PAGE_SIZE, initialKeepAliveState.visibleCount)),
      });
      scrollToBottom('auto');
      trace.step('scroll-to-bottom');
      trace.finish({
        cached: initialKeepAliveState.eventsAsc.length,
        visibleCount: Math.min(initialKeepAliveState.eventsAsc.length, Math.max(PAGE_SIZE, initialKeepAliveState.visibleCount)),
      });
    })();
    return true;
  }, [applyVisibleWindow, initialKeepAliveState, keepAliveProfileId, scrollToBottom]);

  const loadInitialEvents = useCallback(async () => {
    const trace = new PerfTrace('ChatPage loadInitialEvents', {
      page: 'eventlog-record',
    });
    setIsInitialLoading(true);
    try {
      // 只拉最近 INITIAL_LOAD_LIMIT 条；更早历史在向上滚动时按需向后端分页。
      const initialResult = await eventLogService.current.loadEventsDetailed({
        limit: INITIAL_LOAD_LIMIT,
      });
      const loadedEvents = sortEventsAscending(initialResult.events);
      // 拉满一页说明后端大概率还有更旧历史；不足一页说明已到最早。
      hasMoreOlderFromBackendRef.current = loadedEvents.length >= INITIAL_LOAD_LIMIT;
      trace.step('load-events-detailed', {
        fetched: loadedEvents.length,
        semantics: initialResult.semantics,
        snapshotRevision: initialResult.snapshotRevision ?? null,
      });
      shouldStickToBottomRef.current = true;
      lastAppliedSnapshotRevisionRef.current = initialResult.snapshotRevision ?? null;
      applyVisibleWindow(loadedEvents, PAGE_SIZE);
      lastFullRefreshAtRef.current = Date.now();
      persistKeepAliveState(loadedEvents, PAGE_SIZE);
      trace.step('apply-visible-window', {
        visibleCount: Math.min(loadedEvents.length, PAGE_SIZE),
      });
      await waitForNextPaint();
      trace.step('paint-visible-window', {
        visibleCount: Math.min(loadedEvents.length, PAGE_SIZE),
      });
      scrollToBottom('auto');
      trace.step('scroll-to-bottom');
      trace.finish({
        fetched: loadedEvents.length,
        visibleCount: Math.min(loadedEvents.length, PAGE_SIZE),
      });
    } catch (error) {
      trace.fail(error);
      throw error;
    } finally {
      setIsInitialLoading(false);
    }
  }, [applyVisibleWindow, persistKeepAliveState, scrollToBottom]);

  const refreshLatestEvents = useCallback(async (
    behavior: ScrollBehavior = 'smooth',
    trigger: RefreshTrigger = 'poll',
  ) => {
    const trace = new PerfTrace('ChatPage refreshLatestEvents', {
      page: 'eventlog-record',
      trigger,
      behavior,
    });
    try {
      // 全量 reconcile 也只覆盖「已加载的最近范围」(至少 INITIAL_LOAD_LIMIT)，
      // 既保住用户已向上翻出的更早历史不被丢弃，又不会退回一次性全量拉数万条。
      const reconcileLimit = Math.max(INITIAL_LOAD_LIMIT, allEventsRef.current.length);
      const latestCursor = getLatestEventCursor(allEventsRef.current);
      const shouldForceFullReconcile = trigger === 'external-refresh'
        || (
          latestCursor !== null
          && (Date.now() - lastFullRefreshAtRef.current) >= RT_FULL_RECONCILE_INTERVAL_MS
        );
      let requestedMode: 'full' | 'incremental' = latestCursor && !shouldForceFullReconcile ? 'incremental' : 'full';
      trace.step('resolve-refresh-mode', {
        requestedMode,
        latestCursorId: latestCursor?.id ?? null,
      });
      let loadedResult: EventLogLoadResult = await eventLogService.current.loadEventsDetailed(
        requestedMode === 'incremental'
          ? {
              sinceId: latestCursor!.id,
              sinceTimestamp: latestCursor!.timestamp,
            }
          : { limit: reconcileLimit },
      );
      let mode: 'full' | 'incremental' = requestedMode === 'incremental'
        && loadedResult.semantics === 'incremental_batch'
        ? 'incremental'
        : 'full';
      let loadedEvents = sortEventsAscending(loadedResult.events);
      trace.step('load-events-detailed', {
        requestedMode,
        resolvedMode: mode,
        fetched: loadedEvents.length,
        semantics: loadedResult.semantics,
        snapshotRevision: loadedResult.snapshotRevision ?? null,
      });
      const revisionChanged = loadedResult.snapshotRevision !== undefined
        && loadedResult.snapshotRevision !== lastAppliedSnapshotRevisionRef.current;

      const shouldFallbackToFull = mode === 'incremental' && (
        (trigger === 'poll' && revisionChanged)
        || (loadedEvents.length === 0 && (trigger === 'event' || revisionChanged))
      );

      if (shouldFallbackToFull) {
        requestedMode = 'full';
        mode = 'full';
        loadedResult = await eventLogService.current.loadEventsDetailed({ limit: reconcileLimit });
        loadedEvents = sortEventsAscending(loadedResult.events);
        trace.step('fallback-full-refresh', {
          fetched: loadedEvents.length,
          snapshotRevision: loadedResult.snapshotRevision ?? null,
        });
      }

      if (mode === 'full') {
        lastFullRefreshAtRef.current = Date.now();
        lastAppliedSnapshotRevisionRef.current = loadedResult.snapshotRevision ?? null;
        // reconcile 拉满一页说明还有更旧历史；不足一页说明已覆盖到最早。
        hasMoreOlderFromBackendRef.current = loadedEvents.length >= reconcileLimit;
        applyVisibleWindow(loadedEvents);
        persistKeepAliveState(loadedEvents);
        trace.step('apply-full-window', { fetched: loadedEvents.length });
        await waitForNextPaint();
        trace.step('paint-full-window', { fetched: loadedEvents.length });
        if (shouldStickToBottomRef.current) {
          scrollToBottom(behavior);
          trace.step('scroll-to-bottom');
        }
        trace.finish({ mode, fetched: loadedEvents.length });
        return;
      }

      if (loadedEvents.length === 0) {
        if (loadedResult.snapshotRevision !== undefined) {
          lastAppliedSnapshotRevisionRef.current = loadedResult.snapshotRevision;
          persistKeepAliveState(allEventsRef.current);
        }
        trace.finish({ mode, fetched: 0 });
        return;
      }

      const mergedEvents = mergeLatestEventsAscending(allEventsRef.current, loadedEvents);
      trace.step('merge-incremental-events', {
        incoming: loadedEvents.length,
        merged: mergedEvents.length,
      });
      lastAppliedSnapshotRevisionRef.current = loadedResult.snapshotRevision ?? lastAppliedSnapshotRevisionRef.current ?? null;
      applyVisibleWindow(mergedEvents);
      persistKeepAliveState(mergedEvents);
      trace.step('apply-merged-window', { merged: mergedEvents.length });
      await waitForNextPaint();
      trace.step('paint-merged-window', { merged: mergedEvents.length });
      if (shouldStickToBottomRef.current) {
        scrollToBottom(behavior);
        trace.step('scroll-to-bottom');
      }
      trace.finish({ mode, fetched: loadedEvents.length, merged: mergedEvents.length });
    } catch (error) {
      trace.fail(error);
      throw error;
    }
  }, [applyVisibleWindow, persistKeepAliveState, scrollToBottom]);

  const scheduleLatestRefresh = useCallback((trigger: RefreshTrigger): void => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      if (trigger === 'external-refresh') {
        refreshQueuedTriggerRef.current = 'external-refresh';
      } else if (trigger === 'event' && refreshQueuedTriggerRef.current === 'poll') {
        refreshQueuedTriggerRef.current = 'event';
      }
      return;
    }

    refreshInFlightRef.current = true;
    refreshQueuedTriggerRef.current = trigger;
    void (async () => {
      try {
        let nextTrigger: RefreshTrigger = trigger;
        do {
          refreshQueuedRef.current = false;
          await refreshLatestEvents('smooth', nextTrigger);
          nextTrigger = refreshQueuedTriggerRef.current;
          refreshQueuedTriggerRef.current = 'poll';
        } while (refreshQueuedRef.current);
      } finally {
        refreshInFlightRef.current = false;
      }
    })();
  }, [refreshLatestEvents]);

  // 向后端拉取一页更早历史并 prepend 进内存。返回新增条数（0 表示已到最早或正在拉取）。
  const fetchOlderPageFromBackend = useCallback(async (): Promise<number> => {
    if (olderBackendFetchInFlightRef.current || !hasMoreOlderFromBackendRef.current) {
      return 0;
    }
    const current = allEventsRef.current;
    const oldest = current[0];
    if (!oldest) {
      hasMoreOlderFromBackendRef.current = false;
      return 0;
    }

    olderBackendFetchInFlightRef.current = true;
    try {
      // until_timestamp 为闭区间，会带回与最早事件同毫秒的边界事件，
      // 交由 prependOlderEventsAscending 按 id 去重，避免漏掉同毫秒下 id 更小的更早事件。
      const olderResult = await eventLogService.current.loadEventsDetailed({
        untilTimestamp: oldest.timestamp,
        limit: OLDER_PAGE_SIZE,
      });
      const olderAsc = sortEventsAscending(olderResult.events);
      const merged = prependOlderEventsAscending(current, olderAsc);
      const added = merged.length - current.length;

      // 返回不足一页，或合并后没有任何新增，都视为后端已到最早历史。
      if (olderAsc.length < OLDER_PAGE_SIZE || added === 0) {
        hasMoreOlderFromBackendRef.current = false;
      }

      if (added > 0) {
        const container = listContainerRef.current;
        const previousScrollHeight = container?.scrollHeight ?? 0;
        // 把刚拉到的更早事件纳入可视窗口（visibleCount 增加 added 条）。
        applyVisibleWindow(merged, visibleCountRef.current + added);
        requestAnimationFrame(() => {
          const currentContainer = listContainerRef.current;
          if (!currentContainer) return;
          // prepend 更早内容会增高顶部，保持原视口位置不跳动。
          currentContainer.scrollTop = Math.max(0, currentContainer.scrollHeight - previousScrollHeight);
        });
      } else {
        // 已无更早历史：刷新 hasMore 以撤掉顶部「加载更多」提示。
        setHasMore(nextStartIndexRef.current > 0);
      }

      return added;
    } finally {
      olderBackendFetchInFlightRef.current = false;
    }
  }, [applyVisibleWindow]);

  const loadOlderEvents = useCallback(async () => {
    if (loadingOlderRef.current) {
      return;
    }
    const hasInMemoryOlder = nextStartIndexRef.current > 0;
    if (!hasInMemoryOlder && !hasMoreOlderFromBackendRef.current) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      if (hasInMemoryOlder) {
        // 快路径：内存里还有未进入窗口的更早事件，直接扩大可视窗口。
        const container = listContainerRef.current;
        const previousScrollHeight = container?.scrollHeight ?? 0;
        applyVisibleWindow(allEventsRef.current, visibleCountRef.current + PAGE_SIZE);
        requestAnimationFrame(() => {
          const currentContainer = listContainerRef.current;
          if (!currentContainer) return;
          currentContainer.scrollTop = Math.max(0, currentContainer.scrollHeight - previousScrollHeight);
        });
      } else {
        // 已到内存头部：向后端拉取下一页更早历史。
        await fetchOlderPageFromBackend();
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [applyVisibleWindow, fetchOlderPageFromBackend]);

  // permalink 定位到不在内存中的旧事件时，向后端回溯分页直至加载到该事件或到达最早。
  const ensureEventInMemory = useCallback(async (eventId: string) => {
    let pages = 0;
    while (
      allEventsRef.current.findIndex((event) => event.id === eventId) < 0
      && hasMoreOlderFromBackendRef.current
      && pages < MAX_LOCATE_OLDER_PAGES
    ) {
      const added = await fetchOlderPageFromBackend();
      pages += 1;
      if (added === 0) {
        // 0 可能是并发拉取被护栏挡下：交由 events 变更后重跑本流程续拉。
        break;
      }
    }
  }, [fetchOlderPageFromBackend]);

  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) return;

    if (container.scrollTop <= TOP_LOAD_THRESHOLD) {
      void loadOlderEvents();
    }
  }, [loadOlderEvents]);

  useEffect(() => {
    if (locateTarget.eventId && locateTarget.shouldLocate) {
      setPendingLocateEventId(locateTarget.eventId);
    }
  }, [locateTarget.eventId, locateTarget.shouldLocate]);

  useEffect(() => {
    if (!pendingLocateEventId) {
      return;
    }

    if (!events.some((event) => event.id === pendingLocateEventId)) {
      const targetIndex = allEventsRef.current.findIndex((event) => event.id === pendingLocateEventId);
      if (targetIndex < 0) {
        // 目标事件比已加载范围更旧：向后端回溯分页拉取，加载到后本 effect 会随 events 变更重跑。
        void ensureEventInMemory(pendingLocateEventId);
        return;
      }

      const requiredVisibleCount = allEventsRef.current.length - targetIndex;
      if (requiredVisibleCount > visibleCountRef.current) {
        applyVisibleWindow(allEventsRef.current, requiredVisibleCount);
      }
      return;
    }

    const targetNode = eventRowRefs.current.get(pendingLocateEventId);
    if (!targetNode) {
      return;
    }

    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedEventId(pendingLocateEventId);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedEventId((current) => current === pendingLocateEventId ? null : current);
      highlightTimerRef.current = null;
    }, EVENT_HIGHLIGHT_DURATION_MS);
    setPendingLocateEventId(null);
  }, [applyVisibleWindow, ensureEventInMemory, events, pendingLocateEventId]);

  // 初始化 RT EventLog 读源，并用轮询补齐跨链路写入后的 UI 刷新。
  useEffect(() => {
    visibleCountRef.current = PAGE_SIZE;
    lastAppliedSnapshotRevisionRef.current = undefined;
    if (hydrateFromKeepAliveState()) {
      scheduleLatestRefresh('poll');
    } else {
      void loadInitialEvents();
    }

    const unsubscribe = eventLogService.current.onEvent((event) => {
      shouldStickToBottomRef.current = true;
      scheduleLatestRefresh(isRefreshOnlyEvent(event) ? 'external-refresh' : 'event');
    });
    const intervalId = window.setInterval(() => {
      shouldStickToBottomRef.current = isNearBottom();
      scheduleLatestRefresh('poll');
    }, RT_REFRESH_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [
    activeProfileId,
    hydrateFromKeepAliveState,
    isNearBottom,
    loadInitialEvents,
    scheduleLatestRefresh,
  ]);

  // 处理发送消息
  const handleSend = useCallback(async (content: string, tags?: string[], refs?: EventRef[]) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const resolvedRefs = buildRefsFromContent(trimmed, refs);

    const t0 = perfNow();
    shouldStickToBottomRef.current = true;
    try {
      await eventLogService.current.addEvent(
        trimmed,
        tags ? new Set(tags) : undefined,
        resolvedRefs,
      );
      setQuotedRefs([]);
      logPerfInfo(
        `[ChatPage] handleSend done ${JSON.stringify({ totalMs: Math.round(perfNow() - t0) })}`,
      );
    } catch (error) {
      log.error(`[ChatPage] handleSend failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }, [buildRefsFromContent]);

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
      if (
        !e.ctrlKey
        && !e.metaKey
        && !e.shiftKey
        && activeEl
        && (
          activeEl.tagName === 'BUTTON' ||
          activeEl.getAttribute('role') === 'button' ||
          activeEl instanceof HTMLAnchorElement
        )
      ) {
        return;
      }

      if (isEditableTarget(e.target)) return;

      const timerWidget = variant === 'new-mobile'
        ? focusTimerWidgetRef.current
        : timeBlockWidgetRef.current;

      // Ctrl+Enter: 运行中时弹出反馈对话框；空闲时展开并聚焦时间块输入框
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const timerState = timerWidget?.getTimerState();
        if (timerState === 'running' || timerState === 'paused') {
          timerWidget?.endDialog();
        } else {
          timerWidget?.expandAndFocusTaskName();
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
    if (event.tags.has('agent_feedback')) return <Bot size={14} />;
    if (event.tags.has('block_start')) return <Play size={14} />;
    if (event.tags.has('block_pause')) return <Pause size={14} />;
    if (event.tags.has('block_resume')) return <Play size={14} />;
    if (event.tags.has('block_end')) return <Square size={14} />;
    if (event.tags.has('block_feedback')) return <NotepadText size={14} />;
    if (isTaskRelationEvent(event)) return <Link2 size={14} />;
    if (isTaskCreatedEvent(event) || isTaskLifecycleEvent(event)) return <ListTodo size={14} />;
    return <FileText size={14} />;
  };

  // 获取事件头像背景色
  const getEventAvatarColor = (event: Event) => {
    if (event.tags.has('agent_feedback')) return 'bg-violet-500';
    if (event.tags.has('block_start')) return 'bg-success';
    if (event.tags.has('block_pause')) return 'bg-warning';
    if (event.tags.has('block_resume')) return 'bg-success';
    if (event.tags.has('block_end')) return 'bg-destructive';
    if (event.tags.has('block_feedback')) return 'bg-brand';
    if (isTaskRelationEvent(event)) return 'bg-cyan-500';
    if (isTaskCreatedEvent(event)) return 'bg-brand';
    switch (resolveTaskLifecycleStatus(event)) {
      case 'in_progress':
        return 'bg-green-500';
      case 'suspended':
        return 'bg-yellow-500';
      case 'completed':
        return 'bg-blue-500';
      case 'cancelled':
        return 'bg-red-500';
      default:
        break;
    }
    if (isTaskLifecycleEvent(event)) return 'bg-brand';
    return 'bg-brand';
  };

  // 获取事件背景色
  const getEventBgColor = (event: Event) => {
    if (event.tags.has('agent_feedback')) {
      return 'bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-100 rounded-br-md';
    }
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
    if (isTaskRelationEvent(event)) {
      return 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100 rounded-br-md';
    }
    if (isTaskCreatedEvent(event)) {
      return 'bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-100 rounded-br-md';
    }
    switch (resolveTaskLifecycleStatus(event)) {
      case 'in_progress':
        return 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100 rounded-br-md';
      case 'suspended':
        return 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100 rounded-br-md';
      case 'completed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-100 rounded-br-md';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-100 rounded-br-md';
      default:
        break;
    }
    if (isTaskLifecycleEvent(event)) {
      return 'bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-100 rounded-br-md';
    }
    return 'bg-muted rounded-bl-md';
  };

  // 获取事件前缀（已移除，由 Avatar 头像承担事件类型区分）
  const getEventPrefix = (_event: Event) => {
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

  const getEventRowHighlightClassName = useCallback((eventId: string) => (
    highlightedEventId === eventId
      ? 'ring-2 ring-[#F59E0B]/70 ring-offset-2 ring-offset-transparent transition-shadow'
      : ''
  ), [highlightedEventId]);

  const renderForwardRefsSummary = useCallback((event: Event) => {
    if (event.refs.length === 0) {
      return null;
    }

    const primaryRef = event.refs[0];
    const isExpandable = event.refs.length > 1;
    const isExpanded = expandedForwardRefsEventId === event.id;
    const buttonClassName = 'mt-2 flex max-w-full flex-col items-start rounded-xl border border-[#E7E5E4] bg-white/80 px-3 py-2 text-left text-[11px] text-stone-500 hover:bg-stone-50 dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#292524]';

    if (!isExpandable || !isExpanded) {
      return (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => {
            if (!isExpandable) {
              locateEventInRecord(primaryRef.eventId, true);
              return;
            }

            setExpandedForwardRefsEventId(event.id);
          }}
          aria-expanded={isExpandable ? isExpanded : undefined}
          data-testid={`event-forward-refs-${event.id}`}
        >
          <span className="truncate">
            引用：{primaryRef.summary ?? primaryRef.eventId}
          </span>
          {isExpandable ? (
            <span className="mt-0.5 text-[10px] text-stone-400 dark:text-[#78716C]">
              总共 {event.refs.length} 条引用
            </span>
          ) : null}
        </button>
      );
    }

    return event.refs.map((ref) => {
      const targetEvent = allEventsRef.current.find((item) => item.id === ref.eventId);
      const title = ref.summary ?? (targetEvent ? summarizeEventRefContent(targetEvent.content) : ref.eventId);
      const excerpt = targetEvent ? summarizeEventRefExcerpt(targetEvent.content) : undefined;

      return (
        <button
          key={`${event.id}:${ref.eventId}`}
          type="button"
          className={buttonClassName}
          onClick={() => locateEventInRecord(ref.eventId, true)}
          data-testid={`event-forward-ref-item-${event.id}-${ref.eventId}`}
        >
          <span className="truncate">
            引用：{title}
          </span>
          {excerpt ? (
            <span className="mt-0.5 text-[10px] text-stone-400 dark:text-[#78716C]">
              {excerpt}
            </span>
          ) : null}
        </button>
      );
    });
  }, [expandedForwardRefsEventId, locateEventInRecord]);

  const isSystemEvent = (event: Event) => (
    event.tags.has('block_start')
    || event.tags.has('block_pause')
    || event.tags.has('block_resume')
    || event.tags.has('block_end')
    || event.tags.has('block_feedback')
    || event.tags.has('agent_feedback')
    || TASK_SYSTEM_EVENT_TAGS.some((tag) => event.tags.has(tag))
  );

  const getSystemEventActorLabel = (event: Event) => (
    event.tags.has('agent_feedback') ? 'AI 助理' : '系统'
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
      ? 'relative flex h-full min-h-0 flex-col bg-surface'
      : 'flex flex-col h-full max-h-[100dvh] lg:max-h-screen';

  const listClassName =
    variant === 'new-mobile'
      ? 'flex-1 overflow-auto'
      : 'flex-1 overflow-auto p-3 sm:p-6';

  return (
    <div className={rootClassName}>
      {variant === 'new-mobile' ? (
        <div className="pointer-events-none absolute right-4 top-3 z-20">
          <div className="pointer-events-auto">
            <PageMoreMenu />
          </div>
        </div>
      ) : null}

      {/* 头部 */}
      {!hideHeader && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg sm:text-2xl font-bold">事件日志</h2>
            {/* 同步状态 */}
            <Badge
              variant={syncStatus === 'connected' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {syncStatus === 'connected' ? '已同步' : '未同步'}
            </Badge>
          </div>
          <Badge variant="secondary" className="text-xs">
            {events.length}{hasMore ? '+' : ''} 条事件
          </Badge>
        </div>
      )}

      {/* TimeBlock 控件栏 */}
      {variant === 'new-mobile' && showTimerWidget ? (
        <FocusTimerWidget ref={focusTimerWidgetRef} />
      ) : variant === 'default' ? (
        <TimeBlockWidget ref={timeBlockWidgetRef} variant="default" />
      ) : null}

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
            <div className={variant === 'new-mobile' ? 'mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface' : 'w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-muted flex items-center justify-center mb-3 sm:mb-4'}>
              <FileText size={28} className="text-muted-foreground" />
            </div>
            <p className="mb-1 text-base font-semibold text-strong sm:text-lg">暂无事件记录</p>
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
              const eventSourceLabel = formatEventSourceLabel(event);
              const voiceInput = isVoiceInputEvent(event);
              if (systemEvent) {
                const isAgentFeedback = event.tags.has('agent_feedback');
                return (
                  <div
                    key={event.id}
                    ref={assignEventRowRef(event.id)}
                    className={`flex items-start gap-2 ${getEventRowHighlightClassName(event.id)}`}
                    data-event-id={event.id}
                    data-testid="new-mobile-system-message-row"
                  >
                    <Avatar className="mt-0.5 h-8 w-8 shrink-0">
                      <AvatarFallback className={`rounded-full flex items-center justify-center text-white ${getEventAvatarColor(event)}`}>
                        {getEventIcon(event)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 max-w-[85%] flex-1">
                      <div
                        className="mb-1 flex items-center gap-1 text-[11px] leading-[1.4]"
                        data-testid="new-mobile-message-meta"
                      >
                        <span className="text-xs font-semibold text-strong">{getSystemEventActorLabel(event)}</span>
                        <span className="text-muted">{eventSourceLabel}</span>
                        <span className="text-muted">{formatMessageTime(event.timestamp)}</span>
                      </div>
                      <div
                        className={`rounded-2xl border px-[14px] py-3 text-[13px] leading-[1.6] ${
                          isAgentFeedback
                            ? 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/35 dark:text-violet-100'
                            : 'border-card bg-card text-strong'
                        }`}
                        data-testid={isAgentFeedback ? 'new-mobile-agent-feedback-bubble' : undefined}
                      >
                        <EventMarkdown content={event.content} />
                      </div>
                      {renderForwardRefsSummary(event)}
                      <MessageActions
                        content={event.content}
                        align="start"
                        permalink={buildEventlogRecordPermalink(event.id)}
                        onQuote={variant === 'new-mobile' ? () => handleQuoteEvent(event) : undefined}
                        features={{
                          permalink: true,
                          quote: variant === 'new-mobile',
                        }}
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={event.id}
                  ref={assignEventRowRef(event.id)}
                  className={`flex justify-end gap-2 ${getEventRowHighlightClassName(event.id)}`}
                  data-event-id={event.id}
                  data-testid="new-mobile-user-message-row"
                >
                  <div className="flex max-w-[84%] flex-col items-end">
                    <div
                      className="mb-1 flex items-center justify-end gap-1 text-[11px] leading-[1.4]"
                      data-testid="new-mobile-message-meta"
                    >
                      <span className="text-muted">{eventSourceLabel}</span>
                      {voiceInput ? <VoiceInputBadge /> : null}
                      <span className="text-muted">{formatMessageTime(event.timestamp)}</span>
                      <span className="text-xs font-semibold text-strong">{userDisplayName}</span>
                    </div>
                    <div className="rounded-2xl bg-user-bubble px-[14px] py-[10px] text-[13px] leading-[1.6] text-user-bubble-text [&_.prose]:text-inherit [&_.prose_p]:text-inherit [&_.prose_li]:text-inherit">
                      <EventMarkdown content={event.content} />
                    </div>
                    {renderForwardRefsSummary(event)}
                    <MessageActions
                      content={event.content}
                      align="end"
                      permalink={buildEventlogRecordPermalink(event.id)}
                      onQuote={() => handleQuoteEvent(event)}
                      features={{
                        permalink: true,
                        quote: true,
                      }}
                    />
                  </div>
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="rounded-full bg-orange-100 text-[11px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-100">
                      {userAvatarInitial}
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
                    <div
                      key={event.id}
                      ref={assignEventRowRef(event.id)}
                      className={`flex gap-2 sm:gap-3 ${getEventRowHighlightClassName(event.id)}`}
                      data-event-id={event.id}
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
                          <EventMarkdown content={event.content} />
                        </div>
                        {renderForwardRefsSummary(event)}
                        <MessageActions
                          content={event.content}
                          align="start"
                          permalink={buildEventlogRecordPermalink(event.id)}
                          features={{ permalink: true }}
                        />
                        <div className="mt-0.5 flex items-center gap-2 sm:mt-1">
                          <p className="text-xs text-muted-foreground">
                            {formatTime(event.timestamp)}
                          </p>
                          {isVoiceInputEvent(event) ? <VoiceInputBadge /> : null}
                        </div>
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
        <NowInputRow
          ref={voiceMessageInputRef}
          onSend={handleSend}
          placeholder="记录当下的事实..."
          features={{ quote: true }}
          quotedRefs={quotedRefs}
          onQuotedRefsChange={setQuotedRefs}
          resolveQuotedRefSummary={resolveEventRefSummary}
          resolveQuotedRefExcerpt={resolveQuotedRefExcerpt}
          onOpenQuotedEvent={(eventId) => locateEventInRecord(eventId, true)}
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
