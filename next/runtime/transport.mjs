import http from 'node:http';
import https from 'node:https';
import { LIMITS, Fault, requireThat } from './contracts.mjs';
/** Direct HTTP(S); does not inherit a browser's or an environment variable's proxy. */
export function request({ url, method = 'GET', token, body, bytes, ca, signal, timeout = LIMITS.requestMs, maxBytes = LIMITS.json }) {
    return new Promise((resolve, reject) => {
        const target = new URL(url), data = bytes ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
        const headers = { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
        if (data) {
            headers['content-type'] = bytes ? 'application/octet-stream' : 'application/json';
            headers['content-length'] = String(data.length);
        }
        const client = target.protocol === 'https:' ? https : http;
        const req = client.request(target, { method, headers, ca: ca ?? undefined, signal, timeout, agent: false }, res => {
            const chunks = [];
            let length = 0;
            res.on('data', chunk => { length += chunk.length; if (length > maxBytes) {
                res.destroy(new Fault('response_too_large', '响应超过安全上限', 502));
            }
            else
                chunks.push(chunk); });
            res.on('error', reject);
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let code = 'remote_http_error', message = `对端返回 HTTP ${res.statusCode}`;
                    try {
                        const error = JSON.parse(buffer.toString()).error;
                        if (error?.code)
                            code = error.code;
                        if (error?.message)
                            message = error.message;
                    }
                    catch { }
                    reject(new Fault(code, message, res.statusCode));
                    return;
                }
                resolve({ bytes: buffer, headers: res.headers });
            });
        });
        const deadline = setTimeout(() => req.destroy(new Fault('request_timeout', '请求超过总时限；结果尚未确认', 504)), timeout);
        deadline.unref();
        req.on('close', () => clearTimeout(deadline));
        req.on('timeout', () => req.destroy(new Fault('request_timeout', '请求超时；结果可能尚未确认', 504)));
        req.on('error', error => reject(error instanceof Fault ? error : new Fault(signal?.aborted ? 'cancelled' : 'connection_failed', signal?.aborted ? '请求已取消' : `连接失败（${error.code ?? error.name}）`, 502)));
        req.end(data);
    });
}
export async function jsonRequest(options) {
    const response = await request(options);
    try {
        return JSON.parse(response.bytes.toString('utf8'));
    }
    catch {
        throw new Fault('invalid_response', '对端响应不是合法 JSON', 502);
    }
}
export function assertHello(hello, peer, spaceId) {
    requireThat(hello.protocol === 'exomind-buffer/1' && hello.deviceId === peer.id && hello.epochId === peer.epoch && hello.spaceId === spaceId, 'peer_identity_changed', '对端身份、空间或协议与配对不一致', 409);
}
