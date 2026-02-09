import { createRootRoute, createRouter, createRoute, Outlet, useLocation } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Menu, X, MessageCircle, Smartphone, Settings, Mic, MicVocal } from "lucide-react";
import { ChatPage } from "@/components/Chat/ChatPage";
import { SettingsPage } from "@/components/Settings/SettingsPage";
import { DevicesPage } from "@/components/Settings/DevicesPage";
import { ASRTestPage } from "@/pages/ASRTestPage";
import { VoiceChatPage } from "@/pages/VoiceChatPage";
import { MOSSASRTestPage } from "@/pages/MOSSASRTestPage";

const sidebarItems = [
  { title: "聊天", path: "/", icon: MessageCircle },
  { title: "MOSS测试", path: "/moss-test", icon: Mic },
  { title: "语音聊天", path: "/voice-chat", icon: MicVocal },
  { title: "ASR测试", path: "/asr-test", icon: Mic },
  { title: "设备", path: "/devices", icon: Smartphone },
  { title: "设置", path: "/settings", icon: Settings },
];

function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const location = useLocation();

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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="flex h-[100dvh] lg:h-screen bg-background" data-testid="app-container">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* 移动端菜单按钮 */}
      {isMobile && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-30 p-2 bg-background border rounded-md shadow-md lg:hidden"
        >
          <Menu size={20} />
        </button>
      )}

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

// Root route
const rootRoute = createRootRoute({
  component: Layout,
});

// Index route (/)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function Index() {
    return (
      <div className="h-full flex flex-col">
        <ChatPage />
      </div>
    );
  },
});

// Settings route (/settings)
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: function Settings() {
    return <SettingsPage connectionStatus="disconnected" />;
  },
});

// Devices route (/devices)
const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: function Devices() {
    return <DevicesPage connectionStatus="disconnected" />;
  },
});

// ASR Test route (/asr-test)
const asrTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/asr-test",
  component: function ASRTest() {
    return <ASRTestPage />;
  },
});

// Voice Chat route (/voice-chat)
const voiceChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/voice-chat",
  component: function VoiceChat() {
    return <VoiceChatPage />;
  },
});

// MOSS ASR Test route (/moss-test)
const mossTestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/moss-test",
  component: function MOSSTest() {
    return <MOSSASRTestPage />;
  },
});

// Create route tree
const routeTree = rootRoute.addChildren([indexRoute, devicesRoute, mossTestRoute, asrTestRoute, voiceChatRoute, settingsRoute]);

// Create router
const router = createRouter({ routeTree });

export { router };

// Register the router type
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export { RouterProvider } from "@tanstack/react-router";
