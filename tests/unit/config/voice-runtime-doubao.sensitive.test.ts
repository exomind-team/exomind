import { beforeEach, describe, expect, it, vi } from 'vitest';

const setRuntimeConfigValueMock = vi.fn();
const getRuntimeConfigValueSyncMock = vi.fn(() => null);

vi.mock('@/config/runtime-config-cache', () => ({
  setRuntimeConfigValue: (...args: unknown[]) => setRuntimeConfigValueMock(...args),
  getRuntimeConfigValueSync: (...args: unknown[]) => getRuntimeConfigValueSyncMock(...args),
}));

describe('voice-runtime-doubao sensitive writes（豆包配置敏感写入）', () => {
  beforeEach(() => {
    vi.resetModules();
    setRuntimeConfigValueMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReset();
    getRuntimeConfigValueSyncMock.mockReturnValue(null);
  });

  it('writes APP ID / Access Token / Secret Key with sensitive=true（关键凭据写入应标记敏感）', async () => {
    const module = await import('@/config/voice-runtime-doubao');
    module.setVoiceRuntimeDoubaoAppId('4587429383');
    module.setVoiceRuntimeDoubaoAccessToken('access-token');
    module.setVoiceRuntimeDoubaoSecretKey('secret-key');

    const calls = setRuntimeConfigValueMock.mock.calls;
    expect(calls).toEqual(expect.arrayContaining([
      [
        'exomind:voiceRuntimeDoubaoAppId',
        '4587429383',
        expect.objectContaining({ sensitive: true }),
      ],
      [
        'exomind:voiceRuntimeDoubaoAccessToken',
        'access-token',
        expect.objectContaining({ sensitive: true }),
      ],
      [
        'exomind:voiceRuntimeDoubaoSecretKey',
        'secret-key',
        expect.objectContaining({ sensitive: true }),
      ],
    ]));
  });
});

