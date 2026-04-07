/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@/lib/types/session';
import { SessionCard } from '../SessionCard';

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    agent_kind: 'codex',
    role: 'Terminal Agent',
    summary: 'Investigating terminal recovery',
    status: 'running',
    interaction_mode: 'terminal',
    context: {
      issue_refs: ['#841'],
      labels: [],
    },
    created_at: '2026-04-07T10:00:00.000Z',
    last_active_at: new Date().toISOString(),
    turn_count: 3,
    ...overrides,
  };
}

describe('SessionCard', () => {
  it('renders a force-complete action for active terminal sessions without a PTY', () => {
    const onStop = vi.fn();
    const session = buildSession({ pty_id: undefined });

    render(<SessionCard session={session} onStop={onStop} />);

    const button = screen.getByRole('button', { name: '强制完成' });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledWith(session);
  });

  it('does not expose force-complete for non-terminal sessions without a PTY', () => {
    const session = buildSession({
      interaction_mode: 'structured',
      pty_id: undefined,
    });

    render(<SessionCard session={session} />);

    expect(screen.queryByRole('button', { name: '强制完成' })).not.toBeInTheDocument();
    expect(screen.getByTestId('session-card-session-1')).toBeDisabled();
  });
});
