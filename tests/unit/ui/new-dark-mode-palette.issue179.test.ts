import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new ui dark mode palette issue-179（新UI暗色配色）', () => {
  const newLayoutSource = readFileSync(path.resolve('src/routes-new.tsx'), 'utf-8');
  const focusWidgetSource = readFileSync(path.resolve('src/ui/new/components/NewFocusTimerWidget.tsx'), 'utf-8');
  const switchSource = readFileSync(path.resolve('src/components/ui/switch.tsx'), 'utf-8');

  it('applies dark nav shell tokens on NewLayout（NewLayout 应有暗色外壳与底栏）', () => {
    expect(newLayoutSource).toContain('dark:bg-[#0C0A09]');
    expect(newLayoutSource).toContain('dark:border-[#292524]');
    expect(newLayoutSource).toContain('dark:bg-[#0C0A09]/95');
  });

  it('applies pencil dark glass tokens on idle focus card（Idle 卡片应匹配 Pencil 暗色玻璃层）', () => {
    expect(focusWidgetSource).toContain('dark:[background-color:rgba(28,25,23,0.5)]');
    expect(focusWidgetSource).toContain('dark:bg-[linear-gradient(180deg,rgba(28,25,23,0.25)_0%,rgba(28,25,23,0)_100%)]');
  });

  it('applies dark switch tokens from settings pencil（Switch 应匹配设置页暗色令牌）', () => {
    expect(switchSource).toContain('data-[state=checked]:bg-brand-accent');
    expect(switchSource).toContain('dark:data-[state=unchecked]:bg-white/10');
    expect(switchSource).toContain('dark:bg-[#0A0A0A]');
  });
});
