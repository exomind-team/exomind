import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Fault, LIMITS, PROTOCOL, VERSION, EMPTY_CHAIN, requireThat, uuid, text, integer, hashObject, validateOperation, validateAttachments, secret, digest, matchesSecret } from './contracts.mjs';
/** Owns durable facts. No HTTP, model calls, timers or UI state belongs here. */
export class Store {
    constructor(directory, { name = '我的设备', spaceId = randomUUID() } = {}) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.directory = directory;
        this.db = new DatabaseSync(join(directory, 'buffer.sqlite'));
        chmodSync(join(directory, 'buffer.sqlite'), 0o600);
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        requireThat(version <= 1, 'database_newer', '数据格式高于当前程序，拒绝降级打开', 409);
        this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
        this.transaction(() => {
            for (const [key, value] of Object.entries({ deviceId: randomUUID(), epochId: randomUUID(), spaceId: uuid(spaceId), name: text(name, '设备名称', 100, { empty: false }), ownerToken: secret() })) {
                this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run(key, value);
            }
        });
        this.identity = { deviceId: this.meta('deviceId'), epochId: this.meta('epochId'), spaceId: this.meta('spaceId'), name: this.meta('name') };
    }
    meta(key) { return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value; }
    close() { this.db.close(); }
    transaction(action) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = action();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    hello() { return { version: VERSION, protocol: PROTOCOL, ...this.identity, highwater: this.highwater() }; }
    highwater() { return this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM operations').get().n; }
    count() { return this.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n; }
    rowOperation(row) {
        return row ? { schema: 1, id: row.id, space: row.space, actor: row.actor, kind: row.kind, at: row.at, payload: JSON.parse(row.payload), digest: row.digest } : null;
    }
    operation(id) { return this.rowOperation(this.db.prepare('SELECT * FROM operations WHERE id=?').get(id)); }
    insert(op) {
        const previous = this.checkpoint(this.highwater()).hash;
        this.db.prepare('INSERT INTO operations(id,space,actor,kind,at,payload,digest,chain_hash) VALUES (?,?,?,?,?,?,?,?)').run(op.id, op.space, op.actor, op.kind, op.at, JSON.stringify(op.payload), op.digest, digest(`${previous}:${op.digest}`));
    }
    makeOperation({ id = randomUUID(), kind, payload, at = Date.now() }) {
        const raw = { schema: 1, id, space: this.identity.spaceId, actor: this.identity.deviceId, kind, at, payload };
        const op = { ...raw, digest: hashObject(raw) };
        validateOperation(op, this.identity.spaceId);
        return op;
    }
    /** Receipt and record commit together; retries cannot repeat a domain transition. */
    command({ id, kind, input }, execute) {
        uuid(id);
        const inputHash = hashObject(input);
        return this.transaction(() => {
            const previous = this.db.prepare('SELECT * FROM commands WHERE id=?').get(id);
            if (previous) {
                requireThat(previous.kind === kind && previous.input_hash === inputHash, 'idempotency_conflict', '相同操作 ID 的内容发生变化', 409);
                return { ...JSON.parse(previous.result), replayed: true };
            }
            const result = execute();
            this.db.prepare('INSERT INTO commands VALUES (?,?,?,?)').run(id, kind, inputHash, JSON.stringify(result));
            return result;
        });
    }
    capture(input, hasBlob, source = { accessRole: 'owner', accessId: 'owner' }) {
        const { id } = input;
        const payload = { text: text(input.text ?? '', '内容'), files: validateAttachments(input.files ?? []), blockId: input.blockId ?? null, source };
        if (payload.blockId !== null)
            uuid(payload.blockId);
        return this.command({ id, kind: 'capture', input: payload }, () => {
            for (const file of payload.files)
                requireThat(hasBlob(file.hash, file.size), 'attachment_incomplete', '附件尚未校验完成，记录未提交', 409);
            if (payload.blockId)
                requireThat(this.operation(payload.blockId)?.kind === 'block.started', 'unknown_block', '关联时间块不存在', 409);
            const op = this.makeOperation({ id, kind: 'capture', payload });
            this.insert(op);
            return { id: op.id, durability: 'local_committed', seq: this.highwater() };
        });
    }
    block(id) {
        const start = this.operation(id);
        if (!start || start.kind !== 'block.started')
            return null;
        const ends = this.db.prepare("SELECT * FROM operations WHERE kind='block.ended' AND json_extract(payload,'$.blockId')=? ORDER BY at,id").all(id).map(r => this.rowOperation(r));
        const feedback = this.db.prepare("SELECT * FROM operations WHERE kind='block.feedback' AND json_extract(payload,'$.blockId')=? ORDER BY at,id").all(id).map(r => this.rowOperation(r));
        return { id, name: start.payload.name, note: start.payload.note, startedAt: start.at, actor: start.actor, state: ends.length === 0 ? 'running' : ends.length === 1 ? 'ended' : 'end_conflict', ends, feedback };
    }
    current() {
        // Multiple offline starts are separate facts, not an implicit last-writer-wins timer.
        const rows = this.db.prepare("SELECT id FROM operations WHERE kind='block.started' AND id NOT IN (SELECT json_extract(payload,'$.blockId') FROM operations WHERE kind='block.ended') ORDER BY at,id").all();
        const active = rows.map(row => this.block(row.id));
        return { active, conflict: active.length > 1 };
    }
    startBlock(input) {
        const { id } = input;
        const payload = { blockId: id, name: text(input.name, '名称', 200, { empty: false }), note: text(input.note ?? '', '备注') };
        return this.command({ id, kind: 'block.started', input: payload }, () => {
            requireThat(this.current().active.length === 0, 'active_block_exists', '请先结束当前时间块；并发开始不会被覆盖', 409);
            const op = this.makeOperation({ id, kind: 'block.started', payload });
            this.insert(op);
            return { id, blockId: id, durability: 'local_committed' };
        });
    }
    endBlock(input) {
        const { id } = input;
        const payload = { blockId: uuid(input.blockId), feedback: text(input.feedback ?? '', '结束反馈') };
        return this.command({ id, kind: 'block.ended', input: payload }, () => {
            const block = this.block(payload.blockId);
            requireThat(block, 'unknown_block', '时间块不存在', 404);
            requireThat(block.state === 'running', 'block_already_ended', '时间块已结束，请使用追加反馈', 409);
            const op = this.makeOperation({ id, kind: 'block.ended', payload, at: Math.max(Date.now(), block.startedAt) });
            this.insert(op);
            this.enqueueJob({ id, blockId: payload.blockId, triggerId: id });
            return { id, blockId: payload.blockId, durability: 'local_committed', summary: 'queued' };
        });
    }
    addFeedback(input) {
        const { id } = input;
        const payload = { blockId: uuid(input.blockId), text: text(input.text, '追加反馈', LIMITS.text, { empty: false }) };
        return this.command({ id, kind: 'block.feedback', input: payload }, () => {
            const block = this.block(payload.blockId);
            requireThat(block, 'unknown_block', '时间块不存在', 404);
            const op = this.makeOperation({ id, kind: 'block.feedback', payload });
            this.insert(op);
            if (block.state === 'ended' && block.ends[0].actor === this.identity.deviceId)
                this.enqueueJob({ id, blockId: payload.blockId, triggerId: id });
            return { id, durability: 'local_committed' };
        });
    }
    checkpoint(at) {
        integer(at, '检查点');
        const hash = at === 0 ? EMPTY_CHAIN : this.db.prepare('SELECT chain_hash FROM operations WHERE seq=?').get(at)?.chain_hash;
        requireThat(hash, 'checkpoint_missing', '检查点不存在；可能发生历史恢复或截断', 409);
        return { epochId: this.identity.epochId, at, hash };
    }
    changes({ after = 0, through = this.highwater(), limit = LIMITS.page } = {}) {
        integer(after, '游标');
        integer(through, '快照上界');
        integer(limit, '分页大小', { min: 1, max: LIMITS.page });
        const high = this.highwater();
        requireThat(after <= through && through <= high, 'cursor_out_of_range', '游标超出当前数据库范围；不能假装同步完成', 409);
        const rows = this.db.prepare('SELECT * FROM operations WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?').all(after, through, limit);
        const to = rows.length ? rows.at(-1).seq : after;
        return { ...this.hello(), from: after, to, through, fromHash: this.checkpoint(after).hash, toHash: this.checkpoint(to).hash, hasMore: to < through, operations: rows.map(r => this.rowOperation(r)) };
    }
    timeline({ before = this.highwater() + 1, limit = 40, query = '' } = {}) {
        integer(before, '游标');
        integer(limit, '分页大小', { min: 1, max: LIMITS.page });
        text(query, '查询', 300);
        const rows = this.db.prepare("SELECT * FROM operations WHERE seq<? AND (?='' OR instr(lower(payload),lower(?))>0) ORDER BY seq DESC LIMIT ?").all(before, query, query, limit + 1);
        const more = rows.length > limit;
        const shown = rows.slice(0, limit);
        return { items: shown.map(r => ({ ...this.rowOperation(r), localSeq: r.seq })), nextBefore: more ? shown.at(-1).seq : null, highwater: this.highwater() };
    }
    applyRemote(page, peerId, generation) {
        const peer = this.peer(peerId);
        this.assertPeerGeneration(peerId, generation);
        requireThat(page.protocol === PROTOCOL && page.deviceId === peer.id && page.epochId === peer.epoch && page.spaceId === this.identity.spaceId, 'peer_identity_changed', '对端身份、空间或协议变化，请重新核对配对', 409);
        requireThat(Array.isArray(page.operations) && page.operations.length <= LIMITS.page, 'invalid_page', '同步页无效', 409);
        integer(page.from, '起始游标');
        integer(page.to, '结束游标');
        integer(page.through, '快照上界');
        requireThat(page.from === peer.cursor && page.to >= page.from && page.to <= page.through && page.to - page.from === page.operations.length && page.hasMore === (page.to < page.through), 'invalid_cursor', '同步分页不连续，拒绝前移游标', 409);
        requireThat(page.fromHash === peer.cursor_hash, 'history_mismatch', '同步历史前缀变化，拒绝自动覆盖', 409);
        requireThat(!page.hasMore || page.to > page.from, 'empty_progress', '同步页没有进展', 409);
        const computed = page.operations.reduce((hash, op) => digest(`${hash}:${op.digest}`), page.fromHash);
        requireThat(computed === page.toHash, 'invalid_checkpoint', '同步页哈希链校验失败', 409);
        const seen = new Map();
        for (const op of page.operations) {
            validateOperation(op, this.identity.spaceId);
            requireThat(!seen.has(op.id), 'duplicate_page_id', '同一同步页包含重复 ID', 409);
            const old = this.operation(op.id) ?? seen.get(op.id);
            if (old && old.digest !== op.digest) {
                this.db.prepare('INSERT OR IGNORE INTO quarantine VALUES (?,?,?,?,?)').run(op.id, op.digest, old.digest, JSON.stringify(op), Date.now());
                throw new Fault('record_conflict', '同 ID 内容冲突已隔离，原记录保留且游标未前移', 409);
            }
            seen.set(op.id, op);
        }
        return this.transaction(() => {
            this.assertPeerGeneration(peerId, generation);
            let inserted = 0;
            for (const op of page.operations)
                if (!this.operation(op.id)) {
                    this.insert(op);
                    inserted++;
                }
            this.db.prepare('UPDATE peers SET cursor=?,cursor_hash=? WHERE id=?').run(page.to, page.toHash, peerId);
            return inserted;
        });
    }
    peer(id) { return this.db.prepare('SELECT * FROM peers WHERE id=?').get(id); }
    peers() {
        return this.db.prepare('SELECT id,name,endpoint,enabled,revoked,generation,cursor,status,error,last_success,failures,next_retry FROM peers ORDER BY name,id').all();
    }
    assertPeerGeneration(id, generation) {
        const p = this.peer(id);
        requireThat(p && p.enabled && !p.revoked && p.generation === generation, 'peer_inactive', '配对已暂停、撤销或更改；旧请求结果不再应用', 409);
        return p;
    }
    authenticatePeer(token) { return this.db.prepare('SELECT * FROM peers WHERE enabled=1 AND revoked=0 AND inbound_hash=?').get(digest(token)); }
    putPeer(peer) {
        const old = this.peer(peer.id);
        this.db.prepare(`INSERT INTO peers(id,name,endpoint,space,epoch,inbound_hash,outbound,ca,generation) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,endpoint=excluded.endpoint,space=excluded.space,epoch=excluded.epoch,inbound_hash=excluded.inbound_hash,outbound=excluded.outbound,ca=excluded.ca,enabled=1,revoked=0,generation=excluded.generation,cursor=0,cursor_hash='0000000000000000000000000000000000000000000000000000000000000000',status='paired',error=NULL,failures=0,next_retry=0`).run(peer.id, peer.name, peer.endpoint, peer.space, peer.epoch, peer.inbound_hash, peer.outbound, peer.ca ?? null, (old?.generation ?? 0) + 1);
    }
    setPeer(id, action) {
        requireThat(this.peer(id), 'unknown_peer', '设备未配对', 404);
        requireThat(['pause', 'resume', 'revoke'].includes(action), 'invalid_action', '未知配对操作');
        const p = this.peer(id);
        requireThat(action !== 'resume' || !p.revoked, 'peer_revoked', '已撤销设备必须重新配对', 409);
        this.db.prepare("UPDATE peers SET enabled=?,revoked=?,generation=generation+1,status=?,error=NULL,next_retry=0,inbound_hash=?,outbound=? WHERE id=?")
            .run(action === 'resume' ? 1 : 0, action === 'revoke' ? 1 : p.revoked, action === 'resume' ? 'paired' : action === 'pause' ? 'paused' : 'revoked', action === 'revoke' ? '' : p.inbound_hash, action === 'revoke' ? '' : p.outbound, id);
        return this.peers().find(p => p.id === id);
    }
    updatePeerEndpoint(id, { endpoint, ca }) {
        const peer = this.peer(id);
        requireThat(peer && !peer.revoked, 'unknown_peer', '不存在可更新的配对；已撤销设备必须重新配对', 404);
        this.db.prepare('UPDATE peers SET endpoint=?,ca=?,generation=generation+1,status=?,error=NULL,failures=0,next_retry=0 WHERE id=?').run(endpoint, ca === undefined ? peer.ca : ca, peer.enabled ? 'paired' : 'paused', id);
        return this.peers().find(p => p.id === id);
    }
    createInvitation({ endpoint, ca = null }) {
        const id = randomUUID(), token = secret(), expires = Date.now() + LIMITS.invitationMs;
        this.db.prepare('INSERT INTO invitations(id,secret_hash,expires) VALUES (?,?,?)').run(id, digest(token), expires);
        return { protocol: PROTOCOL, id, token, expires, endpoint, ca, ...this.identity };
    }
    claimInvitation(input) {
        const inv = this.db.prepare('SELECT * FROM invitations WHERE id=?').get(input.invitationId);
        requireThat(inv && inv.expires > Date.now() && matchesSecret(input.invitationToken, inv.secret_hash), 'invalid_invitation', '邀请无效或已过期', 403);
        const { invitationToken, ...claim } = input;
        const claimHash = hashObject(claim);
        return this.transaction(() => {
            if (inv.response) {
                requireThat(inv.claim_hash === claimHash, 'invitation_used', '邀请已被其他请求使用', 409);
                return JSON.parse(inv.response);
            }
            requireThat(input.deviceId !== this.identity.deviceId, 'self_pair', '不能配对自身');
            uuid(input.deviceId);
            uuid(input.epochId);
            text(input.name, '设备名称', 100, { empty: false });
            text(input.inboundToken, '接收令牌', 100, { empty: false });
            requireThat(input.inboundToken.length >= 40, 'weak_token', '接收令牌强度不足');
            const tokenForCaller = secret();
            this.putPeer({ id: input.deviceId, name: input.name, endpoint: input.endpoint, space: this.identity.spaceId, epoch: input.epochId, inbound_hash: digest(tokenForCaller), outbound: input.inboundToken, ca: input.ca });
            const result = { ...this.hello(), tokenForCaller };
            this.db.prepare('UPDATE invitations SET claim_hash=?,response=? WHERE id=?').run(claimHash, JSON.stringify(result), input.invitationId);
            return result;
        });
    }
    adoptSpace(spaceId) {
        uuid(spaceId);
        requireThat(spaceId === this.identity.spaceId || (this.count() === 0 && this.peers().length === 0), 'space_not_empty', '只能将空白实例加入另一空间；已有记录不会自动搬走', 409);
        this.db.prepare("UPDATE meta SET value=? WHERE key='spaceId'").run(spaceId);
        this.identity.spaceId = spaceId;
    }
    enqueueJob({ id, blockId, triggerId }) {
        this.db.prepare('INSERT OR IGNORE INTO jobs(id,block_id,trigger_id,cutoff,state,created_at) VALUES (?,?,?,?,?,?)').run(id, blockId, triggerId, this.highwater(), 'pending', Date.now());
    }
    jobs() { return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200').all(); }
    recoverJobs() { this.db.prepare("UPDATE jobs SET state='pending',run_id=NULL,error='进程重启，重新领取；原始记录不受影响' WHERE state='running'").run(); }
    claimJob(providerReady) {
        return this.transaction(() => {
            if (!providerReady) {
                this.db.prepare("UPDATE jobs SET state='waiting_provider' WHERE state='pending'").run();
                return null;
            }
            this.db.prepare("UPDATE jobs SET state='pending' WHERE state='waiting_provider'").run();
            const job = this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND next_attempt<=? ORDER BY created_at LIMIT 1").get(Date.now());
            if (!job)
                return null;
            const runId = randomUUID();
            this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1,run_id=?,error=NULL WHERE id=?").run(runId, job.id);
            return { ...job, state: 'running', run_id: runId, attempts: job.attempts + 1 };
        });
    }
    cancelJob(id) {
        const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
        requireThat(job, 'unknown_job', '总结任务不存在', 404);
        requireThat(job.state !== 'succeeded', 'already_finished', '总结已保存，取消不删除历史', 409);
        this.db.prepare("UPDATE jobs SET state='cancelled',run_id=NULL WHERE id=?").run(id);
    }
    retryJob(id) {
        const job = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
        requireThat(job, 'unknown_job', '总结任务不存在', 404);
        requireThat(['cancelled', 'failed', 'waiting_provider'].includes(job.state), 'job_not_retryable', '该任务当前不能重试', 409);
        this.db.prepare("UPDATE jobs SET state='pending',attempts=0,run_id=NULL,error=NULL,next_attempt=0 WHERE id=?").run(id);
    }
    context(job) {
        const start = this.operation(job.block_id);
        requireThat(start?.kind === 'block.started', 'missing_source', '时间块来源尚未齐全', 409);
        const end = this.db.prepare("SELECT * FROM operations WHERE kind='block.ended' AND json_extract(payload,'$.blockId')=? AND seq<=? ORDER BY seq").all(job.block_id, job.cutoff);
        requireThat(end.length === 1, 'ambiguous_block', '结束事实缺失或存在分叉，不生成单一结论', 409);
        const rows = this.db.prepare(`SELECT * FROM operations WHERE seq<=? AND kind!='summary' AND
      (id=? OR json_extract(payload,'$.blockId')=? OR (kind='capture' AND at>=? AND at<=?)) ORDER BY seq`)
            .all(job.cutoff, job.block_id, job.block_id, start.at, end[0].at);
        const sources = [];
        let chars = 0;
        for (const row of rows) {
            const op = this.rowOperation(row);
            const source = { id: op.id, digest: op.digest, kind: op.kind, at: op.at, payload: op.payload };
            const size = JSON.stringify(source).length;
            if (chars + size > LIMITS.context)
                continue;
            chars += size;
            sources.push(source);
        }
        return { blockId: job.block_id, triggerId: job.trigger_id, spaceId: this.identity.spaceId, sources,
            coverage: { readStatus: sources.length === rows.length ? 'complete' : 'partial', total: rows.length, included: sources.length, omitted: rows.length - sources.length, snapshotSeq: job.cutoff, attachments: 'metadata_only', scope: '本机此快照可见记录，不代表所有设备或现实活动完整' } };
    }
    finishJob(job, output, coverage) {
        return this.transaction(() => {
            const current = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
            if (current?.state !== 'running' || current.run_id !== job.run_id)
                return false;
            requireThat(this.block(job.block_id)?.state === 'ended', 'ambiguous_block', '时间块已发生终态分叉，拒绝提交单一总结', 409);
            const id = randomUUID();
            const op = this.makeOperation({ id, kind: 'summary', payload: { blockId: job.block_id, triggerId: job.trigger_id, ...output, coverage } });
            this.insert(op);
            this.db.prepare("UPDATE jobs SET state='succeeded',result_id=?,run_id=NULL,error=NULL WHERE id=?").run(id, job.id);
            return true;
        });
    }
    failJob(job, message) {
        this.db.prepare("UPDATE jobs SET state=?,run_id=NULL,error=?,next_attempt=? WHERE id=? AND run_id=? AND state='running'")
            .run(job.attempts >= 3 ? 'failed' : 'pending', message, Date.now() + Math.min(60000, 2000 * 2 ** job.attempts), job.id, job.run_id);
    }
    attachmentRefs() {
        const rows = this.db.prepare(`SELECT DISTINCT json_extract(f.value,'$.hash') AS hash,
      json_extract(f.value,'$.size') AS size,json_extract(f.value,'$.name') AS name,
      json_extract(f.value,'$.mime') AS mime
      FROM operations,json_each(operations.payload,'$.files') AS f WHERE kind='capture'`).all();
        const map = new Map();
        for (const file of rows) {
            const old = map.get(file.hash);
            requireThat(!old || old.size === file.size, 'blob_metadata_conflict', '相同附件哈希的长度不同', 409);
            map.set(file.hash, file);
        }
        return [...map.values()];
    }
    isReferenced(hash) { return !!this.db.prepare("SELECT 1 FROM operations, json_each(operations.payload,'$.files') AS f WHERE kind='capture' AND json_extract(f.value,'$.hash')=? LIMIT 1").get(hash); }
}
