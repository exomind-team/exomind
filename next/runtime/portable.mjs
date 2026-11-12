import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, copyFileSync, createReadStream, openSync, writeSync, fsyncSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { request, jsonRequest } from './transport.mjs';
import { PROTOCOL, LIMITS, digest, requireThat, validateOperation, blobHash, integer } from './contracts.mjs';
const FORMAT = 'exomind-portable/1';
async function fileHash(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path))
    hash.update(chunk); return hash.digest('hex'); }
function newDirectory(path) { requireThat(!existsSync(path), 'destination_exists', '目标必须是不存在的新目录，不覆盖任何既有数据', 409); mkdirSync(path, { mode: 0o700 }); writeFileSync(join(path, 'INCOMPLETE'), '未完成，请勿当作可用备份或运行目录。\n', { mode: 0o600 }); }
/** Export a finite append-only business snapshot, not auth settings or worker state. */
export async function exportPortable({ connection, destination }) {
    const json = path => jsonRequest({ url: connection.url + path, token: connection.token, ca: connection.ca });
    const hello = await json('/v1/hello');
    requireThat(hello.protocol === PROTOCOL, 'protocol_mismatch', '导出端协议不匹配', 409);
    newDirectory(destination);
    mkdirSync(join(destination, 'blobs'), { mode: 0o700 });
    let before = hello.highwater + 1;
    const ops = [];
    while (before) {
        const page = await json(`/v1/timeline?before=${before}`);
        requireThat(Array.isArray(page.items), 'invalid_page', '导出分页格式错误');
        for (const item of page.items) {
            const { localSeq, ...op } = item;
            validateOperation(op, hello.spaceId);
            ops.push(op);
        }
        if (page.nextBefore !== null)
            requireThat(page.nextBefore < before, 'invalid_cursor', '导出游标未前进');
        before = page.nextBefore;
    }
    ops.reverse();
    const raw = ops.map(op => JSON.stringify(op)).join('\n') + (ops.length ? '\n' : '');
    writeFileSync(join(destination, 'operations.jsonl'), raw, { mode: 0o600 });
    const files = new Map();
    for (const op of ops)
        for (const file of op.kind === 'capture' ? op.payload.files : [])
            files.set(file.hash, file);
    for (const file of files.values()) {
        const path = join(destination, 'blobs', file.hash), fd = openSync(path, 'wx', 0o600);
        let offset = 0;
        try {
            while (offset < file.size) {
                const r = await request({ url: `${connection.url}/v1/blobs/${file.hash}?offset=${offset}&length=${Math.min(LIMITS.chunk, file.size - offset)}`, token: connection.token, ca: connection.ca, maxBytes: LIMITS.chunk });
                requireThat(r.bytes.length > 0, 'empty_chunk', '导出附件没有进展', 502);
                let n = 0;
                while (n < r.bytes.length)
                    n += writeSync(fd, r.bytes, n, r.bytes.length - n);
                offset += r.bytes.length;
            }
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        requireThat(await fileHash(path) === file.hash, 'blob_hash_mismatch', '导出附件校验失败；目录仍标记未完成', 409);
    }
    const manifest = { format: FORMAT, protocol: PROTOCOL, spaceId: hello.spaceId, through: hello.highwater, operationCount: ops.length, operationsHash: digest(raw), files: [...files.values()].map(({ hash, size }) => ({ hash, size })), createdAt: new Date().toISOString(), excluded: ['device identity', 'pair credentials', 'model credentials', 'summary job queue', 'browser drafts', 'old ExoMind data'] };
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    unlinkSync(join(destination, 'INCOMPLETE'));
    return manifest;
}
export async function inspectPortable(directory) {
    requireThat(!existsSync(join(directory, 'INCOMPLETE')), 'incomplete_bundle', '导出包不完整，禁止导入', 409);
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    requireThat(manifest.format === FORMAT && manifest.protocol === PROTOCOL, 'protocol_mismatch', '不支持的可移植格式', 409);
    const raw = readFileSync(join(directory, 'operations.jsonl'), 'utf8');
    requireThat(digest(raw) === manifest.operationsHash, 'snapshot_hash_mismatch', '记录清单校验失败', 409);
    const ops = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    requireThat(ops.length === manifest.operationCount, 'snapshot_count_mismatch', '记录数量不符', 409);
    const ids = new Set(), refs = new Map();
    for (const op of ops) {
        validateOperation(op, manifest.spaceId);
        requireThat(!ids.has(op.id), 'duplicate_id', '导出包包含重复 ID', 409);
        ids.add(op.id);
        if (op.kind === 'capture')
            for (const f of op.payload.files)
                refs.set(f.hash, f);
    }
    requireThat(Array.isArray(manifest.files) && manifest.files.length === refs.size, 'manifest_mismatch', '附件清单与记录引用不一致', 409);
    const seenFiles = new Set();
    for (const file of manifest.files) {
        blobHash(file.hash);
        integer(file.size, '附件大小', { max: LIMITS.blob });
        requireThat(!seenFiles.has(file.hash), 'duplicate_blob', '附件清单重复', 409);
        seenFiles.add(file.hash);
        requireThat(refs.get(file.hash)?.size === file.size, 'manifest_mismatch', '附件长度与记录引用不一致', 409);
        const path = join(directory, 'blobs', file.hash);
        requireThat(statSync(path).size === file.size && await fileHash(path) === file.hash, 'blob_hash_mismatch', '可移植包附件校验失败', 409);
    }
    return { manifest, operations: ops };
}
export async function restorePortable({ bundle, destination, name = '恢复的设备' }) {
    const { manifest, operations } = await inspectPortable(bundle);
    newDirectory(destination);
    const store = new Store(destination, { name, spaceId: manifest.spaceId });
    try {
        mkdirSync(join(destination, 'blobs'), { mode: 0o700 });
        for (const file of manifest.files)
            copyFileSync(join(bundle, 'blobs', file.hash), join(destination, 'blobs', file.hash));
        store.transaction(() => { for (const op of operations)
            store.insert(op); for (const file of manifest.files)
            store.db.prepare('INSERT INTO blobs VALUES (?,?,?)').run(file.hash, file.size, Date.now()); });
        const result = { operations: store.count(), files: manifest.files.length, newDeviceId: store.identity.deviceId, newEpochId: store.identity.epochId, spaceId: store.identity.spaceId };
        store.close();
        unlinkSync(join(destination, 'INCOMPLETE'));
        return result;
    }
    catch (error) {
        store.close();
        throw error;
    }
}
