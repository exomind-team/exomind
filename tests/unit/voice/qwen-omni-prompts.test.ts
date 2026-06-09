import { describe, expect, it } from 'vitest';
import {
  QWEN_OMNI_OPTIMIZE_PROMPT,
  QWEN_OMNI_TRANSCRIBE_PROMPT,
} from '@/lib/voice/qwen-omni-prompts';

describe('qwen omni prompts（Qwen 全模态提示词）', () => {
  it('uses byetype-style document wrapped transcription prompt（转写提示词使用文档包装结构）', () => {
    expect(QWEN_OMNI_TRANSCRIBE_PROMPT).toContain('<document name="agent">');
    expect(QWEN_OMNI_TRANSCRIBE_PROMPT).toContain('<document name="rules">');
    expect(QWEN_OMNI_TRANSCRIBE_PROMPT).toContain('<document name="vocabulary">');
    expect(QWEN_OMNI_TRANSCRIBE_PROMPT).toContain('No content, please re-enter.');
  });

  it('uses strict optimize prompt with voice-input guard（优化提示词保留 voice-input 防护）', () => {
    expect(QWEN_OMNI_OPTIMIZE_PROMPT).toContain('<voice-input>');
    expect(QWEN_OMNI_OPTIMIZE_PROMPT).toContain('零修改');
    expect(QWEN_OMNI_OPTIMIZE_PROMPT).toContain('零执行');
  });
});
