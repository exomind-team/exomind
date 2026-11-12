import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { app, api, pair, note, temp } from './helpers.mjs';
import { jsonRequest, request } from '../runtime/transport.mjs';
import { createApp } from '../runtime/server.mjs';
import { hashObject, PROTOCOL, LIMITS } from '../runtime/contracts.mjs';
function raw(url, headers, body = '') { return new Promise((resolve, reject) => { const req = http.request(url, { method: body ? 'POST' : 'GET', headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); }); req.on('error', reject); req.end(body); }); }
test('默认拒绝非本机明文监听', async () => { const directory = temp(); try {
    await assert.rejects(createApp({ directory, host: '0.0.0.0', port: 0 }), /非本机监听/);
}
finally {
    rmSync(directory, { recursive: true });
} });
test('拒绝跨站 Origin、错误 Host 与未授权读取', async (t) => {
    const a = await app(t);
    assert.equal((await raw(`${a.origin}/v1/hello`, { origin: 'https://attacker.invalid', authorization: `Bearer ${a.token}` })).status, 403);
    assert.equal((await raw(`${a.origin}/health`, { host: 'attacker.invalid' })).status, 403);
    assert.equal((await raw(`${a.origin}/v1/timeline`, {})).status, 401);
});
test('JSON 内容类型和字段不能通过表单注入绕过', async (t) => { const a = await app(t); const r = await raw(`${a.origin}/v1/capture`, { authorization: `Bearer ${a.token}`, 'content-type': 'text/plain' }, JSON.stringify({ id: randomUUID(), text: '拒绝', files: [] })); assert.equal(r.status, 415); assert.equal(a.store.count(), 0); });
test('摘要/诊断响应不暴露访问密钥', async (t) => { const a = await app(t), b = await app(t); await pair(a, b); const diagnostics = JSON.stringify(await api(a, '/v1/diagnostics')); assert.ok(!diagnostics.includes(a.token)); assert.ok(!diagnostics.includes(a.store.peer(b.store.identity.deviceId).outbound)); assert.ok(!JSON.stringify(await api(a, '/v1/peers')).includes('inbound_hash')); });
test('配对凭据不能读取未关联的暂存附件', async (t) => { const a = await app(t), b = await app(t); await pair(a, b); const peer = b.store.peer(a.store.identity.deviceId); await assert.rejects(request({ url: `${a.origin}/v1/blobs/${'a'.repeat(64)}`, token: peer.outbound }), e => e.status === 404); });
test('撤销接入令牌即拒绝后续请求', async (t) => { const a = await app(t); const access = await api(a, '/v1/access-tokens', { name: '工具', role: 'writer' }); await api(a, '/v1/access-tokens/' + access.id + '/revoke', {}); await assert.rejects(api(a, '/v1/hello', undefined, { token: access.token }), e => e.status === 401); });
test('未知协议不接受邀请，过期邀请不能登记设备', async (t) => { const a = await app(t), b = await app(t); const inv = await api(a, '/v1/pair/invitation', {}); await assert.rejects(api(b, '/v1/pair/join', { invitation: { ...inv, protocol: 'old/0' } }), e => e.code === 'protocol_mismatch'); a.store.db.prepare('UPDATE invitations SET expires=0').run(); await assert.rejects(api(b, '/v1/pair/join', { invitation: inv }), e => e.code === 'invalid_invitation'); assert.equal(a.store.peers().length, 0); });
test('同步远端旧历史恢复不能冒充已补齐', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    await note(a);
    await b.sync.sync(a.store.identity.deviceId);
    // Deliberate isolated corruption: product has no operation deletion endpoint.
    a.store.db.prepare('DELETE FROM operations').run();
    const result = await b.sync.sync(a.store.identity.deviceId);
    assert.equal(result.error.code, 'remote_history_rewound');
    assert.equal(b.store.count(), 1);
});
test('同长度但不同历史前缀由哈希检查点检出', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    await note(a);
    await b.sync.sync(a.store.identity.deviceId);
    a.store.db.prepare("UPDATE operations SET chain_hash=? WHERE seq=1").run('f'.repeat(64));
    const result = await b.sync.sync(a.store.identity.deviceId);
    assert.equal(result.error.code, 'history_mismatch');
});
test('错误哈希链、空进展、外空间与未知记录字段不推进游标', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    await note(a);
    const peer = b.store.peer(a.store.identity.deviceId), page = a.store.changes();
    assert.throws(() => b.store.applyRemote({ ...page, toHash: 'f'.repeat(64) }, peer.id, peer.generation), /哈希链/);
    assert.throws(() => b.store.applyRemote({ ...page, operations: [], to: 0, hasMore: true, toHash: peer.cursor_hash }, peer.id, peer.generation), /没有进展/);
    const op = { ...page.operations[0], space: randomUUID() };
    delete op.digest;
    op.digest = hashObject(op);
    const foreign = { ...page, operations: [op] };
    // Invalid chain is rejected before the foreign payload can enter the store.
    assert.throws(() => b.store.applyRemote(foreign, peer.id, peer.generation));
    assert.equal(b.store.peer(peer.id).cursor, 0);
    assert.equal(b.store.count(), 0);
});
test('HTTP 重定向不跟随，不把令牌送往重定向目的地', async (t) => { const server = http.createServer((req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/secret' }); res.end(); }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r))); await assert.rejects(jsonRequest({ url: `http://127.0.0.1:${server.address().port}`, token: 'fixture' }), e => e.status === 302); });
test('真实 HTTPS：默认拒绝自签证书，显式 CA 配对与复制可用', async (t) => {
    if (spawnSync('openssl', ['version']).status !== 0) {
        t.skip('此机器无 openssl，必须在本地补跑 TLS 测试');
        return;
    }
    const root = temp();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const cert = join(root, 'cert.pem'), key = join(root, 'key.pem');
    const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    assert.equal(gen.status, 0);
    const ca = readFileSync(cert, 'utf8');
    const a = await app(t, { tls: { cert: ca, key: readFileSync(key), ca } }), b = await app(t);
    await assert.rejects(api(a, '/v1/hello'), e => e.code === 'connection_failed');
    const inv = await api(a, '/v1/pair/invitation', {}, { ca });
    await api(b, '/v1/pair/join', { invitation: inv });
    a.store.capture({ id: randomUUID(), text: 'TLS 内的记录' }, () => true);
    assert.equal((await b.sync.sync(a.store.identity.deviceId)).state, 'caught_up');
    assert.equal(b.store.count(), 1);
});
