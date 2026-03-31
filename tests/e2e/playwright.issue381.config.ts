import { defineConfig, devices } from '@playwright/test';
import {
  getBaseUse,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = 1481;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chromium'],
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
      },
    },
  ],
  webServer: {
    command: 'node scripts/test/runtime-dispatch.cjs vite-dev',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180000,
    env: withPlaywrightEnv({
      ...process.env,
      EXOMIND_WEB_PORT: String(WEB_PORT),
      EXOMIND_HMR_PORT: '1482',
      EXOMIND_POUCHDB_PORT: '6984',
      EXOMIND_ASR_PORT: '2481',
      VITE_ASR_SERVER_URL: 'http://localhost:2481',
    }),
  },
});
