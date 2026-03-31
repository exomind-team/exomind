import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY } from '@/config/runtime-target';
import { TauriRuntimeAdapter } from '@/lib/adapters/tauri-runtime-adapter';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => true),
  invoke: invokeMock,
}));

describe('TauriRuntimeAdapter（Tauri 运行时适配器）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
  });

  it('persists authSecret from runtime status（持久化运行时鉴权密钥）', async () => {
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 48202,
      hostId: 'mobile-host',
      authSecret: 'embedded-secret',
    });

    const adapter = new TauriRuntimeAdapter();
    await adapter.getStatus();

    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).toContain('"authSecret":"embedded-secret"');
  });

  it('invokes peer dial address command（调用 peer 拨号地址命令）', async () => {
    invokeMock.mockResolvedValue({
      host: '127.0.0.1',
      port: 39124,
    });

    const adapter = new TauriRuntimeAdapter();
    const result = await adapter.getPeerDialAddress('10.0.2.15', 9124);

    expect(result).toEqual({
      host: '127.0.0.1',
      port: 39124,
    });
    expect(invokeMock).toHaveBeenCalledWith('runtime_service_peer_dial_address', {
      remoteHost: '10.0.2.15',
      remotePort: 9124,
    });
  });
});
