import { beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: isTauriMock,
  invoke: invokeMock,
}));

describe('runtime target persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    isTauriMock.mockReset();
    invokeMock.mockReset();
    window.localStorage.clear();
  });

  it('hydrates persisted external runtime target before the app uses it', async () => {
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'runtime_target_mode_get') {
        return 'external';
      }
      if (command === 'runtime_external_address_get') {
        return '192.168.1.48:9124';
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { hydratePersistedRuntimeTargetConfig } = await import('@/config/runtime-target-mode');
    const {
      getRuntimeExternalAddress,
      getRuntimeTargetMode,
      getSelectedRuntimeTarget,
    } = await import('@/config/runtime-target');

    await hydratePersistedRuntimeTargetConfig();

    expect(getRuntimeTargetMode()).toBe('external');
    expect(getRuntimeExternalAddress()).toBe('192.168.1.48:9124');
    expect(getSelectedRuntimeTarget()).toEqual({
      mode: 'external',
      host: '192.168.1.48',
      port: 9124,
    });
  });

  it('persists external runtime address through the tauri backend', async () => {
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string, payload?: { address?: string }) => {
      if (command === 'runtime_external_address_set') {
        return payload?.address ?? '';
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { setPersistedRuntimeExternalAddress } = await import('@/config/runtime-target-mode');
    const { getRuntimeExternalAddress } = await import('@/config/runtime-target');

    await setPersistedRuntimeExternalAddress('192.168.1.48:9124');

    expect(invokeMock).toHaveBeenCalledWith('runtime_external_address_set', {
      address: '192.168.1.48:9124',
    });
    expect(getRuntimeExternalAddress()).toBe('192.168.1.48:9124');
  });

  it('persists external runtime auth token locally for protected remote runtimes', async () => {
    isTauriMock.mockResolvedValue(true);

    const { setPersistedRuntimeExternalAuthToken } = await import('@/config/runtime-target-mode');
    const { getSelectedRuntimeTarget, setRuntimeTargetMode } = await import('@/config/runtime-target');

    await setPersistedRuntimeExternalAuthToken('Bearer external-admin-token');
    setRuntimeTargetMode('external');

    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      authToken: 'external-admin-token',
    });
  });
});
