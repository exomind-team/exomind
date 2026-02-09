import { createRoute } from '@tanstack/react-router';
import { rootRoute } from '../routes';
import { HomePage } from '@/components/Home/HomePage';

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Home() {
    return <HomePage />;
  },
});

export { homeRoute as HomeRoute };
