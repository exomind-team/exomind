import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Enumerate paths ourselves: Windows command shells do not expand POSIX globs.
const files = readdirSync('tests')
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => `tests/${name}`);
if (!files.length) throw new Error('没有发现测试文件，不能把空套件报告为通过。');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
