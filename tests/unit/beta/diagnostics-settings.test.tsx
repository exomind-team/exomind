import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BetaSettingsPage } from '@/beta/BetaSettingsPage';
import type { BetaDiagnosticsClient } from '@/beta/diagnostics-client';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));

afterEach(cleanup);

it('opens diagnostics from Settings on demand and restores the entry after close', async () => {
  const client: BetaDiagnosticsClient = {
    sample: vi.fn().mockRejectedValue(new Error('synthetic unavailable')),
    scanStorage: vi.fn(),
    cancelStorage: vi.fn(),
  };
  const view = render(<BetaSettingsPage profileName="Synthetic profile" deadlineAlerts={null} diagnosticsClient={client} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(client.sample).not.toHaveBeenCalled();
  const entry = await screen.findByRole('button', { name: '查看运行诊断' });
  fireEvent.click(entry);
  expect(await screen.findByRole('dialog', { name: '运行诊断' })).toBeInTheDocument();
  await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '关闭运行诊断' }));
  await waitFor(() => expect(entry).toHaveFocus());
  view.rerender(<BetaSettingsPage profileName="Synthetic profile" deadlineAlerts={null} diagnosticsClient={client} visible={false} />);
  view.rerender(<BetaSettingsPage profileName="Synthetic profile" deadlineAlerts={null} diagnosticsClient={client} visible />);
  expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();
  expect(client.sample).toHaveBeenCalledTimes(1);
});
