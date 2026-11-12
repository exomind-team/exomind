import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../runtime/server.mjs';
import { jsonRequest } from '../runtime/transport.mjs';
export function temp() { return mkdtempSync(join(tmpdir(), 'exomind-test-')); }
export async function app(t, options = {}) { const directory = temp(); const value = await createApp({ directory, background: false, ...options }); t.after(async () => { await value.close(); rmSync(directory, { recursive: true, force: true }); }); return value; }
export function api(a, path, body, options = {}) { return jsonRequest({ url: `${a.origin}${path}`, token: a.token, ...(body !== undefined ? { method: 'POST', body } : {}), ...options }); }
export async function pair(a, b) { const invitation = await api(a, '/v1/pair/invitation', {}); await api(b, '/v1/pair/join', { invitation }); return invitation; }
export function note(a, text = '一条记录') { return api(a, '/v1/capture', { id: randomUUID(), text, files: [], blockId: null }); }
