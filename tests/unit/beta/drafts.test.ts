import { describe, expect, it, vi } from 'vitest';
import { BetaDraftController } from '@/beta/drafts';
import type { BetaReceipt } from '@/beta/client';
import { deferred, fakeClient, memoryStorage, saved } from './fixtures';

function controller(client = fakeClient(), storage = memoryStorage(), device = 'device-a') {
  let id = 0;
  return new BetaDraftController(client, device, storage, () => `id-${++id}`, () => 1234);
}
describe('Beta reliable drafts', () => {
  it('reopens an unknown command, reads its original receipt, and never sends a second fact', async () => {
    const client = fakeClient(); const storage = memoryStorage();
    client.capture.mockRejectedValueOnce({ code: 'network', message: 'lost receipt' });
    const first = controller(client, storage); first.setDraft('p', 'original');
    await first.submit('p');
    const command = client.capture.mock.calls[0][0]; first.dispose();
    client.receipt.mockResolvedValueOnce(saved(command));
    const reopened = controller(client, storage);
    await reopened.retry(command.command_id);
    expect(client.receipt).toHaveBeenCalledWith('p', command.command_id);
    expect(client.capture).toHaveBeenCalledTimes(1);
    expect(reopened.snapshot().drafts.p.text).toBe('');
  });
  it('retries the exact payload and IDs only after a missing receipt', async () => {
    const client = fakeClient(); client.capture.mockRejectedValueOnce(new Error('timeout'));
    const draft = controller(client); draft.setDraft('p', '  original\n中文  ');
    await draft.submit('p'); await draft.submit('p');
    expect(client.capture.mock.calls[1][0]).toEqual(client.capture.mock.calls[0][0]);
    expect(client.receipt).toHaveBeenCalledTimes(1);
    expect(client.capture.mock.calls[0][0].occurred_at_ms).toBe(1234);
  });
  it('a late receipt clears neither the newer same-profile draft nor another profile', async () => {
    const client = fakeClient(); const flight = deferred<BetaReceipt>(); client.capture.mockReturnValueOnce(flight.promise);
    const draft = controller(client); draft.setDraft('p', 'old'); const result = draft.submit('p');
    draft.setDraft('p', 'new'); draft.setDraft('q', 'other');
    flight.resolve(saved(client.capture.mock.calls[0][0])); await result;
    expect(draft.snapshot().drafts.p.text).toBe('new'); expect(draft.snapshot().drafts.q.text).toBe('other');
  });
  it('validates receipt scope on reconciliation and preserves Native error categories', async () => {
    const client = fakeClient(); client.capture.mockRejectedValueOnce({ code: 'scope_mismatch', message: 'wrong profile' });
    const draft = controller(client); draft.setDraft('p', 'keep'); await draft.submit('p');
    expect(draft.snapshot().pending[0]).toMatchObject({ error_code: 'scope_mismatch', message: 'wrong profile' });
    const command = client.capture.mock.calls[0][0]; client.receipt.mockResolvedValueOnce({ ...saved(command), profile_id: 'q' });
    await draft.retry(command.command_id);
    expect(draft.snapshot().drafts.p.text).toBe('keep');
    expect(draft.snapshot().pending[0].error_code).toBe('invalid_receipt');
    expect(client.capture).toHaveBeenCalledTimes(1);
  });
  it('never resends when receipt lookup itself fails; concurrent clicks share one flight', async () => {
    const client = fakeClient(); const flight = deferred<BetaReceipt>(); client.capture.mockReturnValueOnce(flight.promise);
    const draft = controller(client); draft.setDraft('p', 'one'); const a = draft.submit('p'); const b = draft.submit('p');
    expect(client.capture).toHaveBeenCalledTimes(1); flight.reject('lost'); await Promise.all([a,b]);
    client.receipt.mockRejectedValueOnce(new Error('offline')); await draft.submit('p');
    expect(client.capture).toHaveBeenCalledTimes(1);
  });
  it('isolates device/profile caches and a disposed owner cannot erase a reopened newer draft', async () => {
    const client = fakeClient(); const storage = memoryStorage(); const flight = deferred<BetaReceipt>(); client.capture.mockReturnValueOnce(flight.promise);
    const old = controller(client, storage); old.setDraft('p', 'old'); const result = old.submit('p'); old.dispose();
    const reopened = controller(client, storage); reopened.setDraft('p', 'new');
    const other = controller(client, storage, 'device-b'); expect(other.snapshot().pending).toHaveLength(0);
    expect(other.snapshot().drafts).toEqual({}); flight.resolve(saved(client.capture.mock.calls[0][0])); await result;
    expect(controller(client, storage).snapshot().drafts.p.text).toBe('new');
  });
  it('fails closed for corrupt storage and saves the pending snapshot before any RPC', async () => {
    const client = fakeClient(); const storage = memoryStorage(); storage.setItem('exomind:beta:drafts:device-a', '{bad');
    const bad = controller(client, storage); expect(() => bad.setDraft('p', 'keep')).toThrow();
    expect(storage.getItem('exomind:beta:drafts:device-a')).toBe('{bad');
    const flaky = { getItem: () => null, setItem: vi.fn() }; const draft = new BetaDraftController(client, 'device', flaky);
    draft.setDraft('p', 'unsent'); flaky.setItem.mockImplementation(() => { throw new Error('quota'); });
    await expect(draft.submit('p')).rejects.toThrow('尚未向服务发送'); expect(client.capture).not.toHaveBeenCalled();
  });
  it('retains only bounded receipt metadata after many successful large-text saves', async () => {
    const client = fakeClient(); const storage = memoryStorage(); const draft = controller(client, storage);
    for (let index = 0; index < 20; index++) {
      draft.setDraft('p', `private-fulltext-${index}:${'文'.repeat(20_000)}`); await draft.submit('p');
    }
    const raw = storage.getItem('exomind:beta:drafts:device-a')!;
    expect(raw.includes('private-fulltext-')).toBe(false);
    expect(raw.length).toBeLessThan(10_000);
    expect(draft.snapshot().pending).toHaveLength(0);
    // A reopened controller still edits normally; discarded confirmations never resend.
    expect(controller(client, storage).snapshot().drafts.p.text).toBe('');
  });
});
