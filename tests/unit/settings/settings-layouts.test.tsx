import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopSettingsLayout } from '@/ui/app/layouts/DesktopSettingsLayout';
import { MobileSettingsLayout } from '@/ui/app/layouts/MobileSettingsLayout';
import type { SettingsContext, SettingsItem } from '@/ui/app/config/settings/settings-types';

const makeCustomItem = (
  id: string,
  category: SettingsItem['category'],
  label: string,
): SettingsItem => ({
  id,
  label,
  category,
  type: 'custom',
  component: () => <div>{label}</div>,
});

const items: SettingsItem[] = [
  makeCustomItem('theme', 'appearance', '主题'),
  makeCustomItem('feedback-content', 'feedback', '反馈内容'),
  makeCustomItem('voice-transcript-send-mode', 'input', '语音转写后'),
  makeCustomItem('sync-server-url', 'sync', '同步服务器'),
  makeCustomItem('export-backup', 'data', '导出备份'),
  makeCustomItem('developer-mode', 'developer', '开发者模式'),
  makeCustomItem('clear-local-cache', 'danger', '清空本地缓存'),
];

describe('settings layouts', () => {
  it('renders mobile sections by category order', () => {
    const ctx: SettingsContext = { isDesktop: false };

    render(<MobileSettingsLayout items={items} ctx={ctx} />);

    expect(screen.getByText('外观')).toBeInTheDocument();
    expect(screen.getByText('时间块反馈')).toBeInTheDocument();
    expect(screen.getByText('输入')).toBeInTheDocument();
    expect(screen.getByText('同步')).toBeInTheDocument();
    expect(screen.getByText('数据')).toBeInTheDocument();
    expect(screen.getByText('开发者')).toBeInTheDocument();
    expect(screen.getByText('危险区域')).toBeInTheDocument();

    const dangerSection = screen.getByText('危险区域').closest('section');
    const developerSection = screen.getByText('开发者').closest('section');
    const relation = developerSection?.compareDocumentPosition(dangerSection as Node) ?? 0;

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders desktop tabs from desktop tab config', () => {
    const ctx: SettingsContext = { isDesktop: true };

    render(<DesktopSettingsLayout items={items} ctx={ctx} />);

    expect(screen.getByRole('button', { name: '外观主题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '专注设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '输入' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开发者' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '危险区域' })).toBeInTheDocument();

    const tabs = screen.getAllByRole('button');
    const developerIndex = tabs.findIndex((button) => button.textContent === '开发者');
    const dangerIndex = tabs.findIndex((button) => button.textContent === '危险区域');

    expect(dangerIndex).toBeGreaterThan(developerIndex);
  });
});
