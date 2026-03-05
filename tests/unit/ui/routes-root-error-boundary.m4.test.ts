import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('routes m4（RootRoute 错误边界）', () => {
  it('defines root errorComponent to catch lazy-load failures（根路由捕获懒加载错误）', () => {
    const source = readFileSync('src/routes.tsx', 'utf-8');
    expect(source).toContain('function RootRouteError({ error, reset }: ErrorComponentProps)');
    expect(source).toContain('errorComponent: RootRouteError');
    expect(source).toContain("message.includes('Failed to fetch dynamically imported module')");
  });
});

