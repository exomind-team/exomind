import { describe, expect, it } from 'vitest';
import {
  normalizeVolcanoRecognitionText,
} from '@/lib/voice/recognition-text';

describe('voice recognition text helpers（语音识别文本辅助）', () => {
  it('collapses a fully duplicated volcano phrase（整句重复时折叠为一份）', () => {
    expect(normalizeVolcanoRecognitionText('火山实时结果火山实时结果')).toBe('火山实时结果');
  });

  it('collapses repeated han-character stutter groups（多组汉字口吃式重复会收敛）', () => {
    expect(normalizeVolcanoRecognitionText('会会会有有点点重重复复')).toBe('会有点重复');
  });

  it('keeps short legitimate repetition when it is not stutter-like（短而合理的重复不误伤）', () => {
    expect(normalizeVolcanoRecognitionText('人人')).toBe('人人');
    expect(normalizeVolcanoRecognitionText('哈哈')).toBe('哈哈');
  });
});
