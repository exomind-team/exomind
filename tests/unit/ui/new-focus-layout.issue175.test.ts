import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new focus layout issue-175 structure', () => {
  const focusPagePath = path.resolve('src/ui/new/pages/NewFocusPage.tsx');
  const source = readFileSync(focusPagePath, 'utf-8');

  it('contains layered task card nodes for pencil-like glow and glass', () => {
    expect(source).toContain('data-testid="new-now-task-card-glow"');
    expect(source).toContain('data-testid="new-now-task-card"');
  });

  it('uses full-width chat section instead of inner horizontal padding wrapper', () => {
    expect(source).toContain('data-testid="new-now-chat-section"');
    expect(source).not.toContain('section className="min-h-0 flex-1 px-4');
  });
});

