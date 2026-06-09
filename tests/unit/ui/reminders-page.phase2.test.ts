import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RemindersPage phase 2 regression（提醒页阶段二回归）', () => {
  it('keeps a shared shell header and scrollable content body（继续使用共享页头与滚动内容区）', () => {
    const source = readFileSync(path.resolve('src/ui/app/pages/RemindersPage.tsx'), 'utf8');

    expect(source).toContain('<PageShell');
    expect(source).toContain('title="提醒"');
    expect(source).toContain('subtitle="替代微信提醒的应用内定时提醒"');
    expect(source).toContain('data-testid="reminders-page"');
    expect(source).toContain('overflow-y-auto');
  });
});
