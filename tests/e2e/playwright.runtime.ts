import { existsSync } from 'node:fs';
import { devices } from '@playwright/test';

type TraceMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';
type EnvMap = Record<string, string | undefined>;

const TERMUX_DEFAULT_CHROMIUM =
  '/data/data/com.termux/files/usr/bin/chromium-browser';
const TERMUX_FALLBACK_CHROMIUM = '/data/data/com.termux/files/usr/bin/chromium';
const TERMUX_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const isTermuxRuntime =
  process.platform === 'android' ||
  process.env.TERMUX_VERSION !== undefined ||
  process.env.PLAYWRIGHT_TERMUX === '1';

const useSystemChromium =
  process.env.PLAYWRIGHT_USE_SYSTEM_CHROMIUM === '1' || isTermuxRuntime;

const resolveChromiumPath = (): string => {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }

  if (existsSync(TERMUX_DEFAULT_CHROMIUM)) {
    return TERMUX_DEFAULT_CHROMIUM;
  }

  return TERMUX_FALLBACK_CHROMIUM;
};

export const getBaseUse = (
  baseURL: string,
  trace: TraceMode = 'retain-on-failure'
) => ({
  baseURL,
  trace,
  launchOptions: useSystemChromium
    ? {
        executablePath: resolveChromiumPath(),
        args: TERMUX_ARGS,
      }
    : undefined,
});

export const getChromiumProject = () => ({
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
});

export const withPlaywrightEnv = (env: EnvMap = process.env): EnvMap => {
  if (!useSystemChromium) {
    return env;
  }

  return {
    ...env,
    PLAYWRIGHT_BROWSERS_PATH: env.PLAYWRIGHT_BROWSERS_PATH ?? '0',
    CHROMIUM_PATH: env.CHROMIUM_PATH ?? resolveChromiumPath(),
  };
};
