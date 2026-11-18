import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.EXOMIND_UI_BASE_URL ?? 'http://127.0.0.1:15420';
export default defineConfig({
  testDir: '.', testMatch: 'beta-workspace-ui.test.ts', workers: 1,
  timeout: 45000, expect: { timeout: 10000 },
  outputDir: process.env.EXOMIND_UI_EVIDENCE_DIR ?? '../../test-results/beta-workspace',
  reporter: [['list']],
  use: { baseURL, channel: 'msedge', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure', locale: 'zh-CN' },
  webServer: process.env.EXOMIND_UI_BASE_URL ? undefined : {
    command: 'node node_modules/vite/bin/vite.js --config tests/e2e/vite.beta-workspace.config.ts --host 127.0.0.1 --port 15420 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)), url: `${baseURL}/tests/e2e/fixtures/beta-workspace.html`, reuseExistingServer: false,
    env: { EXOMIND_WEB_PORT: '15420', EXOMIND_HMR_PORT: '15421', VITE_APP_VERSION: '0.6.0-beta12' },
  },
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1280, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' } },
    { name: 'phone-touch', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, colorScheme: 'light' } },
    { name: 'tablet-touch', use: { viewport: { width: 1024, height: 768 }, hasTouch: true, colorScheme: 'dark' } },
  ],
});
