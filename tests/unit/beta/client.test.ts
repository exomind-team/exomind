import { describe, expect, it, vi } from 'vitest';
import { nativeBetaClient, webBetaClient, type BetaCommand } from '@/beta/client';
import { saved } from './fixtures';

const command: BetaCommand = { command_id: 'c', event_id: 'e', profile_id: 'p', occurred_at_ms: 1234, text: '中文 %_\'', tags: [] };
const hello = (device_id = 'device-a', runtime_id = 'runtime-a') => ({ protocol: 'exomind-beta/1', device_id, runtime_id, running: true });
function respond(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
describe('Beta transports', () => {
  it('validates anonymous hello before releasing owner credentials', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => respond({ ...hello(), protocol: 'old' }));
    const client = webBetaClient('http://localhost:4310', 'secret', fetcher);
    await expect(client.profiles()).rejects.toMatchObject({ code: 'incompatible_service' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('/hello');
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
  it('mints a scoped human grant and submits with it, never the owner token', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url); if (path.endsWith('/hello')) return respond(hello());
      if (path.endsWith('/grants')) return respond({ profile_id: 'p', kind: 'human', token: 'human-secret' });
      return respond(saved(command));
    });
    const client = webBetaClient('http://localhost:4310/beta/v1', 'owner-secret', fetcher);
    await client.capture(command);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests[1][1].headers).toMatchObject({ Authorization: 'Bearer owner-secret' });
    expect(requests[2][1]).toMatchObject({ headers: { Authorization: 'Bearer human-secret' }, body: JSON.stringify(command), redirect: 'error' });
    expect(requests.every(([url]) => !url.includes('secret'))).toBe(true);
  });
  it('refuses a changed service device before granting or sending; runtime restart keeps receipt reconciliation', async () => {
    let device = 'device-a'; let runtime = 'run1';
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/hello')) return respond(hello(device, runtime));
      if (String(url).endsWith('/grants')) return respond({ profile_id: 'p', kind: 'human', token: runtime });
      return respond(saved(command));
    });
    const client = webBetaClient('http://localhost:4310', 'owner', fetcher); await client.status(); runtime = 'run2';
    expect(await client.receipt('p', 'c')).toEqual(saved(command)); device = 'device-b';
    await expect(client.capture(command)).rejects.toMatchObject({ code: 'identity_changed' });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/capture'))).toHaveLength(0);
  });
  it('maps only receipt not_found to null and preserves other failures', async () => {
    let failure = 'not_found';
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/hello')) return respond(hello());
      if (String(url).endsWith('/grants')) return respond({ profile_id: 'p', kind: 'human', token: 'h' });
      return respond({ error: { code: failure, message: 'unavailable' } }, 404);
    });
    const client = webBetaClient('http://localhost:4310', 'owner', fetcher);
    expect(await client.receipt('p', 'c')).toBeNull(); failure = 'forbidden';
    await expect(client.receipt('p', 'c')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('uses Native DTO arguments and rejects a receipt from another command', async () => {
    const call = vi.fn(async (name: string) => name === 'beta_status' ? hello() : { ...saved(command), command_id: 'wrong' });
    const client = nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
    await expect(client.capture(command)).rejects.toMatchObject({ code: 'invalid_receipt' });
    expect(call).toHaveBeenCalledWith('beta_capture', { command });
  });
});
