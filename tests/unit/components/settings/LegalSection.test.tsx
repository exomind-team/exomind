/**
 * NewSettingsPage - Legal Section 单元测试
 * GH#217: 新增 Legal Section（隐私政策/用户协议/官网/赞助/开源许可）
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import './setup-settings-mocks.tsx';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';

describe('NewSettingsPage - Legal Section', () => {
  it('renders Legal section title', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('法律与支持')).toBeInTheDocument();
  });

  it('renders privacy policy row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('隐私政策')).toBeInTheDocument();
  });

  it('renders terms of service row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('用户协议')).toBeInTheDocument();
  });

  it('renders website row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('官网')).toBeInTheDocument();
  });

  it('renders sponsor row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('赞助开发者')).toBeInTheDocument();
  });

  it('renders open source license row', () => {
    render(<NewSettingsPage />);
    expect(screen.getByText('开源软件使用声明')).toBeInTheDocument();
  });
});
