import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';
import { saveAIRegistryOfferingDraft } from '@/lib/ai-registry/admin';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

describe('SettingsPage AI registry section（设置页 AI 注册中心分组）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders AI registry manager instead of legacy single-provider form（显示注册中心而不是旧单渠道表单）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('AI Registry')).toBeInTheDocument();
    expect(screen.getByText(/0 channels/i)).toBeInTheDocument();
    expect(screen.queryByText('AI API Key')).not.toBeInTheDocument();
  });

  it('shows multiple registry offerings in the dialog（弹窗中显示多个渠道供给项）', () => {
    saveAIRegistryOfferingDraft({
      capabilityKey: 'llm.chat',
      capabilityDisplayName: 'LLM Chat',
      channelName: 'OpenAI Official',
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      apiKey: 'sk-openai-primary',
      setAsDefault: true,
    });

    saveAIRegistryOfferingDraft({
      capabilityKey: 'image.generate',
      capabilityDisplayName: 'Image Generate',
      channelName: 'Image Gateway',
      vendor: 'openai',
      baseUrl: 'https://images.example/v1',
      model: 'gpt-image-1',
      apiKey: 'sk-image-gateway',
      setAsDefault: true,
    });

    render(<SettingsPage />);

    fireEvent.click(screen.getByText('AI Registry').closest('button') as HTMLButtonElement);

    expect(screen.getByText('默认能力映射')).toBeInTheDocument();
    expect(screen.getByText('已注册供给项')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Official')).toBeInTheDocument();
    expect(screen.getByText('Image Gateway')).toBeInTheDocument();
    expect(screen.getAllByText('llm.chat').length).toBeGreaterThan(0);
    expect(screen.getAllByText('image.generate').length).toBeGreaterThan(0);
  });

  it('uses a viewport-safe scroll shell and dark-mode surfaces（弹窗应限高滚动并带暗色主题表面类）', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByText('AI Registry').closest('button') as HTMLButtonElement);

    const dialog = screen.getByRole('dialog');
    const shell = screen.getByTestId('ai-registry-dialog-shell');
    const scrollRegion = screen.getByTestId('ai-registry-scroll-region');

    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.className).toContain('dark:bg-[#0C0A09]');
    expect(shell.className).toContain('max-h-[calc(100vh-32px)]');
    expect(scrollRegion.className).toContain('overflow-y-auto');
    expect(scrollRegion.className).toContain('overscroll-contain');
  });
});
