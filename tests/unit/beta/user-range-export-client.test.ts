import { describe, expect, it, vi } from 'vitest';
import { createUserRangeExportClient, type UserRangeExportRequest } from '../../../src/beta/user-range-export-client';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const BLOCK = '44444444-4444-4444-8444-444444444444';
const request: UserRangeExportRequest = {
  request_id: REQUEST, profile_id: PROFILE,
  selections: [{ kind: 'event', event_id: EVENT }, { kind: 'timeblock', block_id: BLOCK }],
};
function saved() {
  return {
    request_id: REQUEST, profile_id: PROFILE, phase: 'saved', content_complete: false,
    partial_output: false, included_originals: 1, omitted_originals: 2,
    archive_byte_length: 4096, archive_sha256: 'a'.repeat(64), failure_code: null,
  };
}
describe('Native selected content export client', () => {
  it('checks explicit Native capability and does not infer it from the database version', async () => {
    const invoke = vi.fn(async () => ({ schema: 1, supported: true }));
    await expect(createUserRangeExportClient(invoke).capabilities()).resolves.toEqual({ schema: 1, supported: true });
    expect(invoke).toHaveBeenCalledWith('beta_user_range_export_capabilities', undefined);
    await expect(createUserRangeExportClient(null).capabilities()).rejects.toMatchObject({ code: 'native_unavailable' });
  });
  it('passes only fixed selected IDs to the trusted Native save operation', async () => {
    const invoke = vi.fn(async () => saved());
    await expect(createUserRangeExportClient(invoke).exportRange(request)).resolves.toMatchObject({ phase: 'saved', content_complete: false, omitted_originals: 2 });
    expect(invoke).toHaveBeenCalledWith('beta_export_user_range', { request });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps cancelled partial output distinct from a verified saved file', async () => {
    const result = { ...saved(), phase: 'cancelled', partial_output: true, archive_byte_length: null, archive_sha256: null, failure_code: 'user_cancelled' };
    await expect(createUserRangeExportClient(vi.fn(async () => result)).exportRange(request)).resolves.toMatchObject({ phase: 'cancelled', partial_output: true, failure_code: 'user_cancelled' });
  });
  it('never treats zero bytes, wrong IDs, leaked locations or unverified output as saved', async () => {
    for (const result of [
      { ...saved(), archive_byte_length: 0 }, { ...saved(), archive_sha256: null },
      { ...saved(), profile_id: EVENT }, { ...saved(), request_id: EVENT },
      { ...saved(), destination_uri: 'content://private' },
      { ...saved(), phase: 'failed' },
      { ...saved(), phase: ['failed'], archive_sha256: null, archive_byte_length: null },
    ]) await expect(createUserRangeExportClient(vi.fn(async () => result)).exportRange(request)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects empty, duplicate, nil and path-bearing requests before Native', async () => {
    const invoke = vi.fn(async () => saved());
    const client = createUserRangeExportClient(invoke);
    for (const value of [
      { ...request, selections: [] }, { ...request, selections: [request.selections[0], request.selections[0]] },
      { ...request, request_id: '00000000-0000-0000-0000-000000000000' },
      { ...request, destination: 'C:/private' },
    ]) await expect(client.exportRange(value as UserRangeExportRequest)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('queries the exact task and keeps absent status unconfirmed', async () => {
    const invoke = vi.fn(async () => null);
    await expect(createUserRangeExportClient(invoke).status(PROFILE, REQUEST)).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('beta_user_range_export_status', { requestId: REQUEST });
    const mismatch = vi.fn(async () => ({ ...saved(), profile_id: EVENT }));
    await expect(createUserRangeExportClient(mismatch).status(PROFILE, REQUEST)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('reads Native-owned in-flight phase separately from a matching terminal result', async () => {
    const pending = { request_id: REQUEST, profile_id: PROFILE, phase: 'awaiting_destination' };
    await expect(createUserRangeExportClient(vi.fn(async () => pending)).status(PROFILE, REQUEST)).resolves.toEqual({ ...pending, result: null });
    const finished = { request_id: REQUEST, profile_id: PROFILE, phase: 'saved', result: saved() };
    await expect(createUserRangeExportClient(vi.fn(async () => finished)).status(PROFILE, REQUEST)).resolves.toEqual(finished);
    await expect(createUserRangeExportClient(vi.fn(async () => ({ ...finished, phase: 'failed' }))).status(PROFILE, REQUEST)).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(createUserRangeExportClient(vi.fn(async () => ({ ...finished, result: null }))).status(PROFILE, REQUEST)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('keeps cancellation acknowledgement separate and never resends an unknown export', async () => {
    const invoke = vi.fn(async () => ({ request_id: REQUEST, accepted: false }));
    await expect(createUserRangeExportClient(invoke).cancel(REQUEST)).resolves.toEqual({ request_id: REQUEST, accepted: false });
    expect(invoke).toHaveBeenCalledWith('beta_cancel_user_range_export', { requestId: REQUEST });
    const lost = vi.fn(async () => { throw new Error('lost response'); });
    await expect(createUserRangeExportClient(lost).exportRange(request)).rejects.toMatchObject({ code: 'native_failed' });
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
