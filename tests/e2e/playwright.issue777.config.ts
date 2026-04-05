import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = Number(process.env.EXOMIND_ISSUE777_WEB_PORT || '1577');
const BASE_URL = `http://localhost:${WEB_PORT}`;
const HMR_PORT = WEB_PORT + 1;
const POUCHDB_PORT = WEB_PORT + 6000;
const ASR_PORT = WEB_PORT + 1000;

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
    reuseExistingServer: true,
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
