import { spawnSync } from 'node:child_process';

function runStep(label: string, args: string[]): void {
  console.log(`[build] ${label}`);
  const result = spawnSync('bun', ['run', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      process.exit(result.status);
    }
    return;
  }

  process.exit(1);
}

runStep('ensure-build-deps', ['ensure:build-deps']);
runStep('build:web', ['build:web']);
