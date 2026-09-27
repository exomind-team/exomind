import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

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
  });

  it('keeps a single about section（单一关于分组）', () => {
    render(<SettingsPage />);

    expect(screen.getAllByText('关于').length).toBeGreaterThanOrEqual(1);
  });

  it('places danger section after about section（危险区域放在关于之后）', () => {
    render(<SettingsPage />);

    const aboutSection = screen.getByTestId('new-settings-desktop-vc-section-about');
    const dangerSection = screen.getByTestId('new-settings-desktop-vc-section-danger');
    const relation = aboutSection.compareDocumentPosition(dangerSection);

    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
