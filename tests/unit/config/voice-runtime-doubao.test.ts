import { beforeEach, describe, expect, it } from 'vitest';

import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceRuntimeDoubaoAccessToken,
  getVoiceRuntimeDoubaoAppId,
  getVoiceRuntimeDoubaoConnectId,
  getVoiceRuntimeDoubaoModelVersion,
  getVoiceRuntimeDoubaoSecretKey,
  getVoiceRuntimeDoubaoSpeaker,
  getVoiceRuntimeDoubaoWebsocketUrl,
  setVoiceRuntimeDoubaoAccessToken,
  setVoiceRuntimeDoubaoAppId,
  setVoiceRuntimeDoubaoConnectId,
  setVoiceRuntimeDoubaoModelVersion,
  setVoiceRuntimeDoubaoSecretKey,
  setVoiceRuntimeDoubaoSpeaker,
  setVoiceRuntimeDoubaoWebsocketUrl,
} from '@/config/voice-runtime-doubao';

describe('voice runtime doubao settings（语音运行时豆包配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses the expected defaults（默认值正确）', () => {
    expect(getVoiceRuntimeDoubaoAppId()).toBe('');
    expect(getVoiceRuntimeDoubaoAccessToken()).toBe('');
    expect(getVoiceRuntimeDoubaoSecretKey()).toBe('');
    expect(getVoiceRuntimeDoubaoModelVersion()).toBe('1.2.1.1');
    expect(getVoiceRuntimeDoubaoSpeaker()).toBe('zh_female_vv_jupiter_bigtts');
    expect(getVoiceRuntimeDoubaoConnectId()).toBe('');
    expect(getVoiceRuntimeDoubaoWebsocketUrl()).toBe('wss://openspeech.bytedance.com/api/v3/realtime/dialogue');
  });

  it('persists the detailed page settings（保存实验页详细设置）', () => {
    expect(setVoiceRuntimeDoubaoAppId('4587429383')).toBe('4587429383');
    expect(setVoiceRuntimeDoubaoAccessToken('vei-access-token')).toBe('vei-access-token');
    expect(setVoiceRuntimeDoubaoSecretKey('vei-secret-key')).toBe('vei-secret-key');
    expect(setVoiceRuntimeDoubaoModelVersion('2.2.0.0')).toBe('2.2.0.0');
    expect(setVoiceRuntimeDoubaoSpeaker('zh_female_xiaohe_jupiter_bigtts')).toBe('zh_female_xiaohe_jupiter_bigtts');
    expect(setVoiceRuntimeDoubaoConnectId('connect-1')).toBe('connect-1');
    expect(setVoiceRuntimeDoubaoWebsocketUrl('wss://example.com/s2s')).toBe('wss://example.com/s2s');

    expect(getVoiceRuntimeDoubaoAppId()).toBe('4587429383');
    expect(getVoiceRuntimeDoubaoAccessToken()).toBe('vei-access-token');
    expect(getVoiceRuntimeDoubaoSecretKey()).toBe('vei-secret-key');
    expect(getVoiceRuntimeDoubaoModelVersion()).toBe('2.2.0.0');
    expect(getVoiceRuntimeDoubaoSpeaker()).toBe('zh_female_xiaohe_jupiter_bigtts');
    expect(getVoiceRuntimeDoubaoConnectId()).toBe('connect-1');
    expect(getVoiceRuntimeDoubaoWebsocketUrl()).toBe('wss://example.com/s2s');
  });

  it('prefers runtime-backed values over localStorage（优先读取 Runtime 配置）', () => {
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoAppId', 'local-app-id');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoAccessToken', 'local-access-token');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoSecretKey', 'local-secret-key');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoModelVersion', '2.2.0.0');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoSpeaker', 'zh_male_yunzhou_jupiter_bigtts');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoConnectId', 'local-connect-id');
    window.localStorage.setItem('exomind:voiceRuntimeDoubaoWebsocketUrl', 'wss://local.example/s2s');

    __primeRuntimeConfigForTests({
      'exomind:voiceRuntimeDoubaoAppId': 'runtime-app-id',
      'exomind:voiceRuntimeDoubaoAccessToken': 'runtime-access-token',
      'exomind:voiceRuntimeDoubaoSecretKey': 'runtime-secret-key',
      'exomind:voiceRuntimeDoubaoModelVersion': '1.2.1.1',
      'exomind:voiceRuntimeDoubaoSpeaker': 'zh_female_vv_jupiter_bigtts',
      'exomind:voiceRuntimeDoubaoConnectId': 'runtime-connect-id',
      'exomind:voiceRuntimeDoubaoWebsocketUrl': 'wss://runtime.example/s2s',
    });

    expect(getVoiceRuntimeDoubaoAppId()).toBe('runtime-app-id');
    expect(getVoiceRuntimeDoubaoAccessToken()).toBe('runtime-access-token');
    expect(getVoiceRuntimeDoubaoSecretKey()).toBe('runtime-secret-key');
    expect(getVoiceRuntimeDoubaoModelVersion()).toBe('1.2.1.1');
    expect(getVoiceRuntimeDoubaoSpeaker()).toBe('zh_female_vv_jupiter_bigtts');
    expect(getVoiceRuntimeDoubaoConnectId()).toBe('runtime-connect-id');
    expect(getVoiceRuntimeDoubaoWebsocketUrl()).toBe('wss://runtime.example/s2s');
  });
});
