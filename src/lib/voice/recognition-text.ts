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

function collapseHanStutter(text: string): string {
  const matches = Array.from(text.matchAll(/([\p{Script=Han}])\1+/gu));
  if (matches.length < 2) {
    return text;
  }

  return text.replace(/([\p{Script=Han}])\1+/gu, '$1');
}

export function normalizeVolcanoRecognitionText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  const collapsedWholeText = collapseRepeatedWholeText(normalized);
  return collapseHanStutter(collapsedWholeText).trim();
}
