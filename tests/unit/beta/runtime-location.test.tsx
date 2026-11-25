import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { BetaRuntimeLocation } from '@/beta/BetaRuntimeLocation';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

const location = {
  http_address: 'http://127.0.0.1:43344',
  listener_state: 'listening' as const,
  data_directory: 'C:\\synthetic\\beta-host',
  device_id: '33333333-3333-4333-8333-333333333333',
  runtime_id: '44444444-4444-4444-8444-444444444444',
  active_access_scope: 'local' as const,
  configured_access_scope: 'local' as const,
};

describe('Beta runtime access scope', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockImplementation(async (command) => {
      if (command === 'beta_runtime_location') return location;
      if (command === 'beta_runtime_set_access_scope') {
        return { ...location, configured_access_scope: 'lan' };
      }
      throw new Error(`unexpected command ${command}`);
    });
  });

  it('offers local and LAN scopes, persists LAN, and distinguishes it from the active listener', async () => {
    render(<BetaRuntimeLocation />);
    fireEvent.click(await screen.findByRole('button', { name: '查看当前运行地址与资料目录' }));

    const local = await screen.findByRole('button', { name: '仅本机访问范围' });
    const lan = screen.getByRole('button', { name: '局域网访问范围' });
    expect(local).toHaveAttribute('aria-pressed', 'true');
    expect(lan).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(lan);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'beta_runtime_set_access_scope',
      { accessScope: 'lan' },
    ));
    expect(lan).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText(/已保存.*重启外心.*局域网/)).toBeInTheDocument();
    expect(screen.getAllByText('局域网').length).toBeGreaterThan(0);
    expect(screen.getAllByText('仅本机').length).toBeGreaterThan(0);
  });
});
