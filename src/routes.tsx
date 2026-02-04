import { createRootRoute, createRouter, createRoute, Outlet } from "@tanstack/react-router";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const sidebarItems = [
  { title: "聊天", path: "/", icon: "message-circle" },
  { title: "设备", path: "/devices", icon: "smartphone" },
  { title: "设置", path: "/settings", icon: "settings" },
];

function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 border-r bg-card h-screen flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold">ExoMind</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {sidebarItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              <span className="text-sm font-medium">{item.title}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
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
      <div className="p-2">
        <h3 className="text-lg font-medium">欢迎使用 ExoMind</h3>
        <p className="text-muted-foreground">选择左侧设备开始聊天</p>
      </div>
    );
  },
});

// Settings route (/settings)
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: function Settings() {
    return (
      <div className="p-2">
        <h3 className="text-lg font-medium">设置</h3>
        <p className="text-muted-foreground">P2P 和设备管理设置</p>
      </div>
    );
  },
});

// Create route tree
const routeTree = rootRoute.addChildren([indexRoute, settingsRoute]);

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
