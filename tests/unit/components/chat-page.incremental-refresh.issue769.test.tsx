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

describe('ChatPage incremental refresh issue 769', () => {
  const unsubscribe = vi.fn();
  const loadEvents = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

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

    loadEvents
      .mockResolvedValueOnce([initialEvent])
      .mockResolvedValueOnce([]);

    mockGetEventLogService.mockReturnValue({
      loadEvents,
      addEvent: vi.fn(),
      appendEventData: vi.fn(),
      exportEventsAsJson: vi.fn(),
      importEventsFromJson: vi.fn(),
      onEvent: vi.fn(() => unsubscribe),
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

    expect(loadEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText('初始事件')).toBeInTheDocument();
    expect(loadEvents.mock.calls[0]).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loadEvents).toHaveBeenCalledTimes(2);
    expect(loadEvents).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(mockedLog.info).toHaveBeenCalledWith(expect.stringContaining('"fetched":0'));
  });
});
