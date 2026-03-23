import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { applyThemePreference } from '@/config/theme';

describe('dark mode CSS variables', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.cssText = '';
  });

  it('applies dark class to html element', () => {
    const resolved = applyThemePreference('dark');
    expect(resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('semantic variables use Stone palette hue in dark mode (not purple 270)', () => {
    const cssPath = path.resolve('src/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    // Extract the .dark block
    const darkBlockMatch = content.match(/\.dark\s*\{([\s\S]*?)\}/);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1];

    // Verify NO semantic variable uses purple hue 270
    const semanticVars = [
      '--text-primary',
      '--text-strong',
      '--text-secondary',
      '--text-muted',
      '--bg-card',
      '--bg-surface',
      '--border-card',
      '--border-subtle',
      '--brand-accent',
    ];

    for (const varName of semanticVars) {
      const varMatch = darkBlock.match(new RegExp(`${varName.replace('-', '\\-')}:\\s*([^;]+);`));
      if (varMatch) {
        const value = varMatch[1].trim();
        // Must NOT start with 270 or 271 (purple hue)
        expect(value).not.toMatch(/^27[01]\s/);
      }
    }

    // Verify Stone palette hues are used (hues in range 0-60, warm tones)
    const textPrimaryMatch = darkBlock.match(/--text-primary:\s*(\d+)/);
    expect(textPrimaryMatch).not.toBeNull();
    const textPrimaryHue = parseInt(textPrimaryMatch![1]);
    expect(textPrimaryHue).toBeLessThanOrEqual(60);

    const bgCardMatch = darkBlock.match(/--bg-card:\s*(\d+)/);
    expect(bgCardMatch).not.toBeNull();
    const bgCardHue = parseInt(bgCardMatch![1]);
    expect(bgCardHue).toBeLessThanOrEqual(30);

    const brandAccentMatch = darkBlock.match(/--brand-accent:\s*(\d+)/);
    expect(brandAccentMatch).not.toBeNull();
    const brandAccentHue = parseInt(brandAccentMatch![1]);
    expect(brandAccentHue).toBeLessThanOrEqual(20);
  });
});
