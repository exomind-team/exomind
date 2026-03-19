import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '@/components/Chat/ChatPage';
import type { FocusTimerWidgetHandle } from '@/ui/app/components/FocusTimerWidget';

const loadEventsMock = vi.fn();
const onEventMock = vi.fn(() => () => {});
const endDialogMock = vi.fn();
const pauseOrResumeMock = vi.fn();
const expandAndFocusTaskNameMock = vi.fn();
const focusTextMock = vi.fn();
let timerState: ReturnType<FocusTimerWidgetHandle['getTimerState']> = 'running';

vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: () => ({
    currentUser: null,
    isLoggedIn: false,
    activeProfileId: null,
  }),
}));

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => ({
    loadEvents: (...args: unknown[]) => loadEventsMock(...args),
    addEvent: vi.fn(),
    appendEventData: vi.fn(),
    exportEventsAsJson: vi.fn(),
    importEventsFromJson: vi.fn(),
    onEvent: (...args: unknown[]) => onEventMock(...args),
  }),
}));

vi.mock('@/components/Chat/EventMarkdown', () => ({
  EventMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/components/Chat/MessageActions', () => ({
  MessageActions: () => null,
}));

vi.mock('@/ui/app/components/PageMoreMenu', () => ({
  PageMoreMenu: () => null,
}));

vi.mock('@/ui/app/components/NowInputRow', async () => {
  const React = await import('react');
  return {
    NowInputRow: React.forwardRef((_: Record<string, never>, ref) => {
      React.useImperativeHandle(ref, () => ({
        focusText: focusTextMock,
      }));
      return <div data-testid="mock-now-input-row" />;
    }),
  };
});

vi.mock('@/ui/app/components/FocusTimerWidget', async () => {
  const React = await import('react');
  return {
    FocusTimerWidget: React.forwardRef<FocusTimerWidgetHandle>((_, ref) => {
      React.useImperativeHandle(ref, () => ({
        expandAndFocusTaskName: expandAndFocusTaskNameMock,
        openTaskConfig: vi.fn(),
        getTimerState: () => timerState,
        pauseOrResume: pauseOrResumeMock,
        endDialog: endDialogMock,
      }));
      return (
        <div data-testid="mock-focus-timer-widget">
          <button type="button" data-testid="mock-focus-shortcut-anchor">
            计时按钮
          </button>
        </div>
      );
    }),
  };
});

vi.mock('@/components/TimeBlockWidget', () => ({
  TimeBlockWidget: () => <div data-testid="mock-timeblock-widget" />,
}));

vi.mock('@/components/VoiceMessageInput', () => ({
  VoiceMessageInput: () => <div data-testid="mock-voice-input" />,
}));

describe('ChatPage keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadEventsMock.mockResolvedValue([]);
    timerState = 'running';
  });

  it('keeps Ctrl+Enter ending focus block even when a button keeps focus', async () => {
    render(<ChatPage variant="new-mobile" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-focus-timer-widget')).toBeInTheDocument();
    });

    const button = screen.getByTestId('mock-focus-shortcut-anchor');
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(endDialogMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Shift+Enter toggling pause/resume even when a button keeps focus', async () => {
    render(<ChatPage variant="new-mobile" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-focus-timer-widget')).toBeInTheDocument();
    });

    const button = screen.getByTestId('mock-focus-shortcut-anchor');
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(pauseOrResumeMock).toHaveBeenCalledTimes(1);
  });

  it('focuses idle timer input on Ctrl+Enter and Shift+Enter when no block is running', async () => {
    timerState = 'idle';
    render(<ChatPage variant="new-mobile" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-focus-timer-widget')).toBeInTheDocument();
    });

    const button = screen.getByTestId('mock-focus-shortcut-anchor');
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(expandAndFocusTaskNameMock).toHaveBeenCalledTimes(2);
    expect(endDialogMock).not.toHaveBeenCalled();
    expect(pauseOrResumeMock).not.toHaveBeenCalled();
  });
});
