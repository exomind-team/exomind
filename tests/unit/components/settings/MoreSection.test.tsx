/**
 * SettingsPage - More Section 单元测试
 * GH#217: 新增 More Section（更新/遥测/报告问题/调试日志）
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { MoreSection } from '@/ui/app/components/MoreSection';

describe('SettingsPage - More Section', () => {
  it('renders More section title', () => {
    render(<SettingsPage />);
    expect(screen.getByText('更多')).toBeInTheDocument();
  });

  it('renders update settings row', () => {
    render(<SettingsPage />);
    expect(screen.getByText('更新')).toBeInTheDocument();
  });

  it('renders telemetry row', () => {
    render(<SettingsPage />);
    expect(screen.getByText('遥测')).toBeInTheDocument();
  });

  it('renders report problem row', () => {
    render(<SettingsPage />);
    expect(screen.getByText('报告问题')).toBeInTheDocument();
  });

  it('renders debug log row', () => {
    render(<SettingsPage />);
    expect(screen.getByText('调试日志')).toBeInTheDocument();
  });

  it('renders help and feedback rows（更多中包含帮助与反馈）', () => {
    render(<SettingsPage />);
    expect(screen.getByText('帮助中心')).toBeInTheDocument();
    expect(screen.getByText('反馈建议')).toBeInTheDocument();
  });
});

describe('MoreSection（更多组件 - 点击回调）', () => {
  it('clicking 帮助中心 calls onComingSoon', async () => {
    const onComingSoon = vi.fn();
    render(<MoreSection onNavigateUpdate={() => {}} onComingSoon={onComingSoon} />);
    await userEvent.click(screen.getByText('帮助中心'));
    expect(onComingSoon).toHaveBeenCalledOnce();
  });

  it('clicking 反馈建议 calls onComingSoon', async () => {
    const onComingSoon = vi.fn();
    render(<MoreSection onNavigateUpdate={() => {}} onComingSoon={onComingSoon} />);
    await userEvent.click(screen.getByText('反馈建议'));
    expect(onComingSoon).toHaveBeenCalledOnce();
  });

  it('clicking 更新 calls onNavigateUpdate', async () => {
    const onNavigateUpdate = vi.fn();
    render(<MoreSection onNavigateUpdate={onNavigateUpdate} onComingSoon={() => {}} />);
    await userEvent.click(screen.getByText('更新'));
    expect(onNavigateUpdate).toHaveBeenCalledOnce();
  });
});
