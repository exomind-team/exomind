import { createRootRoute, createRouter, createRoute, Outlet, Link, useLocation } from '@tanstack/react-router';
import { Target, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NewFocusPage } from '@/ui/new/pages/NewFocusPage';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';
import { UserManagePage } from '@/ui/pages/UserManagePage';
import { ASRTestPage } from '@/pages/ASRTestPage';
import { MOSSASRTestPage } from '@/pages/MOSSASRTestPage';

function NewLayout() {
  const location = useLocation();

  const navItems = [
    { title: '当下', path: '/eventlog', icon: Target },
    { title: '设置', path: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-[100dvh] bg-[#ECE6E1] dark:bg-[#0C0A09] md:p-6">
      <div className="relative mx-auto h-[100dvh] w-full max-w-[393px] overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09] md:h-[852px] md:rounded-[40px] md:border md:border-[#E6DFD8] md:dark:border-[#292524] md:shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]">
        <main className="absolute inset-x-0 top-0 bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] overflow-y-auto">
          <Outlet />
        </main>

        <nav className="absolute inset-x-0 bottom-0 z-40 border-t border-[#E4DED7] dark:border-[#292524] bg-[#FAF7F5]/95 dark:bg-[#0C0A09]/95 backdrop-blur">
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

const newUserManageRoute = createRoute({
  getParentRoute: () => newRootRoute,
  path: '/user-manage',
  component: function NewUserManage() {
    return <UserManagePage />;
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
  newUserManageRoute,
  newAsrTestRoute,
  newMossTestRoute,
]);

const newUiRouter = createRouter({ routeTree: newRouteTree });

export { newUiRouter };
