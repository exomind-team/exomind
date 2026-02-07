import * as React from "react";
import { Outlet, Link, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const sidebarItems = [
  { title: "聊天", path: "/", icon: "message-circle" },
  { title: "设备", path: "/devices", icon: "smartphone" },
  { title: "设置", path: "/settings", icon: "settings" },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 border-r bg-card h-screen flex flex-col" data-testid="device-panel">
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

export function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
