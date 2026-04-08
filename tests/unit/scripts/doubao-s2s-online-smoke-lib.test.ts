import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOUBAO_REALTIME_SMOKE_AUDIO_FIXTURE,
  resolveDoubaoRealtimeSmokeConfig,
} from '../../../scripts/test/doubao-s2s-online-smoke-lib';

describe('doubao-s2s-online-smoke-lib（豆包 S2S 在线 smoke 配置）', () => {
  it('resolves config from primary env names and fills documented defaults（主环境变量名可解析且补齐官方默认值）', () => {
    const config = resolveDoubaoRealtimeSmokeConfig({
      EXOMIND_VOICE_RUNTIME_APP_ID: '4587429383',
      EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN: 'access-token',
      EXOMIND_VOICE_RUNTIME_SECRET_KEY: 'secret-key',
    }, 'D:/project/exomind');

    expect(config).toEqual(expect.objectContaining({
      appId: '4587429383',
      accessToken: 'access-token',
      secretKey: 'secret-key',
      modelVersion: '1.2.1.1',
      speaker: 'zh_female_vv_jupiter_bigtts',
      websocketUrl: 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
      language: 'en-US',
      sampleRate: 16000,
      ttsSampleRate: 24000,
      fixturePath: path.join('D:/project/exomind', DEFAULT_DOUBAO_REALTIME_SMOKE_AUDIO_FIXTURE),
    }));
  });

  it('accepts fallback env aliases for local debugging（兼容备用环境变量名，便于本地调试）', () => {
    const config = resolveDoubaoRealtimeSmokeConfig({
      DOUBAO_REALTIME_APP_ID: '4587429383',
      DOUBAO_REALTIME_ACCESS_TOKEN: 'access-token',
      DOUBAO_REALTIME_SECRET_KEY: 'secret-key',
      DOUBAO_REALTIME_CONNECT_ID: 'manual-connect-id',
      DOUBAO_REALTIME_SMOKE_FIXTURE: 'custom/sample.pcm',
    }, 'D:/project/exomind');

    expect(config.connectId).toBe('manual-connect-id');
    expect(config.fixturePath).toBe(path.join('D:/project/exomind', 'custom/sample.pcm'));
  });

  it('throws a readable error when required credentials are missing（缺少凭据时给出可读错误）', () => {
    expect(() => resolveDoubaoRealtimeSmokeConfig({}, 'D:/project/exomind')).toThrowError(
      /EXOMIND_VOICE_RUNTIME_APP_ID.*EXOMIND_VOICE_RUNTIME_ACCESS_TOKEN.*EXOMIND_VOICE_RUNTIME_SECRET_KEY/s,
    );
  });
});
