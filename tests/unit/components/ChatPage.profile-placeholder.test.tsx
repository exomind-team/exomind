import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/lib/types/event';
import { ChatPage } from '@/components/Chat/ChatPage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { getEventLogService } from '@/lib/services/eventlog.service';

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
  const unsubscribe = vi.fn();
  const loadEvents = vi.fn<() => Promise<Event[]>>();
  const onEvent = vi.fn(() => unsubscribe);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadEvents.mockResolvedValue([baseEvent]);
    mockGetEventLogService.mockReturnValue({
      loadEvents,
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

    loadEvents.mockResolvedValue([{
      ...baseEvent,
      id: 'event-voice-1',
      content: '这是一条语音输入事件',
      metadata: {
        ...baseEvent.metadata,
        inputSource: 'voice',
      },
    }]);

    render(<ChatPage variant="new-mobile" />);

    const row = await screen.findByTestId('new-mobile-user-message-row');

    await waitFor(() => {
      expect(within(row).getByText('语音输入')).toBeInTheDocument();
    });
  });
});
