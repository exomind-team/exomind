import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

// Note: avoid Chrome "unsafe ports" (e.g. 1720).
const WEB_PORT = 1530;
const HMR_PORT = 1531;
const POUCHDB_PORT = 7090;
const ASR_PORT = 2055;
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
    command: 'bun scripts/test/runtime-dispatch.cjs vite-dev',
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
