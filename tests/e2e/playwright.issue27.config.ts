import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = 1620;
const HMR_PORT = 1621;
const POUCHDB_PORT = 7184;
const ASR_PORT = 2149;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const SYNC_SERVER_URL = `http://localhost:${POUCHDB_PORT}`;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [getChromiumProject()],
  webServer: [
    {
      command: 'node ../scripts/test/runtime-dispatch.cjs server-start',
      cwd: '../../server',
      url: `${SYNC_SERVER_URL}/_all_dbs`,
      reuseExistingServer: false,
      timeout: 180000,
      env: withPlaywrightEnv({
        ...process.env,
        EXOMIND_POUCHDB_PORT: String(POUCHDB_PORT),
        EXOMIND_POUCHDB_HOST: '0.0.0.0',
      }),
    },
    {
      command: 'node scripts/test/runtime-dispatch.cjs vite-dev',
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
        VITE_SYNC_SERVER_URL: SYNC_SERVER_URL,
        VITE_ASR_SERVER_URL: `http://localhost:${ASR_PORT}`,
      }),
    },
  ],
});
