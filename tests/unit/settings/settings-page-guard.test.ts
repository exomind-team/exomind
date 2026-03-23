import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SETTINGS_PAGE_PATH = resolve(__dirname, '../../../src/ui/app/pages/SettingsPage.tsx');

describe('SettingsPage regression guard', () => {
  const source = readFileSync(SETTINGS_PAGE_PATH, 'utf-8');

  it('keeps SettingsPage under 500 lines', () => {
    const lineCount = source.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(500);
  });

  it('imports DesktopSettingsLayout from the registry-driven layout', () => {
    expect(source).toContain('DesktopSettingsLayout');
  });

  it('imports MobileSettingsLayout from the registry-driven layout', () => {
    expect(source).toContain('MobileSettingsLayout');
  });

  it('does not contain inline setting renderers', () => {
    expect(source).not.toContain('SectionCard');
    expect(source).not.toContain('Switch');
  });
});
