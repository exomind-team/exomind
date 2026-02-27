import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation, useParams } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Target, Settings, Bot, SquareCheckBig, UserRound, LayoutDashboard, Brain, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentPageEnabled, subscribeAgentPageEnabledChanges } from '@/config/agent-page-enabled';
import { getDesktopAdaptiveEnabled, subscribeDesktopAdaptiveChanges } from '@/config/desktop-adaptive';

const NewFocusPage = lazy(async () => {
  const module = await import('@/ui/new/pages/NewFocusPage');
  return { default: module.NewFocusPage };
});

const NewSettingsPage = lazy(async () => {
  const module = await import('@/ui/new/pages/NewSettingsPage');
  return { default: module.NewSettingsPage };
});

const NewTasksPage = lazy(async () => {
  const module = await import('@/ui/new/pages/NewTasksPage');
  return { default: module.NewTasksPage };
});

const NewTaskDetailPage = lazy(async () => {
  const module = await import('@/ui/new/pages/NewTaskDetailPage');
  return { default: module.NewTaskDetailPage };
});

const NewMePage = lazy(async () => {
  const module = await import('@/ui/new/pages/NewMePage');
  return { default: module.NewMePage };
});

const UserManagePage = lazy(async () => {
  const module = await import('@/ui/pages/UserManagePage');
  return { default: module.UserManagePage };
});

const MOSSASRTestPage = lazy(async () => {
  const module = await import('@/pages/MOSSASRTestPage');
  return { default: module.MOSSASRTestPage };
});

const AgentsPage = lazy(async () => {
  const module = await import('@/ui/new/pages/AgentsPage');
  return { default: module.AgentsPage };
});

const UpdatePage = lazy(async () => {
  const module = await import('@/ui/new/pages/UpdatePage');
  return { default: module.UpdatePage };
});

const AgentDetailPage = lazy(async () => {
  const module = await import('@/ui/new/pages/agents/AgentDetailPage');
  return { default: module.AgentDetailPage };
});

const ActorDetailPage = lazy(async () => {
  const module = await import('@/ui/new/pages/agents/ActorDetailPage');
  return { default: module.ActorDetailPage };
});

const AgentConversationPage = lazy(async () => {
  const module = await import('@/ui/new/pages/agents/AgentConversationPage');
  return { default: module.AgentConversationPage };
});

const AgentMarketPage = lazy(async () => {
  const module = await import('@/ui/new/pages/agents/AgentMarketPage');
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

type ShellNavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
};

function MobileShell({
  locationPath,
  navItems,
  desktopFrame = false,
}: {
  locationPath: string;
  navItems: ShellNavItem[];
  desktopFrame?: boolean;
}) {
  return (
    <div className={cn('min-h-[100dvh] bg-[#ECE6E1] dark:bg-[#0C0A09]', desktopFrame && 'p-6')}>
      <div
        className={cn(
          'relative mx-auto h-[100dvh] w-full max-w-[393px] overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]',
          desktopFrame && 'h-[852px] rounded-[40px] border border-[#E6DFD8] dark:border-[#292524] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]'
        )}
      >
        <main className="absolute inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] overflow-y-auto">
          <Outlet />
        </main>

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
                || (item.path === '/me' && locationPath.startsWith('/me'));
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
    { key: 'dashboard', title: '总览', path: '/dashboard', icon: LayoutDashboard, match: (path: string) => path === '/dashboard' },
    { key: 'now', title: '当下', path: '/eventlog', icon: Target, match: (path: string) => path === '/eventlog' || path === '/' },
    { key: 'tasks', title: '任务', path: '/tasks', icon: SquareCheckBig, match: (path: string) => path === '/tasks' || path.startsWith('/tasks/') },
    { key: 'agents', title: 'Agent', path: '/agents', icon: Bot, match: (path: string) => path === '/agents' || path.startsWith('/agents/') },
    { key: 'settings', title: '设置', path: '/settings', icon: Settings, match: (path: string) => path === '/settings' },
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
    <div className="min-h-[100dvh] bg-[#ECE6E1] p-6 dark:bg-[#0C0A09]">
      <div className="mx-auto flex h-[calc(100dvh-48px)] max-w-[1400px] overflow-hidden rounded-2xl border border-[hsl(var(--sidebar-border))] bg-[#FAF7F5] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)] dark:bg-[#0C0A09]">
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
  const isDesktop = useIsDesktop();

  const [agentPageEnabled, setAgentPageEnabled] = useState(() => getAgentPageEnabled());
  const [desktopAdaptiveEnabled, setDesktopAdaptiveEnabledState] = useState(() => getDesktopAdaptiveEnabled());

  useEffect(() => {
    return subscribeAgentPageEnabledChanges(setAgentPageEnabled);
  }, []);
  useEffect(() => {
    return subscribeDesktopAdaptiveChanges(setDesktopAdaptiveEnabledState);
  }, []);

  const navItems = [
    { title: '当下', path: '/eventlog', icon: Target },
    { title: '任务', path: '/tasks', icon: SquareCheckBig },
    { title: 'Me', path: '/me', icon: UserRound },
    ...(agentPageEnabled ? [{ title: 'Agent', path: '/agents', icon: Bot }] : []),
    { title: '设置', path: '/settings', icon: Settings },
  ];
  const isDesktopSettingsRoute = location.pathname === '/settings';

  if (isDesktop && desktopAdaptiveEnabled && isDesktopSettingsRoute) {
    return <DesktopLayout activePath={location.pathname} />;
  }

  return <MobileShell locationPath={location.pathname} navItems={navItems} desktopFrame={isDesktop} />;
}

const newRootRoute = createRootRoute({
  component: NewLayout,
});

const newHomeRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/',
  component: function NewHome() {
    return (
      <LazyPage>
        <NewFocusPage />
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
        <NewFocusPage />
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
        <NewFocusPage />
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
        <NewTasksPage />
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
        <NewTaskDetailPage />
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
        <NewMePage />
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
        <NewSettingsPage />
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
  newTaskDetailRoute,
  newMeRoute,
  newSettingsRoute,
  newUserManageRoute,
  newMossTestRoute,
  newAgentsRoute,
  newUpdateRoute,
  newAgentDetailRoute,
  newActorDetailRoute,
  newAgentConversationRoute,
  newAgentMarketRoute,
]);

const newUiRouter = createRouter({ routeTree: newRouteTree });

export { newUiRouter };
