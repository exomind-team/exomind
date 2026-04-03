import { beforeEach, describe, expect, it } from 'vitest';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceOmniModelId,
  getVoiceOmniOptimizeEnabled,
  getVoiceOmniProfileId,
  setVoiceOmniModelId,
  setVoiceOmniOptimizeEnabled,
  setVoiceOmniProfileId,
} from '@/config/voice-omni-settings';

describe('voice omni settings（Qwen 全模态语音设置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses empty profile id, qwen3-omni-flash model and disabled optimize by default（默认值正确）', () => {
    expect(getVoiceOmniProfileId()).toBe('');
    expect(getVoiceOmniModelId()).toBe('qwen3-omni-flash');
    expect(getVoiceOmniOptimizeEnabled()).toBe(false);
  });

  it('persists profile id, model id and optimize flag（保存档案与模型设置）', () => {
    setVoiceOmniProfileId('registry-qwen-voice');
    setVoiceOmniModelId('qwen3.5-omni-flash');
    setVoiceOmniOptimizeEnabled(true);

    expect(getVoiceOmniProfileId()).toBe('registry-qwen-voice');
    expect(getVoiceOmniModelId()).toBe('qwen3.5-omni-flash');
    expect(getVoiceOmniOptimizeEnabled()).toBe(true);
  });

  it('prefers runtime-backed values over localStorage（优先读取 Runtime 配置）', () => {
    window.localStorage.setItem('exomind:voiceOmniProfileId', 'registry-local');
    window.localStorage.setItem('exomind:voiceOmniModelId', 'qwen-local');
    window.localStorage.setItem('exomind:voiceOmniOptimizeEnabled', '0');
    __primeRuntimeConfigForTests({
      'exomind:voiceOmniProfileId': 'registry-runtime',
      'exomind:voiceOmniModelId': 'qwen3-omni-flash',
      'exomind:voiceOmniOptimizeEnabled': '1',
    });

    expect(getVoiceOmniProfileId()).toBe('registry-runtime');
    expect(getVoiceOmniModelId()).toBe('qwen3-omni-flash');
    expect(getVoiceOmniOptimizeEnabled()).toBe(true);
  });
});
