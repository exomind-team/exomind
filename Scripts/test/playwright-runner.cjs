#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const isTermuxRuntime =
  process.platform === 'android' ||
  Boolean(process.env.TERMUX_VERSION) ||
  process.env.PLAYWRIGHT_TERMUX === '1';

const env = { ...process.env };

if (isTermuxRuntime) {
  env.PLAYWRIGHT_TERMUX = env.PLAYWRIGHT_TERMUX || '1';
  env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH || '0';
  env.CHROMIUM_PATH =
    env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
}

const playwrightPackageJson = require.resolve('playwright/package.json');
const cliPath = path.join(path.dirname(playwrightPackageJson), 'cli.js');
const args = [cliPath, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
