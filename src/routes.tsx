import { createRootRoute, createRouter, createRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { X, Settings, ClipboardList, Menu, Home, Users, Sun, Moon, SunMoon } from "lucide-react";
import { ChatPage } from "@/components/Chat/ChatPage";
import { SettingsPage } from "@/components/Settings/SettingsPage";
import { MOSSASRTestPage } from "@/pages/MOSSASRTestPage";
import { HomePage } from "@/components/Home/HomePage";
import { UserManagePage } from "@/ui/pages/UserManagePage";
import { SyncTestPage } from "@/ui/pages/SyncTestPage";
import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreferenceChanges,
  type ThemePreference,
} from "@/config/theme";

const sidebarItems = [
  { title: "首页", path: "/", icon: Home },
  { title: "事件日志", path: "/eventlog", icon: ClipboardList },
  { title: "用户管理", path: "/user-manage", icon: Users },
  { title: "设置", path: "/settings", icon: Settings },
];

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() => getThemePreference());

  useEffect(() => {
    return subscribeThemePreferenceChanges((preference) => {
      setThemePreferenceState(preference);
    });
  }, []);

  const handleToggleTheme = () => {
    const nextPreference: ThemePreference =
      themePreference === 'light' ? 'dark' : themePreference === 'dark' ? 'system' : 'light';
    setThemePreference(nextPreference);
    setThemePreferenceState(nextPreference);
  };

  const renderThemeIcon = () => {
    const iconClassName = "w-5 h-5";
    if (themePreference === 'light') {
      return <Sun className={iconClassName} aria-hidden="true" />;
    }
    if (themePreference === 'dark') {
      return <Moon className={iconClassName} aria-hidden="true" />;
    }

    return (
      <span className="relative inline-flex" aria-hidden="true">
        <SunMoon className={iconClassName} />
        <span className="absolute -bottom-0.5 -right-0.5 rounded bg-background px-0.5 text-[9px] leading-none text-muted-foreground border">
          A
        </span>
      </span>
    );
  };

  return (
    <>
      {/* 遮罩层 - 移动端显示 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r flex flex-col safe-area-pt transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        data-testid="device-panel"
      >
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">ExoMind</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleToggleTheme}
              className="p-2 hover:bg-accent rounded-md"
              aria-label="切换主题（浅色/深色/跟随系统）"
              title="切换主题：浅 → 深 → 系统"
            >
              {renderThemeIcon()}
            </button>
            <button
              onClick={onClose}
              className="lg:hidden p-2 hover:bg-accent rounded-md"
              aria-label="关闭侧边栏"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {sidebarItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                <Icon size={20} />
                <span className="text-sm font-medium">{item.title}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] lg:h-screen bg-background" data-testid="app-container">
      {/* 侧边栏 */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部栏 - 移动端显示菜单按钮 */}
        <header className="lg:hidden sticky top-0 z-30 safe-area-pt flex items-center px-4 py-3 border-b bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-accent rounded-md mr-3"
          >
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-bold">事件日志</h2>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// Root route
const rootRoute = createRootRoute({
  component: Layout,
});

// Home route (/)
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Home() {
    return <HomePage />;
  },
});

// Index route (/eventlog)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/eventlog',
  component: function EventLog() {
    return (
      <div className="h-full flex flex-col">
        <ChatPage />
      </div>
    );
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: function Settings() {
    return <SettingsPage />;
  },
});

// MOSS ASR Test route (/moss-test)
const mossTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'moss-test',
  component: function MOSSTest() {
    return <MOSSASRTestPage />;
  },
});

// User Manage route (/user-manage)
const userManageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'user-manage',
  component: function UserManage() {
    return <UserManagePage />;
  },
});

// Sync Test route (/sync-test)
// 保留兼容入口；不在侧边栏展示
const syncTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sync-test',
  component: function SyncTest() {
    return <SyncTestPage />;
  },
});

// Create the route tree
const routeTree = rootRoute.addChildren([
  homeRoute,
  indexRoute,
  settingsRoute,
  mossTestRoute,
  userManageRoute,
  syncTestRoute,
]);

// Create the router
const router = createRouter({ routeTree });

// Export router instance
export { router, rootRoute };

// Re-export Outlet and context for convenience
export { Outlet };
