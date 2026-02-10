import { createRootRoute, createRouter, createRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { X, Settings, Mic, ClipboardList, Menu, Home } from "lucide-react";
import { cn } from "./lib/utils";

const sidebarItems = [
  { title: "首页", path: "/", icon: Home },
  { title: "事件日志", path: "/eventlog", icon: ClipboardList },
  { title: "语音聊天", path: "/voice-chat", icon: Mic },
  { title: "设置", path: "/settings", icon: Settings },
];

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r flex flex-col transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        data-testid="device-panel"
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h1 className="text-xl font-bold">ExoMind</h1>
          <button
            onClick={onClose}
            className="lg:hidden p-2 hover:bg-accent rounded-md"
          >
            <X size={20} />
          </button>
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
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center px-4 py-3 border-b bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-accent rounded-md mr-3"
          >
            <Menu size={20} />
          </button>
          <h2 className="text-lg font-bold">ExoMind</h2>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: Layout,
});

function HomePage() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">ExoMind</h1>
        <p className="text-xl text-muted-foreground">
          生命成长助手 - 记录、思考、成长
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/eventlog"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <ClipboardList className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">事件日志</h3>
            <p className="text-sm text-muted-foreground">记录你的想法</p>
          </div>
        </Link>
        <Link
          to="/voice-chat"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Mic className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">语音聊天</h3>
            <p className="text-sm text-muted-foreground">语音输入助手</p>
          </div>
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent transition-colors"
        >
          <Settings className="w-8 h-8 text-primary" />
          <div className="flex-1">
            <h3 className="font-semibold">设置</h3>
            <p className="text-sm text-muted-foreground">配置你的偏好</p>
          </div>
        </Link>
      </div>
    </div>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const eventLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/eventlog',
  component: function EventLog() {
    return (
      <div className="h-full flex flex-col p-6">
        <h2 className="text-2xl font-bold mb-4">事件日志</h2>
        <p className="text-muted-foreground">事件日志功能开发中...</p>
      </div>
    );
  },
});

const voiceChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/voice-chat',
  component: function VoiceChat() {
    return (
      <div className="h-full flex flex-col p-6">
        <h2 className="text-2xl font-bold mb-4">语音聊天</h2>
        <p className="text-muted-foreground">语音聊天功能开发中...</p>
      </div>
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: function Settings() {
    return (
      <div className="h-full flex flex-col p-6">
        <h2 className="text-2xl font-bold mb-4">设置</h2>
        <p className="text-muted-foreground">设置功能开发中...</p>
      </div>
    );
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  eventLogRoute,
  voiceChatRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree });

export { router };
