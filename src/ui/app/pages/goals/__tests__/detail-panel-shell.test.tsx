import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isDesktopMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => isDesktopMock(),
}));

describe('DetailPanelShell', () => {
  beforeEach(() => {
    isDesktopMock.mockReset();
  });

  it('renders as a desktop side panel on desktop', async () => {
    isDesktopMock.mockReturnValue(true);
    const { DetailPanelShell } = await import('../components/DetailPanelShell');

    render(
      <DetailPanelShell title="Panel" subtitle="Goal" onClose={() => {}}>
        <div>content</div>
      </DetailPanelShell>,
    );

    const panel = screen.getByRole('complementary');
    expect(panel.className).toContain('right-4');
    expect(panel.className).toContain('w-[340px]');
  });

  it('renders as a bottom drawer on mobile', async () => {
    isDesktopMock.mockReturnValue(false);
    const { DetailPanelShell } = await import('../components/DetailPanelShell');

    render(
      <DetailPanelShell title="Panel" subtitle="Goal" onClose={() => {}}>
        <div>content</div>
      </DetailPanelShell>,
    );

    const panel = screen.getByRole('complementary');
    expect(panel.className).toContain('inset-x-0');
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).toContain('rounded-t-[28px]');
    expect(panel.className).toContain('max-h-[72vh]');
  });
});
