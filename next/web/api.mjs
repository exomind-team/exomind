export class Api {
    constructor(token) { this.token = token; }
    async request(path, { method = 'GET', body, bytes, signal } = {}) {
        const response = await fetch(path, { method, signal, headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(bytes ? { 'content-type': 'application/octet-stream' } : {}) }, body: bytes ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'error' });
        if (!response.ok) {
            let error;
            try {
                error = (await response.json()).error;
            }
            catch { }
            const failure = new Error(error?.message ?? `HTTP ${response.status}，未确认成功`);
            failure.code = error?.code;
            failure.status = response.status;
            throw failure;
        }
        return response;
    }
    async get(path) { return (await this.request(path)).json(); }
    async post(path, body = {}) { return (await this.request(path, { method: 'POST', body })).json(); }
}
export async function hashFile(file) { const data = await file.arrayBuffer(); const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data)); return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export async function upload(api, file, progress) {
    if (file.size > 64 * 1024 * 1024)
        throw new Error('首版单附件上限 64 MiB');
    if (!crypto.subtle)
        throw new Error('附件上传需要本机页面或 HTTPS 安全上下文');
    const hash = await hashFile(file);
    let state = await api.post('/v1/blobs/begin', { hash, size: file.size });
    while (state.offset < file.size) {
        const end = Math.min(file.size, state.offset + 256 * 1024);
        const bytes = await file.slice(state.offset, end).arrayBuffer();
        state = await (await api.request(`/v1/blobs/${hash}/chunks/${state.offset}`, { method: 'PUT', bytes })).json();
        progress(state.offset, file.size);
    }
    await api.post(`/v1/blobs/${hash}/commit`);
    return { hash, size: file.size, name: file.name, mime: file.type || 'application/octet-stream' };
}
export async function readFile(api, file) {
    const chunks = [];
    let offset = 0;
    while (offset < file.size) {
        const response = await api.request(`/v1/blobs/${file.hash}?offset=${offset}&length=${Math.min(256 * 1024, file.size - offset)}`);
        const part = await response.arrayBuffer();
        if (!part.byteLength)
            throw new Error('附件传输中断');
        chunks.push(part);
        offset += part.byteLength;
    }
    const result = new Blob(chunks, { type: file.mime });
    if (await hashFile(result) !== file.hash)
        throw new Error('附件哈希不一致，拒绝下载');
    return result;
}
