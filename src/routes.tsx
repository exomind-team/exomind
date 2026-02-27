import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation, useNavigate, useParams } from '@tanstack/react-router';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Target, Settings, Bot, SquareCheckBig, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentPageEnabled, subscribeAgentPageEnabledChanges } from '@/config/agent-page-enabled';
import { getDeveloperModeEnabled, subscribeDeveloperModeChanges } from '@/config/developer-mode';
import { getCommandPaletteEnabled, subscribeCommandPaletteEnabledChanges } from '@/config/command-palette-enabled';
import { getCommandRegistryService } from '@/lib/services/command-registry.service';
import { getCommandPaletteService } from '@/lib/services/command-palette.service';
import { createCoreNavigationCommands, type CoreNavigationPath } from '@/lib/services/command-palette.commands';
import { CommandPalette } from '@/ui/app/components/CommandPalette';

const FocusPage = lazy(async () => {
  const module = await import('@/ui/app/pages/FocusPage');
  return { default: module.FocusPage };
});

const SettingsPage = lazy(async () => {
  const module = await import('@/ui/app/pages/SettingsPage');
  return { default: module.SettingsPage };
});

const TasksPage = lazy(async () => {
  const module = await import('@/ui/app/pages/TasksPage');
  return { default: module.TasksPage };
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

function resolveRuntimePlatform(): 'web' | 'tauri' | 'unknown' {
  if (typeof window === 'undefined') return 'unknown';
  return '__TAURI_INTERNALS__' in window ? 'tauri' : 'web';
}

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [agentPageEnabled, setAgentPageEnabled] = useState(() => getAgentPageEnabled());
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(() => getDeveloperModeEnabled());
  const [commandPaletteEnabled, setCommandPaletteEnabled] = useState(() => getCommandPaletteEnabled());
  const commandPaletteActive = developerModeEnabled && commandPaletteEnabled;
  const registryService = useMemo(() => getCommandRegistryService(), []);
  const paletteService = useMemo(() => getCommandPaletteService(), []);

  useEffect(() => {
    return subscribeAgentPageEnabledChanges(setAgentPageEnabled);
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

  const commandContext = useMemo(() => ({
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
    ...(agentPageEnabled ? [{ title: 'Agent', path: '/agents', icon: Bot }] : []),
    { title: '设置', path: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#ECE6E1] dark:bg-[#0C0A09] md:p-6">
      <div className="relative mx-auto h-[100dvh] w-full max-w-[393px] overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09] md:h-[852px] md:rounded-[40px] md:border md:border-[#E6DFD8] md:dark:border-[#292524] md:shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]">
        <main className="absolute inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] overflow-y-auto">
          <Outlet />
        </main>

        {commandPaletteActive ? (
          <CommandPalette context={commandContext} />
        ) : null}

        <nav className="absolute inset-x-0 bottom-0 z-40 border-t border-[#E4DED7] dark:border-[#292524] bg-[#FAF7F5]/95 dark:bg-[#0C0A09]/95 backdrop-blur">
          <div className="flex items-center px-2 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path
                || (item.path === '/eventlog' && location.pathname === '/')
                || (item.path === '/tasks' && location.pathname.startsWith('/tasks'))
                || (item.path === '/me' && location.pathname.startsWith('/me'));
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

const rootRoute = createRootRoute({
  component: AppLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Home() {
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const eventlogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/eventlog',
  component: function Eventlog() {
    return (
      <LazyPage>
        <FocusPage />
      </LazyPage>
    );
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks',
  component: function Tasks() {
    return (
      <LazyPage>
        <TasksPage />
      </LazyPage>
    );
  },
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tasks/$taskId',
  component: function TaskDetail() {
    return (
      <LazyPage>
        <TaskDetailPage />
      </LazyPage>
    );
  },
});

const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/me',
  component: function Me() {
    return (
      <LazyPage>
        <MePage />
      </LazyPage>
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function Settings() {
    return (
      <LazyPage>
        <SettingsPage />
      </LazyPage>
    );
  },
});

const userManageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/user-manage',
  component: function UserManage() {
    return (
      <LazyPage>
        <UserManagePage />
      </LazyPage>
    );
  },
});

const mossTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/moss-test',
  component: function MossTest() {
    return (
      <LazyPage>
        <MOSSASRTestPage />
      </LazyPage>
    );
  },
});

const syncTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sync-test',
  component: function SyncTest() {
    return (
      <LazyPage>
        <SyncTestPage />
      </LazyPage>
    );
  },
});

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: function Agents() {
    return (
      <LazyPage>
        <AgentsPage />
      </LazyPage>
    );
  },
});

const updateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/update',
  component: function Update() {
    return (
      <LazyPage>
        <UpdatePage />
      </LazyPage>
    );
  },
});

const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/agent/$agentId',
  component: function AgentDetail() {
    const { agentId } = useParams({ strict: false }) as { agentId?: string };
    return (
      <LazyPage>
        <AgentDetailPage agentId={agentId} />
      </LazyPage>
    );
  },
});

const actorDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/actor/$actorId',
  component: function ActorDetail() {
    const { actorId } = useParams({ strict: false }) as { actorId?: string };
    return (
      <LazyPage>
        <ActorDetailPage actorId={actorId} />
      </LazyPage>
    );
  },
});

const agentConversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/chat/$agentId',
  component: function AgentConversation() {
    const { agentId } = useParams({ strict: false }) as { agentId?: string };
    return (
      <LazyPage>
        <AgentConversationPage agentId={agentId} />
      </LazyPage>
    );
  },
});

const agentMarketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/market',
  component: function AgentMarket() {
    return (
      <LazyPage>
        <AgentMarketPage />
      </LazyPage>
    );
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  eventlogRoute,
  tasksRoute,
  taskDetailRoute,
  meRoute,
  settingsRoute,
  userManageRoute,
  mossTestRoute,
  syncTestRoute,
  agentsRoute,
  updateRoute,
  agentDetailRoute,
  actorDetailRoute,
  agentConversationRoute,
  agentMarketRoute,
]);

const appRouter = createRouter({ routeTree: routeTree });

export { appRouter };
