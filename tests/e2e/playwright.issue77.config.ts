import { defineConfig } from '@playwright/test';
import { getBaseUse, getChromiumProject } from './playwright.termux';

const PORT = 1436;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [getChromiumProject()],
  webServer: {
    command: `node scripts/test/runtime-dispatch.cjs issue77-preview ${PORT}`,
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180000,
  },
});
