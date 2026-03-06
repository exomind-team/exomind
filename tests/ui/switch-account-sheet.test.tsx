/**
 * SwitchAccountSheet 静态文案测试
 *
 * 保护混合身份模型下的本地档案心智，不回退到“账户/登录/注册”主叙事。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SwitchAccountSheet local-profile copy（本地档案文案）', () => {
  const filePath = path.resolve('src/ui/app/components/SwitchAccountSheet.tsx');
  const content = fs.readFileSync(filePath, 'utf-8');

  it('contains local-profile primary labels（包含本地档案主标签）', () => {
    expect(content).toContain('切换本地档案');
    expect(content).toContain('打开本地档案');
    expect(content).toContain('创建本地档案');
  });

  it('contains local-profile action labels（包含档案动作标签）', () => {
    expect(content).toContain('打开档案');
    expect(content).toContain('创建档案');
    expect(content).toContain('打开中...');
    expect(content).toContain('创建中...');
  });

  it('contains local-profile navigation labels（包含档案导航标签）', () => {
    expect(content).toContain('没有本地档案？去创建');
    expect(content).toContain('已有本地档案？去打开');
  });
});
