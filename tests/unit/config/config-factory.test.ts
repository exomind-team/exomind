import { beforeEach, describe, expect, it, vi } from 'vitest';

const setRuntimeConfigValueMock = vi.fn();
const getRuntimeConfigValueSyncMock = vi.fn(() => null);

vi.mock('@/config/runtime-config-cache', () => ({
  setRuntimeConfigValue: (...args: unknown[]) => setRuntimeConfigValueMock(...args),
  getRuntimeConfigValueSync: (...args: unknown[]) => getRuntimeConfigValueSyncMock(...args),
}));

describe('createConfigModule（配置工厂）', () => {
  beforeEach(() => {
    setRuntimeConfigValueMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReturnValue(null);
  });

  it('passes runtime write options for runtime-preferred mode（runtime-preferred 会透传 Runtime 写入选项）', async () => {
    const { createConfigModule } = await import('@/config/config-factory');
    const module = createConfigModule<string>({
      storageKey: 'exomind:test-sensitive-key',
      eventName: 'exomind:test-sensitive-key-changed',
      defaultValue: '',
      normalize: (raw) => (raw ?? '').trim(),
      persistMode: 'runtime-preferred',
      runtimeWriteOptions: { sensitive: true },
    });

    module.set('test-value');

    expect(setRuntimeConfigValueMock).toHaveBeenCalledTimes(1);
    expect(setRuntimeConfigValueMock).toHaveBeenCalledWith(
      'exomind:test-sensitive-key',
      'test-value',
      expect.objectContaining({
        sensitive: true,
        source: 'exomind:test-sensitive-key-changed',
      }),
    );
  });
});

