import { existsSync } from 'node:fs';
import { devices } from '@playwright/test';

const DEFAULT_TERMUX_CHROMIUM_PATH =
  '/data/data/com.termux/files/usr/bin/chromium-browser';
const FALLBACK_TERMUX_CHROMIUM_PATH =
  '/data/data/com.termux/files/usr/bin/chromium';
const TERMUX_CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const isTermuxRuntime =
  process.platform === 'android' ||
  Boolean(process.env.TERMUX_VERSION) ||
  process.env.PLAYWRIGHT_TERMUX === '1';

const useSystemChromium =
  process.env.PLAYWRIGHT_USE_SYSTEM_CHROMIUM === '1' || isTermuxRuntime;

type EnvMap = Record<string, string | undefined>;
type TraceMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';

const resolveChromiumPath = (): string => {
  if (process.env.CHROMIUM_PATH) {
    return process.env.CHROMIUM_PATH;
  }

  if (existsSync(DEFAULT_TERMUX_CHROMIUM_PATH)) {
    return DEFAULT_TERMUX_CHROMIUM_PATH;
  }

  return FALLBACK_TERMUX_CHROMIUM_PATH;
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
        args: TERMUX_CHROMIUM_ARGS,
      }
    : {
        channel: 'chrome' as const,
      },
});

export const getChromiumProject = () => ({
  name: 'chromium',
  use: useSystemChromium
    ? { ...devices['Desktop Chrome'] }
    : { ...devices['Desktop Chrome'], channel: 'chrome' as const },
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
