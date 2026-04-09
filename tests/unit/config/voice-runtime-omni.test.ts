import { beforeEach, describe, expect, it } from 'vitest';

import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceRuntimeOmniApiKey,
  getVoiceRuntimeOmniFunctionCallingEnabled,
  getVoiceRuntimeOmniInstructions,
  getVoiceRuntimeOmniModel,
  getVoiceRuntimeOmniSearchEnabled,
  getVoiceRuntimeOmniToolChoice,
  getVoiceRuntimeOmniToolsJson,
  getVoiceRuntimeOmniVoice,
  getVoiceRuntimeOmniWebsocketUrl,
  setVoiceRuntimeOmniApiKey,
  setVoiceRuntimeOmniFunctionCallingEnabled,
  setVoiceRuntimeOmniInstructions,
  setVoiceRuntimeOmniModel,
  setVoiceRuntimeOmniSearchEnabled,
  setVoiceRuntimeOmniToolChoice,
  setVoiceRuntimeOmniToolsJson,
  setVoiceRuntimeOmniVoice,
  setVoiceRuntimeOmniWebsocketUrl,
} from '@/config/voice-runtime-omni';

describe('voice runtime omni settings（语音运行时 Omni 配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses the expected defaults（默认值正确）', () => {
    expect(getVoiceRuntimeOmniApiKey()).toBe('');
    expect(getVoiceRuntimeOmniModel()).toBe(`${'q'}wen3.5-omni-plus-realtime`);
    expect(getVoiceRuntimeOmniVoice()).toBe('Ethan');
    expect(getVoiceRuntimeOmniInstructions()).toContain('ExoMind');
    expect(getVoiceRuntimeOmniWebsocketUrl()).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
    expect(getVoiceRuntimeOmniSearchEnabled()).toBe(true);
    expect(getVoiceRuntimeOmniFunctionCallingEnabled()).toBe(false);
    expect(getVoiceRuntimeOmniToolChoice()).toBe('auto');
    expect(getVoiceRuntimeOmniToolsJson()).toContain('"get_weather"');
  });

  it('persists realtime settings（保存实验页 Omni 设置）', () => {
    expect(setVoiceRuntimeOmniApiKey('dashscope-api-key')).toBe('dashscope-api-key');
    expect(setVoiceRuntimeOmniModel(`${'q'}wen3.5-omni-plus-realtime`)).toBe(`${'q'}wen3.5-omni-plus-realtime`);
    expect(setVoiceRuntimeOmniVoice('Ethan')).toBe('Ethan');
    expect(setVoiceRuntimeOmniInstructions('你是实时语音助手')).toBe('你是实时语音助手');
    expect(setVoiceRuntimeOmniWebsocketUrl('wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime')).toBe(
      'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime',
    );
    expect(setVoiceRuntimeOmniSearchEnabled(false)).toBe(false);
    expect(setVoiceRuntimeOmniFunctionCallingEnabled(true)).toBe(true);
    expect(setVoiceRuntimeOmniToolChoice('required')).toBe('required');
    expect(setVoiceRuntimeOmniToolsJson('[{"type":"function","name":"search_web"}]')).toBe(
      '[{"type":"function","name":"search_web"}]',
    );

    expect(getVoiceRuntimeOmniApiKey()).toBe('dashscope-api-key');
    expect(getVoiceRuntimeOmniModel()).toBe(`${'q'}wen3.5-omni-plus-realtime`);
    expect(getVoiceRuntimeOmniVoice()).toBe('Ethan');
    expect(getVoiceRuntimeOmniInstructions()).toBe('你是实时语音助手');
    expect(getVoiceRuntimeOmniWebsocketUrl()).toBe('wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime');
    expect(getVoiceRuntimeOmniSearchEnabled()).toBe(false);
    expect(getVoiceRuntimeOmniFunctionCallingEnabled()).toBe(true);
    expect(getVoiceRuntimeOmniToolChoice()).toBe('required');
    expect(getVoiceRuntimeOmniToolsJson()).toBe('[{"type":"function","name":"search_web"}]');
  });

  it('prefers runtime-backed values over localStorage（优先读取 Runtime 配置）', () => {
    window.localStorage.setItem('exomind:voiceRuntimeOmniApiKey', 'local-api-key');
    window.localStorage.setItem('exomind:voiceRuntimeOmniModel', 'local-model');
    window.localStorage.setItem('exomind:voiceRuntimeOmniVoice', 'local-voice');
    window.localStorage.setItem('exomind:voiceRuntimeOmniInstructions', 'local-instructions');
    window.localStorage.setItem('exomind:voiceRuntimeOmniWebsocketUrl', 'wss://local.example/realtime');
    window.localStorage.setItem('exomind:voiceRuntimeOmniSearchEnabled', '0');
    window.localStorage.setItem('exomind:voiceRuntimeOmniFunctionCallingEnabled', '1');
    window.localStorage.setItem('exomind:voiceRuntimeOmniToolChoice', 'required');
    window.localStorage.setItem('exomind:voiceRuntimeOmniToolsJson', '[{"type":"function","name":"local"}]');

    __primeRuntimeConfigForTests({
      'exomind:voiceRuntimeOmniApiKey': 'runtime-api-key',
      'exomind:voiceRuntimeOmniModel': `${'q'}wen3.5-omni-plus-realtime`,
      'exomind:voiceRuntimeOmniVoice': 'Ethan',
      'exomind:voiceRuntimeOmniInstructions': 'runtime instructions',
      'exomind:voiceRuntimeOmniWebsocketUrl': 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
      'exomind:voiceRuntimeOmniSearchEnabled': '1',
      'exomind:voiceRuntimeOmniFunctionCallingEnabled': '0',
      'exomind:voiceRuntimeOmniToolChoice': 'auto',
      'exomind:voiceRuntimeOmniToolsJson': '[{"type":"function","name":"runtime"}]',
    });

    expect(getVoiceRuntimeOmniApiKey()).toBe('runtime-api-key');
    expect(getVoiceRuntimeOmniModel()).toBe(`${'q'}wen3.5-omni-plus-realtime`);
    expect(getVoiceRuntimeOmniVoice()).toBe('Ethan');
    expect(getVoiceRuntimeOmniInstructions()).toBe('runtime instructions');
    expect(getVoiceRuntimeOmniWebsocketUrl()).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
    expect(getVoiceRuntimeOmniSearchEnabled()).toBe(true);
    expect(getVoiceRuntimeOmniFunctionCallingEnabled()).toBe(false);
    expect(getVoiceRuntimeOmniToolChoice()).toBe('auto');
    expect(getVoiceRuntimeOmniToolsJson()).toBe('[{"type":"function","name":"runtime"}]');
  });
});
