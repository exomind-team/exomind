import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/lib/types/event';
import { ChatPage } from '@/components/Chat/ChatPage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { getEventLogService } from '@/lib/services/eventlog.service';
import { act } from '@testing-library/react';
import { setEventDateDisplayMode } from '@/config/event-date-display';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  useLocation: () => ({ pathname: '/eventlog/record', searchStr: '' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: vi.fn(),
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

const baseEvent: Event = {
  id: 'event-1',
  timestamp: new Date('2026-03-17T10:00:00.000Z').getTime(),
  content: '记录了一条用户事件',
  tags: new Set(),
  refs: [],
  metadata: {
    source: {
      deviceId: 'device-1',
      deviceName: 'Pixel 9',
      platform: 'android',
      app: 'ExoMind',
    },
  },
};

describe('ChatPage profile placeholder', () => {
  it('日期显示偏好持久化并实时更新已显示的消息', async () => {
    mockUseSyncStore.mockReturnValue({ currentUser: '测试', isLoggedIn: true, activeProfileId: 'profile-test' } as never);
    loadEventsDetailed.mockResolvedValue({ events: [{ ...baseEvent, timestamp: new Date(2026, 10, 12, 19, 16).getTime() }], semantics: 'full_snapshot' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 13, 20).getTime());
    try {
      render(<ChatPage variant="new-mobile" />);
      expect(await screen.findByText('12日 · 19:16')).toBeInTheDocument();
      act(() => { setEventDateDisplayMode('weekday'); });
      expect(await screen.findByText('星期四 · 19:16')).toBeInTheDocument();
      expect(localStorage.getItem('exomind:eventDateDisplay')).toBe('weekday');
      act(() => { setEventDateDisplayMode('full'); });
      expect(await screen.findByText('2026年11月12日 · 19:16')).toBeInTheDocument();
    } finally {
      act(() => { setEventDateDisplayMode('compact'); });
      clock.mockRestore();
    }
  });
  it('披露昨天消息的日期而不是只显示时刻', async () => {
    mockUseSyncStore.mockReturnValue({ currentUser: '测试', isLoggedIn: true, activeProfileId: 'profile-test' } as never);
    loadEventsDetailed.mockResolvedValue({ events: [{ ...baseEvent, timestamp: new Date(2026, 10, 12, 19, 16).getTime() }], semantics: 'full_snapshot' });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 13, 20).getTime());
    try {
      render(<ChatPage variant="new-mobile" />);
      expect(await screen.findByText('12日 · 19:16')).toBeInTheDocument();
    } finally { clock.mockRestore(); }
  });
  const unsubscribe = vi.fn();
  const loadEvents = vi.fn<() => Promise<Event[]>>();
  const loadEventsDetailed = vi.fn();
  const onEvent = vi.fn(() => unsubscribe);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadEvents.mockResolvedValue([baseEvent]);
    loadEventsDetailed.mockResolvedValue({
      events: [baseEvent],
      semantics: 'full_snapshot',
      snapshotRevision: null,
    });
    mockGetEventLogService.mockReturnValue({
      loadEvents,
      loadEventsDetailed,
      addEvent: vi.fn(),
      appendEventData: vi.fn(),
      exportEventsAsJson: vi.fn(),
      importEventsFromJson: vi.fn(),
      onEvent,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows placeholder name and avatar initial when currentUser is empty', async () => {
    mockUseSyncStore.mockReturnValue({
      currentUser: null,
      isLoggedIn: false,
      activeProfileId: null,
    } as never);

    render(<ChatPage variant="new-mobile" />);

    const row = await screen.findByTestId('new-mobile-user-message-row');

    await waitFor(() => {
      expect(within(row).getByText('未名')).toBeInTheDocument();
    });
    expect(within(row).getByText('未')).toBeInTheDocument();
  });

  it('keeps using current profile name and derived avatar initial when currentUser exists', async () => {
    mockUseSyncStore.mockReturnValue({
      currentUser: 'Alice',
      isLoggedIn: true,
      activeProfileId: 'profile-alice',
    } as never);

    render(<ChatPage variant="new-mobile" />);

    const row = await screen.findByTestId('new-mobile-user-message-row');

    await waitFor(() => {
      expect(within(row).getByText('Alice')).toBeInTheDocument();
    });
    expect(within(row).getByText('A')).toBeInTheDocument();
  });

  it('shows voice input badge for voice-tagged events', async () => {
    mockUseSyncStore.mockReturnValue({
      currentUser: 'Alice',
      isLoggedIn: true,
      activeProfileId: 'profile-alice',
    } as never);

    const voiceEvent: Event = {
      ...baseEvent,
      id: 'event-voice-1',
      content: '这是一条语音输入事件',
      metadata: {
        ...baseEvent.metadata,
        inputSource: 'voice',
      },
    };

    loadEventsDetailed.mockResolvedValue({
      events: [voiceEvent],
      semantics: 'full_snapshot',
      snapshotRevision: null,
    });

    render(<ChatPage variant="new-mobile" />);

    const row = await screen.findByTestId('new-mobile-user-message-row');

    await waitFor(() => {
      expect(within(row).getByText('语音输入')).toBeInTheDocument();
    });
  });
});
