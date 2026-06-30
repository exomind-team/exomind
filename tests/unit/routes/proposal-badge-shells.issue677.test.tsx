import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';

const routeState = vi.hoisted(() => ({
  isDesktop: false,
  desktopAdaptiveEnabled: true,
  setCommands: vi.fn(),
  removeScope: vi.fn(),
  closePalette: vi.fn(),
  togglePalette: vi.fn(),
  setSidebarCollapsed: vi.fn(),
}));

function subscribeNoop() {
  return () => {};
}

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: () => false,
  subscribeAgentPageEnabledChanges: subscribeNoop,
}));

vi.mock('@/config/goals-page-enabled', () => ({
  getGoalsPageEnabled: () => false,
  subscribeGoalsPageEnabledChanges: subscribeNoop,
}));

vi.mock('@/config/desktop-adaptive', () => ({
  getDesktopAdaptiveEnabled: () => routeState.desktopAdaptiveEnabled,
  subscribeDesktopAdaptiveChanges: subscribeNoop,
}));

vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => false,
  subscribeDeveloperModeChanges: subscribeNoop,
}));

vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: () => false,
  subscribeCommandPaletteEnabledChanges: subscribeNoop,
}));

vi.mock('@/config/desktop-sidebar-preferences', () => ({
  getDesktopSidebarCollapsed: () => false,
  setDesktopSidebarCollapsed: (...args: unknown[]) => routeState.setSidebarCollapsed(...args),
}));

vi.mock('@/lib/services/command-registry.service', () => ({
  getCommandRegistryService: () => ({
    setCommands: (...args: unknown[]) => routeState.setCommands(...args),
    removeScope: (...args: unknown[]) => routeState.removeScope(...args),
  }),
}));

vi.mock('@/lib/services/command-palette.service', () => ({
  getCommandPaletteService: () => ({
    close: (...args: unknown[]) => routeState.closePalette(...args),
    toggle: (...args: unknown[]) => routeState.togglePalette(...args),
  }),
}));

vi.mock('@/lib/services/command-palette.commands', () => ({
  createCoreNavigationCommands: () => [],
}));

vi.mock('@/ui/app/hooks/useTauriFullscreenShortcut', () => ({
  useTauriFullscreenShortcut: () => undefined,
}));

vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => routeState.isDesktop,
}));

vi.mock('@/ui/app/components/CommandPalette', () => ({
  CommandPalette: () => null,
}));

vi.mock('@/ui/app/components/DesktopSidebarAccountEntry', () => ({
  DesktopSidebarAccountEntry: () => null,
}));

vi.mock('@/ui/app/components/ProposalNotificationBadge', () => ({
  ProposalNotificationBadge: ({ placement = 'desktop' }: { placement?: string }) => (
    <div data-testid={`proposal-badge-${placement}`}>{placement}</div>
  ),
}));

vi.mock('@/ui/app/components/ProposalNotificationCoordinator', () => ({
  ProposalNotificationCoordinator: () => null,
}));

vi.mock('@/ui/app/components/ReminderNotifier', () => ({
  ReminderNotifier: () => null,
}));

vi.mock('@/ui/app/components/TimeblockEndAlertCoordinator', () => ({
  TimeblockEndAlertCoordinator: () => null,
}));

vi.mock('@/ui/components/UpdateToast', () => ({
  UpdateToast: () => null,
}));

vi.mock('@/ui/stores/reminder-ui-store', () => ({
  requestReminderCompose: vi.fn(),
}));

vi.mock('@/ui/app/pages/SettingsPage', () => ({
  SettingsPage: () => <div>mock-settings-page</div>,
}));

async function renderSettingsRoute() {
  window.history.replaceState({}, '', '/settings');
  const { appRouter } = await import('@/routes');
  const rendered = render(<RouterProvider router={appRouter} />);
  await screen.findByText('mock-settings-page');
  return rendered;
}

describe('routes proposal badge shells issue #677', () => {
  beforeEach(() => {
    vi.resetModules();
    routeState.isDesktop = false;
    routeState.desktopAdaptiveEnabled = true;
    routeState.setCommands.mockReset();
    routeState.removeScope.mockReset();
    routeState.closePalette.mockReset();
    routeState.togglePalette.mockReset();
    routeState.setSidebarCollapsed.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts proposal badge in desktop shell（桌面壳层挂载 proposal 角标）', async () => {
    routeState.isDesktop = true;
    routeState.desktopAdaptiveEnabled = true;

    await renderSettingsRoute();

    expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
    expect(screen.getAllByTestId('proposal-badge-desktop')).toHaveLength(1);
  });

  it('keeps proposal badge in mobile shell（移动壳层继续挂载 proposal 入口角标）', async () => {
    routeState.isDesktop = false;

    await renderSettingsRoute();

    expect(screen.getByTestId('mobile-bottom-tab')).toBeInTheDocument();
    expect(screen.getAllByTestId('proposal-badge-mobile-floating')).toHaveLength(1);
  });
});
