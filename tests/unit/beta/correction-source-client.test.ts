import { describe, expect, it, vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { nativeCorrectionSourceReader, validateCorrectionSourceEntry, webCorrectionSourceReader } from '@/beta/correction-source-client';
import type { BetaCorrectionEntry } from '@/beta/record-organization-client';

const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const E = '44444444-4444-4444-8444-444444444444';
const T = '55555555-5555-4555-8555-555555555555';
const R = '66666666-6666-4666-8666-666666666666';
const HASH = 'a'.repeat(64);

function status(runtimeId = R, correctionSource: boolean | null = true) {
  return {
    protocol: 'exomind-beta/1', device_id: D, runtime_id: runtimeId, running: true,
    capabilities: correctionSource === null ? {} : { correction_source: correctionSource },
  };
}

function entry(): BetaCorrectionEntry {
  return {
    record: {
      event_id: E, profile_id: P, device_id: D, author_id: D, author_kind: 'human',
      occurred_at_ms: 1_794_560_000_000, target_event_id: T, target_digest: 'b'.repeat(64),
      corrected_text: 'synthetic corrected wording', digest: HASH, local_seq: 9,
    },
    target_state: 'digest_conflict',
  };
}

describe('exact correction source reader', () => {
  it('reads the selected correction by exact profile and event on Native and HTTP', async () => {
    const call = vi.fn(async (name: string) => name === 'beta_status' ? status() : entry());
    const native = nativeCorrectionSourceReader(call as Parameters<typeof nativeCorrectionSourceReader>[0]);
    expect(await native(P, E, HASH)).toEqual(entry());
    expect(call).toHaveBeenCalledWith('beta_correction_event', { profileId: P, eventId: E });

    const json = vi.fn(async () => entry());
    const web = webCorrectionSourceReader({ identity: async () => status(), json });
    expect(await web(P, E, HASH)).toEqual(entry());
    expect(json).toHaveBeenCalledWith(P, `/profiles/${P}/corrections/${E}`);
  });

  it('treats only a successful null response as a missing correction', async () => {
    const read = webCorrectionSourceReader({ identity: async () => status(), json: async () => null });
    await expect(read(P, E, HASH)).resolves.toBeNull();
    const denied = webCorrectionSourceReader({ identity: async () => status(), json: async () => { throw new BetaApiError('forbidden', 'denied'); } });
    await expect(denied(P, E, HASH)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reports an undeclared capability without trying another protocol path', async () => {
    const json = vi.fn(async () => entry());
    const web = webCorrectionSourceReader({ identity: async () => status(R, null), json });
    await expect(web(P, E, HASH)).rejects.toMatchObject({ code: 'unsupported_correction_source' });
    expect(json).not.toHaveBeenCalled();

    const call = vi.fn(async () => status(R, null));
    const native = nativeCorrectionSourceReader(call as Parameters<typeof nativeCorrectionSourceReader>[0]);
    await expect(native(P, E, HASH)).rejects.toMatchObject({ code: 'unsupported_correction_source' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched profile, event, digest, unknown fields and oversized UTF-8 text', () => {
    expect(() => validateCorrectionSourceEntry(entry(), P, E, HASH)).not.toThrow();
    expect(() => validateCorrectionSourceEntry({ ...entry(), extra: true }, P, E, HASH)).toThrow();
    expect(() => validateCorrectionSourceEntry({ ...entry(), record: { ...entry().record, profile_id: Q } }, P, E, HASH)).toThrow();
    expect(() => validateCorrectionSourceEntry({ ...entry(), record: { ...entry().record, event_id: T } }, P, E, HASH)).toThrow();
    expect(() => validateCorrectionSourceEntry({ ...entry(), record: { ...entry().record, digest: 'c'.repeat(64) } }, P, E, HASH)).toThrow();
    expect(() => validateCorrectionSourceEntry({ ...entry(), record: { ...entry().record, corrected_text: '汉'.repeat(44_000) } }, P, E, HASH)).toThrow();
  });

  it('does not apply a response when the service runtime changes during the read', async () => {
    let read = 0;
    const reader = webCorrectionSourceReader({ identity: async () => status(read++ === 0 ? R : Q), json: async () => entry() });
    await expect(reader(P, E, HASH)).rejects.toMatchObject({ code: 'source_service_changed' });
  });
});
