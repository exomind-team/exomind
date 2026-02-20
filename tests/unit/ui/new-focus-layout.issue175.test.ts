import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new focus layout issue-175 structure', () => {
  const focusPagePath = path.resolve('src/ui/new/pages/NewFocusPage.tsx');
  const source = readFileSync(focusPagePath, 'utf-8');

  it('removes legacy top hero card and keeps only chat container（移除旧顶部卡片）', () => {
    expect(source).not.toContain('data-testid="new-now-task-card-glow"');
    expect(source).not.toContain('data-testid="new-now-task-card"');
    expect(source).not.toContain('设计系统重构');
  });

  it('uses full-width chat section with new-mobile variant（保留新移动端聊天主体）', () => {
    expect(source).toContain('data-testid="new-now-chat-section"');
    expect(source).toContain('<ChatPage variant="new-mobile" hideHeader />');
  });
});
