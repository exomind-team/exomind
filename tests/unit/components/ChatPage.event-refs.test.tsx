import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/lib/types/event';
import { ChatPage } from '@/components/Chat/ChatPage';

const navigateMock = vi.fn();
const useSyncStoreMock = vi.fn();
const getEventLogServiceMock = vi.fn();
const onEventMock = vi.fn(() => () => {});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({
      pathname: '/eventlog/record',
      searchStr: '',
    }),
  };
});

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: () => useSyncStoreMock(),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => getEventLogServiceMock(),
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
      <div ref={ref} data-testid="mock-now-input-row" />
    )),
  };
});

vi.mock('@/ui/app/components/PageMoreMenu', () => ({
  PageMoreMenu: () => null,
}));

vi.mock('@/ui/app/components/FocusTimerWidget', async () => {
  const React = await import('react');
  return {
    FocusTimerWidget: React.forwardRef<HTMLDivElement>((_, ref) => (
      <div ref={ref} data-testid="mock-focus-timer-widget" />
    )),
  };
});

vi.mock('@/components/TimeBlockWidget', () => ({
  TimeBlockWidget: () => <div data-testid="mock-timeblock-widget" />,
}));

vi.mock('@/components/VoiceMessageInput', () => ({
  VoiceMessageInput: () => <div data-testid="mock-voice-input" />,
}));

const makeEvent = (overrides: Partial<Event> & Pick<Event, 'id' | 'content' | 'timestamp'>): Event => ({
  id: overrides.id,
  content: overrides.content,
  timestamp: overrides.timestamp,
  tags: overrides.tags ?? new Set(),
  refs: overrides.refs ?? [],
  metadata: overrides.metadata ?? {
    source: {
      deviceId: 'device-1',
      deviceName: 'Pixel 9',
      platform: 'android',
    },
  },
});

describe('ChatPage event refs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSyncStoreMock.mockReturnValue({
      currentUser: 'Alice',
      isLoggedIn: true,
      activeProfileId: 'profile-alice',
    });

    const sourceOne = makeEvent({
      id: 'src-1',
      timestamp: 1000,
      content: '第一条源消息\n第一条补充说明',
    });
    const sourceTwo = makeEvent({
      id: 'src-2',
      timestamp: 2000,
      content: '第二条源消息\n第二条补充说明',
    });
    const sourceThree = makeEvent({
      id: 'src-3',
      timestamp: 3000,
      content: '第三条源消息\n第三条补充说明',
    });
    const reply = makeEvent({
      id: 'reply-1',
      timestamp: 4000,
      content: '引用了三条事件',
      refs: [
        { kind: 'event', eventId: 'src-1', summary: '第一条源消息' },
        { kind: 'event', eventId: 'src-2', summary: '第二条源消息' },
        { kind: 'event', eventId: 'src-3', summary: '第三条源消息' },
      ],
    });

    getEventLogServiceMock.mockReturnValue({
      loadEvents: vi.fn().mockResolvedValue([sourceOne, sourceTwo, sourceThree, reply]),
      loadEventsDetailed: vi.fn().mockResolvedValue({
        events: [sourceOne, sourceTwo, sourceThree, reply],
        semantics: 'full',
        snapshotRevision: null,
      }),
      addEvent: vi.fn(),
      appendEventData: vi.fn(),
      exportEventsAsJson: vi.fn(),
      importEventsFromJson: vi.fn(),
      onEvent: onEventMock,
    });
  });

  it('expands multi refs and collapses after selecting a referenced event', async () => {
    render(<ChatPage variant="new-mobile" showTimerWidget={false} />);

    const toggle = await screen.findByTestId('event-forward-refs-reply-1');
    expect(toggle).toHaveTextContent('引用：第一条源消息');
    expect(toggle).toHaveTextContent('总共 3 条引用');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByTestId('event-forward-refs-reply-1')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-1')).toHaveTextContent('第一条源消息');
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-1')).toHaveTextContent('第一条补充说明');
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-2')).toHaveTextContent('第二条源消息');
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-2')).toHaveTextContent('第二条补充说明');
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-3')).toHaveTextContent('第三条源消息');
    expect(screen.getByTestId('event-forward-ref-item-reply-1-src-3')).toHaveTextContent('第三条补充说明');

    fireEvent.click(screen.getByTestId('event-forward-ref-item-reply-1-src-2'));

    await waitFor(() => {
      expect(screen.queryByTestId('event-forward-ref-item-reply-1-src-2')).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId('event-forward-refs-reply-1')).toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalled();
  });
});
