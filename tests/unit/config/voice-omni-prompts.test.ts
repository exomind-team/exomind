import { beforeEach, describe, expect, it } from 'vitest';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';
import {
  getVoiceOmniPromptDocs,
  resetVoiceOmniPromptDocs,
  setVoiceOmniPromptDocs,
} from '@/config/voice-omni-prompts';

describe('voice omni prompt docs config（Qwen 提示词文档配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to byetype-style docs（默认使用 byetype 风格文档）', () => {
    const docs = getVoiceOmniPromptDocs();
    expect(docs.agent).toContain('你是一台转录机器');
    expect(docs.rules).toContain('转录规则');
    expect(docs.vocabulary).toContain('专有词汇表');
    expect(docs.textOptimize).toContain('零修改');
  });

  it('persists edited docs（保存编辑后的文档）', () => {
    const docs = setVoiceOmniPromptDocs({
      agent: '# agent',
      rules: '# rules',
      vocabulary: '# vocabulary',
      textOptimize: '# optimize',
    });

    expect(docs).toEqual({
      agent: '# agent',
      rules: '# rules',
      vocabulary: '# vocabulary',
      textOptimize: '# optimize',
    });
  });

  it('can reset docs back to defaults（可重置回默认文档）', () => {
    setVoiceOmniPromptDocs({
      agent: '# custom agent',
      rules: '# custom rules',
      vocabulary: '# custom vocabulary',
      textOptimize: '# custom optimize',
    });

    const reset = resetVoiceOmniPromptDocs();
    expect(reset.agent).toContain('你是一台转录机器');
    expect(reset.textOptimize).toContain('零执行');
  });

  it('prefers runtime-backed docs over localStorage（优先读取 Runtime 中的提示词文档）', () => {
    __primeRuntimeConfigForTests({
      'exomind:voiceOmniPromptDocs': JSON.stringify({
        agent: '# runtime agent',
        rules: '# runtime rules',
        vocabulary: '# runtime vocabulary',
        textOptimize: '# runtime optimize',
      }),
    });

    expect(getVoiceOmniPromptDocs()).toEqual({
      agent: '# runtime agent',
      rules: '# runtime rules',
      vocabulary: '# runtime vocabulary',
      textOptimize: '# runtime optimize',
    });
  });
});
