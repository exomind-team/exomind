import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY,
  getEmbeddedRuntimeNetworkMode,
  setEmbeddedRuntimeNetworkMode,
} from '@/config/runtime-target';
import { setPersistedEmbeddedRuntimeNetworkMode } from '@/config/runtime-open-mode';

const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

describe('runtime open mode persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockResolvedValue(false);
  });

  it('persists UI mode locally in web mode', async () => {
    const mode = await setPersistedEmbeddedRuntimeNetworkMode('lan');

    expect(mode).toBe('lan');
    expect(getEmbeddedRuntimeNetworkMode()).toBe('lan');
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY)).toBe('lan');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('writes native runtime mode in tauri mode', async () => {
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockResolvedValue('lan');

    const mode = await setPersistedEmbeddedRuntimeNetworkMode('lan');

    expect(mode).toBe('lan');
    expect(invokeMock).toHaveBeenCalledWith('runtime_network_mode_set', { mode: 'lan' });
    expect(getEmbeddedRuntimeNetworkMode()).toBe('lan');
  });

  it('reverts UI mode when native persistence fails', async () => {
    setEmbeddedRuntimeNetworkMode('local');
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockRejectedValue(new Error('native write failed'));

    await expect(setPersistedEmbeddedRuntimeNetworkMode('lan')).rejects.toThrow('native write failed');
    expect(getEmbeddedRuntimeNetworkMode()).toBe('local');
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY)).toBe('local');
  });
});
