import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionInfo } from '@/lib/types/session';
import { WorkbenchPage } from '@/ui/app/pages/workbench/WorkbenchPage';

const useSessionStreamMock = vi.fn();
const useIsDesktopMock = vi.fn();
const useLocationMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => useLocationMock(),
}));

vi.mock('@/hooks/useSessionStream', () => ({
  useSessionStream: (...args: unknown[]) => useSessionStreamMock(...args),
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: (...args: unknown[]) => useIsDesktopMock(...args),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: () => ({
    mode: 'embedded',
    host: '127.0.0.1',
    port: 9124,
    authToken: 'token-789',
  }),
  subscribeRuntimeTargetChanges: () => () => {},
  toRuntimeBaseUrl: () => 'http://127.0.0.1:9124',
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-789',
    agent_kind: 'claude',
    agent_id: 'agent-review',
    role: 'Review Agent',
    summary: 'Reviewing code',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: ['#789'],
      labels: ['workbench'],
    },
    created_at: '2026-03-31T09:00:00.000Z',
    last_active_at: '2026-03-31T09:15:00.000Z',
    turn_count: 4,
    last_output_preview: 'Please confirm merge',
    ...overrides,
  };
}

describe('Issue #789 legacy handoff preservation（保留旧入口 handoff 语义）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useIsDesktopMock.mockReturnValue(true);
    useLocationMock.mockReturnValue({
      pathname: '/workbench',
      searchStr: '?legacySource=agent-chat&agentId=agent-review',
    });
    useSessionStreamMock.mockReturnValue({
      sessions: [
        buildSession({
          id: 'session-review',
          agent_id: 'agent-review',
          role: 'Review Agent',
        }),
        buildSession({
          id: 'session-terminal',
          agent_id: undefined,
          interaction_mode: 'terminal',
          pty_id: 'pty-789',
          role: 'Terminal Runner',
          summary: 'Running shell',
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it('keeps agent chat handoff visible even when runtime panes exist（runtime pane 存在时仍显示 agent chat handoff）', () => {
    render(<WorkbenchPage />);

    expect(screen.getByTestId('workbench-legacy-entry')).toContainHTML('/agents/chat/agent-review');
    expect(screen.getByText('Agent Chat / agent-review')).toBeInTheDocument();
  });
});
