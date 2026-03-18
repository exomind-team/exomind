import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PtySpawnDialog } from '@/ui/app/components/PtySpawnDialog';

describe('PtySpawnDialog（终端会话启动弹窗）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds codex spawn request with model and reasoning config（Codex 启动携带模型与推理强度）', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/pty/sessions?agent_type=claude')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes('/pty/sessions?agent_type=codex')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.endsWith('/pty/spawn')) {
        return {
          ok: true,
          json: async () => ({ id: 'pty-codex-1', name: 'codex-main' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSpawned = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={onOpenChange}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir="D:/project/exomind"
        onSpawned={onSpawned}
      />,
    );

    fireEvent.change(screen.getByTestId('pty-agent-type'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByTestId('pty-session-name'), { target: { value: 'codex-main' } });
    fireEvent.change(screen.getByTestId('pty-session-workdir'), { target: { value: 'D:/project/exomind' } });
    fireEvent.change(screen.getByTestId('pty-model'), { target: { value: 'gpt-5.4' } });
    fireEvent.change(screen.getByTestId('pty-reasoning-effort'), { target: { value: 'xhigh' } });
    fireEvent.change(screen.getByTestId('pty-extra-args'), { target: { value: '--search --full-auto' } });
    fireEvent.click(screen.getByTestId('pty-spawn-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1949/pty/spawn',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'codex-main',
            workdir: 'D:/project/exomind',
            command: 'codex',
            args: [
              '-m',
              'gpt-5.4',
              '-c',
              'model_reasoning_effort="xhigh"',
              '--search',
              '--full-auto',
            ],
            rows: 24,
            cols: 80,
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({ id: 'pty-codex-1', name: 'codex-main' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('resumes codex historical session with agent_type（按 Agent 类型恢复 Codex 历史会话）', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/pty/sessions?agent_type=claude')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.includes('/pty/sessions?agent_type=codex')) {
        return {
          ok: true,
          json: async () => ([{
            agent_type: 'codex',
            session_id: '019d0011-aaaa-bbbb-cccc-1234567890ab',
            project_path: 'D:/project/exomind',
            last_modified: '2026-03-18T02:20:32.696Z',
          }]),
        } as Response;
      }
      if (input.endsWith('/pty/resume')) {
        return {
          ok: true,
          json: async () => ({ id: 'pty-codex-2', name: 'Codex-019d0011' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSpawned = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={onOpenChange}
        rtBaseUrl="http://127.0.0.1:1949"
        defaultWorkdir="D:/project/exomind"
        onSpawned={onSpawned}
      />,
    );

    fireEvent.change(screen.getByTestId('pty-agent-type'), { target: { value: 'codex' } });

    await waitFor(() => {
      expect(screen.getByTestId('pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('pty-session-name'), { target: { value: 'resume-codex' } });
    fireEvent.change(screen.getByTestId('pty-session-workdir'), { target: { value: 'D:/project/exomind' } });
    fireEvent.change(screen.getByTestId('pty-model'), { target: { value: 'gpt-5.4' } });
    fireEvent.change(screen.getByTestId('pty-reasoning-effort'), { target: { value: 'xhigh' } });
    fireEvent.change(screen.getByTestId('pty-extra-args'), { target: { value: '--search --full-auto' } });
    fireEvent.click(screen.getByTestId('pty-history-session-019d0011-aaaa-bbbb-cccc-1234567890ab'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1949/pty/resume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            agent_type: 'codex',
            session_id: '019d0011-aaaa-bbbb-cccc-1234567890ab',
            name: 'resume-codex',
            workdir: 'D:/project/exomind',
            model: 'gpt-5.4',
            reasoning_effort: 'xhigh',
            extra_args: ['--search', '--full-auto'],
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({ id: 'pty-codex-2', name: 'Codex-019d0011' });
    });
  });

  it('supports custom command mode without history list（自定义命令模式不显示历史恢复）', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('/pty/sessions?agent_type=claude')) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (input.endsWith('/pty/spawn')) {
        return {
          ok: true,
          json: async () => ({ id: 'pty-custom-1', name: 'my-custom' }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSpawned = vi.fn();

    render(
      <PtySpawnDialog
        open={true}
        onOpenChange={() => {}}
        rtBaseUrl="http://127.0.0.1:1949"
        onSpawned={onSpawned}
      />,
    );

    fireEvent.change(screen.getByTestId('pty-agent-type'), { target: { value: 'custom' } });

    expect(screen.getByTestId('pty-custom-command')).toBeInTheDocument();
    expect(screen.queryByTestId('pty-history-list')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('pty-custom-command'), { target: { value: 'node' } });
    fireEvent.change(screen.getByTestId('pty-extra-args'), { target: { value: 'server.js --label \"alpha beta\" --watch' } });
    fireEvent.click(screen.getByTestId('pty-spawn-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:1949/pty/spawn',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            command: 'node',
            args: ['server.js', '--label', 'alpha beta', '--watch'],
            rows: 24,
            cols: 80,
          }),
        }),
      );
      expect(onSpawned).toHaveBeenCalledWith({ id: 'pty-custom-1', name: 'my-custom' });
    });
  });
});
