import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.EXOMIND_WEBSITE_BASE_URL || 'https://exo-mind.ai';

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
});
