import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const roots = ['runtime', 'web', 'tools', 'tests'];
let failed = false, count = 0;
function visit(directory) { for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory())
        visit(path);
    else if (path.endsWith('.mjs')) {
        const r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
        count++;
        if (r.status !== 0) {
            failed = true;
            console.error(r.stderr);
        }
    }
} }
roots.forEach(visit);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!readFileSync('runtime/contracts.mjs', 'utf8').includes(version)) {
    failed = true;
    console.error('包版本与协议模块的应用版本不一致');
}
console.log(`${count} 个 JavaScript 模块语法检查${failed ? '失败' : '通过'}；这不是 TypeScript 静态类型检查。`);
process.exitCode = failed ? 1 : 0;
