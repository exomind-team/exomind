import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new focus timer visual tokens issue-175（视觉尺寸令牌）', () => {
  const sourcePath = path.resolve('src/ui/new/components/NewFocusTimerWidget.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('contains idle card sizing tokens from pencil（未开始卡片尺寸）', () => {
    expect(source).toContain('h-[104px]');
    expect(source).toContain('h-[68px]');
    expect(source).toContain('w-[357px]');
    expect(source).toContain('rounded-[24px]');
  });

  it('contains config card sizing tokens from pencil（配置卡片尺寸）', () => {
    expect(source).toContain('h-[253px]');
    expect(source).toContain('w-[361px]');
    expect(source).toContain('rounded-[24px]');
  });

  it('contains running timer typography tokens from pencil（运行态数字样式）', () => {
    expect(source).toContain('text-[56px]');
    expect(source).toContain('tracking-[2px]');
  });
});
