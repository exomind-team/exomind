import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 1442;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'signal-pool-smoke.test.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: {
      channel: 'chrome',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    command: 'bun run dev',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
    env: {
      ...process.env,
      EXOMIND_WEB_PORT: String(WEB_PORT),
      EXOMIND_HMR_PORT: '1443',
      EXOMIND_POUCHDB_PORT: '7442',
      EXOMIND_ASR_PORT: '2442',
      VITE_SYNC_SERVER_URL: 'http://localhost:7442',
      VITE_ASR_SERVER_URL: 'http://localhost:2442',
    },
  },
});
