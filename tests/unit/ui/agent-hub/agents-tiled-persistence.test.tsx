import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SessionInfo } from '@/lib/types/session';
import { TiledGrid } from '@/ui/app/pages/agents/TiledGrid';
import {
  AGENTS_TILED_PERSISTENCE_STORAGE_KEY,
  readAgentsTiledPersistState,
  writeAgentsTiledPersistState,
} from '@/ui/app/pages/agents/agents-tiled-persistence';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({ ptyId }: { ptyId: string }) => <div data-testid={`mock-pty-terminal-${ptyId}`}>PTY:{ptyId}</div>,
}));

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-persist-default',
    agent_kind: 'claude',
    role: 'Persistent Session',
    summary: '',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-persist-default',
    context: {
      issue_refs: [],
      labels: [],
    },
    created_at: '2026-04-02T00:00:00.000Z',
    last_active_at: '2026-04-02T00:00:00.000Z',
    turn_count: 0,
    ...overrides,
  };
}

describe('agents tiled persistence（终端平铺持久化）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips tiled layout, pane order, and fullscreen PTY id（布局、pane 顺序、全屏 PTY 可往返持久化）', () => {
    writeAgentsTiledPersistState({
      layout: '2x4',
      paneOrder: ['session-a', 'session-b'],
      fullscreenPtyId: 'pty-recover-1',
      fullscreenTerminalRecovery: {
        sessionId: 'session-a',
        sourceHostId: 'runtime-host-523',
        agentType: 'codex',
        innerSessionId: 'codex-thread-818',
        role: 'Codex Recovery',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    });

    expect(localStorage.getItem(AGENTS_TILED_PERSISTENCE_STORAGE_KEY)).toContain('pty-recover-1');
    expect(readAgentsTiledPersistState()).toEqual({
      layout: '2x4',
      paneOrder: ['session-a', 'session-b'],
      fullscreenPtyId: 'pty-recover-1',
      fullscreenTerminalRecovery: {
        sessionId: 'session-a',
        sourceHostId: 'runtime-host-523',
        agentType: 'codex',
        innerSessionId: 'codex-thread-818',
        role: 'Codex Recovery',
        workdir: 'D:/project/exomind',
        projectPathKey: 'd:/project/exomind',
      },
    });
  });

  it('renders a disconnected placeholder for stale pane ids and removes it on close（过期 pane 显示断开占位并可移除）', () => {
    const onReorder = vi.fn();

    render(
      <TiledGrid
        sessions={[
          buildSession({
            id: 'session-live',
            pty_id: 'pty-live',
          }),
        ]}
        layout="1x2"
        resolveSessionConnection={() => ({
          rtBaseUrl: 'http://127.0.0.1:1949',
        })}
        focusedIndex={0}
        onFocusPane={vi.fn()}
        paneOrder={['session-stale', 'session-live']}
        onReorder={onReorder}
      />,
    );

    expect(screen.getByTestId('tiled-grid-disconnected-session-stale')).toBeInTheDocument();
    expect(screen.getByText('会话已断开')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tiled-grid-disconnected-close-session-stale'));

    expect(onReorder).toHaveBeenCalledWith(['session-live']);
  });
});
