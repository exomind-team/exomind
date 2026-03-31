import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();
const runtimeConfigStore = vi.hoisted(() => new Map<string, string>());
const runtimeControlMocks = {
  startRuntime: vi.fn(),
  stopRuntime: vi.fn(),
};
const runtimeConfigCacheMocks = {
  resume: vi.fn(),
  suspend: vi.fn(),
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: (...args: unknown[]) => isTauriMock(...args),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => runtimeControlMocks,
}));

vi.mock('@/config/runtime-config-cache', () => ({
  getRuntimeConfigValueSync: (key: string) => runtimeConfigStore.get(key) ?? null,
  setRuntimeConfigValue: (key: string, value: string) => {
    runtimeConfigStore.set(key, value);
    window.localStorage.setItem(key, value);
  },
  resumeRuntimeConfigBootstrap: () => runtimeConfigCacheMocks.resume(),
  suspendRuntimeConfigBootstrap: () => runtimeConfigCacheMocks.suspend(),
}));

import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  getRuntimeTargetMode,
  setEmbeddedRuntimeNetworkMode,
  setRuntimeTargetMode,
} from '@/config/runtime-target';
import { setPersistedRuntimeTargetMode } from '@/config/runtime-target-mode';

describe('runtime target mode persistence（RT 配置持久化）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    runtimeConfigStore.clear();
    vi.clearAllMocks();
    isTauriMock.mockResolvedValue(true);
    invokeMock.mockImplementation(async (command: string, payload?: { mode?: string }) => {
      if (command === 'runtime_target_mode_set') {
        return payload?.mode ?? 'embedded';
      }
      return null;
    });
    runtimeControlMocks.startRuntime.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
    runtimeControlMocks.stopRuntime.mockResolvedValue({
      running: false,
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
  });

  it('starts embedded runtime after switching back to embedded in tauri', async () => {
    setRuntimeTargetMode('external');
    setEmbeddedRuntimeNetworkMode('lan');

    await expect(setPersistedRuntimeTargetMode('embedded')).resolves.toBe('embedded');

    expect(invokeMock).toHaveBeenCalledWith('runtime_target_mode_set', { mode: 'embedded' });
    expect(runtimeControlMocks.startRuntime).toHaveBeenCalledWith({
      host: '0.0.0.0',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
    expect(runtimeConfigCacheMocks.resume).toHaveBeenCalledTimes(1);
    expect(runtimeConfigCacheMocks.suspend).not.toHaveBeenCalled();
    expect(getRuntimeTargetMode()).toBe('embedded');
  });

  it('stops embedded runtime after switching to external in tauri', async () => {
    setRuntimeTargetMode('embedded');

    await expect(setPersistedRuntimeTargetMode('external')).resolves.toBe('external');

    expect(invokeMock).toHaveBeenCalledWith('runtime_target_mode_set', { mode: 'external' });
    expect(runtimeControlMocks.stopRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeConfigCacheMocks.suspend).toHaveBeenCalledTimes(1);
    expect(runtimeConfigCacheMocks.resume).not.toHaveBeenCalled();
    expect(getRuntimeTargetMode()).toBe('external');
  });

  it('rolls back native mode when tauri runtime stop fails', async () => {
    setRuntimeTargetMode('embedded');
    runtimeControlMocks.stopRuntime.mockRejectedValueOnce(new Error('stop failed'));

    await expect(setPersistedRuntimeTargetMode('external')).rejects.toThrow('stop failed');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'runtime_target_mode_set', { mode: 'external' });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'runtime_target_mode_set', { mode: 'embedded' });
    expect(getRuntimeTargetMode()).toBe('embedded');
  });

  it('falls back to local storage only outside tauri', async () => {
    isTauriMock.mockResolvedValue(false);

    await expect(setPersistedRuntimeTargetMode('external')).resolves.toBe('external');

    expect(invokeMock).not.toHaveBeenCalled();
    expect(runtimeControlMocks.stopRuntime).not.toHaveBeenCalled();
    expect(runtimeConfigCacheMocks.suspend).not.toHaveBeenCalled();
    expect(runtimeConfigCacheMocks.resume).not.toHaveBeenCalled();
    expect(getRuntimeTargetMode()).toBe('external');
  });
});
