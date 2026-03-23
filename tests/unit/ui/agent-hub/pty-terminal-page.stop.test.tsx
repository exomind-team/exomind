import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PtyTerminalPage } from '@/ui/app/pages/agents/PtyTerminalPage';

vi.mock('@/ui/app/components/PtyTerminal', () => ({
  PtyTerminal: ({
    ptyId,
  }: {
    ptyId: string;
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'pty-123',
        status: 'stopped',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<PtyTerminalPage ptyId="pty-123" />);

    expect(screen.getByTestId('mock-pty-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('pty-terminal-page-stop')).toBeInTheDocument();

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
});
