import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageMoreMenu } from '@/ui/new/components/PageMoreMenu';

const openPaletteMock = vi.fn();

const runtimeFlags = vi.hoisted(() => ({
  developerModeEnabled: true,
  commandPaletteEnabled: true,
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => runtimeFlags.developerModeEnabled,
  subscribeDeveloperModeChanges: () => () => {},
}));

vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: () => runtimeFlags.commandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges: () => () => {},
}));

vi.mock('@/lib/services/command-palette.service', () => ({
  getCommandPaletteService: () => ({
    open: openPaletteMock,
    close: vi.fn(),
    toggle: vi.fn(),
    setQuery: vi.fn(),
    setHighlightedIndex: vi.fn(),
    moveHighlight: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getState: vi.fn(),
  }),
}));

describe('page more menu issue-243（页面点点点入口）', () => {
  beforeEach(() => {
    openPaletteMock.mockReset();
    runtimeFlags.developerModeEnabled = true;
    runtimeFlags.commandPaletteEnabled = true;
  });

  it('shows command palette item when enabled and opens palette on click（可用时展示并触发）', () => {
    render(<PageMoreMenu />);

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    const entry = screen.getByTestId('page-more-menu-open-command-palette');
    expect(entry).toBeInTheDocument();

    fireEvent.click(entry);
    expect(openPaletteMock).toHaveBeenCalledTimes(1);
  });

  it('hides command palette item when disabled（不可用时隐藏）', () => {
    runtimeFlags.commandPaletteEnabled = false;

    render(<PageMoreMenu />);

    fireEvent.click(screen.getByRole('button', { name: '更多菜单' }));
    expect(screen.queryByTestId('page-more-menu-open-command-palette')).not.toBeInTheDocument();
  });
});
