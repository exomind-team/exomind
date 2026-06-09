import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '@/lib/types/event';
import { NowPage } from '@/ui/app/pages/NowPage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { getEventLogService } from '@/lib/services/eventlog.service';

const navigateMock = vi.fn();
let locationState = {
  pathname: '/eventlog/record',
  searchStr: '',
};

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useLocation: () => locationState,
    useNavigate: () => navigateMock,
  };
});

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
      <div ref={ref} data-testid="now-page-focus-widget" />
    )),
  };
});

vi.mock('@/components/TimeBlockWidget', () => ({
  TimeBlockWidget: () => <div data-testid="time-block-widget" />,
}));

vi.mock('@/components/VoiceMessageInput', () => ({
  VoiceMessageInput: () => <div data-testid="voice-message-input" />,
}));

vi.mock('@/ui/app/components/BlockTaskAssociationList', () => ({
  BlockTaskAssociationList: () => <div data-testid="now-page-association-list" />,
}));

vi.mock('@/ui/app/components/NowTodayTab', () => ({
  NowTodayTab: () => <div data-testid="now-page-today" />,
}));

vi.mock('@/ui/app/components/FocusKeepAwakeController', () => ({
  useFocusKeepAwakeController: () => null,
}));

vi.mock('@/ui/app/components/PageShell', () => ({
  PageShell: ({
    title,
    headerBottom,
    children,
    contentClassName,
  }: {
    title: string;
    headerBottom?: React.ReactNode;
    children: React.ReactNode;
    contentClassName?: string;
  }) => (
    <div>
      <h1>{title}</h1>
      {headerBottom}
      <div className={contentClassName}>{children}</div>
    </div>
  ),
}));

vi.mock('@/ui/app/components/PageHeaderNav', () => ({
  PageHeaderNav: ({
    items,
    activeId,
    onChange,
    rootTestId,
  }: {
    items: Array<{ id: string; label: string; testId?: string }>;
    activeId: string;
    onChange: (value: string) => void;
    rootTestId?: string;
  }) => (
    <div data-testid={rootTestId}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          data-testid={item.testId}
          aria-selected={item.id === activeId ? 'true' : 'false'}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

const mockUseSyncStore = vi.mocked(useSyncStore);
const mockGetEventLogService = vi.mocked(getEventLogService);
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

type MockLoadEventsDetailedResult = {
  events: Event[];
  semantics: 'full_snapshot' | 'incremental_batch';
  snapshotRevision?: string | null;
};

const initialEvent: Event = {
  id: 'evt-initial',
  timestamp: new Date('2026-03-30T10:00:00.000Z').getTime(),
  content: '初始事件',
  tags: new Set<string>(),
  refs: [],
  metadata: {
    source: {
      deviceId: 'device-1',
      deviceName: 'Desktop',
      platform: 'windows',
      app: 'ExoMind',
    },
  },
};

const lateHistoricalEvent: Event = {
  id: 'evt-late-history',
  timestamp: new Date('2026-03-29T08:00:00.000Z').getTime(),
  content: '补导入的历史事件',
  tags: new Set<string>(),
  refs: [],
  metadata: {
    source: {
      deviceId: 'device-2',
      deviceName: 'Imported',
      platform: 'windows',
      app: 'ExoMind',
    },
  },
};

describe('NowPage record keep-alive', () => {
  const unsubscribe = vi.fn();
  const loadEventsDetailed = vi.fn<() => Promise<MockLoadEventsDetailedResult>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:10:00.000Z'));
    vi.clearAllMocks();
    navigateMock.mockReset();
    locationState = {
      pathname: '/eventlog/record',
      searchStr: '',
    };

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
      onEvent: vi.fn(() => unsubscribe),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('restores record events after switching tabs and resumes incremental refresh（record 页签回切应先复用缓存再增量刷新）', async () => {
    const { rerender } = render(<NowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();
    expect(loadEventsDetailed).toHaveBeenCalledTimes(1);
    expect(loadEventsDetailed.mock.calls[0]).toEqual([]);

    locationState = {
      pathname: '/eventlog',
      searchStr: '',
    };
    rerender(<NowPage />);

    expect(screen.getByTestId('now-page-focus-widget')).toBeInTheDocument();
    expect(screen.queryByText('初始事件')).not.toBeInTheDocument();

    locationState = {
      pathname: '/eventlog/record',
      searchStr: '',
    };
    rerender(<NowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();
    expect(loadEventsDetailed).toHaveBeenCalledTimes(2);
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
  });

  it('shows keep-alive cache first and then fully reconciles when revision drifts after tab restore（回切后若 revision 漂移，应先复用缓存再完整对账）', async () => {
    const { rerender } = render(<NowPage />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('初始事件')).toBeInTheDocument();

    locationState = {
      pathname: '/eventlog',
      searchStr: '',
    };
    rerender(<NowPage />);

    expect(screen.getByTestId('now-page-focus-widget')).toBeInTheDocument();

    loadEventsDetailed.mockReset();
    loadEventsDetailed
      .mockResolvedValueOnce({
        events: [],
        semantics: 'incremental_batch',
        snapshotRevision: 'rev-2',
      })
      .mockResolvedValueOnce({
        events: [lateHistoricalEvent],
        semantics: 'full_snapshot',
        snapshotRevision: 'rev-2',
      });

    locationState = {
      pathname: '/eventlog/record',
      searchStr: '',
    };
    rerender(<NowPage />);

    expect(screen.getByText('初始事件')).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadEventsDetailed).toHaveBeenCalledTimes(2);
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(1, {
      sinceId: 'evt-initial',
      sinceTimestamp: initialEvent.timestamp,
    });
    expect(loadEventsDetailed).toHaveBeenNthCalledWith(2);
    expect(screen.queryByText('初始事件')).not.toBeInTheDocument();
    expect(screen.getByText('补导入的历史事件')).toBeInTheDocument();
  });
});
