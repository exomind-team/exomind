#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportPortable, inspectPortable, restorePortable } from '../runtime/portable.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { connection: { type: 'string' }, out: { type: 'string' }, bundle: { type: 'string' }, name: { type: 'string' } } });
try {
    let result;
    switch (positionals[0]) {
        case 'export':
            result = await exportPortable({ connection: JSON.parse(readFileSync(values.connection, 'utf8')), destination: resolve(values.out) });
            break;
        case 'inspect': {
            const { manifest } = await inspectPortable(resolve(values.bundle));
            result = manifest;
            break;
        }
        case 'restore':
            result = await restorePortable({ bundle: resolve(values.bundle), destination: resolve(values.out), name: values.name });
            break;
        default: throw new Error('命令：export --connection <私有连接文件> --out <新目录> | inspect --bundle <包目录> | restore --bundle <包目录> --out <全新数据目录>');
    }
    console.log(JSON.stringify(result, null, 2));
}
catch (error) {
    console.error(JSON.stringify({ error: { code: error.code ?? 'portable_failed', message: error.message } }));
    process.exitCode = 1;
}
