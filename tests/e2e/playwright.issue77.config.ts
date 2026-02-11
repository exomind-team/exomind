import { defineConfig, devices } from '@playwright/test';

const PORT = 1436;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
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
    command: `bun run build && bunx vite preview --port ${PORT} --strictPort --host 0.0.0.0`,
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
  },
});
