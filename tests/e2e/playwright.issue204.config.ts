import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.runtime';

const WEB_PORT = 1420;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL, 'retain-on-failure'),
  projects: [getChromiumProject()],
  webServer: {
    command: 'bun run dev',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
    env: withPlaywrightEnv({
      ...process.env,
      EXOMIND_WEB_PORT: String(WEB_PORT),
      EXOMIND_HMR_PORT: '1421',
      EXOMIND_POUCHDB_PORT: '7420',
      EXOMIND_ASR_PORT: '2420',
      VITE_SYNC_SERVER_URL: 'http://localhost:7420',
      VITE_ASR_SERVER_URL: 'http://localhost:2420',
    }),
  },
});
