/**
 * SettingsPage - Developer Section 单元测试
 * GH#217: Developer Section 对齐设计稿 — 开发者功能开关
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { setDevtoolsEnabled } from '@/config/devtools-mode';
import { setCommandPaletteEnabled } from '@/config/command-palette-enabled';
import { setMePageEnabled } from '@/config/me-page-enabled';
import { setProposalInboxEnabled } from '@/config/proposal-inbox-enabled';
import { syncDevtoolsWithSettings } from '@/lib/debug/devtools-runtime';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

beforeEach(() => {
  vi.mocked(getDeveloperModeEnabled).mockReturnValue(true);
});

describe('SettingsPage - Developer Section (developerMode=true)', () => {
  it('renders inline feature toggles directly inside developer section（直接在开发者分组渲染功能开关）', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Me 页面')).toBeInTheDocument();
    expect(screen.getByText('网络页面')).toBeInTheDocument();
    expect(screen.getByText('请求箱（任务域）')).toBeInTheDocument();
    expect(screen.getByText('桌面端适配')).toBeInTheDocument();
    expect(screen.getByText('命令面板')).toBeInTheDocument();
  });

  it('renders mock data toggle', () => {
    render(<SettingsPage />);
    expect(screen.getByText('使用测试数据')).toBeInTheDocument();
  });

  it('renders devtools toggle', () => {
    render(<SettingsPage />);
    expect(screen.getByText('开发者工具')).toBeInTheDocument();
  });

  it('updates devtools state and syncs runtime on toggle', () => {
    render(<SettingsPage />);
    const toggle = screen.getByTestId('new-settings-devtools-switch');
    fireEvent.click(toggle);
    expect(vi.mocked(setDevtoolsEnabled)).toHaveBeenCalledWith(true);
    expect(vi.mocked(syncDevtoolsWithSettings)).toHaveBeenCalled();
  });

  it('updates command palette state inside feature toggles drawer', () => {
    render(<SettingsPage />);
    const toggle = screen.getByTestId('feature-toggle-command-palette-switch');
    fireEvent.click(toggle);

    expect(vi.mocked(setCommandPaletteEnabled)).toHaveBeenCalledWith(true);
  });

  it('updates me page state inside feature toggles drawer', () => {
    render(<SettingsPage />);
    const toggle = screen.getByTestId('feature-toggle-me-page-switch');
    fireEvent.click(toggle);

    expect(vi.mocked(setMePageEnabled)).toHaveBeenCalledWith(true);
  });

  it('updates proposal inbox state inline（直接更新请求箱任务域开关）', () => {
    render(<SettingsPage />);
    const toggle = screen.getByTestId('feature-toggle-proposal-inbox-switch');
    fireEvent.click(toggle);

    expect(vi.mocked(setProposalInboxEnabled)).toHaveBeenCalledWith(false);
  });
});
