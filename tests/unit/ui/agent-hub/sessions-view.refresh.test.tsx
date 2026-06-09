import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionsView } from '@/ui/app/pages/agents/SessionsView';
import type { SessionInfo } from '@/lib/types/session';

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-refresh',
    agent_kind: 'claude',
    role: 'Refresh Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-refresh',
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

describe('sessions view refresh feedback（会话列表刷新反馈）', () => {
  it('spins, disables, and logs while a manual refresh is in flight（手动刷新进行中应旋转、禁用并记录日志）', async () => {
    let resolveRefresh: (() => void) | null = null;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    render(
      <SessionsView
        sessions={[buildSession()]}
        loading={false}
        error={null}
        useMockData={false}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId('sessions-refresh-button'));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sessions-refresh-button')).toBeDisabled();
    expect(screen.getByTestId('sessions-refresh-icon')).toHaveClass('animate-spin');
    expect(infoSpy).toHaveBeenCalledWith(
      '[agent-hub][sessions][refresh] requested',
      expect.objectContaining({ visibleSessionCount: 1 }),
    );

    resolveRefresh?.();

    await waitFor(() => {
      expect(screen.getByTestId('sessions-refresh-button')).not.toBeDisabled();
    });
    expect(screen.getByTestId('sessions-refresh-icon')).not.toHaveClass('animate-spin');
    expect(infoSpy).toHaveBeenCalledWith(
      '[agent-hub][sessions][refresh] completed',
      expect.objectContaining({ visibleSessionCount: 1 }),
    );

    infoSpy.mockRestore();
  });
});
