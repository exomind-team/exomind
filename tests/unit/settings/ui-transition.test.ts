import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('UI transition entry（旧 UI 仅保留切新入口）', () => {
  const legacySettingsSource = readFileSync(path.resolve('src/components/Settings/SettingsPage.tsx'), 'utf-8');
  const newSettingsSource = readFileSync(path.resolve('src/ui/new/pages/NewSettingsPage.tsx'), 'utf-8');

  it('legacy settings keeps switch-to-new action（旧设置页保留切新入口）', () => {
    expect(legacySettingsSource).toContain('切换到新 UI');
    expect(legacySettingsSource).toContain("setUIMode('new')");
  });

  it('new settings no longer exposes switch-back action（新设置页不再提供回旧入口）', () => {
    expect(newSettingsSource).not.toContain('label="旧版页面"');
    expect(newSettingsSource).not.toContain("setUIMode('old')");
  });
});
