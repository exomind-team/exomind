#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const [preset, ...presetArgs] = process.argv.slice(2);

function fail(message) {
  console.error(`[runtime-dispatch] ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[runtime-dispatch] ${message}`);
}

function hasBinary(binary) {
  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

function resolveRuntime() {
  const configured = (process.env.EXOMIND_JS_RUNTIME || 'auto').toLowerCase();

  if (!['auto', 'bun', 'node'].includes(configured)) {
    fail(`Invalid EXOMIND_JS_RUNTIME="${configured}". Use auto|bun|node.`);
  }

  if (configured === 'bun') {
    if (!hasBinary('bun')) {
      fail('EXOMIND_JS_RUNTIME=bun but bun is not available in PATH.');
    }
    return 'bun';
  }

  if (configured === 'node') {
    return 'node';
  }

  return hasBinary('bun') ? 'bun' : 'node';
}

function resolveRepoFile(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`Required file not found: ${relativePath}`);
  }
  return absolutePath;
}

function resolveStepStdio(step) {
  if (step.stdio) {
    return step.stdio;
  }
  if (step.ignoreStdin) {
    return ['ignore', 'inherit', 'inherit'];
  }
  return 'inherit';
}

function runStep(step) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd || process.cwd(),
      env: step.env || process.env,
      stdio: resolveStepStdio(step),
    });

    const forwardSigint = () => child.kill('SIGINT');
    const forwardSigterm = () => child.kill('SIGTERM');

    process.on('SIGINT', forwardSigint);
    process.on('SIGTERM', forwardSigterm);

    child.on('error', (error) => {
      process.removeListener('SIGINT', forwardSigint);
      process.removeListener('SIGTERM', forwardSigterm);
      console.error(`[runtime-dispatch] Failed to spawn "${step.command}": ${error.message}`);
      resolve(1);
    });

    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', forwardSigint);
      process.removeListener('SIGTERM', forwardSigterm);
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function getStepsForPreset(runtime, name, args) {
  const playwrightArgs = args.length > 0 ? args : ['test'];

  if (name === 'playwright') {
    if (runtime === 'bun') {
      return [{ command: 'bunx', args: ['playwright', ...playwrightArgs] }];
    }
    const playwrightCli = resolveRepoFile('node_modules/playwright/cli.js');
    return [{ command: 'node', args: [playwrightCli, ...playwrightArgs] }];
  }

  if (name === 'vite-dev') {
    if (runtime === 'bun') {
      return [{ command: 'bun', args: ['run', 'dev'], ignoreStdin: true }];
    }
    const viteCli = resolveRepoFile('node_modules/vite/bin/vite.js');
    return [{ command: 'node', args: [viteCli], ignoreStdin: true }];
  }

  if (name === 'server-start') {
    if (runtime === 'bun') {
      return [{ command: 'bun', args: ['run', 'start'] }];
    }
    return [{ command: 'node', args: ['pouchdb-server.js'] }];
  }

  if (name === 'issue77-preview') {
    const [port] = args;
    if (!port) {
      fail('issue77-preview requires a port argument.');
    }

    if (runtime === 'bun') {
      return [
        { command: 'bunx', args: ['tsc'] },
        { command: 'bunx', args: ['vite', 'build'] },
        {
          command: 'bunx',
          args: ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '0.0.0.0'],
        },
      ];
    }

    const tscCli = resolveRepoFile('node_modules/typescript/bin/tsc');
    const viteCli = resolveRepoFile('node_modules/vite/bin/vite.js');
    return [
      { command: 'node', args: [tscCli] },
      { command: 'node', args: [viteCli, 'build'] },
      {
        command: 'node',
        args: [viteCli, 'preview', '--port', String(port), '--strictPort', '--host', '0.0.0.0'],
      },
    ];
  }

  fail(`Unknown preset "${name}".`);
}

async function main() {
  if (!preset) {
    fail('Missing preset. Use one of: playwright|vite-dev|server-start|issue77-preview');
  }

  const runtime = resolveRuntime();
  info(`preset=${preset} runtime=${runtime}`);

  const steps = getStepsForPreset(runtime, preset, presetArgs);
  for (const step of steps) {
    const exitCode = await runStep(step);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}

module.exports = {
  getStepsForPreset,
  resolveStepStdio,
  runStep,
};
