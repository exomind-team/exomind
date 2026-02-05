import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('routes configuration', () => {
  const routesDir = path.resolve('src/routes');

  it('should have routes directory', () => {
    expect(fs.existsSync(routesDir)).toBe(true);
  });

  it('should export route configuration', () => {
    const routeConfigPath = path.resolve('src/routes.ts');
    expect(fs.existsSync(routeConfigPath)).toBe(true);
  });
});

describe('router components', () => {
  it('should export RouterProvider', async () => {
    const { RouterProvider } = await import('@tanstack/react-router');
    expect(RouterProvider).toBeDefined();
  });

  it('should export createRouter', async () => {
    const { createRouter } = await import('@tanstack/react-router');
    expect(createRouter).toBeDefined();
    expect(typeof createRouter).toBe('function');
  });
});

describe('route tree', () => {
  it('should have route tree file', () => {
    const routeTreePath = path.resolve('src/routeTree.tsx');
    expect(fs.existsSync(routeTreePath)).toBe(true);
  });

  it('should export route tree components', async () => {
    const routeExports = await import('@/routeTree');
    // routeTree exports rootRoute and routeTree
    expect(routeExports.rootRoute).toBeDefined();
    expect(routeExports.routeTree).toBeDefined();
  });
});

describe('lazy routes', () => {
  it('should have index route', () => {
    const indexRoutePath = path.resolve('src/routes/index.tsx');
    expect(fs.existsSync(indexRoutePath)).toBe(true);
  });

  it('should export index route component', async () => {
    const { IndexRoute } = await import('@/routes/index');
    expect(IndexRoute).toBeDefined();
  });

  it('should have settings route', () => {
    const settingsRoutePath = path.resolve('src/routes/settings.tsx');
    expect(fs.existsSync(settingsRoutePath)).toBe(true);
  });

  it('should export settings route component', async () => {
    const { SettingsRoute } = await import('@/routes/settings');
    expect(SettingsRoute).toBeDefined();
  });
});
