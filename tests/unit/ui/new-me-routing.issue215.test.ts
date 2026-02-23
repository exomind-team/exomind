import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('issue-215 me routing wiring（Me 路由接线）', () => {
  const sourcePath = path.resolve('src/routes-new.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('adds me entry to bottom nav（底部导航新增 Me）', () => {
    expect(source).toContain("title: 'Me'");
    expect(source).toContain('UserRound');
  });

  it('defines /me route（定义 /me 路由）', () => {
    expect(source).toContain("path: '/me'");
    expect(source).toContain('NewMePage');
  });
});

