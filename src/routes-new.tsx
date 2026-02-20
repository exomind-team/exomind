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
    <div className="min-h-[100dvh] bg-[#F3EFEA]">
      <main className="pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E4DED7] bg-[#FAF7F5]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-around px-6 py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path || (item.path === '/eventlog' && location.pathname === '/');
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex min-w-20 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-xs transition-colors',
                  active ? 'text-[#C75B3A] font-semibold' : 'text-stone-500'
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

