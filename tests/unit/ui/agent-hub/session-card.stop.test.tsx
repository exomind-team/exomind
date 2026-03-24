import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SessionCard } from '@/ui/app/pages/agents/SessionCard';
import { SessionsView } from '@/ui/app/pages/agents/SessionsView';
import type { SessionInfo } from '@/lib/types/session';

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
});
