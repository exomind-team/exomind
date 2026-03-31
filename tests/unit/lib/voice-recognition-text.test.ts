import { describe, expect, it } from 'vitest';
import {
  normalizeRecognitionText,
  normalizeVolcanoRecognitionText,
} from '@/lib/voice/recognition-text';

describe('normalizeRecognitionText（通用语音去重）', () => {
  // ── 英文连续重复词折叠 ──
  describe('English consecutive word dedup', () => {
    it('collapses doubled English words（"super super" → "super"）', () => {
      expect(normalizeRecognitionText('super super')).toBe('super');
    });

    it('collapses each doubled word independently（"hello hello world world" → "hello world"）', () => {
      expect(normalizeRecognitionText('hello hello world world')).toBe('hello world');
    });

    it('collapses doubled single letters（"C C I I U U D D" → "C I U D"）', () => {
      expect(normalizeRecognitionText('C C I I U U D D')).toBe('C I U D');
    });

    it('collapses tripled words（"agent agent agent" → "agent"）', () => {
      expect(normalizeRecognitionText('agent agent agent')).toBe('agent');
    });

    it('preserves non-repeated English words', () => {
      expect(normalizeRecognitionText('hello world')).toBe('hello world');
    });
  });

  // ── 汉字词组重复折叠（2字+） ──
  describe('Chinese word-group dedup', () => {
    it('collapses doubled two-char groups（"这个这个" → "这个"）', () => {
      expect(normalizeRecognitionText('这个这个')).toBe('这个');
    });

    it('collapses doubled two-char groups（"应该应该" → "应该"）', () => {
      expect(normalizeRecognitionText('应该应该')).toBe('应该');
    });

    it('collapses multiple doubled groups in one sentence', () => {
      expect(normalizeRecognitionText('然后然后根据根据我们我们的')).toBe('然后根据我们的');
    });

    it('collapses tripled groups（"系统系统系统" → "系统"）', () => {
      expect(normalizeRecognitionText('系统系统系统')).toBe('系统');
    });

    it('collapses three-char groups（"解决了解决了" → "解决了"）', () => {
      expect(normalizeRecognitionText('解决了解决了')).toBe('解决了');
    });

    it('preserves non-repeated Chinese text', () => {
      expect(normalizeRecognitionText('这个项目很好')).toBe('这个项目很好');
    });
  });

  // ── 单字口吃 ──
  describe('single-character stutter', () => {
    it('collapses multi-group stutter（"会会有有点点重重复复" → "会有点重复"）', () => {
      expect(normalizeRecognitionText('会会有有点点重重复复')).toBe('会有点重复');
    });

    it('collapses single-group stutter when tripled（"我我我想" → "我想"）', () => {
      expect(normalizeRecognitionText('我我我想')).toBe('我想');
    });
  });

  // ── 中英混合 ──
  describe('mixed Chinese-English', () => {
    it('handles mixed text with both types of duplication', () => {
      expect(normalizeRecognitionText('用好用好 super super power power skill')).toBe('用好 super power skill');
    });

    it('handles Chinese text with spaced English duplicates', () => {
      expect(normalizeRecognitionText('这是 API API 的问题')).toBe('这是 API 的问题');
    });
  });

  // ── 整句重复 ──
  describe('whole-text repetition', () => {
    it('collapses fully duplicated text（"火山实时结果火山实时结果" → "火山实时结果"）', () => {
      expect(normalizeRecognitionText('火山实时结果火山实时结果')).toBe('火山实时结果');
    });

    it('collapses duplicated leading phrase before the unique tail（"火山实时结果火山实时结果继续补充" → "火山实时结果继续补充"）', () => {
      expect(normalizeRecognitionText('火山实时结果火山实时结果继续补充')).toBe('火山实时结果继续补充');
    });
  });

  // ── 边界 ──
  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(normalizeRecognitionText('')).toBe('');
    });

    it('handles whitespace only', () => {
      expect(normalizeRecognitionText('   ')).toBe('');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeRecognitionText('  hello hello  ')).toBe('hello');
    });
  });
});

// ── 向后兼容：旧函数名仍可用 ──
describe('normalizeVolcanoRecognitionText（向后兼容）', () => {
  it('still works as alias', () => {
    expect(normalizeVolcanoRecognitionText('火山实时结果火山实时结果')).toBe('火山实时结果');
  });

  it('collapses repeated han-character stutter groups', () => {
    expect(normalizeVolcanoRecognitionText('会会会有有点点重重复复')).toBe('会有点重复');
  });
});
