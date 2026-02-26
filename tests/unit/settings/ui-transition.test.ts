import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('UI transition entry/exit（新旧 UI 双向切换）', () => {
  const legacySettingsSource = readFileSync(path.resolve('src/components/Settings/SettingsPage.tsx'), 'utf-8');
  const newSettingsSource = readFileSync(path.resolve('src/ui/new/pages/NewSettingsPage.tsx'), 'utf-8');

  it('legacy settings keeps switch-to-new action（旧设置页保留切新入口）', () => {
    expect(legacySettingsSource).toContain('切换到新 UI');
    expect(legacySettingsSource).toContain("setUIMode('new')");
  });

  it('new settings keeps switch-back action（新设置页保留回旧入口）', () => {
    expect(newSettingsSource).toContain('label="旧版页面"');
    expect(newSettingsSource).toContain("setUIMode('old')");
  });

  it('old-ui entry is placed after developer-only block（回旧入口位于开发者条件块之外）', () => {
    expect(newSettingsSource).toMatch(/\{developerMode\s*&&[\s\S]*?\)\}\s*<Divider \/>\s*<SettingRow[\s\S]*label=\"旧版页面\"/);
  });
});
