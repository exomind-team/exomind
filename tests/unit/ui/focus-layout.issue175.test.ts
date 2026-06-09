import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new focus layout issue-175 structure', () => {
  const focusPagePath = path.resolve('src/ui/app/pages/FocusPage.tsx');
  const source = readFileSync(focusPagePath, 'utf-8');

  it('turns FocusPage into a thin shell over NowPage（FocusPage 退化为 NowPage 壳层）', () => {
    expect(source).toContain("import { NowPage } from './NowPage'");
    expect(source).toContain('return <NowPage />');
  });

  it('no longer renders ChatPage directly inside FocusPage（FocusPage 不再直接渲染 ChatPage）', () => {
    expect(source).not.toContain('data-testid="new-now-chat-section"');
    expect(source).not.toContain('<ChatPage variant="new-mobile" hideHeader />');
  });
});
