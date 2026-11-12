import { LIMITS, publicError, requireThat } from './contracts.mjs';
import { jsonRequest, request, assertHello } from './transport.mjs';
/** One pull loop per peer; connection failure never removes trusted identity. */
export class SyncEngine {
    constructor(store, blobs) { this.store = store; this.blobs = blobs; this.running = new Map(); this.timer = null; this.stopped = false; }
    start() { this.stopped = false; this.timer = setInterval(() => this.tick(), 1500); this.timer.unref(); this.tick(); }
    tick() { if (this.stopped)
        return; for (const peer of this.store.peers())
        if (peer.enabled && !peer.revoked && peer.next_retry <= Date.now())
            void this.sync(peer.id); }
    async stop() { this.stopped = true; clearInterval(this.timer); for (const r of this.running.values())
        r.controller.abort(); await Promise.allSettled([...this.running.values()].map(r => r.promise)); }
    interrupt(id) { this.running.get(id)?.controller.abort(); }
    sync(id) {
        if (this.running.has(id))
            return this.running.get(id).promise;
        const controller = new AbortController();
        const promise = this.perform(id, controller.signal).finally(() => this.running.delete(id));
        this.running.set(id, { controller, promise });
        return promise;
    }
    async perform(id, signal) {
        const peer = this.store.peer(id);
        if (!peer || !peer.enabled || peer.revoked)
            return { state: 'inactive' };
        const generation = peer.generation, options = { token: peer.outbound, ca: peer.ca, signal };
        try {
            const hello = await jsonRequest({ ...options, url: `${peer.endpoint}/v1/hello` });
            this.store.assertPeerGeneration(id, generation);
            assertHello(hello, peer, this.store.identity.spaceId);
            let cursor = peer.cursor, pages = 0;
            const through = hello.highwater;
            requireThat(cursor <= through, 'remote_history_rewound', '对端历史短于已确认游标，停止同步以保护已有记录', 409);
            if (cursor) {
                const checkpoint = await jsonRequest({ ...options, url: `${peer.endpoint}/v1/checkpoint?at=${cursor}` });
                requireThat(checkpoint.epochId === peer.epoch && checkpoint.hash === peer.cursor_hash, 'history_mismatch', '对端历史前缀已变化，停止同步并等待显式修复', 409);
            }
            signal.throwIfAborted();
            // Bounded work per turn; a durable cursor resumes the same finite history next turn.
            while (cursor < through && pages < 16) {
                const page = await jsonRequest({ ...options, url: `${peer.endpoint}/v1/changes?after=${cursor}&through=${through}` });
                signal.throwIfAborted();
                this.store.applyRemote(page, id, generation);
                cursor = page.to;
                pages++;
            }
            this.store.assertPeerGeneration(id, generation);
            // Limit blob work per peer turn so new text is not starved behind a large backlog.
            const candidates = this.blobs.missing().slice(0, 4);
            for (const file of candidates) {
                this.store.assertPeerGeneration(id, generation);
                let upload = this.blobs.begin(file);
                let chunks = 0;
                while (upload.offset < file.size && chunks < 16) {
                    let response;
                    try {
                        response = await request({ ...options, url: `${peer.endpoint}/v1/blobs/${file.hash}?offset=${upload.offset}&length=${Math.min(LIMITS.chunk, file.size - upload.offset)}`, maxBytes: LIMITS.chunk });
                    }
                    catch (error) {
                        if (error.status === 404)
                            break;
                        throw error;
                    }
                    this.store.assertPeerGeneration(id, generation);
                    if (!response.bytes.length)
                        throw new Error('Empty blob chunk');
                    upload = this.blobs.write({ hash: file.hash, offset: upload.offset, bytes: response.bytes });
                    chunks++;
                }
                if (upload.offset === file.size) {
                    this.store.assertPeerGeneration(id, generation);
                    await this.blobs.commit(file.hash);
                }
            }
            this.store.assertPeerGeneration(id, generation);
            const state = cursor < through ? 'catching_up' : this.blobs.missing().length ? 'attachments_pending' : 'caught_up';
            this.store.db.prepare('UPDATE peers SET status=?,error=NULL,last_success=?,failures=0,next_retry=0 WHERE id=? AND generation=?').run(state, Date.now(), id, generation);
            return { state, cursor, through };
        }
        catch (error) {
            const current = this.store.peer(id);
            if (current?.generation === generation && current.enabled && !current.revoked) {
                const details = publicError(error), failures = current.failures + 1;
                this.store.db.prepare("UPDATE peers SET status='error',error=?,failures=?,next_retry=? WHERE id=? AND generation=?")
                    .run(`${details.code}: ${details.message}`, failures, Date.now() + Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) + Math.floor(Math.random() * 500), id, generation);
            }
            return { state: 'error', error: publicError(error) };
        }
    }
}
