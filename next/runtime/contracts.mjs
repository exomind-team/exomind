import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const VERSION = '0.6.0-rebuild.1';
export const PROTOCOL = 'exomind-buffer/1';
export const EMPTY_CHAIN = '0'.repeat(64);
export const LIMITS = Object.freeze({
    text: 32768, attachments: 16, blob: 64 * 1024 * 1024,
    chunk: 256 * 1024, page: 64, json: 4 * 1024 * 1024,
    context: 64000, modelResponse: 1024 * 1024,
    invitationMs: 10 * 60 * 1000, requestMs: 15000, modelMs: 60000,
});
export class Fault extends Error {
    constructor(code, message, status = 400, details = undefined) {
        super(message);
        this.name = 'Fault';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}
export function requireThat(condition, code, message, status = 400) {
    if (!condition)
        throw new Fault(code, message, status);
}
export function object(value, label = '对象') {
    requireThat(value && typeof value === 'object' && !Array.isArray(value), 'invalid_input', `${label}必须为对象`);
    return value;
}
export function text(value, label, max = LIMITS.text, { empty = true } = {}) {
    requireThat(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), 'invalid_input', `${label}无效或超过 ${max} 字符`);
    return value;
}
export function uuid(value, label = 'ID') {
    requireThat(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'invalid_id', `${label}必须为 UUID`);
    requireThat(value === value.toLowerCase(), 'invalid_id', `${label}必须使用小写规范形式`);
    return value;
}
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
export function hashObject(value) { return digest(canonical(value)); }
export function secret() { return randomBytes(32).toString('base64url'); }
export function matchesSecret(raw, expectedHash) {
    if (typeof raw !== 'string' || typeof expectedHash !== 'string')
        return false;
    const a = Buffer.from(digest(raw));
    const b = Buffer.from(expectedHash);
    return a.length === b.length && timingSafeEqual(a, b);
}
export function blobHash(value) {
    requireThat(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'invalid_hash', '附件哈希无效');
    return value;
}
export function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'invalid_input', `${label}必须为 ${min}–${max} 的整数`);
    return value;
}
export function validateAttachments(value) {
    requireThat(Array.isArray(value) && value.length <= LIMITS.attachments, 'invalid_input', '附件列表无效');
    for (const file of value) {
        object(file);
        blobHash(file.hash);
        integer(file.size, '附件大小', { max: LIMITS.blob });
        text(file.name, '文件名', 255, { empty: false });
        requireThat(!/[\x00-\x1f/\\]/.test(file.name), 'invalid_input', '文件名不能包含路径或控制字符');
        text(file.mime, '媒体类型', 128);
    }
    return value;
}
export const KINDS = Object.freeze(['capture', 'block.started', 'block.ended', 'block.feedback', 'summary']);
export function validateOperation(op, spaceId) {
    object(op);
    requireThat(Object.keys(op).sort().join(',') === 'actor,at,digest,id,kind,payload,schema,space', 'invalid_operation', '记录字段与协议不一致', 409);
    requireThat(op.schema === 1, 'protocol_mismatch', '不支持的记录格式', 409);
    uuid(op.id);
    uuid(op.actor);
    uuid(op.space);
    integer(op.at, '记录时间');
    requireThat(op.space === spaceId, 'space_mismatch', '记录不属于当前空间', 403);
    requireThat(KINDS.includes(op.kind), 'unknown_kind', '未知记录种类', 409);
    const p = object(op.payload);
    switch (op.kind) {
        case 'capture':
            text(p.text, '内容');
            validateAttachments(p.files);
            requireThat(p.text.trim() || p.files.length, 'empty_capture', '不能发送空记录');
            if (p.blockId !== null)
                uuid(p.blockId, '时间块 ID');
            break;
        case 'block.started':
            requireThat(p.blockId === op.id, 'invalid_block', '开始记录必须使用自身 ID');
            text(p.name, '时间块名称', 200, { empty: false });
            text(p.note, '备注');
            break;
        case 'block.ended':
            uuid(p.blockId);
            text(p.feedback, '结束反馈');
            break;
        case 'block.feedback':
            uuid(p.blockId);
            text(p.text, '追加反馈', LIMITS.text, { empty: false });
            break;
        case 'summary':
            uuid(p.blockId);
            uuid(p.triggerId);
            text(p.narrative, '总结', 4000, { empty: false });
            requireThat(Array.isArray(p.evidence) && p.evidence.length <= 256, 'invalid_summary', '总结来源列表无效');
            p.evidence.forEach(id => uuid(id));
            requireThat(Array.isArray(p.uncertainties) && p.uncertainties.length <= 32, 'invalid_summary', '总结不确定性列表无效');
            p.uncertainties.forEach(s => text(s, '不确定性', 1000));
            object(p.coverage);
            break;
    }
    const { digest: expected, ...unsigned } = op;
    requireThat(blobHash(expected) === hashObject(unsigned), 'digest_mismatch', '记录校验失败', 409);
    return op;
}
export function endpoint(value, allowTrustedHttp = false) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Fault('invalid_endpoint', '请输入完整的 Runtime 地址');
    }
    requireThat(!url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === ''), 'invalid_endpoint', '地址不能包含账号、路径、查询或片段');
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    requireThat(url.protocol === 'https:' || (url.protocol === 'http:' && (loopback || allowTrustedHttp)), 'tls_required', '非本机连接需要 HTTPS；受信网络 HTTP 必须显式启用');
    return url.origin;
}
export function publicError(error) {
    return error instanceof Fault ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } : { code: 'internal_error', message: '内部操作失败，未确认成功；请查看运行日志' };
}
