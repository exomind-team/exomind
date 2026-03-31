import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionInfo } from '@/lib/types/session';
import { WorkbenchPage } from '@/ui/app/pages/workbench/WorkbenchPage';

const useSessionStreamMock = vi.fn();
const useIsDesktopMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({
    pathname: '/workbench',
    searchStr: '',
  }),
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
    authToken: 'token-777',
  }),
  subscribeRuntimeTargetChanges: () => () => {},
  toRuntimeBaseUrl: () => 'http://127.0.0.1:9124',
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-777',
    agent_kind: 'claude',
    agent_id: 'agent-777',
    role: 'Planner Agent',
    summary: 'Plan the next workbench slice',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: ['#777'],
      labels: ['workbench'],
    },
    created_at: '2026-03-31T02:00:00.000Z',
    last_active_at: '2026-03-31T02:30:00.000Z',
    turn_count: 3,
    last_output_preview: 'Ready for review',
    ...overrides,
  };
}

describe('Issue #777 workbench pane click-through（工作台 pane 点击跳转）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/workbench');
    useIsDesktopMock.mockReturnValue(true);
    useSessionStreamMock.mockReturnValue({
      sessions: [
        buildSession({
          id: 'session-structured',
          agent_id: 'agent-review',
          role: 'Review Agent',
          interaction_mode: 'structured',
        }),
        buildSession({
          id: 'session-terminal',
          agent_id: undefined,
          role: 'Terminal Runner',
          summary: 'Running shell',
          interaction_mode: 'terminal',
          pty_id: 'pty-777',
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  it('renders runtime-fed panes（渲染真实 runtime pane）', () => {
    render(<WorkbenchPage />);

    expect(screen.getByText('Agent Workbench / Agent 工作台')).toBeInTheDocument();
    expect(screen.getByText('Review Agent')).toBeInTheDocument();
    expect(screen.getByText('Running shell')).toBeInTheDocument();
  });

  it('opens the legacy chat route when clicking a structured pane（点击结构化 pane 跳到旧聊天路由）', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const popStateDispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<WorkbenchPage />);
    fireEvent.click(screen.getByTestId('workbench-pane-open-pane-session-structured'));

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/agents/chat/agent-review?workbenchBypass=true',
    );
    expect(popStateDispatchSpy).toHaveBeenCalled();
  });

  it('opens the legacy agents fallback when clicking a PTY pane（点击 PTY pane 跳到旧 agents 回退路由）', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    render(<WorkbenchPage />);
    fireEvent.click(screen.getByTestId('workbench-pane-open-pane-session-terminal'));

    expect(pushStateSpy).toHaveBeenCalledWith(
      {},
      '',
      '/agents?workbenchBypass=true&focusSession=session-terminal',
    );
  });
});
