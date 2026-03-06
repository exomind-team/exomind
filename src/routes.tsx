import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation, useNavigate, useParams, type ErrorComponentProps } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Target, Settings, Waypoints, SquareCheckBig, UserRound, Brain, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentPageEnabled, subscribeAgentPageEnabledChanges } from '@/config/agent-page-enabled';
import { getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges } from '@/config/desktop-adaptive';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { getCommandPaletteEnabled, subscribeCommandPaletteEnabledChanges } from '@/config/command-palette-enabled';
import { getCommandRegistryService } from '@/lib/services/command-registry.service';
import { getCommandPaletteService } from '@/lib/services/command-palette.service';
import { createCoreNavigationCommands, type CoreNavigationPath } from '@/lib/services/command-palette.commands';
import { CommandPalette } from '@/ui/app/components/CommandPalette';
import { ReminderNotifier } from '@/ui/app/components/ReminderNotifier';
import { requestReminderCompose } from '@/ui/stores/reminder-ui-store';
import type { CommandContext } from '@/lib/types/command-palette';

const FocusPage = lazy(async () => {
  const module = await import('@/ui/app/pages/FocusPage');
  return { default: module.FocusPage };
});

const SettingsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/SettingsPage');
  return { default: module.SettingsPage };
});

const LegalSupportPage = lazy(async () => {
  const module = await import('@/ui/app/pages/LegalSupportPage');
  return { default: module.LegalSupportPage };
});

const TasksPage = lazy(async () => {
  const module = await import('@/ui/app/pages/TasksPage');
  return { default: module.TasksPage };
});

const RemindersPage = lazy(async () => {
  const module = await import('@/ui/app/pages/RemindersPage');
  return { default: module.RemindersPage };
});

const TaskDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/TaskDetailPage');
  return { default: module.TaskDetailPage };
});

const MePage = lazy(async () => {
  const module = await import('@/ui/app/pages/MePage');
  return { default: module.MePage };
});

const UserManagePage = lazy(async () => {
  const module = await import('@/ui/pages/UserManagePage');
  return { default: module.UserManagePage };
});

const SyncTestPage = lazy(async () => {
  const module = await import('@/ui/pages/SyncTestPage');
  return { default: module.SyncTestPage };
});

const MOSSASRTestPage = lazy(async () => {
  const module = await import('@/pages/MOSSASRTestPage');
  return { default: module.MOSSASRTestPage };
});

const AgentsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/AgentsPage');
  return { default: module.AgentsPage };
});

const UpdatePage = lazy(async () => {
  const module = await import('@/ui/app/pages/UpdatePage');
  return { default: module.UpdatePage };
});

const AgentDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/AgentDetailPage');
  return { default: module.AgentDetailPage };
});

const ActorDetailPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/ActorDetailPage');
  return { default: module.ActorDetailPage };
});

const AgentConversationPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/AgentConversationPage');
  return { default: module.AgentConversationPage };
});

const AgentMarketPage = lazy(async () => {
  const module = await import('@/ui/app/pages/agents/AgentMarketPage');
  return { default: module.AgentMarketPage };
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

function useIsDesktop(minWidth = 768): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQueryList = window.matchMedia(`(min-width: ${minWidth}px)`);
    const onChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', onChange);
    return () => {
      mediaQueryList.removeEventListener('change', onChange);
    };
  }, [minWidth]);

  return isDesktop;
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

function MobileShell({
  locationPath,
  navItems,
  desktopFrame = false,
  commandPaletteActive = false,
  commandContext,
}: {
  locationPath: string;
  navItems: ShellNavItem[];
  desktopFrame?: boolean;
  commandPaletteActive?: boolean;
  commandContext?: CommandContext;
}) {
  const previewFrame = desktopFrame && resolveRuntimePlatform() !== 'tauri';

  return (
    <div className={cn('min-h-[100dvh] bg-[#ECE6E1] dark:bg-[#0C0A09]', previewFrame && 'p-6')}>
      <div
        className={cn(
          'relative h-[100dvh] w-full overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]',
          previewFrame && 'mx-auto max-w-[393px] h-[852px] rounded-[40px] border border-[#E6DFD8] dark:border-[#292524] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]'
        )}
      >
        <main className={cn("absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] overflow-y-auto", previewFrame ? "top-0" : "top-[env(safe-area-inset-top,0px)]")}>
          <Outlet />
        </main>

        {commandPaletteActive && commandContext ? (
          <CommandPalette context={commandContext} />
        ) : null}

        <nav
          data-testid="mobile-bottom-tab"
          className="absolute inset-x-0 bottom-0 z-40 border-t border-[#E4DED7] dark:border-[#292524] bg-[#FAF7F5]/95 dark:bg-[#0C0A09]/95 backdrop-blur"
        >
          <div className="flex items-center px-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = locationPath === item.path
                || (item.path === '/eventlog' && locationPath === '/')
                || (item.path === '/tasks' && locationPath.startsWith('/tasks'))
                || (item.path === '/me' && locationPath.startsWith('/me'))
                || (item.path === '/settings' && locationPath.startsWith('/settings'));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex flex-1 min-w-0 flex-col items-center gap-1 rounded-xl py-1 text-[11px] transition-colors',
                    active ? 'text-[#C75B3A] dark:text-[#E8734E] font-semibold' : 'text-stone-400 dark:text-[#57534E]'
                  )}
                >
                  <Icon size={20} />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

function DesktopSidebar({ activePath }: { activePath: string }) {
  const desktopNavItems = [
    { key: 'now', title: '当下', path: '/eventlog', icon: Target, match: (path: string) => path === '/eventlog' || path === '/' },
    { key: 'tasks', title: '任务', path: '/tasks', icon: SquareCheckBig, match: (path: string) => path === '/tasks' || path.startsWith('/tasks/') },
    { key: 'agents', title: '网络', path: '/agents', icon: Waypoints, match: (path: string) => path === '/agents' || path.startsWith('/agents/') },
    { key: 'settings', title: '设置', path: '/settings', icon: Settings, match: (path: string) => path === '/settings' || path.startsWith('/settings/') },
  ];

  return (
    <aside
      data-testid="desktop-sidebar"
      className="flex h-full w-64 shrink-0 flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))]"
    >
      <div className="border-b border-[hsl(var(--sidebar-border))] p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))]">
            <Brain size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">ExoMind</p>
            <p className="truncate text-xs text-[hsl(var(--sidebar-muted))]">外心</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {desktopNavItems.map((item) => {
          const Icon = item.icon;
          const active = item.match(activePath);
          const itemClassName = cn(
            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            active
              ? 'bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-accent-foreground))] font-medium'
              : 'text-[hsl(var(--sidebar-foreground))]'
          );
          return (
            <Link
              key={item.path}
              to={item.path}
              data-testid={`desktop-sidebar-item-${item.key}`}
              className={itemClassName}
            >
              <Icon size={16} />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[hsl(var(--sidebar-border))] p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-accent))] text-xs font-semibold text-[hsl(var(--sidebar-accent-foreground))]">
            S
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Starlin</p>
            <p className="truncate text-xs text-[hsl(var(--sidebar-muted))]">starlin@exomind.ai</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function DesktopLayout({ activePath }: { activePath: string }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]">
      <div className="flex h-full w-full overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]">
        <DesktopSidebar activePath={activePath} />
        <main data-testid="desktop-settings-content" className="min-w-0 flex-1 overflow-y-auto bg-[#FAF7F5] dark:bg-[#0C0A09]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NewLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const [agentPageEnabled, setAgentPageEnabled] = useState(() => getAgentPageEnabled());
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
    return subscribeDesktopAdaptiveChanges(setDesktopAdaptiveEnabledState);
  }, []);
  useEffect(() => {
    return subscribeDeveloperModeChanges(setDeveloperModeEnabled);
  }, []);
  useEffect(() => {
    return subscribeCommandPaletteEnabledChanges(setCommandPaletteEnabled);
  }, []);

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
    { title: '任务', path: '/tasks', icon: SquareCheckBig },
    { title: 'Me', path: '/me', icon: UserRound },
    ...(agentPageEnabled ? [{ title: '网络', path: '/agents', icon: Waypoints }] : []),
    { title: '设置', path: '/settings', icon: Settings },
  ];
  const isDesktopAdaptiveRoute =
    // primary app routes（主应用路由）：desktop shell（桌面壳层）启用范围
    location.pathname === '/'
    || location.pathname === '/eventlog'
    || location.pathname === '/dashboard'
    || location.pathname === '/tasks'
    || location.pathname.startsWith('/tasks/')
    || location.pathname === '/reminders'
    || location.pathname === '/me'
    || location.pathname === '/update'
    || location.pathname === '/settings'
    || location.pathname.startsWith('/settings/')
    || location.pathname === '/agents'
    || location.pathname.startsWith('/agents/');

  if (isDesktop && desktopAdaptiveEnabled && isDesktopAdaptiveRoute) {
    return (
      <>
        <DesktopLayout activePath={location.pathname} />
        {commandPaletteActive ? <CommandPalette context={commandContext} /> : null}
        <ReminderNotifier />
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
      <ReminderNotifier />
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
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
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
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const newTasksRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks',
  component: function NewTasks() {
    return (
      <LazyPage>
        <TasksPage />
      </LazyPage>
    );
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

const newTaskDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks/$taskId',
  component: function NewTaskDetail() {
    return (
      <LazyPage>
        <TaskDetailPage />
      </LazyPage>
    );
  },
});

const newTimeblockDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/tasks/block/$blockId',
  component: function NewTimeblockDetail() {
    return (
      <LazyPage>
        <TaskDetailPage />
      </LazyPage>
    );
  },
});

const newMeRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/me',
  component: function NewMe() {
    return (
      <LazyPage>
        <MePage />
      </LazyPage>
    );
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

const newLegalSupportRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/settings/legal-support',
  component: function NewLegalSupport() {
    return (
      <LazyPage>
        <LegalSupportPage />
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

const newMossTestRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/moss-test',
  component: function NewMossTest() {
    return (
      <LazyPage>
        <MOSSASRTestPage />
      </LazyPage>
    );
  },
});

const newSyncTestRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/sync-test',
  component: function NewSyncTest() {
    return (
      <LazyPage>
        <SyncTestPage />
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

const newAgentDetailRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/agent/$agentId',
  component: function NewAgentDetail() {
    const { agentId } = useParams({ strict: false }) as { agentId?: string };
    return (
      <LazyPage>
        <AgentDetailPage agentId={agentId} />
      </LazyPage>
    );
  },
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

const newAgentConversationRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/chat/$agentId',
  component: function NewAgentConversation() {
    const { agentId } = useParams({ strict: false }) as { agentId?: string };
    return (
      <LazyPage>
        <AgentConversationPage agentId={agentId} />
      </LazyPage>
    );
  },
});

const newAgentMarketRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/agents/market',
  component: function NewAgentMarket() {
    return (
      <LazyPage>
        <AgentMarketPage />
      </LazyPage>
    );
  },
});

const newRouteTree = newRootRoute.addChildren([
  newHomeRoute,
  newDashboardRoute,
  newEventlogRoute,
  newTasksRoute,
  newRemindersRoute,
  newTimeblockDetailRoute,
  newTaskDetailRoute,
  newMeRoute,
  newSettingsRoute,
  newLegalSupportRoute,
  newUserManageRoute,
  newMossTestRoute,
  newSyncTestRoute,
  newAgentsRoute,
  newUpdateRoute,
  newAgentDetailRoute,
  newActorDetailRoute,
  newAgentConversationRoute,
  newAgentMarketRoute,
]);

const appRouter = createRouter({ routeTree: newRouteTree });

export { appRouter };

