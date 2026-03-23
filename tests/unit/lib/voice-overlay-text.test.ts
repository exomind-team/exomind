import { describe, expect, it } from 'vitest';
import { trimToLatestCharacters } from '@/lib/voice/overlay-text';

describe('voice overlay text helpers（语音悬浮窗文本辅助）', () => {
  it('keeps full text when it is within the limit（短文本不截断）', () => {
    expect(trimToLatestCharacters('你好 ExoMind', 100)).toBe('你好 ExoMind');
  });

  it('keeps the latest 100 characters for long text（长文本保留最新 100 字）', () => {
    const source = Array.from({ length: 120 }, (_, index) => String(index % 10)).join('');

    expect(trimToLatestCharacters(source, 100)).toBe(source.slice(-100));
  });
});
