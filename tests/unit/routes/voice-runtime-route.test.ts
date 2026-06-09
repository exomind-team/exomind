import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('voice runtime route and desktop entry（语音运行时路由与桌面入口）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');
  const desktopNavStart = source.indexOf('const desktopNavItems = [');
  const desktopNavEnd = source.indexOf('];', desktopNavStart);
  const desktopNavBlock = source.slice(desktopNavStart, desktopNavEnd);
  const mobileNavStart = source.indexOf('const navItems = [');
  const mobileNavEnd = source.indexOf('];', mobileNavStart);
  const mobileNavBlock = source.slice(mobileNavStart, mobileNavEnd);

  it('registers the dedicated lab page route（注册独立实验页路由）', () => {
    expect(source).toContain('const VoiceRuntimeLabPage = lazy(async () => {');
    expect(source).toContain("path: '/voice-runtime'");
    expect(source).toContain('<VoiceRuntimeLabPage />');
  });

  it('shows the desktop nav entry behind developer mode and the lab switch（桌面入口受开发者模式与实验页开关共同控制）', () => {
    expect(source).toContain('getVoiceRuntimeLabNavEnabled');
    expect(source).toContain('subscribeVoiceRuntimeLabNavEnabledChanges');
    expect(desktopNavBlock).toContain('developerModeEnabled && voiceRuntimeLabNavEnabled');
    expect(desktopNavBlock).toContain("key: 'voice-runtime-lab'");
    expect(desktopNavBlock).toContain("title: '语音实验'");
    expect(desktopNavBlock).toContain("path: '/voice-runtime'");
  });

  it('does not add the lab entry to the mobile bottom tab（移动端底栏不显示实验页入口）', () => {
    expect(mobileNavBlock).not.toContain('/voice-runtime');
    expect(mobileNavBlock).not.toContain('语音实验');
  });
});
