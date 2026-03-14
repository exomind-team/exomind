import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import type { SessionInfo } from '@/lib/types/session';

function buildSession(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'session-523',
    agent_kind: 'claude',
    role: 'Session 523',
    summary: '',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-03-14T00:00:00.000Z',
    last_active_at: '2026-03-14T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

describe('tiled grid quick actions issue-523（平铺会话动作栏）', () => {
  it('shows mark-waiting button for running terminal sessions（运行中的终端会话应显示等待决策按钮）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'terminal-running',
            status: 'running',
            interaction_mode: 'terminal',
          }),
        ]}
        layout="1x1"
        rtBaseUrl="http://127.0.0.1:1949"
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '等待决策' })).toBeInTheDocument();
  });

  it('does not show mark-waiting button for already waiting terminal sessions（已等待中的终端会话不应重复显示等待决策按钮）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'terminal-waiting',
            status: 'waiting_input',
            interaction_mode: 'terminal',
          }),
        ]}
        layout="1x1"
        rtBaseUrl="http://127.0.0.1:1949"
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '等待决策' })).not.toBeInTheDocument();
  });
});
