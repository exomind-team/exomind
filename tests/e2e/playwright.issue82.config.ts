import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = 1520;
const HMR_PORT = 1521;
const POUCHDB_PORT = 7084;
const ASR_PORT = 2049;
const BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [getChromiumProject()],
  webServer: {
    command: 'node Scripts/test/runtime-dispatch.cjs vite-dev',
    cwd: '../..',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180000,
    env: withPlaywrightEnv({
      ...process.env,
      EXOMIND_WEB_PORT: String(WEB_PORT),
      EXOMIND_HMR_PORT: String(HMR_PORT),
      EXOMIND_POUCHDB_PORT: String(POUCHDB_PORT),
      EXOMIND_ASR_PORT: String(ASR_PORT),
      VITE_SYNC_SERVER_URL: `http://localhost:${POUCHDB_PORT}`,
      VITE_ASR_SERVER_URL: `http://localhost:${ASR_PORT}`,
    }),
  },
});
