/**
 * NewSettingsPage - Developer Section 单元测试
 * GH#217: Developer Section 对齐设计稿 — 开发者功能开关
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { getDeveloperModeEnabled } from '@/config/developer-mode';
import { setDevtoolsEnabled } from '@/config/devtools-mode';
import { syncDevtoolsWithSettings } from '@/lib/debug/devtools-runtime';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

beforeEach(() => {
  vi.mocked(getDeveloperModeEnabled).mockReturnValue(true);
});

describe('NewSettingsPage - Developer Section (developerMode=true)', () => {
  it('renders feature toggles row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('功能开关')).toBeInTheDocument();
  });

  it('opens feature toggles drawer on click', () => {
    render(<NewSettingsPage />);
    const row = screen.getByText('功能开关');
    fireEvent.click(row);
    expect(screen.getByText('Agent 页面')).toBeInTheDocument();
  });

  it('renders mock data toggle', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('使用测试数据')).toBeInTheDocument();
  });

  it('renders devtools toggle', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('开发者工具')).toBeInTheDocument();
  });

  it('updates devtools state and syncs runtime on toggle', () => {
    render(<NewSettingsPage />);
    const toggle = screen.getByTestId('new-settings-devtools-switch');
    fireEvent.click(toggle);
    expect(vi.mocked(setDevtoolsEnabled)).toHaveBeenCalledWith(true);
    expect(vi.mocked(syncDevtoolsWithSettings)).toHaveBeenCalled();
  });
});
