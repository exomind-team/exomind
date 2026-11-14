import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '@/components/Chat/ChatPage';

const probes = vi.hoisted(() => ({
  focus: vi.fn(), legacy: vi.fn(), expand: vi.fn(), navigate: vi.fn(),
  load: vi.fn(async () => ({ events: [], semantics: 'full_snapshot', snapshotRevision: null })),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  useLocation: () => ({ pathname: '/eventlog/record', searchStr: '' }),
  useNavigate: () => probes.navigate,
}));
// ChatPage's own keyboard behavior is under test. The native shortcut adapter
// must not import application routes or bootstrap the old runtime for it.
vi.mock('@/services/main-window-shortcut.service', () => ({
  MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT: 'eventlog-record-input',
}));
vi.mock('@/services/main-window-focus-targets', () => ({
  registerMainWindowFocusTarget: () => () => {},
}));
vi.mock('@/ui/stores/sync-store', () => ({
  useSyncStore: () => ({ currentUser: 'synthetic', isLoggedIn: true, activeProfileId: 'synthetic-focus-profile' }),
}));
vi.mock('@/config/event-date-display', () => ({
  getEventDateDisplayMode: () => 'compact', subscribeEventDateDisplayMode: () => () => {},
}));
vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => ({ loadEventsDetailed: probes.load, onEvent: () => () => {} }),
}));
vi.mock('@/lib/utils/perf-trace', () => ({
  PerfTrace: class { step() {} finish() {} fail() {} totalMs() { return 0; } },
  perfNow: () => 0, logPerfInfo: () => {}, waitForNextPaint: async () => {},
}));
vi.mock('@/ui/app/components/FocusTimerWidget', async () => {
  const React = await import('react');
  return { FocusTimerWidget: React.forwardRef(function FocusProbe(props: Record<string, unknown>, ref) {
    probes.focus(props);
    React.useImperativeHandle(ref, () => ({
      getTimerState: () => 'idle', expandAndFocusTaskName: probes.expand,
      openTaskConfig: () => {}, pauseOrResume: async () => {}, endDialog: () => {},
    }));
    return React.createElement('div', { 'data-testid': 'rendered-focus-widget' });
  }) };
});
vi.mock('@/components/TimeBlockWidget', async () => {
  const React = await import('react');
  return { TimeBlockWidget: React.forwardRef(function LegacyProbe(props: Record<string, unknown>, ref) {
    probes.legacy(props);
    React.useImperativeHandle(ref, () => ({ getTimerState: () => 'idle' }));
    return React.createElement('div', { 'data-testid': 'rendered-legacy-widget' });
  }) };
});
vi.mock('@/ui/app/components/NowInputRow', async () => {
  const React = await import('react');
  return { NowInputRow: React.forwardRef(function InputProbe(_props, ref) {
    React.useImperativeHandle(ref, () => ({ focusText: () => {} }));
    return React.createElement('div', { 'data-testid': 'record-input' });
  }) };
});
vi.mock('@/components/VoiceMessageInput', () => ({ VoiceMessageInput: () => null }));
vi.mock('@/ui/app/components/PageMoreMenu', () => ({ PageMoreMenu: () => null }));
vi.mock('@/components/Chat/EventMarkdown', () => ({ EventMarkdown: () => null }));
vi.mock('@/components/Chat/MessageActions', () => ({ MessageActions: () => null }));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('ChatPage variant and timer visibility wiring', () => {
  it.each([
    ['new-mobile', undefined, true, false],
    ['new-mobile', true, true, false],
    ['new-mobile', false, false, false],
    ['default', undefined, false, true],
    ['default', true, false, true],
    ['default', false, false, true],
  ] as const)('variant=%s showTimerWidget=%s renders the correct timer', async (variant, showTimerWidget, focus, legacy) => {
    render(createElement(ChatPage, { variant, showTimerWidget }));
    await screen.findByText('暂无事件记录');
    expect(!!screen.queryByTestId('rendered-focus-widget')).toBe(focus);
    expect(!!screen.queryByTestId('rendered-legacy-widget')).toBe(legacy);
    if (focus) expect(probes.focus.mock.calls.at(-1)?.[0]).toMatchObject({
      taskAssociationsEnabled: false, showRunningLinkedTasks: false,
    });
    else expect(probes.focus).not.toHaveBeenCalled();
    if (legacy) expect(probes.legacy.mock.calls.at(-1)?.[0]).toMatchObject({ variant: 'default' });
    else expect(probes.legacy).not.toHaveBeenCalled();
  });

  it('toggles only the new-mobile timer without introducing legacy/task UI', async () => {
    const { rerender } = render(createElement(ChatPage, { variant: 'new-mobile', showTimerWidget: true }));
    await screen.findByText('暂无事件记录');
    expect(screen.getByTestId('rendered-focus-widget')).toBeInTheDocument();
    rerender(createElement(ChatPage, { variant: 'new-mobile', showTimerWidget: false }));
    expect(screen.queryByTestId('rendered-focus-widget')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rendered-legacy-widget')).not.toBeInTheDocument();
    rerender(createElement(ChatPage, { variant: 'new-mobile', showTimerWidget: true }));
    expect(screen.getByTestId('rendered-focus-widget')).toBeInTheDocument();
    expect(probes.focus.mock.calls.at(-1)?.[0]).toMatchObject({ taskAssociationsEnabled: false, showRunningLinkedTasks: false });
  });

  it('keeps the real focus ref connected to the existing keyboard command path', async () => {
    render(createElement(ChatPage, { variant: 'new-mobile' }));
    await screen.findByText('暂无事件记录');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(probes.expand).toHaveBeenCalledTimes(1);
  });
});
