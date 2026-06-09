import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionCard } from '@/ui/app/pages/agents/SessionCard';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import type { SessionInfo } from '@/lib/types/session';

const hoisted = vi.hoisted(() => ({
  retryPtyInputTransport: vi.fn(),
}));

vi.mock('@/ui/app/components/pty-input', () => ({
  retryPtyInputTransport: hoisted.retryPtyInputTransport,
}));

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
    onTransportPresentationChange,
  }: {
    ptyId?: string;
    onTransportPresentationChange?: (state: unknown) => void;
  }) => (
    <div data-testid={ptyId ? `mock-pty-terminal-${ptyId}` : 'mock-pty-terminal'}>
      <button
        type="button"
        data-testid={ptyId ? `mock-pty-output-reconnecting-${ptyId}` : 'mock-pty-output-reconnecting'}
        onClick={() => {
          onTransportPresentationChange?.({
            kind: 'output-reconnecting',
            message: '输出重连中，输入暂停',
          });
        }}
      >
        output-reconnecting
      </button>
      <button
        type="button"
        data-testid={ptyId ? `mock-pty-input-readonly-${ptyId}` : 'mock-pty-input-readonly'}
        onClick={() => {
          onTransportPresentationChange?.({
            kind: 'input-readonly',
            message: '输入只读，可重连',
            actionLabel: '重连输入',
          });
        }}
      >
        input-readonly
      </button>
      <button
        type="button"
        data-testid={ptyId ? `mock-pty-clear-${ptyId}` : 'mock-pty-clear'}
        onClick={() => {
          onTransportPresentationChange?.(null);
        }}
      >
        clear
      </button>
    </div>
  ),
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const justNow = new Date(Date.now() - 1_000).toISOString();
  return {
    id: 'session-status-1',
    agent_kind: 'claude',
    role: 'Terminal Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-status-1',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: justNow,
    last_active_at: justNow,
    turn_count: 0,
    ...overrides,
  };
}

describe('agent hub terminal status layering（Agent Hub 终端状态分层）', () => {
  beforeEach(() => {
    hoisted.retryPtyInputTransport.mockReset();
  });

  it('renders session card meta on the left with status icon and relative time（会话卡片左侧渲染状态图标与时间元信息）', () => {
    render(<SessionCard session={buildSession()} />);

    expect(screen.getByTestId('session-status-mark-running')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-meta-session-status-1')).toHaveTextContent(
      'Claude',
    );
    expect(screen.getByTestId('session-card-meta-session-status-1')).toHaveTextContent(
      '刚刚',
    );
    expect(screen.queryByText('▲')).not.toBeInTheDocument();
  });

  it('moves tiled pane meta to the left header cluster（平铺窗格将 Agent 与时间移动到左上信息簇）', () => {
    render(
      <TiledGrid
        sessions={[buildSession()]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tiled-grid-pane-meta-session-status-1')).toHaveTextContent(
      'Claude',
    );
    expect(screen.getByTestId('tiled-grid-pane-meta-session-status-1')).toHaveTextContent(
      '刚刚',
    );
  });

  it('prefers session attention over turn count in footer（左下角优先显示 session attention 而非 turns）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            status: 'waiting_input',
            turn_count: 6,
          }),
        ]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    expect(screen.getByTestId('tiled-grid-footer-status-session-status-1')).toHaveTextContent(
      '等待输入',
    );
    expect(screen.queryByText('6 turns')).not.toBeInTheDocument();
  });

  it('lets PTY reconnect status override waiting_input in footer（PTY 非阻塞状态会覆盖等待输入文案）', () => {
    render(
      <TiledGrid
        sessions={[
          buildSession({
            status: 'waiting_input',
          }),
        ]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-pty-output-reconnecting-pty-status-1'));

    expect(screen.getByTestId('tiled-grid-footer-status-session-status-1')).toHaveTextContent(
      '输出重连中，输入暂停',
    );
    expect(screen.queryByTestId('tiled-grid-retry-input-session-status-1')).not.toBeInTheDocument();
  });

  it('shows retry input action on the right when input becomes read-only（输入只读时在右侧显示重连输入动作）', () => {
    render(
      <TiledGrid
        sessions={[buildSession()]}
        layout="1x1"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mock-pty-input-readonly-pty-status-1'));

    expect(screen.getByTestId('tiled-grid-footer-status-session-status-1')).toHaveTextContent(
      '输入只读，可重连',
    );

    fireEvent.click(screen.getByTestId('tiled-grid-retry-input-session-status-1'));

    expect(hoisted.retryPtyInputTransport).toHaveBeenCalledWith({
      rtBaseUrl: 'http://127.0.0.1:1949',
      ptyId: 'pty-status-1',
      authToken: undefined,
    });
  });
});
