import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';

const routeState = vi.hoisted(() => ({
  isDesktop: true,
  legacyPageMounted: vi.fn(),
}));

vi.mock('@/config/agent-page-enabled', () => ({
  getAgentPageEnabled: () => true,
  subscribeAgentPageEnabledChanges: () => () => {},
}));
vi.mock('@/config/goals-page-enabled', () => ({
  getGoalsPageEnabled: () => false,
  subscribeGoalsPageEnabledChanges: () => () => {},
}));
vi.mock('@/config/desktop-adaptive', () => ({
  getDesktopAdaptiveEnabled: () => true,
  subscribeDesktopAdaptiveChanges: () => () => {},
}));
vi.mock('@/config/developer-mode', () => ({
  getDeveloperModeEnabled: () => true,
  subscribeDeveloperModeChanges: () => () => {},
}));
vi.mock('@/config/command-palette-enabled', () => ({
  getCommandPaletteEnabled: () => false,
  subscribeCommandPaletteEnabledChanges: () => () => {},
}));
vi.mock('@/lib/services/command-registry.service', () => ({
  getCommandRegistryService: () => ({ setCommands: vi.fn(), removeScope: vi.fn() }),
}));
vi.mock('@/lib/services/command-palette.service', () => ({
  getCommandPaletteService: () => ({ close: vi.fn(), toggle: vi.fn() }),
}));
vi.mock('@/ui/app/hooks/useTauriFullscreenShortcut', () => ({
  useTauriFullscreenShortcut: () => undefined,
}));
vi.mock('@/ui/app/hooks/useIsDesktop', () => ({
  useIsDesktop: () => routeState.isDesktop,
}));
vi.mock('@/ui/app/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/ui/app/components/DesktopSidebarAccountEntry', () => ({ DesktopSidebarAccountEntry: () => null }));
vi.mock('@/ui/app/components/ReminderNotifier', () => ({ ReminderNotifier: () => null }));
vi.mock('@/ui/app/components/TimeblockEndAlertCoordinator', () => ({ TimeblockEndAlertCoordinator: () => null }));
vi.mock('@/ui/components/UpdateToast', () => ({ UpdateToast: () => null }));
vi.mock('@/ui/app/pages/SettingsPage', () => ({
  SettingsPage: () => React.createElement('div', { 'data-testid': 'settings-page' }),
}));
vi.mock('@/ui/app/pages/FocusPage', () => ({
  FocusPage: () => React.createElement('div', { 'data-testid': 'focus-page' }),
}));
vi.mock('@/ui/app/pages/AgentsPage', () => ({
  AgentsPage: () => React.createElement('div', { 'data-testid': 'network-page' }),
}));
vi.mock('@/ui/app/pages/TimeBlockDetailPage', () => ({
  TimeBlockDetailPage: () => React.createElement('div', { 'data-testid': 'timeblock-page' }),
}));
vi.mock('@/ui/app/pages/agents/ActorDetailPage', () => ({
  ActorDetailPage: () => React.createElement('div', { 'data-testid': 'actor-page' }),
}));
vi.mock('@/ui/app/pages/agents/SignalDetailPage', () => ({
  SignalDetailPage: () => React.createElement('div', { 'data-testid': 'signal-page' }),
}));
vi.mock('@/ui/app/pages/TasksPage', () => ({ TasksPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/TaskDetailPage', () => ({ TaskDetailPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/proposals/ProposalInboxPage', () => ({ ProposalInboxPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/agents/AgentDetailPage', () => ({ AgentDetailPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/agents/AgentConversationPage', () => ({ AgentConversationPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/agents/AgentMarketPage', () => ({ AgentMarketPage: routeState.legacyPageMounted }));
vi.mock('@/ui/app/pages/agents/PtyTerminalPage', () => ({ PtyTerminalPage: routeState.legacyPageMounted }));

async function renderRoute(path: string) {
  window.history.replaceState({}, '', path);
  const { appRouter } = await import('@/routes');
  const router = createRouter({
    routeTree: appRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(React.createElement(RouterProvider, { router }));
  return router;
}

describe('Alpha task and agent management routing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    routeState.isDesktop = true;
    routeState.legacyPageMounted.mockClear();
  });
  afterEach(cleanup);

  it.each([false, true])('removes task/proposal navigation with desktop=%s', async (isDesktop) => {
    routeState.isDesktop = isDesktop;
    await renderRoute('/settings');
    await screen.findByTestId('settings-page');
    expect(screen.getByRole('link', { name: '当下' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '网络' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /任务|提案/ })).not.toBeInTheDocument();
  });

  it.each([
    '/tasks', '/tasks/synthetic-task', '/tasks/timeline', '/tasks/dag',
    '/tasks/timeblocks', '/tasks/block/synthetic-block',
    '/proposals', '/proposals/synthetic-proposal',
  ])('redirects %s to 当下 without mounting the legacy page', async (path) => {
    const router = await renderRoute(path);
    await screen.findByTestId('focus-page');
    await waitFor(() => expect(router.state.location.pathname).toBe('/eventlog'));
    expect(routeState.legacyPageMounted).not.toHaveBeenCalled();
  });

  it.each([
    '/agents/agent/synthetic-agent', '/agents/chat/synthetic-agent',
    '/agents/market', '/agents/pty/synthetic-pty',
  ])('redirects %s to the network without mounting management', async (path) => {
    const router = await renderRoute(path);
    await screen.findByTestId('network-page');
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents'));
    expect(routeState.legacyPageMounted).not.toHaveBeenCalled();
  });

  it.each([
    ['/eventlog/timeblocks/synthetic-block', 'timeblock-page'],
    ['/agents/actor/synthetic-actor', 'actor-page'],
    ['/agents/signal/synthetic-signal', 'signal-page'],
  ])('preserves the retained route %s', async (path, testId) => {
    const router = await renderRoute(path);
    await screen.findByTestId(testId);
    expect(router.state.location.pathname).toBe(path);
  });
});
