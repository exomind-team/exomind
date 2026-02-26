import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './tests/e2e/playwright.termux';

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
    command: 'npm run dev --silent',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    env: withPlaywrightEnv(process.env),
  },
});
