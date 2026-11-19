import { describe, expect, it, vi } from 'vitest';
import { nativeBetaClient } from '@/beta/client';

const nativeStatus = { protocol: 'exomind-beta/1', device_id: '33333333-3333-4333-8333-333333333333', running: true };
const autoStatus = {
  network_enabled: true,
  policy_enabled: true,
  max_bytes: 8 * 1024 * 1024,
  active_outbound: 0,
  deferred: false,
  last_error_code: null,
};

function clientFor(reply: unknown) {
  const call = vi.fn(async <T>(command: string, _args?: Record<string, unknown>): Promise<T> => {
    if (command === 'beta_status') return nativeStatus as T;
    if (command === 'beta_peer_original_auto_status') return reply as T;
    throw new Error('unexpected Native command');
  });
  const client = nativeBetaClient(call as Parameters<typeof nativeBetaClient>[0]);
  const diagnostics = (client as unknown as {
    originalAutoDiagnostics: { status(): Promise<unknown> };
  }).originalAutoDiagnostics;
  return { call, diagnostics };
}

describe('Native original auto diagnostics read boundary', () => {
  it('uses one argument-free read command and issues no fetch or policy mutation', async () => {
    const fixture = clientFor(autoStatus);
    await expect(fixture.diagnostics.status()).resolves.toEqual(autoStatus);
    expect(fixture.call.mock.calls.map(([command]) => command)).toEqual([
      'beta_status',
      'beta_peer_original_auto_status',
    ]);
    expect(fixture.call.mock.calls[1][1]).toBeUndefined();
  });

  it('rejects an unknown secret-bearing field without returning its value', async () => {
    const secret = 'owner_token-secret-value';
    const fixture = clientFor({ ...autoStatus, owner_token: secret });
    let failure: unknown;
    try {
      await fixture.diagnostics.status();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'invalid_original_auto_diagnostics' });
    expect(String(failure)).not.toContain(secret);
  });
});
