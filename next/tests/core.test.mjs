import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { Store } from '../runtime/store.mjs';
import { Blobs } from '../runtime/blobs.mjs';
import { digest, hashObject, LIMITS } from '../runtime/contracts.mjs';
import { temp, app, api, pair, note } from './helpers.mjs';
test('提交重试保留同一记录，同 ID 改内容拒绝', () => {
    const directory = temp(), s = new Store(directory), id = randomUUID();
    try {
        const input = { id, text: '记下即可', files: [] };
        s.capture(input, () => true);
        assert.equal(s.capture(input, () => true).replayed, true);
        assert.equal(s.count(), 1);
        assert.throws(() => s.capture({ ...input, text: '改过了' }, () => true), /内容发生变化/);
        assert.equal(s.operation(id).payload.text, '记下即可');
    }
    finally {
        s.close();
        rmSync(directory, { recursive: true });
    }
});
test('持久化、时间块和自动总结任务重启后保留', () => {
    const directory = temp();
    let s = new Store(directory);
    const start = randomUUID(), end = randomUUID();
    try {
        s.startBlock({ id: start, name: '休息', note: '不要求生产性成果' });
        s.endBlock({ id: end, blockId: start, feedback: '喝了水' });
        s.close();
        s = new Store(directory);
        assert.equal(s.block(start).state, 'ended');
        assert.equal(s.jobs()[0].id, end);
        assert.equal(s.current().active.length, 0);
    }
    finally {
        s.close();
        rmSync(directory, { recursive: true });
    }
});
test('未完整附件不允许提交事件；分块重试、续传与哈希校验', async () => {
    const directory = temp(), s = new Store(directory), b = new Blobs(s), bytes = Buffer.from('图片或文件内容'), hash = digest(bytes);
    try {
        b.begin({ hash, size: bytes.length });
        assert.throws(() => s.capture({ id: randomUUID(), text: '', files: [{ hash, size: bytes.length, name: '图.png', mime: 'image/png' }] }, (h, z) => b.has(h, z)), /尚未校验/);
        b.write({ hash, offset: 0, bytes: bytes.subarray(0, 5) });
        assert.equal(b.begin({ hash, size: bytes.length }).offset, 5);
        assert.equal(b.write({ hash, offset: 0, bytes: bytes.subarray(0, 5) }).replayed, true);
        b.write({ hash, offset: 5, bytes: bytes.subarray(5) });
        await b.commit(hash);
        assert.equal(b.has(hash, bytes.length), true);
        assert.deepEqual(b.read({ hash }), bytes);
    }
    finally {
        s.close();
        rmSync(directory, { recursive: true });
    }
});
test('错误附件哈希不进入已校验存储', async () => {
    const directory = temp(), s = new Store(directory), b = new Blobs(s), hash = digest('expected');
    try {
        b.begin({ hash, size: 3 });
        b.write({ hash, offset: 0, bytes: Buffer.from('bad') });
        await assert.rejects(b.commit(hash), /校验失败/);
        assert.equal(b.has(hash), false);
        assert.equal(b.begin({ hash, size: 8 }).offset, 0);
    }
    finally {
        s.close();
        rmSync(directory, { recursive: true });
    }
});
test('双实例配对、分页补齐、双方离线新增后收敛', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    for (let n = 0; n < 131; n++)
        await note(a, `A-${n}`);
    for (let n = 0; n < 5; n++)
        await note(b, `B-${n}`);
    assert.equal((await b.sync.sync(a.store.identity.deviceId)).state, 'caught_up');
    await a.sync.sync(b.store.identity.deviceId);
    await b.sync.sync(a.store.identity.deviceId);
    assert.equal(a.store.count(), 136);
    assert.equal(b.store.count(), 136);
    assert.deepEqual(a.store.db.prepare('SELECT id,digest FROM operations ORDER BY id').all(), b.store.db.prepare('SELECT id,digest FROM operations ORDER BY id').all());
    await a.sync.sync(b.store.identity.deviceId);
    assert.equal(a.store.count(), 136);
});
test('读到健康接口不代表授权；只读和配对令牌不能发起业务写入', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    await assert.rejects(api(a, '/v1/hello', undefined, { token: 'wrong' }), e => e.status === 401);
    const token = await api(a, '/v1/access-tokens', { name: 'WinCraft', role: 'observer' });
    assert.equal((await api(a, '/v1/views/current', undefined, { token: token.token })).active.length, 0);
    await assert.rejects(api(a, '/v1/capture', { id: randomUUID(), text: '不应写入', files: [] }, { token: token.token }), e => e.status === 403);
    const peer = b.store.peer(a.store.identity.deviceId);
    await assert.rejects(api(a, '/v1/capture', { id: randomUUID(), text: '不应写入', files: [] }, { token: peer.outbound }), e => e.status === 403);
});
test('另一空间不能覆盖已有记录；邀请单次消费', async (t) => {
    const a = await app(t), b = await app(t), c = await app(t);
    await note(b, '保留');
    const inv = await api(a, '/v1/pair/invitation', {});
    await assert.rejects(api(b, '/v1/pair/join', { invitation: inv }), e => e.code === 'space_not_empty');
    await api(c, '/v1/pair/join', { invitation: inv });
    const d = await app(t);
    await assert.rejects(api(d, '/v1/pair/join', { invitation: inv }), e => e.code === 'invitation_used');
    assert.equal(b.store.count(), 1);
});
test('离线并发开始显式呈现两个当前时间块', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    a.store.startBlock({ id: randomUUID(), name: '电脑上的工作' });
    b.store.startBlock({ id: randomUUID(), name: '平板上的休息' });
    await a.sync.sync(b.store.identity.deviceId);
    await b.sync.sync(a.store.identity.deviceId);
    assert.equal(a.store.current().conflict, true);
    assert.equal(a.store.current().active.length, 2);
    assert.equal(b.store.current().active.length, 2);
});
test('同 ID 异内容进入隔离区，不覆盖、不前移游标', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    const id = randomUUID();
    a.store.capture({ id, text: '原文' }, () => true);
    b.store.capture({ id, text: '另一端同 ID' }, () => true);
    const result = await b.sync.sync(a.store.identity.deviceId);
    assert.equal(result.error.code, 'record_conflict');
    assert.equal(b.store.operation(id).payload.text, '另一端同 ID');
    assert.equal(b.store.peer(a.store.identity.deviceId).cursor, 0);
    assert.equal(b.store.db.prepare('SELECT COUNT(*) AS n FROM quarantine').get().n, 1);
});
test('暂停与撤销不删除设备身份，旧代际不能应用数据', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    await note(a);
    const peer = b.store.peer(a.store.identity.deviceId), page = a.store.changes();
    b.store.setPeer(peer.id, 'pause');
    assert.throws(() => b.store.applyRemote(page, peer.id, peer.generation), /旧请求结果/);
    assert.equal(b.store.peers().length, 1);
    b.store.setPeer(peer.id, 'resume');
    b.store.setPeer(peer.id, 'revoke');
    assert.throws(() => b.store.setPeer(peer.id, 'resume'), /重新配对/);
});
test('附件随元数据同步且逐块验证', async (t) => {
    const a = await app(t), b = await app(t);
    await pair(a, b);
    const bytes = Buffer.alloc(LIMITS.chunk + 37, 93), hash = digest(bytes);
    a.blobs.begin({ hash, size: bytes.length });
    a.blobs.write({ hash, offset: 0, bytes: bytes.subarray(0, LIMITS.chunk) });
    a.blobs.write({ hash, offset: LIMITS.chunk, bytes: bytes.subarray(LIMITS.chunk) });
    await a.blobs.commit(hash);
    a.store.capture({ id: randomUUID(), text: '附件', files: [{ hash, size: bytes.length, name: 'proof.bin', mime: 'application/octet-stream' }] }, (h, z) => a.blobs.has(h, z));
    await b.sync.sync(a.store.identity.deviceId);
    assert.equal(b.blobs.has(hash, bytes.length), true);
    assert.deepEqual(b.blobs.read({ hash, length: 10 }), bytes.subarray(0, 10));
});
test('超过 100 条仍分页读取，101 条上下文不伪装为空', () => {
    const directory = temp(), s = new Store(directory);
    try {
        const block = randomUUID();
        s.startBlock({ id: block, name: '阅读' });
        for (let i = 0; i < 101; i++)
            s.capture({ id: randomUUID(), text: `第 ${i} 条`, blockId: block }, () => true);
        s.endBlock({ id: randomUUID(), blockId: block, feedback: '读完一部分' });
        const context = s.context(s.jobs()[0]);
        assert.equal(context.coverage.total, 103);
        assert.equal(context.sources.length, 103);
        assert.equal(context.coverage.readStatus, 'complete');
        assert.ok(context.sources.every(x => x.id && x.digest));
    }
    finally {
        s.close();
        rmSync(directory, { recursive: true });
    }
});
test('大上下文明确标注部分覆盖，数据库故障不能返回空数据', () => {
    const directory = temp(), s = new Store(directory);
    const block = randomUUID();
    s.startBlock({ id: block, name: '记录' });
    for (let i = 0; i < 5; i++)
        s.capture({ id: randomUUID(), text: '字'.repeat(20000), blockId: block }, () => true);
    s.endBlock({ id: randomUUID(), blockId: block });
    const job = s.jobs()[0];
    assert.equal(s.context(job).coverage.readStatus, 'partial');
    s.close();
    assert.throws(() => s.context(job));
    rmSync(directory, { recursive: true });
});
test('地址改变不改变稳定身份、密钥和已确认游标', async (t) => { const a = await app(t), b = await app(t); await pair(a, b); await note(a); await b.sync.sync(a.store.identity.deviceId); const old = b.store.peer(a.store.identity.deviceId); await api(b, `/v1/peers/${old.id}/endpoint`, { endpoint: a.origin }); const current = b.store.peer(old.id); assert.equal(current.id, old.id); assert.equal(current.outbound, old.outbound); assert.equal(current.inbound_hash, old.inbound_hash); assert.equal(current.cursor, old.cursor); assert.equal(current.generation, old.generation + 1); });
