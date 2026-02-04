import { createRootRoute, createRouter } from "@tanstack/react-router";
import { RouterProvider } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";

import { IndexRoute } from "./routes/index";
import { SettingsRoute } from "./routes/settings";

const rootRoute = createRootRoute({
  component: Layout,
});

const routeTree = rootRoute.addChildren([IndexRoute, SettingsRoute]);

export { rootRoute, routeTree };

export function Router() {
  return createRouter({ routeTree });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof Router>;
  }
}

export { RouterProvider };
