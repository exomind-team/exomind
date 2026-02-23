import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('issue-215 bottom nav fit（底部导航适配 5 菜单）', () => {
  const sourcePath = path.resolve('src/routes-new.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('uses equal-width flexible nav items for mobile（菜单项均分宽度）', () => {
    expect(source).toContain('flex flex-1 min-w-0 flex-col');
  });

  it('does not force 80px min width per nav item（不再强制 min-w-20）', () => {
    expect(source).not.toContain('min-w-20');
  });
});

