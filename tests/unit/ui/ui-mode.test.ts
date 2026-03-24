import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

describe('ui mode retired（界面模式切换已移除）', () => {
  it('ui-mode config file is removed', () => {
    expect(existsSync(path.resolve('src/config/ui-mode.ts'))).toBe(false);
  });

  it('app no longer contains mode switching logic', () => {
    const appSource = readFileSync(path.resolve('src/App.tsx'), 'utf-8');
    expect(appSource).not.toContain('getUIMode');
    expect(appSource).not.toContain('subscribeUIModeChanges');
    expect(appSource).not.toContain('uiMode');
  });
});
