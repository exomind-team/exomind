import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('SettingsPage section tones（分组主题色变量）', () => {
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

  it('uses a theme-aware CSS variable as the developer section tone color', () => {
    render(<SettingsPage />);

    const developerSection = screen.getByText('开发者').closest('section');
    const developerCard = developerSection?.querySelector('[data-settings-section-card="true"]');

    expect(developerCard).not.toBeNull();
    expect(developerCard?.getAttribute('style') ?? '').toContain('--settings-tone-color: var(--settings-tone-developer)');
  });
});
