import { defineConfig } from '@playwright/test';
import {
  getBaseUse,
  getChromiumProject,
  withPlaywrightEnv,
} from './playwright.termux';

const WEB_PORT = 1544;
const HMR_PORT = 1545;
const POUCHDB_PORT = 7098;
const ASR_PORT = 2063;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const useExternalServer = process.env.EXOMIND_PLAYWRIGHT_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: getBaseUse(BASE_URL),
  projects: [getChromiumProject()],
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: 'node ./node_modules/vite/bin/vite.js',
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
      }),
});
