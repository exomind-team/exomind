import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Alpha and Beta share one actual focus presentation implementation', () => {
  it('moves the existing Alpha config/running DOM into the shared View rather than leaving a second copy', () => {
    const source = readFileSync(path.resolve('src/ui/app/components/FocusTimerWidget.tsx'), 'utf8');
    expect(source).toMatch(/import[\s\S]*?FocusTimerView[\s\S]*?from\s+["'].*FocusTimerView["']/);
    expect(source).toContain('<FocusTimerView');
    expect(source).not.toContain('data-testid="new-focus-state-config"');
    expect(source).not.toContain('data-testid="new-focus-running-clock"');
    expect(source).not.toContain('data-testid="new-focus-expected-time-row"');
  });
});
