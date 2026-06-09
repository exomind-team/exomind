import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('issue-142 mobile safe area', () => {
  const htmlPath = path.resolve('index.html');
  const cssPath = path.resolve('src/index.css');
  const routesPath = path.resolve('src/routes.tsx');
  const voiceInputPath = path.resolve('src/components/VoiceMessageInput.tsx');

  it('includes fullscreen-safe and anti-zoom viewport settings in index.html', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('minimum-scale=1.0');
    expect(html).toContain('maximum-scale=1.0');
    expect(html).toContain('user-scalable=no');
  });

  it('defines safe-area utility classes in src/index.css', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.safe-area-pb');
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('constant(safe-area-inset-bottom)');
  });

  it('applies safe-area offset in mobile layout', () => {
    const routesSource = fs.readFileSync(routesPath, 'utf-8');
    expect(routesSource).toContain('env(safe-area-inset-bottom,0px)');
    expect(routesSource).toContain('env(safe-area-inset-top,0px)');
  });

  it('hides the vertical scrollbar only for mobile fullscreen routes', () => {
    const routesSource = fs.readFileSync(routesPath, 'utf-8');
    expect(routesSource).toContain("fullscreenRoute && 'scrollbar-none'");
  });

  it('keeps base vertical spacing when applying bottom safe-area in voice input', () => {
    const voiceInputSource = fs.readFileSync(voiceInputPath, 'utf-8');
    expect(voiceInputSource).toContain("wrapperClassName = isNewMobile ? 'safe-area-pb");
    expect(voiceInputSource).toContain(": 'safe-area-pb bg-card shrink-0'");
  });
});
