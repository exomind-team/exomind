import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from '@/components/Settings/SettingsPage';

describe('SettingsPage import/export', () => {
  it('renders json import/export controls', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入 JSON' })).toBeInTheDocument();
    expect(screen.getByLabelText('导入策略')).toBeInTheDocument();
  });

  it('renders sync server controls', () => {
    render(<SettingsPage />);

    expect(screen.getByLabelText('同步服务器地址')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存同步地址' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复自动地址' })).toBeInTheDocument();
  });
});
