import { defineConfig, devices } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = 1428;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'agent-hub.signal-routes.issue245f.test.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [
    getChromiumProject(),
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
      },
    },
  ],
  webServer: {
    command: 'node Scripts/test/runtime-dispatch.cjs vite-dev',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
    env: withPlaywrightEnv({
      ...process.env,
      EXOMIND_WEB_PORT: String(WEB_PORT),
      EXOMIND_HMR_PORT: '1429',
      EXOMIND_POUCHDB_PORT: '7428',
      EXOMIND_ASR_PORT: '2428',
      VITE_SYNC_SERVER_URL: 'http://localhost:7428',
      VITE_ASR_SERVER_URL: 'http://localhost:2428',
    }),
  },
});
