import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.runtime';

const PORT = 1436;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL, 'retain-on-failure'),
  projects: [getChromiumProject()],
  webServer: {
    command: `bun run build && bunx vite preview --port ${PORT} --strictPort --host 0.0.0.0`,
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
    env: withPlaywrightEnv(process.env),
  },
});
