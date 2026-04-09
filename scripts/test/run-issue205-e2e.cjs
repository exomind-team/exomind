#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const viteCli = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
const baseUrl = 'http://127.0.0.1:1544';
const serverEnv = {
  ...process.env,
  EXOMIND_WEB_PORT: '1544',
  EXOMIND_HMR_PORT: '1545',
  EXOMIND_POUCHDB_PORT: '7098',
  EXOMIND_ASR_PORT: '2063',
  VITE_SYNC_SERVER_URL: 'http://localhost:7098',
  VITE_ASR_SERVER_URL: 'http://localhost:2063',
};

let viteProcess = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling until timeout（持续轮询直到超时）
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function terminateProcessTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore already-exited process（忽略已退出进程）
  }
}

async function cleanup() {
  if (!viteProcess) {
    return;
  }
  terminateProcessTree(viteProcess.pid);
  viteProcess = null;
}

async function main() {
  viteProcess = spawn(process.execPath, [viteCli], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: 'inherit',
  });

  viteProcess.on('error', (error) => {
    console.error(`[issue205-e2e] failed to start vite: ${error.message}`);
  });

  const handleSignal = async (signal) => {
    await cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  try {
    await waitForServer(baseUrl, 180000);
    const testProcess = spawn(process.execPath, [
      playwrightCli,
      'test',
      'tests/e2e/agent-runtime-host.issue205.test.ts',
      '--config',
      'tests/e2e/playwright.issue205.config.ts',
      '--reporter=line',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        EXOMIND_PLAYWRIGHT_EXTERNAL_SERVER: '1',
      },
      stdio: 'inherit',
    });

    const exitCode = await new Promise((resolve, reject) => {
      testProcess.on('error', reject);
      testProcess.on('exit', (code, signal) => {
        if (signal) {
          resolve(1);
          return;
        }
        resolve(code ?? 1);
      });
    });

    await cleanup();
    process.exit(exitCode);
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[issue205-e2e] ${message}`);
    process.exit(1);
  }
}

main();
