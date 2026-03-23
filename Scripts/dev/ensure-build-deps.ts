import { spawnSync } from 'node:child_process';

const shouldSkipInstall = process.env.EXOMIND_SKIP_BUN_INSTALL === '1';

if (shouldSkipInstall) {
  console.log('Skipping bun install because CI bootstrap already completed / CI 已完成前置依赖安装，跳过重复 bun install');
  process.exit(0);
}

const result = spawnSync('bun', ['install', '--frozen-lockfile'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
