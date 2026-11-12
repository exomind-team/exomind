import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID, X509Certificate } from 'node:crypto';
import { Store } from './store.mjs';
import { Blobs } from './blobs.mjs';
import { SyncEngine } from './sync.mjs';
import { SummaryWorker } from './summary.mjs';
import { jsonRequest } from './transport.mjs';
import { LIMITS, VERSION, PROTOCOL, Fault, requireThat, text, uuid, integer, object, secret, digest, matchesSecret, endpoint, publicError } from './contracts.mjs';
const ASSETS = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
    ['/api.mjs', ['api.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req, { raw = false, limit = LIMITS.json } = {}) {
    if (!raw)
        requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'content_type', '请求必须使用 application/json', 415);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit)
            throw new Fault('body_too_large', '请求体超过安全上限', 413);
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (raw)
        return buffer;
    try {
        return object(JSON.parse(buffer.toString('utf8')));
    }
    catch (error) {
        if (error instanceof Fault)
            throw error;
        throw new Fault('invalid_json', '请求体不是合法 JSON');
    }
}
function caCertificate(value) {
    if (value === null || value === undefined)
        return null;
    text(value, 'CA 证书', 16384, { empty: false });
    try {
        new X509Certificate(value);
    }
    catch {
        throw new Fault('invalid_certificate', 'CA 证书无效');
    }
    return value;
}
const READ_PATHS = new Set(['/v1/hello', '/v1/timeline', '/v1/current', '/v1/views/current', '/v1/jobs', '/v1/search']);
function canRead(path) { return READ_PATHS.has(path) || /^\/v1\/blocks\/[0-9a-f-]+$/.test(path) || path.startsWith('/v1/operations/') || /^\/v1\/blobs\/[a-f0-9]{64}$/.test(path); }
/** Start an isolated application. It never probes or opens the old ExoMind database. */
export async function createApp({ directory, name = '我的设备', spaceId, host = '127.0.0.1', port = 0, advertise, allowTrustedHttp = false, tls, provider = null, background = true, logger = () => { } }) {
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
    requireThat(loopback || tls || allowTrustedHttp, 'unsafe_bind', '非本机监听必须配置 TLS，或显式接受受信网络 HTTP 风险');
    const store = new Store(directory, { name, ...(spaceId ? { spaceId } : {}) });
    const blobs = new Blobs(store);
    const sync = new SyncEngine(store, blobs), summaries = new SummaryWorker(store, provider);
    let origin, advertised;
    const hosts = new Set();
    const protocol = tls ? 'https:' : 'http:';
    const ownerToken = store.meta('ownerToken');
    const handler = async (req, res) => {
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.setHeader('x-frame-options', 'DENY');
        try {
            requireThat(hosts.has(req.headers.host), 'invalid_host', 'Host 不在本实例允许列表中', 403);
            const requestOrigin = req.headers.origin;
            requireThat(!requestOrigin || requestOrigin === `${protocol}//${req.headers.host}`, 'origin_rejected', '拒绝跨站请求', 403);
            const url = new URL(req.url, origin), path = url.pathname, method = req.method;
            if (method === 'GET' && ASSETS.has(path)) {
                const [file, mime] = ASSETS.get(path);
                res.writeHead(200, { 'content-type': mime });
                res.end(readFileSync(new URL(`../web/${file}`, import.meta.url)));
                return;
            }
            if (method === 'GET' && path === '/health') {
                json(res, 200, { status: 'ok', version: VERSION, protocol: PROTOCOL });
                return;
            }
            if (method === 'POST' && path === '/v1/pair/claim') {
                const input = await body(req);
                requireThat(input.protocol === PROTOCOL, 'protocol_mismatch', '协议不匹配', 409);
                input.endpoint = endpoint(input.endpoint, allowTrustedHttp);
                input.ca = caCertificate(input.ca);
                json(res, 200, store.claimInvitation(input));
                return;
            }
            const raw = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
            let principal;
            if (matchesSecret(raw, digest(ownerToken)))
                principal = { role: 'owner' };
            else {
                const token = store.db.prepare('SELECT id,role FROM access_tokens WHERE hash=? AND revoked=0').get(digest(raw));
                if (token)
                    principal = token;
                else {
                    const peer = store.authenticatePeer(raw);
                    if (peer)
                        principal = { role: 'peer', id: peer.id, generation: peer.generation };
                }
            }
            requireThat(principal, 'unauthorized', '需要有效的本机或配对访问令牌', 401);
            if (principal.role === 'peer')
                requireThat(method === 'GET' && (path === '/v1/hello' || path === '/v1/changes' || path === '/v1/checkpoint' || /^\/v1\/blobs\/[a-f0-9]{64}$/.test(path)), 'forbidden', '配对令牌只允许读取同步数据', 403);
            if (principal.role === 'observer')
                requireThat(method === 'GET' && canRead(path), 'forbidden', '只读接入不能执行该操作', 403);
            if (principal.role === 'writer')
                requireThat((method === 'GET' && canRead(path)) || path === '/v1/capture' || path.startsWith('/v1/blocks/') || path.startsWith('/v1/blobs/'), 'forbidden', '写入令牌不能管理配对、模型或权限', 403);
            if (method === 'GET' && path === '/v1/hello') {
                json(res, 200, store.hello());
                return;
            }
            if (method === 'GET' && path === '/v1/checkpoint') {
                json(res, 200, store.checkpoint(Number(url.searchParams.get('at'))));
                return;
            }
            if (method === 'GET' && path === '/v1/changes') {
                const after = Number(url.searchParams.get('after') ?? 0), through = url.searchParams.has('through') ? Number(url.searchParams.get('through')) : store.highwater();
                json(res, 200, store.changes({ after, through }));
                return;
            }
            if (method === 'GET' && (path === '/v1/timeline' || path === '/v1/search')) {
                const options = {};
                if (url.searchParams.has('before'))
                    options.before = Number(url.searchParams.get('before'));
                if (path === '/v1/search')
                    options.query = text(url.searchParams.get('q') ?? '', '查询', 300);
                json(res, 200, store.timeline(options));
                return;
            }
            if (method === 'GET' && path.startsWith('/v1/operations/')) {
                const op = store.operation(uuid(path.slice('/v1/operations/'.length)));
                requireThat(op, 'not_found', '记录不存在', 404);
                json(res, 200, op);
                return;
            }
            if (method === 'GET' && (path === '/v1/current' || path === '/v1/views/current')) {
                json(res, 200, { ...store.current(), protocol: PROTOCOL, deviceId: store.identity.deviceId, spaceId: store.identity.spaceId, snapshotSeq: store.highwater(), observedAt: Date.now() });
                return;
            }
            if (method === 'POST' && path === '/v1/capture') {
                json(res, 200, store.capture(await body(req), (hash, size) => blobs.has(hash, size), { accessRole: principal.role, accessId: principal.id ?? 'owner' }));
                return;
            }
            const blockRead = path.match(/^\/v1\/blocks\/([0-9a-f-]+)$/);
            if (method === 'GET' && blockRead) {
                const block = store.block(uuid(blockRead[1]));
                requireThat(block, 'not_found', '时间块不存在', 404);
                json(res, 200, block);
                return;
            }
            const blockMethods = { '/v1/blocks/start': 'startBlock', '/v1/blocks/end': 'endBlock', '/v1/blocks/feedback': 'addFeedback' };
            if (method === 'POST' && blockMethods[path]) {
                json(res, 200, store[blockMethods[path]](await body(req)));
                return;
            }
            if (method === 'POST' && path === '/v1/blobs/begin') {
                json(res, 200, blobs.begin(await body(req)));
                return;
            }
            const chunkMatch = path.match(/^\/v1\/blobs\/([a-f0-9]{64})\/chunks\/(\d+)$/);
            if (method === 'PUT' && chunkMatch) {
                const bytes = await body(req, { raw: true, limit: LIMITS.chunk });
                json(res, 200, blobs.write({ hash: chunkMatch[1], offset: Number(chunkMatch[2]), bytes }));
                return;
            }
            const commitMatch = path.match(/^\/v1\/blobs\/([a-f0-9]{64})\/commit$/);
            if (method === 'POST' && commitMatch) {
                await body(req);
                json(res, 200, await blobs.commit(commitMatch[1]));
                return;
            }
            const blobMatch = path.match(/^\/v1\/blobs\/([a-f0-9]{64})$/);
            if (method === 'GET' && blobMatch) {
                if (principal.role === 'peer')
                    requireThat(store.isReferenced(blobMatch[1]), 'not_found', '附件未关联到本空间记录', 404);
                const bytes = blobs.read({ hash: blobMatch[1], offset: Number(url.searchParams.get('offset') ?? 0), length: Number(url.searchParams.get('length') ?? LIMITS.chunk) });
                res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment', 'content-length': String(bytes.length) });
                res.end(bytes);
                return;
            }
            if (method === 'GET' && path === '/v1/jobs') {
                json(res, 200, { items: store.jobs(), providerConfigured: !!provider });
                return;
            }
            const jobMatch = path.match(/^\/v1\/jobs\/([0-9a-f-]+)\/(cancel|retry)$/);
            if (method === 'POST' && jobMatch) {
                await body(req);
                if (jobMatch[2] === 'cancel')
                    summaries.cancel(jobMatch[1]);
                else
                    store.retryJob(jobMatch[1]);
                json(res, 200, { accepted: true });
                return;
            }
            if (method === 'GET' && path === '/v1/peers') {
                json(res, 200, { items: store.peers(), missingAttachments: blobs.missing().length });
                return;
            }
            const endpointMatch = path.match(/^\/v1\/peers\/([0-9a-f-]+)\/endpoint$/);
            if (method === 'POST' && endpointMatch) {
                const input = await body(req);
                const result = store.updatePeerEndpoint(endpointMatch[1], { endpoint: endpoint(input.endpoint, allowTrustedHttp), ca: input.ca === undefined ? undefined : caCertificate(input.ca) });
                sync.interrupt(endpointMatch[1]);
                json(res, 200, result);
                return;
            }
            const peerMatch = path.match(/^\/v1\/peers\/([0-9a-f-]+)\/(pause|resume|revoke|sync)$/);
            if (method === 'POST' && peerMatch) {
                await body(req);
                if (peerMatch[2] === 'sync')
                    json(res, 200, await sync.sync(peerMatch[1]));
                else {
                    const result = store.setPeer(peerMatch[1], peerMatch[2]);
                    sync.interrupt(peerMatch[1]);
                    json(res, 200, result);
                }
                return;
            }
            if (method === 'POST' && path === '/v1/pair/invitation') {
                const input = await body(req);
                const exposed = endpoint(input.endpoint ?? advertised, allowTrustedHttp);
                json(res, 200, store.createInvitation({ endpoint: exposed, ca: caCertificate(input.ca ?? tls?.ca ?? null) }));
                return;
            }
            if (method === 'POST' && path === '/v1/pair/join') {
                const input = await body(req), inv = object(input.invitation, '邀请');
                requireThat(inv.protocol === PROTOCOL, 'protocol_mismatch', '邀请协议不匹配', 409);
                uuid(inv.id);
                uuid(inv.deviceId);
                uuid(inv.epochId);
                uuid(inv.spaceId);
                requireThat(inv.deviceId !== store.identity.deviceId, 'self_pair', '不能配对自身');
                const remote = endpoint(inv.endpoint, allowTrustedHttp), ca = caCertificate(inv.ca);
                const returnEndpoint = endpoint(input.endpoint ?? advertised, allowTrustedHttp);
                requireThat(inv.spaceId === store.identity.spaceId || (store.count() === 0 && store.peers().length === 0), 'space_not_empty', '请为另一空间建立空白实例，不会覆盖当前记录', 409);
                let attempt = store.db.prepare('SELECT request FROM pair_attempts WHERE id=?').get(inv.id);
                if (!attempt) {
                    const claim = { protocol: PROTOCOL, invitationId: inv.id, invitationToken: inv.token, deviceId: store.identity.deviceId, epochId: store.identity.epochId, name: store.identity.name, inboundToken: secret(), endpoint: returnEndpoint, ca: caCertificate(input.ca ?? tls?.ca ?? null) };
                    store.db.prepare('INSERT INTO pair_attempts VALUES (?,?)').run(inv.id, JSON.stringify(claim));
                    attempt = { request: JSON.stringify(claim) };
                }
                const claim = JSON.parse(attempt.request);
                requireThat(claim.endpoint === returnEndpoint, 'pair_attempt_changed', '未确认的配对请求仍使用原返回地址；请重试原请求或创建新邀请', 409);
                const response = await jsonRequest({ url: `${remote}/v1/pair/claim`, method: 'POST', body: claim, ca });
                requireThat(response.protocol === PROTOCOL && response.deviceId === inv.deviceId && response.epochId === inv.epochId && response.spaceId === inv.spaceId, 'pair_identity_mismatch', '邀请与对端身份不一致，未完成本机配对', 409);
                text(response.tokenForCaller, '配对令牌', 100, { empty: false });
                requireThat(response.tokenForCaller.length >= 40, 'weak_token', '对端令牌强度不足', 409);
                store.transaction(() => {
                    store.adoptSpace(inv.spaceId);
                    store.putPeer({ id: inv.deviceId, name: response.name, endpoint: remote, space: inv.spaceId, epoch: inv.epochId, inbound_hash: digest(claim.inboundToken), outbound: response.tokenForCaller, ca });
                });
                json(res, 200, { paired: true, deviceId: inv.deviceId, spaceId: inv.spaceId, sync: 'not_yet_confirmed' });
                return;
            }
            if (method === 'POST' && path === '/v1/access-tokens') {
                const input = await body(req);
                requireThat(['observer', 'writer'].includes(input.role), 'invalid_role', '仅支持 observer / writer');
                text(input.name, '接入名称', 100, { empty: false });
                const id = randomUUID(), token = secret();
                store.db.prepare('INSERT INTO access_tokens(id,name,hash,role) VALUES (?,?,?,?)').run(id, input.name, digest(token), input.role);
                json(res, 200, { id, name: input.name, role: input.role, token });
                return;
            }
            const tokenMatch = path.match(/^\/v1\/access-tokens\/([0-9a-f-]+)\/revoke$/);
            if (method === 'POST' && tokenMatch) {
                await body(req);
                store.db.prepare('UPDATE access_tokens SET revoked=1 WHERE id=?').run(tokenMatch[1]);
                json(res, 200, { revoked: true });
                return;
            }
            if (method === 'GET' && path === '/v1/diagnostics') {
                json(res, 200, { ...store.hello(), operations: store.count(), missingAttachments: blobs.missing().length, peers: store.peers(), jobs: store.jobs().map(({ id, state, attempts, error }) => ({ id, state, attempts, error })), quarantined: store.db.prepare('SELECT COUNT(*) AS n FROM quarantine').get().n, transport: tls ? 'https' : allowTrustedHttp ? 'trusted_http_explicit' : 'loopback_http' });
                return;
            }
            throw new Fault('not_found', '接口不存在', 404);
        }
        catch (error) {
            logger({ at: new Date().toISOString(), level: 'error', code: error.code ?? 'internal_error', method: req.method, path: req.url?.split('?')[0] });
            if (!res.headersSent)
                json(res, error instanceof Fault ? error.status : 500, { error: publicError(error) });
            else
                res.destroy();
        }
    };
    const server = tls ? https.createServer({ key: tls.key, cert: tls.cert }, handler) : http.createServer(handler);
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;
    server.maxHeadersCount = 64;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    }
    catch (error) {
        store.close();
        throw error;
    }
    const bound = server.address();
    origin = `${protocol}//${host.includes(':') ? `[${host}]` : host}:${bound.port}`;
    const browserHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host;
    const browserOrigin = `${protocol}//${browserHost}:${bound.port}`;
    advertised = endpoint(advertise ?? browserOrigin, allowTrustedHttp);
    [origin, browserOrigin, advertised, `${protocol}//localhost:${bound.port}`, `${protocol}//127.0.0.1:${bound.port}`].forEach(value => hosts.add(new URL(value).host));
    if (background) {
        sync.start();
        summaries.start();
    }
    let closed = false;
    return { store, blobs, sync, summaries, server, origin: browserOrigin, advertised, token: ownerToken,
        async close() { if (closed)
            return; closed = true; await sync.stop(); await summaries.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
