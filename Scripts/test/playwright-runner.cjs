#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const dispatchScript = path.resolve(__dirname, 'runtime-dispatch.cjs');
const env = { ...process.env };

function parseArgs(rawArgs) {
  const forwarded = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === '--') {
      forwarded.push(...rawArgs.slice(index + 1));
      break;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(arg)) {
      const separatorIndex = arg.indexOf('=');
      const key = arg.slice(0, separatorIndex);
      const value = arg.slice(separatorIndex + 1);
      env[key] = value;
      continue;
    }
    forwarded.push(arg);
  }
  return forwarded;
}

const forwarded = parseArgs(process.argv.slice(2));
const args = ['playwright', ...(forwarded.length > 0 ? forwarded : ['test'])];

const isTermuxRuntime =
  process.platform === 'android' ||
  Boolean(env.TERMUX_VERSION) ||
  env.PLAYWRIGHT_TERMUX === '1';

if (isTermuxRuntime) {
  const defaultChromiumPath = '/data/data/com.termux/files/usr/bin/chromium-browser';
  const fallbackChromiumPath = '/data/data/com.termux/files/usr/bin/chromium';

  env.PLAYWRIGHT_TERMUX = env.PLAYWRIGHT_TERMUX || '1';
  env.PLAYWRIGHT_BROWSERS_PATH = env.PLAYWRIGHT_BROWSERS_PATH || '0';
  env.CHROMIUM_PATH =
    env.CHROMIUM_PATH ||
    (existsSync(defaultChromiumPath) ? defaultChromiumPath : fallbackChromiumPath);
}

const child = spawn('node', [dispatchScript, ...args], {
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`[playwright-runner] Failed to spawn runtime dispatcher: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
