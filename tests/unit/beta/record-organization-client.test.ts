import { describe, expect, it, vi } from 'vitest';
import {
  nativeRecordOrganizationClient,
  webRecordOrganizationClient,
  type BetaCorrectionPage,
  type BetaRecordOrganizationIO,
} from '@/beta/record-organization-client';
import type { BetaPage } from '@/beta/client';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function capturePage(profileId = PROFILE, eventId = TARGET, highwater = 8): BetaPage {
  return { items: [{
    event_id: eventId, profile_id: profileId, device_id: 'device-a', author_id: 'device-a',
    author_kind: 'human', occurred_at_ms: 1, text: 'capture', tags: ['daily'], digest: 'a'.repeat(64), local_seq: 4,
  }], next_before: null, highwater };
}

function correctionPage(profileId = PROFILE, targetEventId = TARGET): BetaCorrectionPage {
  return { items: [{ target_state: 'digest_matches', record: {
    event_id: OTHER, profile_id: profileId, device_id: 'device-a', author_id: 'human-a', author_kind: 'human',
    occurred_at_ms: 2, target_event_id: targetEventId, target_digest: 'a'.repeat(64),
    corrected_text: 'corrected', digest: 'b'.repeat(64), local_seq: 6,
  } }], next_before: null, highwater: 8 };
}

describe('Beta record organization client', () => {
  it('passes exact tag/search/cursor values to the native page command', async () => {
    const call = vi.fn(async <T>() => capturePage(PROFILE, TARGET, 30) as T);
    const client = nativeRecordOrganizationClient(call);
    const page = await client.eventsPageWithTag(PROFILE, { search: 'a+b', before: 12, through: 30, limit: 25 }, 'daily');

    expect(page.items[0].event_id).toBe(TARGET);
    expect(call).toHaveBeenCalledWith('beta_events_page_with_tag', {
      profileId: PROFILE, query: { search: 'a+b', before: 12, through: 30, limit: 25 }, tag: 'daily',
    });
  });

  it('encodes tag and text search without changing their exact values in the web request', async () => {
    const io: BetaRecordOrganizationIO = { json: vi.fn(async () => capturePage(PROFILE, TARGET, 30)) };
    const client = webRecordOrganizationClient(io);
    await client.eventsPageWithTag(PROFILE, { search: "a+b & c", through: 30, limit: 25 }, 'two words');

    const [profile, path, method] = vi.mocked(io.json).mock.calls[0];
    expect(profile).toBe(PROFILE);
    expect(method).toBe('GET');
    const url = new URL(path, 'https://example.test');
    expect(url.pathname).toBe(`/profiles/${PROFILE}/events`);
    expect(url.searchParams.get('q')).toBe('a+b & c');
    expect(url.searchParams.get('tag')).toBe('two words');
    expect(url.searchParams.get('through')).toBe('30');
  });

  it('queries only the selected target correction and rejects a mismatched response', async () => {
    const call = vi.fn(async <T>() => correctionPage() as T);
    const client = nativeRecordOrganizationClient(call);
    const page = await client.correctionsForTarget(PROFILE, TARGET, { limit: 100, through: 8 });
    expect(page.items[0].record.target_event_id).toBe(TARGET);
    expect(call).toHaveBeenCalledWith('beta_corrections_page', {
      profileId: PROFILE, query: { limit: 100, through: 8 }, targetEventId: TARGET,
    });

    const mismatched = nativeRecordOrganizationClient(vi.fn(async <T>() => correctionPage(PROFILE, OTHER) as T));
    await expect(mismatched.correctionsForTarget(PROFILE, TARGET, { limit: 100 })).rejects.toMatchObject({ code: 'invalid_page' });
  });
  it('rejects a tag page that switches the requested snapshot', async () => {
    const call = vi.fn(async <T>() => capturePage() as T);
    const client = nativeRecordOrganizationClient(call);
    await expect(client.eventsPageWithTag(PROFILE, { through:30 }, 'daily'))
      .rejects.toMatchObject({ code:'invalid_page' });
  });

  it('posts one correction command with its fixed identity and validates the receipt', async () => {
    const command = {
      command_id: 'command', event_id: OTHER, profile_id: PROFILE, occurred_at_ms: 2,
      target_event_id: TARGET, target_digest: 'a'.repeat(64), corrected_text: 'fixed wording',
    };
    const call = vi.fn(async <T>() => ({ command_id: 'command', event_id: OTHER, profile_id: PROFILE, local_seq: 9,
      event_digest: 'c'.repeat(64), durability: 'local_committed', replayed: false } as T));
    const client = nativeRecordOrganizationClient(call);
    expect((await client.recordCorrection(command)).event_id).toBe(OTHER);
    expect(call).toHaveBeenCalledWith('beta_record_correction', { command });

    const invalid = nativeRecordOrganizationClient(vi.fn(async <T>() => ({ command_id: 'different', event_id: OTHER,
      profile_id: PROFILE, local_seq: 9, event_digest: 'c'.repeat(64), durability: 'local_committed', replayed: false } as T)));
    await expect(invalid.recordCorrection(command)).rejects.toMatchObject({ code: 'invalid_receipt' });
  });

  it('rejects a correction body outside Core byte bounds before making a request', async () => {
    const call = vi.fn(async <T>() => ({ command_id: 'command', event_id: OTHER, profile_id: PROFILE, local_seq: 9,
      event_digest: 'c'.repeat(64), durability: 'local_committed', replayed: false } as T));
    const client = nativeRecordOrganizationClient(call);
    await expect(client.recordCorrection({
      command_id: 'command', event_id: OTHER, profile_id: PROFILE, occurred_at_ms: 2,
      target_event_id: TARGET, target_digest: 'a'.repeat(64), corrected_text: 'x'.repeat(128 * 1024 + 1),
    })).rejects.toMatchObject({ code: 'invalid_correction' });
    expect(call).not.toHaveBeenCalled();
  });

  it('accepts the maximum UTF-8 correction whose escaped JSON request remains within the HTTP body budget', async () => {
    const correctedText = '\u0001'.repeat(128 * 1024);
    const command = {
      command_id: 'command', event_id: OTHER, profile_id: PROFILE, occurred_at_ms: 2,
      target_event_id: TARGET, target_digest: 'a'.repeat(64), corrected_text: correctedText,
    };
    const receipt = { command_id: 'command', event_id: OTHER, profile_id: PROFILE, local_seq: 9,
      event_digest: 'c'.repeat(64), durability: 'local_committed', replayed: false };
    const io: BetaRecordOrganizationIO = { json: vi.fn(async () => receipt) };
    const client = webRecordOrganizationClient(io);

    await expect(client.recordCorrection(command)).resolves.toMatchObject({ event_id: OTHER });

    const [, , method, body] = vi.mocked(io.json).mock.calls[0];
    expect(method).toBe('POST');
    expect(JSON.stringify(body).length).toBeLessThan(1024 * 1024);
    expect(body).toMatchObject({ corrected_text: correctedText });
  });

  it('rejects malformed UTF-16 before crossing the Native command boundary', async () => {
    const call = vi.fn(async <T>() => ({ command_id: 'command', event_id: OTHER, profile_id: PROFILE, local_seq: 9,
      event_digest: 'c'.repeat(64), durability: 'local_committed', replayed: false } as T));
    const client = nativeRecordOrganizationClient(call);
    await expect(client.recordCorrection({
      command_id: 'command', event_id: OTHER, profile_id: PROFILE, occurred_at_ms: 2,
      target_event_id: TARGET, target_digest: 'a'.repeat(64), corrected_text: '\ud800',
    })).rejects.toMatchObject({ code: 'invalid_correction' });
    expect(call).not.toHaveBeenCalled();
  });

  it('rejects tags outside the Core contract before making a request', async () => {
    const call = vi.fn(async <T>() => capturePage() as T);
    const client = nativeRecordOrganizationClient(call);
    await expect(client.eventsPageWithTag(PROFILE, {}, 'x'.repeat(129))).rejects.toMatchObject({ code: 'invalid_query' });
    expect(call).not.toHaveBeenCalled();
  });
});
