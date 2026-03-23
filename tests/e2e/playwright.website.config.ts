import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 4327;
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bun run --cwd website dev -- --host 127.0.0.1 --port ${WEB_PORT}`,
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
  },
});
