import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

const openMock = vi.fn();

describe('issue-198 settings about merge（设置关于合并）', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('min-width: 768px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    Object.defineProperty(window, 'open', {
      writable: true,
      value: openMock,
    });
  });

  it('keeps a single about section and merges sponsor with developer（单一关于并合并赞助与开发者）', () => {
    render(<SettingsPage />);

    expect(screen.getByText('关于')).toBeInTheDocument();
    expect(screen.getByText('赞助开发者（Starlin）')).toBeInTheDocument();
  });

  it('opens sponsor link on sponsor row click（点击赞助条目打开链接）', () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: '赞助开发者（Starlin）' }));

    expect(openMock).toHaveBeenCalledWith('https://exo-mind.ai/', '_blank', 'noopener,noreferrer');
  });

  it('places danger section after about section（危险区域放在关于之后）', () => {
    render(<SettingsPage />);

    const aboutSection = screen.getByTestId('new-settings-desktop-vc-section-about');
    const dangerSection = screen.getByTestId('new-settings-desktop-vc-section-danger');
    const relation = aboutSection.compareDocumentPosition(dangerSection);

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
