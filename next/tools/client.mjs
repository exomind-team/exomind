#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { jsonRequest } from '../runtime/transport.mjs';
import { PROTOCOL, requireThat } from '../runtime/contracts.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { connection: { type: 'string' }, text: { type: 'string' }, id: { type: 'string' }, 'block-id': { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'observer' }, out: { type: 'string' } } });
try {
    requireThat(values.connection, 'missing_connection', '必须指定 --connection 私有连接文件');
    const c = JSON.parse(readFileSync(values.connection, 'utf8'));
    const call = (path, body) => jsonRequest({ url: c.url + path, token: c.token, ca: c.ca, ...(body !== undefined ? { method: 'POST', body } : {}) });
    const hello = await call('/v1/hello');
    requireThat(hello.protocol === PROTOCOL, 'protocol_mismatch', '这不是本候选协议；拒绝向旧 RT 猜测写入');
    const command = positionals[0] ?? 'status';
    let result;
    if (['capture', 'start', 'end'].includes(command))
        requireThat(values.id, 'missing_id', '写入必须提供持久的 --id UUID；不确定结果时使用同一个 ID 重试');
    switch (command) {
        case 'status':
            result = await call('/v1/views/current');
            break;
        case 'capture':
            result = await call('/v1/capture', { id: values.id, text: values.text ?? '', files: [], blockId: values['block-id'] ?? null });
            break;
        case 'start':
            result = await call('/v1/blocks/start', { id: values.id, name: values.name ?? '', note: values.text ?? '' });
            break;
        case 'end':
            result = await call('/v1/blocks/end', { id: values.id, blockId: values['block-id'], feedback: values.text ?? '' });
            break;
        case 'events': {
            let before = hello.highwater + 1;
            const items = [];
            while (before) {
                const page = await call(`/v1/timeline?before=${before}`);
                items.push(...page.items);
                if (page.nextBefore !== null)
                    requireThat(page.nextBefore < before, 'no_progress', '分页未前进');
                before = page.nextBefore;
            }
            result = { coverage: 'complete_at_snapshot', through: hello.highwater, items: items.reverse() };
            break;
        }
        case 'token': {
            requireThat(values.out, 'missing_output', '创建令牌必须指定 --out 私有文件，避免密钥打印到日志');
            result = await call('/v1/access-tokens', { name: values.name ?? '外部接入', role: values.role });
            writeFileSync(values.out, JSON.stringify({ schema: 1, protocol: PROTOCOL, url: c.url, token: result.token, role: result.role, id: result.id, ca: c.ca ?? null }, null, 2), { flag: 'wx', mode: 0o600 });
            result = { id: result.id, role: result.role, saved: true };
            break;
        }
        default: throw new Error('命令：status | capture | start | end | events | token');
    }
    if (['capture', 'start', 'end'].includes(command))
        requireThat(result.id === values.id, 'receipt_mismatch', '回执 ID 与请求 ID 不一致，不能宣称写入成功');
    console.log(JSON.stringify(result, null, 2));
}
catch (error) {
    console.error(JSON.stringify({ error: { code: error.code ?? 'client_error', message: error.message } }));
    process.exitCode = 1;
}
