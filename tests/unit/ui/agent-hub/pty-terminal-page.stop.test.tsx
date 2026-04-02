import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PtyTerminalPage } from '@/ui/app/pages/agents/PtyTerminalPage';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
    onInitialConnectionFailure: _onInitialConnectionFailure,
  }: {
    ptyId: string;
    onInitialConnectionFailure?: () => void;
  }) => <div data-testid="mock-pty-terminal">PTY:{ptyId}</div>,
}));

describe('pty terminal page stop action（全屏终端页结束动作）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(
      { ptyToken: 'token-123' },
      '',
      '/agents/pty/pty-123?baseUrl=http://127.0.0.1:1919',
    );
  });

  it('stops terminal agent and navigates back to agents（结束 Terminal Agent 后返回 agents 页）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'pty-123' }],
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'pty-123',
          status: 'stopped',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PtyTerminalPage ptyId="pty-123" />);

    expect(screen.getByTestId('mock-pty-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('pty-terminal-page-stop')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('pty-terminal-page-stop')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('pty-terminal-page-stop'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/pty/pty-123/stop',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
          }),
        }),
      );
      expect(window.location.pathname).toBe('/agents');
    });
  });

  it('shows disconnected state when the PTY no longer exists（PTY 不存在时显示断开提示）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 'pty-other' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<PtyTerminalPage ptyId="pty-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('pty-terminal-page-disconnected')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('mock-pty-terminal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回 Agents' })).toBeInTheDocument();
  });

  it('reconciles a stale terminal session when stop returns 404（丢失 PTY 时可将会话收敛为已完成）', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/pty')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'pty-other' }],
        } as Response;
      }
      if (url.endsWith('/pty/pty-123/stop')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'not found' }),
        } as Response;
      }
      if (url.endsWith('/sessions')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{
            id: 'session-pty-123',
            agent_kind: 'claude',
            role: 'Recovered Terminal',
            summary: '',
            status: 'running',
            interaction_mode: 'terminal',
            pty_id: 'pty-123',
            context: {
              issue_refs: [],
              labels: [],
            },
            created_at: '2026-03-14T00:00:00.000Z',
            last_active_at: '2026-03-14T00:00:00.000Z',
            turn_count: 0,
          }],
        } as Response;
      }
      if (url.endsWith('/sessions/session-pty-123') && init?.method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'session-pty-123',
            agent_kind: 'claude',
            role: 'Recovered Terminal',
            summary: '',
            status: 'completed',
            interaction_mode: 'terminal',
            pty_id: 'pty-123',
            context: {
              issue_refs: [],
              labels: [],
            },
            created_at: '2026-03-14T00:00:00.000Z',
            last_active_at: '2026-03-14T00:00:00.000Z',
            turn_count: 0,
          }),
        } as Response;
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not found' }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PtyTerminalPage ptyId="pty-123" />);

    await waitFor(() => {
      expect(screen.getByTestId('pty-terminal-page-disconnected')).toBeInTheDocument();
      expect(screen.getByTestId('pty-terminal-page-stop')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('pty-terminal-page-stop'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1919/sessions/session-pty-123',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ status: 'completed' }),
        }),
      );
      expect(window.location.pathname).toBe('/agents');
    });
  });
});
