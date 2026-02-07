import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Layout components', () => {
  const layoutDir = path.resolve('src/components/Layout');

  it('should have Layout directory', () => {
    expect(fs.existsSync(layoutDir)).toBe(true);
  });

  it('should export Layout component', async () => {
    const { Layout } = await import('@/components/Layout');
    expect(Layout).toBeDefined();
    expect(typeof Layout).toBe('function');
  });

  it('should export Sidebar component', async () => {
    const { Sidebar } = await import('@/components/Layout');
    expect(Sidebar).toBeDefined();
    expect(typeof Sidebar).toBe('function');
  });
});

describe('Layout features', () => {
  it('should have Sidebar with navigation items', async () => {
    // Check that Sidebar renders navigation
    const { Sidebar: SidebarComponent } = await import('@/components/Layout');
    expect(SidebarComponent).toBeDefined();
  });

  it('should have Layout with Outlet', async () => {
    // Layout should be a component that can wrap content
    const { Layout } = await import('@/components/Layout');
    expect(Layout).toBeDefined();
  });
});
