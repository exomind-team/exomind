import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionCard } from '@/ui/app/pages/agents/SessionCard';
import { SessionsView } from '@/ui/app/pages/agents/SessionsView';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import type { SessionInfo } from '@/lib/types/session';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: () => <div data-testid="mock-pty-terminal">Mock PTY Terminal</div>,
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-stop-1',
    agent_kind: 'claude',
    role: 'Terminal Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-stop-1',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-03-18T00:00:00.000Z',
    last_active_at: '2026-03-18T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

describe('session card stop action（列表卡片停止动作）', () => {
  it('shows stop button for PTY terminal sessions and does not trigger main click（PTY 终端会话显示停止按钮且不触发主点击）', () => {
    const session = buildSession();
    const onClick = vi.fn();
    const onStop = vi.fn();

    render(<SessionCard session={session} onClick={onClick} onStop={onStop} />);

    const stopButton = screen.getByTestId('session-card-stop-session-stop-1');
    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledWith(session);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not show stop button for non-PTY sessions（非 PTY 会话不显示停止按钮）', () => {
    render(
      <SessionCard
        session={buildSession({
          id: 'session-no-stop',
          interaction_mode: 'structured',
          pty_id: undefined,
        })}
      />,
    );

    expect(screen.queryByTestId('session-card-stop-session-no-stop')).not.toBeInTheDocument();
  });

  it('passes stop callback through SessionsView（SessionsView 应透传停止回调）', () => {
    const session = buildSession({ id: 'session-pass-through', pty_id: 'pty-pass-through' });
    const onStopSession = vi.fn();

    render(
      <SessionsView
        sessions={[session]}
        loading={false}
        error={null}
        useMockData={false}
        onStopSession={onStopSession}
      />,
    );

    fireEvent.click(screen.getByTestId('session-card-stop-session-pass-through'));

    expect(onStopSession).toHaveBeenCalledWith(session);
  });

  it('shows archive button for completed PTY sessions and does not trigger stop/main click（已完成 PTY 会话显示归档按钮且不触发停止或主点击）', () => {
    const session = buildSession({
      id: 'session-completed',
      status: 'completed',
      pty_id: 'pty-completed',
    });
    const onClick = vi.fn();
    const onStop = vi.fn();
    const onArchive = vi.fn();

    render(
      <SessionCard
        session={session}
        onClick={onClick}
        onStop={onStop}
        onArchive={onArchive}
      />,
    );

    expect(screen.getByTestId('session-card-session-completed')).toHaveClass('opacity-50');
    expect(screen.queryByTestId('session-card-stop-session-completed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('session-card-archive-session-completed'));

    expect(onArchive).toHaveBeenCalledWith(session);
    expect(onStop).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('passes archive callback through SessionsView（SessionsView 应透传归档回调）', () => {
    const session = buildSession({
      id: 'session-archive-pass-through',
      status: 'completed',
      pty_id: 'pty-archive-pass-through',
    });
    const onArchiveSession = vi.fn();

    render(
      <SessionsView
        sessions={[session]}
        loading={false}
        error={null}
        useMockData={false}
        onArchiveSession={onArchiveSession}
      />,
    );

    fireEvent.click(screen.getByTestId('session-card-archive-session-archive-pass-through'));

    expect(onArchiveSession).toHaveBeenCalledWith(session);
  });
});

describe('tiled grid terminal lifecycle actions（平铺视图终端生命周期动作）', () => {
  it('calls stop handler for running terminal PTY sessions（运行中的终端 PTY 会话点击停止应触发回调）', () => {
    const onStopSession = vi.fn();
    const session = buildSession({
      id: 'terminal-pty',
      interaction_mode: 'terminal',
      pty_id: 'pty-523',
    });

    render(
      <TiledGrid
        sessions={[session]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        onStopSession={onStopSession}
      />,
    );

    fireEvent.click(screen.getByTestId('tiled-grid-stop-terminal-pty'));

    expect(onStopSession).toHaveBeenCalledWith(session);
  });

  it('shows archive button instead of stop for completed panes（已完成窗格显示归档按钮而非停止按钮）', () => {
    const session = buildSession({
      id: 'terminal-completed',
      status: 'completed',
      interaction_mode: 'terminal',
      pty_id: 'pty-completed-grid',
    });
    const onArchiveSession = vi.fn();
    const onStopSession = vi.fn();

    render(
      <TiledGrid
        sessions={[session]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        onArchiveSession={onArchiveSession}
        onStopSession={onStopSession}
      />,
    );

    expect(screen.queryByTestId('tiled-grid-stop-terminal-completed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tiled-grid-archive-terminal-completed'));

    expect(onArchiveSession).toHaveBeenCalledWith(session);
    expect(onStopSession).not.toHaveBeenCalled();
  });
});
