import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

describe('SettingsPage AI registry section（设置页 AI 注册中心分组）', () => {
  it('renders AI registry manager instead of legacy single-provider form（显示注册中心而不是旧单渠道表单）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('AI Registry')).toBeInTheDocument();
    expect(screen.getByText(/Default llm\.chat/)).toBeInTheDocument();
    expect(screen.queryByText('AI API Key')).not.toBeInTheDocument();
  });
});
