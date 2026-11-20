import { describe, expect, it, vi } from 'vitest';
import { createProfileArchiveClient } from '../../../src/beta/profile-archive-client';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const capabilities = { schema: 1, supports_import: true, supports_export: true };
function task() {
  return {
    request_id: REQUEST, profile_id: PROFILE, direction: 'import', phase: 'preview_ready',
    archive_sha256: SHA, archive_complete: false, byte_length: 1024,
    bytes_processed: 1024, facts_processed: 105, original_bytes_processed: 0,
    partial_output: false,
    preview: {
      request_id: REQUEST, profile_id: PROFILE, archive_sha256: SHA,
      fact_count: 105, original_count: 2, conflict_count: 0, missing_original_count: 1,
      unverified_origin_count: 1, facts_complete: true, proofs_complete: false,
      bytes_complete: false, target_bytes_complete: false, can_import: true,
    },
  };
}

describe('Native profile archive IPC client', () => {
  it('uses the explicit capability command without assuming old Native support', async () => {
    const invoke = vi.fn(async () => capabilities);
    await expect(createProfileArchiveClient(invoke).capabilities()).resolves.toEqual(capabilities);
    expect(invoke).toHaveBeenCalledWith('beta_profile_archive_capabilities', undefined);
    await expect(createProfileArchiveClient(vi.fn(async () => ({ ...capabilities, schema: 2 }))).capabilities()).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(createProfileArchiveClient(null).capabilities()).rejects.toMatchObject({ code: 'native_unavailable' });
  });

  it('previews from an empty device without inventing or provisioning a target profile', async () => {
    const invoke = vi.fn(async () => ({ request_id: REQUEST, accepted: true }));
    const client = createProfileArchiveClient(invoke);
    await expect(client.previewImport(REQUEST)).resolves.toEqual({ request_id: REQUEST, accepted: true });
    expect(invoke).toHaveBeenCalledWith('beta_profile_archive_import_preview', { requestId: REQUEST, expectedProfileId: null });
    expect(invoke).toHaveBeenCalledTimes(1);
    await client.previewImport(REQUEST, PROFILE);
    expect(invoke).toHaveBeenLastCalledWith('beta_profile_archive_import_preview', { requestId: REQUEST, expectedProfileId: PROFILE });
  });

  it('confirms only the selected request and keeps cancellation as a request acknowledgement', async () => {
    const invoke = vi.fn(async (command: string) => command === 'beta_profile_archive_cancel' ? true : { request_id: REQUEST, accepted: true });
    const client = createProfileArchiveClient(invoke);
    await client.confirmImport(REQUEST);
    expect(invoke).toHaveBeenLastCalledWith('beta_profile_archive_import_confirm', { requestId: REQUEST });
    await expect(client.cancel(REQUEST)).resolves.toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('beta_profile_archive_cancel', { requestId: REQUEST });
    await client.exportProfile(PROFILE, REQUEST);
    expect(invoke).toHaveBeenLastCalledWith('beta_profile_archive_export', { profileId: PROFILE, requestId: REQUEST });
  });

  it('preserves incomplete but importable preview and distinguishes accepted work from saved output', async () => {
    const invoke = vi.fn(async () => [task(), { ...task(), request_id: OTHER, phase: 'interrupted', preview: null, failure_code: 'process_restarted', partial_output: true }]);
    const history = await createProfileArchiveClient(invoke).history();
    expect(history[0]?.preview).toMatchObject({ can_import: true, proofs_complete: false, missing_original_count: 1 });
    expect(history[0]?.phase).toBe('preview_ready');
    expect(history[1]).toMatchObject({ phase: 'interrupted', failure_code: 'process_restarted', partial_output: true });
    expect(invoke).toHaveBeenCalledWith('beta_profile_archive_history', { profileId: null });
  });

  it('allows unknown profile before picking a source but rejects mismatched history and preview identities', async () => {
    const pending = { ...task(), profile_id: null, phase: 'awaiting_source', preview: null };
    await expect(createProfileArchiveClient(vi.fn(async () => [pending])).history()).resolves.toHaveLength(1);
    await expect(createProfileArchiveClient(vi.fn(async () => [task()])).history(OTHER)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(createProfileArchiveClient(vi.fn(async () => [{ ...task(), preview: { ...task().preview, request_id: OTHER } }])).history()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects unsafe metadata, leaked paths, duplicate tasks and oversized response lists', async () => {
    for (const rows of [
      [{ ...task(), bytes_processed: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...task(), phase: 'pretend_complete' }],
      [{ ...task(), direction: ['export'], phase: 'failed', preview: null }],
      [{ ...task(), destination_uri: 'content://private' }],
      [task(), task()],
      Array.from({ length: 34 }, () => task()),
    ]) {
      await expect(createProfileArchiveClient(vi.fn(async () => rows)).history()).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });

  it('rejects bad IDs before Native and never automatically resends a failed operation', async () => {
    const invoke = vi.fn(async () => { throw new Error('connection interrupted'); });
    const client = createProfileArchiveClient(invoke);
    await expect(client.previewImport('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(invoke).not.toHaveBeenCalled();
    await expect(client.confirmImport(REQUEST)).rejects.toMatchObject({ code: 'native_failed' });
    expect(invoke).toHaveBeenCalledTimes(1);
    await expect(createProfileArchiveClient(vi.fn(async () => ({ request_id: OTHER, accepted: true }))).exportProfile(PROFILE, REQUEST)).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
