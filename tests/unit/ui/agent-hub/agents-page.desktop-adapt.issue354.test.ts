import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agents page desktop adapt issue-354（桌面端适配与占位清理）', () => {
  const sourcePath = path.resolve('src/ui/app/pages/AgentsPage.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('uses desktop-specific bottom padding override（桌面端覆盖底部内边距）', () => {
    expect(source).toContain(
      'pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2 lg:pb-6'
    );
  });

  it('shows right panel only on lg breakpoint（右侧栏在 lg 断点显示）', () => {
    expect(source).toContain('lg:flex lg:flex-col');
    expect(source).not.toContain('md:flex md:flex-col');
  });

  it('replaces signal-detail placeholder with route counters（信号详情使用路由统计替代占位）', () => {
    expect(source).toContain('接收路由');
    expect(source).toContain('发送路由');
    expect(source).not.toContain('完整 Signal History 面板将在后续版本实现');
  });

  it('replaces agent-chat placeholder with roadmap hint（Agent 对话占位改为规划提示）', () => {
    expect(source).toContain('此功能计划在 v0.3.6 实现，需要 RT 会话管理接口支持。');
    expect(source).toContain('<MessageSquare size={20} className="text-[#0D9488]" />');
    expect(source).not.toContain('Agent 对话 — T8 阶段实现');
  });
});
