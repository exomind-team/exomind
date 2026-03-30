import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/lib/types/event';
import { ChatPage } from '@/components/Chat/ChatPage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { getEventLogService } from '@/lib/services/eventlog.service';
import { log } from '@/lib/logger';

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/Chat/EventMarkdown', () => ({
  EventMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/components/Chat/MessageActions', () => ({
  MessageActions: () => null,
}));

vi.mock('@/ui/app/components/NowInputRow', async () => {
  const React = await import('react');
  return {
    NowInputRow: React.forwardRef<HTMLDivElement>((_, ref) => (
      <div ref={ref} data-testid="now-input-row" />
    )),
  };
});

vi.mock('@/ui/app/components/PageMoreMenu', () => ({
  PageMoreMenu: () => <div data-testid="page-more-menu" />,
}));

vi.mock('@/ui/app/components/FocusTimerWidget', async () => {
  const React = await import('react');
  return {
    FocusTimerWidget: React.forwardRef<HTMLDivElement>((_, ref) => (
      <div ref={ref} data-testid="focus-timer-widget" />
    )),
  };
});

vi.mock('@/components/TimeBlockWidget', () => ({
  TimeBlockWidget: () => <div data-testid="time-block-widget" />,
}));

vi.mock('@/components/VoiceMessageInput', () => ({
  VoiceMessageInput: () => <div data-testid="voice-message-input" />,
}));

const mockUseSyncStore = vi.mocked(useSyncStore);
const mockGetEventLogService = vi.mocked(getEventLogService);
const mockedLog = vi.mocked(log, true);
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

const initialEvent: Event = {
  id: 'evt-initial',
  timestamp: new Date('2026-03-30T10:00:00.000Z').getTime(),
  content: '初始事件',
  tags: new Set<string>(),
  metadata: {
    source: {
      deviceId: 'device-1',
      deviceName: 'Desktop',
      platform: 'windows',
      app: 'ExoMind',
    },
  },
};

type MockLoadEventsDetailedResult = {
  events: Event[];
  semantics: 'full_snapshot' | 'incremental_batch';
  snapshotRevision?: string | null;
};

const sameTimestampBase = new Date('2026-03-30T10:05:00.000Z').getTime();

const sameTimestampLowerIdEvent: Event = {
  id: 'evt-same-a',
  timestamp: sameTimestampBase,
  content: '同时间戳 A',
  tags: new Set<string>(),
};

const sameTimestampHigherIdEvent: Event = {
  id: 'evt-same-b',
  timestamp: sameTimestampBase,
  content: '同时间戳 B',
  tags: new Set<string>(),
};

describe('ChatPage incremental refresh issue 769', () => {
  const unsubscribe = vi.fn();
  const loadEventsDetailed = vi.fn<() => Promise<MockLoadEventsDetailedResult>>();
  let onEventCallback: ((event: Event) => void) | null = null;

  const lateHistoricalEvent: Event = {
    id: 'evt-late-history',
    timestamp: new Date('2026-03-29T08:00:00.000Z').getTime(),
    content: '补导入的历史事件',
    tags: new Set<string>(),
    metadata: {
      source: {
        deviceId: 'device-2',
        deviceName: 'Imported',
        platform: 'windows',
        app: 'ExoMind',
      },
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:10:00.000Z'));
    vi.clearAllMocks();
    onEventCallback = null;

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLElement.prototype.scrollIntoView = vi.fn();

    mockUseSyncStore.mockReturnValue({
      currentUser: 'Alice',
      isLoggedIn: true,
      activeProfileId: 'profile-alice',
    } as never);

    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [initialEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rev-1',
      })
      .mockResolvedValueOnce({
        events: [],
        semantics: 'incremental_batch',
        snapshotRevision: 'rev-1',
      });

    mockGetEventLogService.mockReturnValue({
      loadEventsDetailed,
      loadEvents: vi.fn(),
      addEvent: vi.fn(),
      appendEventData: vi.fn(),
      exportEventsAsJson: vi.fn(),
      importEventsFromJson: vi.fn(),
      onEvent: vi.fn((callback: (event: Event) => void) => {
        onEventCallback = callback;
        return unsubscribe;
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('poll refreshes with latest event cursor instead of reloading all events（轮询刷新应带最新事件游标）', async () => {
    await act(async () => {
      render(<ChatPage variant="new-mobile" showTimerWidget={false} />);
      await Promise.resolve();
    });

    expect(loadEventsDetailed).toHaveBeenCalledTimes(1);
    expect(screen.getByText('初始事件')).toBeInTheDocument();
    expect(loadEventsDetailed.mock.calls[0]).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loadEventsDetailed).toHaveBeenCalledTimes(2);
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(mockedLog.info).toHaveBeenCalledWith(expect.stringContaining('"fetched":0'));
  });

  it('uses the timestamp+id tail event as incremental cursor（同时间戳时应使用 timestamp+id 尾事件做游标）', async () => {
    loadEventsDetailed.mockReset();
    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [
          sameTimestampHigherIdEvent,
          sameTimestampLowerIdEvent,
        ],
        semantics: 'full_snapshot',
        snapshotRevision: 'rev-same-1',
      })
      .mockResolvedValueOnce({
        events: [],
        semantics: 'incremental_batch',
        snapshotRevision: 'rev-same-1',
      });

    await act(async () => {
      render(<ChatPage variant="new-mobile" showTimerWidget={false} />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-same-b',
      sinceTimestamp: sameTimestampBase,
    });
  });

  it('reconciles full state when signaled refresh sees an empty delta（外部刷新信号遇到空增量时应回退全量对账）', async () => {
    loadEventsDetailed.mockReset();
    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [initialEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rev-1',
      })
      .mockResolvedValueOnce({
        events: [],
        semantics: 'incremental_batch',
        snapshotRevision: 'rev-1',
      })
      .mockResolvedValueOnce({
        events: [lateHistoricalEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rev-2',
      });

    await act(async () => {
      render(<ChatPage variant="new-mobile" showTimerWidget={false} />);
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();
    expect(onEventCallback).not.toBeNull();

    await act(async () => {
      onEventCallback?.(lateHistoricalEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadEventsDetailed).toHaveBeenCalledTimes(3);
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(3);
    expect(screen.queryByText('初始事件')).not.toBeInTheDocument();
    expect(screen.getByText('补导入的历史事件')).toBeInTheDocument();
    expect(mockedLog.info).toHaveBeenCalledWith(expect.stringContaining('"mode":"full"'));
  });

  it('replaces visible events when legacy cursor queries resolve as full snapshot（legacy 快照结果不应继续按增量 merge）', async () => {
    loadEventsDetailed.mockReset();
    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [initialEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'legacy-rev-1',
      })
      .mockResolvedValueOnce({
        events: [lateHistoricalEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'legacy-rev-2',
      });

    await act(async () => {
      render(<ChatPage variant="new-mobile" showTimerWidget={false} />);
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(screen.queryByText('初始事件')).not.toBeInTheDocument();
    expect(screen.getByText('补导入的历史事件')).toBeInTheDocument();
  });

  it('forces full reconcile when incremental poll sees a newer snapshot revision with empty delta（空增量但 revision 变化时应立即全量对账）', async () => {
    loadEventsDetailed.mockReset();
    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [initialEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rt-rev-1',
      })
      .mockResolvedValueOnce({
        events: [],
        semantics: 'incremental_batch',
        snapshotRevision: 'rt-rev-2',
      })
      .mockResolvedValueOnce({
        events: [lateHistoricalEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rt-rev-2',
      });

    await act(async () => {
      render(<ChatPage variant="new-mobile" showTimerWidget={false} />);
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadEventsDetailed).toHaveBeenCalledTimes(3);
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(3);
    expect(screen.queryByText('初始事件')).not.toBeInTheDocument();
    expect(screen.getByText('补导入的历史事件')).toBeInTheDocument();
  });
});
