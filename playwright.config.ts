import { defineConfig } from '@playwright/test';
import { getBaseUse, getChromiumProject } from './tests/e2e/playwright.termux';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: getBaseUse('http://localhost:1420', 'on-first-retry'),
  projects: [getChromiumProject()],
  webServer: {
    command: 'bun scripts/test/runtime-dispatch.cjs vite-dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
  },
});
