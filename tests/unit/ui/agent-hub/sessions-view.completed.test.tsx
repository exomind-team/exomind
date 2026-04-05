import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsView } from '@/ui/app/pages/agents/SessionsView';
import type { SessionInfo } from '@/lib/types/session';

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-default',
    agent_kind: 'claude',
    role: 'Terminal Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-default',
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

describe('sessions view completed grouping（会话列表已完成分组）', () => {
  it('shows active sessions first, completed sessions below, and filters archived（活跃会话在上、已完成在下、归档被过滤）', () => {
    render(
      <SessionsView
        sessions={[
          buildSession({
            id: 'completed-session',
            status: 'completed',
            last_active_at: '2026-03-18T00:01:00.000Z',
          }),
          buildSession({
            id: 'active-session',
            status: 'running',
            last_active_at: '2026-03-18T00:03:00.000Z',
          }),
          buildSession({
            id: 'waiting-session',
            status: 'waiting_input',
            last_active_at: '2026-03-18T00:02:00.000Z',
          }),
          buildSession({
            id: 'archived-session',
            status: 'archived',
            last_active_at: '2026-03-18T00:04:00.000Z',
          }),
        ]}
        loading={false}
        error={null}
        useMockData={false}
      />,
    );

    const activeSection = screen.getByTestId('sessions-active-section');
    const completedSection = screen.getByTestId('sessions-completed-section');

    expect(screen.getByTestId('session-card-active-session')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-waiting-session')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-completed-session')).toBeInTheDocument();
    expect(screen.queryByTestId('session-card-archived-session')).not.toBeInTheDocument();

    expect(activeSection).toHaveTextContent('活跃会话');
    expect(activeSection).toHaveTextContent('2');
    expect(completedSection).toHaveTextContent('已完成');
    expect(completedSection).toHaveTextContent('1');

    expect(
      activeSection.compareDocumentPosition(completedSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
});
