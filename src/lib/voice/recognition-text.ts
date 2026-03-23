/**
 * Collapse whole-text repetition (2x or 3x exact copies).
 * "火山实时结果火山实时结果" → "火山实时结果"
 */
function collapseRepeatedWholeText(text: string): string {
  const characters = Array.from(text);
  const totalLength = characters.length;

  for (let repeatCount = 2; repeatCount <= 3; repeatCount += 1) {
    if (totalLength % repeatCount !== 0) {
      continue;
    }

    const unitLength = totalLength / repeatCount;
    if (unitLength < 2) {
      continue;
    }

    const unit = characters.slice(0, unitLength).join('');
    if (unit.repeat(repeatCount) === text) {
      return unit;
    }
  }

  return text;
}

/**
 * Collapse consecutive identical space-separated tokens.
 * "super super" → "super"
 * "C C I I U U D D" → "C I U D"
 * "hello hello world world" → "hello world"
 */
function collapseConsecutiveTokens(text: string): string {
  const tokens = text.split(/(\s+)/);
  const result: string[] = [];
  let lastWord = '';

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      continue;
    }
    if (token === lastWord) {
      continue;
    }
    result.push(token);
    lastWord = token;
  }

  return result.join(' ');
}

/**
 * Collapse repeated Chinese character groups (2+ chars).
 * "这个这个" → "这个"
 * "应该应该" → "应该"
 * "然后然后根据根据我们我们的" → "然后根据我们的"
 * "解决了解决了" → "解决了"
 *
 * Matches groups of 2-4 Han characters repeated 2-3 times consecutively.
 */
function collapseHanWordGroupRepeat(text: string): string {
  return text.replace(/([\p{Script=Han}]{2,4})\1+/gu, '$1');
}

/**
 * Collapse single Han character stutter (3+ consecutive identical chars).
 * "我我我想" → "我想"
 * "会会会有有点点重重复复" → "会有点重复"
 *
 * Uses ≥3 threshold for single chars to preserve legitimate doubles like "哈哈".
 * For multi-group stutter (≥2 groups of doubles), also collapses.
 */
function collapseHanStutter(text: string): string {
  // First: collapse any single char repeated 3+ times (always stutter)
  let result = text.replace(/([\p{Script=Han}])\1{2,}/gu, '$1');

  // Then: if there are ≥2 groups of doubled chars, collapse those too
  const doubleMatches = Array.from(result.matchAll(/([\p{Script=Han}])\1/gu));
  if (doubleMatches.length >= 2) {
    result = result.replace(/([\p{Script=Han}])\1+/gu, '$1');
  }

  return result;
}

/**
 * Universal voice recognition text normalization.
 * Applies a multi-layer dedup pipeline:
 *   1. Whole-text repetition
 *   2. Chinese word-group repetition (2+ char groups)
 *   3. Single Han character stutter
 *   4. Consecutive identical space-separated tokens (English words/letters)
 */
export function normalizeRecognitionText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  let result = collapseRepeatedWholeText(trimmed);
  result = collapseHanWordGroupRepeat(result);
  result = collapseHanStutter(result);
  result = collapseConsecutiveTokens(result);

  return result.trim();
}

/** @deprecated Use `normalizeRecognitionText` instead. */
export function normalizeVolcanoRecognitionText(text: string): string {
  return normalizeRecognitionText(text);
}
