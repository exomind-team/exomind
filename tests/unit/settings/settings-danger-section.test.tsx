import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage danger section（危险区域样式与按钮动作）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the danger section last with a red-toned shell and explicit CTA buttons', () => {
    render(<SettingsPage />);

    const developerSection = screen.getByText('开发者').closest('section');
    const dangerSection = screen.getByText('危险区域').closest('section');
    const relation = developerSection?.compareDocumentPosition(dangerSection as Node) ?? 0;

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const dangerCard = dangerSection?.querySelector('[data-settings-section-card="true"]');
    expect(dangerCard).not.toBeNull();
    expect(dangerCard?.getAttribute('style') ?? '').toContain('--settings-tone-color: #DC2626');

    expect(screen.getByText('将清除设备上的临时设置与缓存')).toBeInTheDocument();
    expect(screen.getByText('恢复默认配置，不影响历史事件数据')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即清空' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复默认' })).toBeInTheDocument();
  });
});
