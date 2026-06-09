import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionCard } from '@/ui/app/pages/agents/SessionCard';
import { SessionsView } from '@/ui/app/pages/agents/SessionsView';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import type { SessionInfo } from '@/lib/types/session';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
    inputPaused,
  }: {
    ptyId?: string;
    inputPaused?: boolean;
  }) => (
    <div
      data-testid={ptyId ? `mock-pty-terminal-${ptyId}` : 'mock-pty-terminal'}
      data-input-paused={inputPaused === true ? 'true' : 'false'}
    >
      Mock PTY Terminal
    </div>
  ),
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

  it('shows a unified close button for structured sessions without PTY（无 PTY 的结构化会话显示统一关闭按钮）', () => {
    render(
      <SessionCard
        session={buildSession({
          id: 'session-no-stop',
          interaction_mode: 'structured',
          pty_id: undefined,
        })}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('session-card-stop-session-no-stop')).not.toBeInTheDocument();
    const closeButton = screen.getByTestId('session-card-close-session-no-stop');
    expect(closeButton).toHaveAttribute('title', '关闭');
    expect(closeButton).toHaveClass('rounded-full');
  });

  it('shows unified end action for terminal sessions without PTY（无 PTY 的终端会话显示统一结束按钮）', () => {
    const session = buildSession({
      id: 'session-no-pty-terminal',
      pty_id: undefined,
    });
    const onStop = vi.fn();

    render(<SessionCard session={session} onStop={onStop} />);

    expect(screen.queryByTestId('session-card-stop-session-no-pty-terminal')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-card-missing-pty-note-session-no-pty-terminal')).toHaveTextContent('该会话没有关联 PTY');
    expect(screen.getByTestId('session-card-missing-pty-note-session-no-pty-terminal')).toHaveTextContent('若存在可恢复的历史终端');
    expect(screen.getByTestId('session-card-missing-pty-note-session-no-pty-terminal')).toHaveTextContent('结束');

    const stopButton = screen.getByTestId('session-card-force-complete-session-no-pty-terminal');
    expect(stopButton).toHaveAttribute('title', '结束');
    expect(stopButton).toHaveClass('rounded-full');

    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledWith(session);
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

  it('passes resolve callback through SessionsView for terminal sessions without PTY（SessionsView 对无 PTY 终端会话也应透传结束回调）', () => {
    const session = buildSession({
      id: 'session-pass-through-no-pty',
      pty_id: undefined,
    });
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

    fireEvent.click(screen.getByTestId('session-card-force-complete-session-pass-through-no-pty'));

    expect(onStopSession).toHaveBeenCalledWith(session);
  });

  it('uses end semantics for terminal sessions without PTY（无 PTY 的终端会话应显示结束动作）', () => {
    const session = buildSession({
      id: 'session-no-pty',
      pty_id: undefined,
    });
    const onStop = vi.fn();

    render(<SessionCard session={session} onStop={onStop} />);

    const stopButton = screen.getByTestId('session-card-force-complete-session-no-pty');
    expect(stopButton).toHaveAttribute('title', '结束');
    expect(stopButton).toHaveClass('rounded-full');

    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledWith(session);
  });

  it('disables the stop button while a stop action is pending（停止进行中时禁用列表卡片按钮）', () => {
    const session = buildSession({ id: 'session-stop-pending' });

    render(
      <SessionCard
        session={session}
        onStop={vi.fn()}
        stopDisabled
      />,
    );

    const stopButton = screen.getByTestId('session-card-stop-session-stop-pending');
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute('title', '停止中');
  });

  it('uses processing label while resolving a no-PTY terminal session（无 PTY 会话处理中时显示处理中）', () => {
    const session = buildSession({
      id: 'session-no-pty-pending',
      pty_id: undefined,
    });

    render(
      <SessionCard
        session={session}
        onStop={vi.fn()}
        stopDisabled
      />,
    );

    expect(screen.queryByTestId('session-card-stop-session-no-pty-pending')).not.toBeInTheDocument();
    const stopButton = screen.getByTestId('session-card-force-complete-session-no-pty-pending');
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute('title', '处理中');
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

  it('calls resolve handler for running terminal sessions without PTY in tiled view（平铺视图中的无 PTY 终端会话点击结束应触发回调）', () => {
    const onStopSession = vi.fn();
    const session = buildSession({
      id: 'terminal-no-pty',
      interaction_mode: 'terminal',
      pty_id: undefined,
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

    fireEvent.click(screen.getByTestId('tiled-grid-stop-terminal-no-pty'));

    expect(onStopSession).toHaveBeenCalledWith(session);
  });

  it('disables tiled stop button while stop is pending（停止进行中时禁用平铺窗格按钮）', () => {
    const session = buildSession({
      id: 'terminal-pty-pending',
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
        onStopSession={vi.fn()}
        isSessionStopping={() => true}
      />,
    );

    const stopButton = screen.getByTestId('tiled-grid-stop-terminal-pty-pending');
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute('title', '停止中');
  });

  it('uses end semantics in tiled view for terminal sessions without PTY（平铺视图中的无 PTY 终端会话仍应显示结束动作）', () => {
    const onStopSession = vi.fn();
    const session = buildSession({
      id: 'terminal-no-pty',
      interaction_mode: 'terminal',
      pty_id: undefined,
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

    const stopButton = screen.getByTestId('tiled-grid-stop-terminal-no-pty');
    expect(stopButton).toHaveAttribute('title', '结束');

    fireEvent.click(stopButton);

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

  it('renders disconnected tiled terminals in read-only mode（断开窗格不会继续建立可输入终端）', () => {
    const session = buildSession({
      id: 'terminal-disconnected',
      interaction_mode: 'terminal',
      pty_id: 'pty-disconnected-grid',
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
        isSessionDisconnected={() => true}
      />,
    );

    expect(screen.getByTestId('mock-pty-terminal-pty-disconnected-grid')).toHaveAttribute(
      'data-input-paused',
      'true',
    );
    expect(screen.getByTestId('tiled-grid-pty-disconnected-terminal-disconnected')).toBeInTheDocument();
  });
});
