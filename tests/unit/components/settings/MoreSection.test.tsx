/**
 * NewSettingsPage - More Section 单元测试
 * GH#217: 新增 More Section（更新/遥测/报告问题/调试日志）
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

describe('NewSettingsPage - More Section', () => {
  it('renders More section title', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('更多')).toBeInTheDocument();
  });

  it('renders update settings row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('更新')).toBeInTheDocument();
  });

  it('renders telemetry row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('遥测')).toBeInTheDocument();
  });

  it('renders report problem row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('报告问题')).toBeInTheDocument();
  });

  it('renders debug log row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('调试日志')).toBeInTheDocument();
  });
});
