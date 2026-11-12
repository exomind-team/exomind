import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { jsonRequest } from '../runtime/transport.mjs';
import { temp } from './helpers.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
async function kill(child, signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode)
    return; const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(signal); await exited; }
async function start(directory, port = 0) {
    const child = spawn(process.execPath, ['runtime/cli.mjs', '--data-dir', directory, '--port', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => stderr += d);
    child.stdout.resume();
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null)
            throw new Error(`启动失败: ${stderr}`);
        try {
            const c = JSON.parse(readFileSync(join(directory, 'connection.runtime.json'), 'utf8'));
            await jsonRequest({ url: c.url + '/v1/hello', token: c.token });
            return { child, connection: c };
        }
        catch { }
        await delay(30);
    }
    await kill(child);
    throw new Error('启动超时');
}
const call = (c, path, body) => jsonRequest({ url: c.url + path, token: c.token, ...(body === undefined ? {} : { method: 'POST', body }) });
async function until(predicate) { for (let i = 0; i < 150; i++) {
    if (await predicate())
        return;
    await delay(100);
} throw new Error('自动补齐超时'); }
test('两个独立进程、无 UI：自动同步，强杀后确认记录保留并补齐离线增量', async (t) => {
    const aDir = temp(), bDir = temp(), children = [];
    t.after(async () => { for (const child of children)
        await kill(child); rmSync(aDir, { recursive: true, force: true }); rmSync(bDir, { recursive: true, force: true }); });
    const a = await start(aDir), b = await start(bDir);
    children.push(a.child, b.child);
    const invitation = await call(a.connection, '/v1/pair/invitation', {});
    await call(b.connection, '/v1/pair/join', { invitation });
    const sent = await call(b.connection, '/v1/capture', { id: randomUUID(), text: '收到落盘回执后强杀', files: [] });
    await until(async () => { const data = await call(a.connection, '/v1/timeline'); return data.items.some(op => op.id === sent.id); });
    const identity = await call(b.connection, '/v1/hello'), oldPort = new URL(b.connection.url).port;
    await kill(b.child, 'SIGKILL');
    for (let i = 0; i < 7; i++)
        await call(a.connection, '/v1/capture', { id: randomUUID(), text: `离线阶段新增 ${i}`, files: [] });
    const restarted = await start(bDir, oldPort);
    children.push(restarted.child);
    const next = await call(restarted.connection, '/v1/hello');
    assert.equal(next.deviceId, identity.deviceId);
    assert.equal(next.epochId, identity.epochId);
    assert.equal((await call(restarted.connection, `/v1/operations/${sent.id}`)).id, sent.id);
    await until(async () => { const data = await call(restarted.connection, '/v1/timeline'); return data.items.length === 8; });
    assert.equal((await call(a.connection, '/v1/timeline')).items.length, 8);
});
