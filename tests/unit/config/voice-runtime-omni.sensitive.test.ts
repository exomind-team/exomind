import { beforeEach, describe, expect, it, vi } from 'vitest';

const setRuntimeConfigValueMock = vi.fn();
const getRuntimeConfigValueSyncMock = vi.fn(() => null);

vi.mock('@/config/runtime-config-cache', () => ({
  setRuntimeConfigValue: (...args: unknown[]) => setRuntimeConfigValueMock(...args),
  getRuntimeConfigValueSync: (...args: unknown[]) => getRuntimeConfigValueSyncMock(...args),
}));

describe('voice-runtime-omni sensitive writes（Omni 配置敏感写入）', () => {
  beforeEach(() => {
    vi.resetModules();
    setRuntimeConfigValueMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReturnValue(null);
  });

  it('writes API Key with sensitive=true（API Key 写入应标记敏感）', async () => {
    const module = await import('@/config/voice-runtime-omni');
    module.setVoiceRuntimeOmniApiKey('dashscope-api-key');

    const calls = setRuntimeConfigValueMock.mock.calls;
    expect(calls).toEqual(expect.arrayContaining([
      [
        'exomind:voiceRuntimeOmniApiKey',
        'dashscope-api-key',
        expect.objectContaining({ sensitive: true }),
      ],
    ]));
  });
});
