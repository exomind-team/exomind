import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation, useNavigate, useParams, type ErrorComponentProps } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Target, Settings, Waypoints, Orbit, type LucideIcon } from 'lucide-react';
import { AlphaDesktopShellView, AlphaDesktopSidebarView, AlphaMobileShellView } from '@/ui/app/components/AlphaAppShellView';
import { getAgentPageEnabled, subscribeAgentPageEnabledChanges } from '@/config/agent-page-enabled';
import { getGoalsPageEnabled, subscribeGoalsPageEnabledChanges } from '@/config/goals-page-enabled';
import { getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges } from '@/config/desktop-adaptive';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { getCommandPaletteEnabled, subscribeCommandPaletteEnabledChanges } from '@/config/command-palette-enabled';
import {
  getDesktopSidebarCollapsed as getPersistedDesktopSidebarCollapsed,
  setDesktopSidebarCollapsed as setPersistedDesktopSidebarCollapsed,
} from '@/config/desktop-sidebar-preferences';
import { getCommandRegistryService } from '@/lib/services/command-registry.service';
import { getCommandPaletteService } from '@/lib/services/command-palette.service';
import { createCoreNavigationCommands, type CoreNavigationPath } from '@/lib/services/command-palette.commands';
import { useTauriFullscreenShortcut } from '@/ui/app/hooks/useTauriFullscreenShortcut';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { CommandPalette } from '@/ui/app/components/CommandPalette';
import { DesktopSidebarAccountEntry } from '@/ui/app/components/DesktopSidebarAccountEntry';
import { ReminderNotifier } from '@/ui/app/components/ReminderNotifier';
import { TimeblockEndAlertCoordinator } from '@/ui/app/components/TimeblockEndAlertCoordinator';
import { UpdateToast } from '@/ui/components/UpdateToast';
import { requestReminderCompose } from '@/ui/stores/reminder-ui-store';
import type { CommandContext } from '@/lib/types/command-palette';
import {
  getEventlogPathForTab,
  resolveEventlogRestoreTab,
  resolveLegacyEventlogTabSearch,
} from '@/ui/app/pages/eventlog-route-memory';

const FocusPage = lazy(async () => {
  const module = await import('@/ui/app/pages/FocusPage');
  return { default: module.FocusPage };
});

const SettingsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/SettingsPage');
  return { default: module.SettingsPage };
});


const RemindersPage = lazy(async () => {
  const module = await import('@/ui/app/pages/RemindersPage');
  return { default: module.RemindersPage };
});

const TimeBlockDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/TimeBlockDetailPage');
  return { default: module.TimeBlockDetailPage };
});

const UserManagePage = lazy(async () => {
  const module = await import('@/ui/pages/UserManagePage');
  return { default: module.UserManagePage };
});

const AgentsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/AgentsPage');
  return { default: module.AgentsPage };
});

const GoalsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/goals/GoalsPage');
  return { default: module.GoalsPage };
});

const UpdatePage = lazy(async () => {
  const module = await import('@/ui/app/pages/UpdatePage');
  return { default: module.UpdatePage };
});

const ActorDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/ActorDetailPage');
  return { default: module.ActorDetailPage };
});

const SignalDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/SignalDetailPage');
  return { default: module.SignalDetailPage };
});

function PageFallback() {
  return (
    <div className="px-6 py-6 text-sm text-[#A8A29E] dark:text-[#78716C]">
      页面加载中...
    </div>
  );
}

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function resolveRuntimePlatform(): 'web' | 'tauri' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  return '__TAURI_INTERNALS__' in window ? 'tauri' : 'web';
}

type ShellNavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
};

function isMobileFullscreenRoute(pathname: string): boolean {
  return pathname.startsWith('/agents/actor/');
}

function MobileShell({
  locationPath, navItems, desktopFrame = false, commandPaletteActive = false, commandContext,
}: { locationPath: string; navItems: ShellNavItem[]; desktopFrame?: boolean;
  commandPaletteActive?: boolean; commandContext?: CommandContext;
}) {
  const previewFrame = desktopFrame && resolveRuntimePlatform() !== 'tauri';
  const fullscreenRoute = isMobileFullscreenRoute(locationPath);
  const items = navItems.map(item => ({ ...item, key: item.path, active: locationPath === item.path
    || (item.path === '/eventlog' && locationPath.startsWith('/eventlog'))
    || (item.path === '/goals' && locationPath.startsWith('/goals'))
    || (item.path === '/agents' && locationPath.startsWith('/agents'))
    || (item.path === '/settings' && locationPath.startsWith('/settings')) }));
  return <AlphaMobileShellView items={items} previewFrame={previewFrame} fullscreen={fullscreenRoute}
    commandPalette={commandPaletteActive && commandContext ? <CommandPalette context={commandContext}/> : null}
    renderNavigationItem={(item, view) => <Link to={item.path} className={view.className}>{view.children}</Link>}>
    <Outlet/>
  </AlphaMobileShellView>;
}

function DesktopSidebar({
  activePath,
  agentPageEnabled,
  goalsPageEnabled,
  collapsed,
  onToggleCollapsed,
}: {
  activePath: string;
  agentPageEnabled: boolean;
  goalsPageEnabled: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const desktopNavItems = [
    { key: 'now', title: '当下', path: '/eventlog', icon: Target, match: (path: string) => path === '/' || path.startsWith('/eventlog') },
    ...(goalsPageEnabled ? [{
      key: 'goals',
      title: '目标',
      path: '/goals',
      icon: Orbit,
      match: (path: string) => path === '/goals' || path.startsWith('/goals/'),
    }] : []),
    ...(agentPageEnabled ? [{
      key: 'agents',
      title: '网络',
      path: '/agents',
      icon: Waypoints,
      match: (path: string) => path === '/agents' || path.startsWith('/agents/'),
    }] : []),
    { key: 'settings', title: '设置', path: '/settings', icon: Settings, match: (path: string) => path === '/settings' || path.startsWith('/settings/') },
  ];

  const items = desktopNavItems.map(item => ({ ...item, active: item.match(activePath) }));
  return <AlphaDesktopSidebarView items={items} collapsed={collapsed} onToggleCollapsed={onToggleCollapsed}
    footer={<DesktopSidebarAccountEntry collapsed={collapsed}/>}
    renderNavigationItem={(item, view) => <Link to={item.path} data-testid={view.testId}
      aria-label={item.title} title={item.title} className={view.className}>{view.children}</Link>}/>;
}

function DesktopLayout({
  activePath,
  agentPageEnabled,
  goalsPageEnabled,
  collapsed,
  onToggleCollapsed,
}: {
  activePath: string;
  agentPageEnabled: boolean;
  goalsPageEnabled: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return <AlphaDesktopShellView sidebar={<DesktopSidebar activePath={activePath}
    agentPageEnabled={agentPageEnabled} goalsPageEnabled={goalsPageEnabled}
    collapsed={collapsed} onToggleCollapsed={onToggleCollapsed}/>}>
    <Outlet/>
  </AlphaDesktopShellView>;
}

function GoalsRouteGate() {
  const navigate = useNavigate();
  const [goalsPageEnabled, setGoalsPageEnabled] = useState(() => getGoalsPageEnabled());

  useEffect(() => {
    return subscribeGoalsPageEnabledChanges(setGoalsPageEnabled);
  }, []);

  useEffect(() => {
    if (!goalsPageEnabled) {
      void navigate({ to: '/settings', replace: true });
    }
  }, [goalsPageEnabled, navigate]);

  if (!goalsPageEnabled) {
    return <PageFallback />;
  }

  return (
    <LazyPage>
      <GoalsPage />
    </LazyPage>
  );
}

function NewLayout() {
  const location = useLocation();
  useTauriFullscreenShortcut();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const [agentPageEnabled, setAgentPageEnabled] = useState(() => getAgentPageEnabled());
  const [goalsPageEnabled, setGoalsPageEnabled] = useState(() => getGoalsPageEnabled());
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => getPersistedDesktopSidebarCollapsed());
  const [desktopAdaptiveEnabled, setDesktopAdaptiveEnabledState] = useState(() => getDesktopAdaptiveEnabled());
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(() => getDeveloperModeEnabled());
  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => getCommandPaletteEnabled());
  const commandPaletteActive = developerModeEnabled && commandPaletteEnabled;
  const registryService = useMemo(() => getCommandRegistryService(), []);
  const paletteService = useMemo(() => getCommandPaletteService(), []);

  useEffect(() => {
    return subscribeAgentPageEnabledChanges(setAgentPageEnabled);
  }, []);
  useEffect(() => {
    return subscribeGoalsPageEnabledChanges(setGoalsPageEnabled);
  }, []);
  useEffect(() => {
    return subscribeDesktopAdaptiveChanges(setDesktopAdaptiveEnabledState);
  }, []);
  useEffect(() => {
    return subscribeDeveloperModeChanges(setDeveloperModeEnabled);
  }, []);
  useEffect(() => {
    return subscribeCommandPaletteEnabledChanges(setCommandPaletteEnabled);
  }, []);
  useEffect(() => {
    setPersistedDesktopSidebarCollapsed(desktopSidebarCollapsed);
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    const navigateTo = async (path: CoreNavigationPath) => {
      await navigate({ to: path });
    };

    registryService.setCommands('core-navigation', createCoreNavigationCommands({
      navigate: navigateTo,
      openReminderComposer: requestReminderCompose,
    }));

    return () => {
      registryService.removeScope('core-navigation');
    };
  }, [navigate, registryService]);

  useEffect(() => {
    if (!commandPaletteActive) {
      paletteService.close();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      paletteService.toggle();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [commandPaletteActive, paletteService]);

  const commandContext = useMemo<CommandContext>(() => ({
    currentPath: location.pathname,
    platform: resolveRuntimePlatform(),
    developerModeEnabled,
    commandPaletteEnabled: commandPaletteActive,
    featureFlags: {
      agentPageEnabled,
      goalsV2Enabled: false,
    },
  }), [agentPageEnabled, commandPaletteActive, developerModeEnabled, location.pathname]);

  const navItems = [
    { title: '当下', path: '/eventlog', icon: Target },
    ...(goalsPageEnabled ? [{ title: '目标', path: '/goals', icon: Orbit }] : []),
    ...(agentPageEnabled ? [{ title: '网络', path: '/agents', icon: Waypoints }] : []),
    { title: '设置', path: '/settings', icon: Settings },
  ];
  const selectedShell = isDesktop && desktopAdaptiveEnabled ? 'desktop' : 'mobile';

  if (selectedShell === 'desktop') {
    return (
      <>
        <DesktopLayout
          activePath={location.pathname}
          agentPageEnabled={agentPageEnabled}
          goalsPageEnabled={goalsPageEnabled}
          collapsed={desktopSidebarCollapsed}
          onToggleCollapsed={() => setDesktopSidebarCollapsed((current) => !current)}
        />
        {commandPaletteActive ? <CommandPalette context={commandContext} /> : null}
        <TimeblockEndAlertCoordinator />
        <ReminderNotifier />
        <UpdateToast />
      </>
    );
  }

  return (
    <>
      <MobileShell
        locationPath={location.pathname}
        navItems={navItems}
        desktopFrame={isDesktop}
        commandPaletteActive={commandPaletteActive}
        commandContext={commandContext}
      />
      <TimeblockEndAlertCoordinator />
      <ReminderNotifier />
      <UpdateToast />
    </>
  );
}

function RootRouteError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  const dynamicImportFailed = message.includes('Failed to fetch dynamically imported module');

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#FAF7F5] px-6 py-8 dark:bg-[#0C0A09]">
      <div className="w-full max-w-md rounded-2xl border border-[#E7E5E4] bg-white p-5 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
        <h2 className="text-base font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
          页面加载失败（Page Load Failed）
        </h2>
        <p className="mt-2 text-sm text-[#78716C] dark:text-[#A8A29E]">
          {dynamicImportFailed
            ? '动态模块加载失败，请刷新页面或重启开发服务器。'
            : message}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-[#C75B3A] px-3 py-1.5 text-sm font-medium text-white"
          >
            重试（Retry）
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-[#F5F0ED] px-3 py-1.5 text-sm font-medium text-[#44403C] dark:bg-[#292524] dark:text-[#D6D3D1]"
          >
            刷新（Reload）
          </button>
        </div>
      </div>
    </div>
  );
}

const newRootRoute = createRootRoute({
  component: NewLayout,
  errorComponent: RootRouteError,
});

const newHomeRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/',
  component: function NewHome() {
    const navigate = useNavigate();
    useEffect(() => {
      navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const newDashboardRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/dashboard',
  component: function NewDashboard() {
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const newEventlogRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/eventlog',
  component: function NewEventlog() {
    const navigate = useNavigate();

    useEffect(() => {
      const currentSearch = typeof window !== 'undefined' ? window.location.search : '';
      const legacyTab = resolveLegacyEventlogTabSearch(currentSearch);
      if (legacyTab && legacyTab !== 'focus') {
        void navigate({
          to: getEventlogPathForTab(legacyTab),
          replace: true,
        });
        return;
      }

      const restoreTab = resolveEventlogRestoreTab(currentSearch);
      if (!restoreTab) {
        return;
      }

      void navigate({
        to: getEventlogPathForTab(restoreTab),
        replace: true,
      });
    }, [navigate]);

    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const newEventlogRecordRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/eventlog/record',
  component: function NewEventlogRecord() {
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const newEventlogTodayRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/eventlog/today',
  component: function NewEventlogToday() {
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const newEventlogTimeblockDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/eventlog/timeblocks/$blockId',
  component: function NewEventlogTimeblockDetail() {
    return (
      <LazyPage>
        <TimeBlockDetailPage />
      </LazyPage>
    );
  },
});

const removedTasksRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks',
  component: function RemovedTasks() {
    const navigate = useNavigate();
    useEffect(() => {
      void navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const removedTaskSubroute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks/$legacyTaskId',
  component: function RemovedTaskSubroute() {
    const navigate = useNavigate();
    useEffect(() => {
      void navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const removedTaskTimeblockRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks/block/$legacyBlockId',
  component: function RemovedTaskTimeblock() {
    const navigate = useNavigate();
    useEffect(() => {
      void navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const removedProposalsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/proposals',
  component: function RemovedProposals() {
    const navigate = useNavigate();
    useEffect(() => {
      void navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const removedProposalSubroute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/proposals/$legacyProposalId',
  component: function RemovedProposalSubroute() {
    const navigate = useNavigate();
    useEffect(() => {
      void navigate({ to: '/eventlog', replace: true });
    }, [navigate]);
    return null;
  },
});

const newRemindersRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/reminders',
  component: function NewReminders() {
    return (
      <LazyPage>
        <RemindersPage />
      </LazyPage>
    );
  },
});

const newGoalsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/goals',
  component: function NewGoals() {
    return <GoalsRouteGate />;
  },
});

const newSettingsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/settings',
  component: function NewSettings() {
    return (
      <LazyPage>
        <SettingsPage />
      </LazyPage>
    );
  },
});

const newUserManageRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/user-manage',
  component: function NewUserManage() {
    return (
      <LazyPage>
        <UserManagePage />
      </LazyPage>
    );
  },
});

const newAgentsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents',
  component: function NewAgents() {
    return (
      <LazyPage>
        <AgentsPage />
      </LazyPage>
    );
  },
});

const newUpdateRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/update',
  component: function NewUpdate() {
    return (
      <LazyPage>
        <UpdatePage />
      </LazyPage>
    );
  },
});

function RemovedAgentManagementPage() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: '/agents', replace: true });
  }, [navigate]);
  return null;
}

const removedAgentDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/agent/$agentId',
  component: RemovedAgentManagementPage,
});

const newActorDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/actor/$actorId',
  component: function NewActorDetail() {
    const { actorId } = useParams({ strict: false }) as { actorId?: string };
    return (
      <LazyPage>
        <ActorDetailPage actorId={actorId} />
      </LazyPage>
    );
  },
});

const newSignalDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/signal/$signalId',
  component: function NewSignalDetail() {
    return (
      <LazyPage>
        <SignalDetailPage />
      </LazyPage>
    );
  },
});

const removedAgentConversationRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/chat/$agentId',
  component: RemovedAgentManagementPage,
});

const removedPtyTerminalRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/pty/$legacyPtyId',
  component: RemovedAgentManagementPage,
});

const removedAgentMarketRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/market',
  component: RemovedAgentManagementPage,
});

const newRouteTree = newRootRoute.addChildren([
  newHomeRoute,
  newDashboardRoute,
  newEventlogRoute,
  newEventlogRecordRoute,
  newEventlogTodayRoute,
  newEventlogTimeblockDetailRoute,
  removedTasksRoute,
  removedTaskSubroute,
  removedTaskTimeblockRoute,
  removedProposalsRoute,
  removedProposalSubroute,
  newRemindersRoute,
  newGoalsRoute,
  newSettingsRoute,
  newUserManageRoute,
  newAgentsRoute,
  newUpdateRoute,
  removedAgentDetailRoute,
  newActorDetailRoute,
  newSignalDetailRoute,
  removedAgentConversationRoute,
  removedPtyTerminalRoute,
  removedAgentMarketRoute,
]);

const appRouter = createRouter({ routeTree: newRouteTree });

export { appRouter };
