import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation } from '@tanstack/react-router';
import { Target, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NewFocusPage } from '@/ui/new/pages/NewFocusPage';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';
import { ASRTestPage } from '@/pages/ASRTestPage';
import { MOSSASRTestPage } from '@/pages/MOSSASRTestPage';

function NewLayout() {
  const location = useLocation();

  const navItems = [
    { title: '当下', path: '/eventlog', icon: Target },
    { title: '设置', path: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#ECE6E1] md:p-6">
      <div className="relative mx-auto min-h-[100dvh] w-full max-w-[393px] overflow-hidden bg-[#FAF7F5] md:min-h-[852px] md:rounded-[40px] md:border md:border-[#E6DFD8] md:shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]">
        <main className="h-full overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
          <Outlet />
        </main>

        <nav className="absolute bottom-0 left-0 right-0 z-40 border-t border-[#E4DED7] bg-[#FAF7F5]/95 backdrop-blur">
          <div className="flex items-center justify-around px-6 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path || (item.path === '/eventlog' && location.pathname === '/');
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-1 text-[11px] transition-colors',
                    active ? 'text-[#C75B3A] font-semibold' : 'text-stone-400'
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

const newRootRoute = createRootRoute({
  component: NewLayout,
});

const newHomeRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/',
  component: function NewHome() {
    return <NewFocusPage />;
  },
});

const newEventlogRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/eventlog',
  component: function NewEventlog() {
    return <NewFocusPage />;
  },
});

const newSettingsRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/settings',
  component: function NewSettings() {
    return <NewSettingsPage />;
  },
});

const newAsrTestRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/asr-test',
  component: function NewAsrTest() {
    return <ASRTestPage />;
  },
});

const newMossTestRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/moss-test',
  component: function NewMossTest() {
    return <MOSSASRTestPage />;
  },
});

const newRouteTree = newRootRoute.addChildren([
  newHomeRoute,
  newEventlogRoute,
  newSettingsRoute,
  newAsrTestRoute,
  newMossTestRoute,
]);

const newUiRouter = createRouter({ routeTree: newRouteTree });

export { newUiRouter };
