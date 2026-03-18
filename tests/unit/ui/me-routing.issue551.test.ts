import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('issue-551 me page feature guard（Me 页面功能开关接线）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('wires me-page-enabled state into layout subscriptions（路由壳层订阅 Me 页面开关）', () => {
    expect(source).toContain('getMePageEnabled');
    expect(source).toContain('subscribeMePageEnabledChanges');
    expect(source).toContain('const [mePageEnabled, setMePageEnabled] = useState(() => getMePageEnabled())');
  });

  it('gates mobile/desktop navigation and command context with the me flag（导航与命令上下文受 Me 开关控制）', () => {
    expect(source).toContain("...(mePageEnabled ? [{ title: 'Me', path: '/me', icon: UserRound }] : [])");
    expect(source).toContain("featureFlags: {");
    expect(source).toContain('mePageEnabled');
  });

  it('redirects /me to settings when the me page is disabled（关闭开关时访问 /me 跳转到设置）', () => {
    expect(source).toContain("path: '/me'");
    expect(source).toContain("void navigate({ to: '/settings', replace: true })");
  });
});
