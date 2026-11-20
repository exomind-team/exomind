import { describe, expect, it, vi } from 'vitest';
import type { LocalIntentJournal } from '../../../src/beta/local-intent-journal';
import {
  UserRangeExportStateController,
  userRangeExportIntentKey,
} from '../../../src/beta/user-range-export-state';
import type {
  UserRangeExportClient,
  UserRangeExportRequest,
  UserRangeExportResult,
  UserRangeExportStatus,
  UserRangeSelection,
} from '../../../src/beta/user-range-export-client';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const OTHER_DEVICE = '88888888-8888-4888-8888-888888888888';
const RUNTIME = '22222222-2222-4222-8222-222222222222';
const NEXT_RUNTIME = '99999999-9999-4999-8999-999999999999';
const PROFILE = '33333333-3333-4333-8333-333333333333';
const OTHER_PROFILE = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const EVENT = '66666666-6666-4666-8666-666666666666';
const BLOCK = '77777777-7777-4777-8777-777777777777';

function saved(request: UserRangeExportRequest): UserRangeExportResult {
  return {
    request_id: request.request_id,
    profile_id: request.profile_id,
    phase: 'saved',
    content_complete: true,
    partial_output: false,
    included_originals: 0,
    omitted_originals: 0,
    archive_byte_length: 8,
    archive_sha256: 'a'.repeat(64),
    failure_code: null,
  };
}

function memoryJournal() {
  const values = new Map<string, string>();
  const journal: LocalIntentJournal = {
    read: vi.fn(async key => values.get(key) ?? null),
    write: vi.fn(async (key, raw) => { values.set(key, raw); }),
  };
  return { journal, values };
}

function client(): UserRangeExportClient {
  return {
    capabilities: vi.fn(async () => ({ schema: 1 as const, supported: true })),
    exportRange: vi.fn(async request => saved(request)),
    status: vi.fn(async (_profileId: string, _requestId: string) => null),
    cancel: vi.fn(async requestId => ({ request_id: requestId, accepted: true })),
  };
}

function controller(api = client(), journal = memoryJournal().journal, uuid: () => string = () => REQUEST) {
  return new UserRangeExportStateController(api, {
    deviceId: DEVICE, runtimeId: RUNTIME, profileId: PROFILE, journal, uuid,
  });
}

function eventId(index: number): string {
  return '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('user range export frontend state contract', () => {
  it('recovers the fixed request after a Native restart changes runtime identity without resubmitting it', async () => {
    const { journal } = memoryJournal();
    const previousApi = client();
    previousApi.exportRange = vi.fn(async () => { throw new Error('process ended while picker was open'); });
    const previous = controller(previousApi, journal);
    await previous.ready();
    await previous.toggleSelection({ kind: 'event', event_id: EVENT });
    await previous.startExport();
    expect(previous.snapshot().task?.phase).toBe('unknown');
    previous.dispose();

    const nextApi = client();
    nextApi.status = vi.fn(async () => ({
      request_id: REQUEST, profile_id: PROFILE, phase: 'interrupted',
      result: {
        request_id: REQUEST, profile_id: PROFILE, phase: 'interrupted',
        content_complete: false, partial_output: true, included_originals: 0, omitted_originals: 0,
        archive_byte_length: null, archive_sha256: null, failure_code: 'process_restarted',
      },
    }));
    const restarted = new UserRangeExportStateController(nextApi, {
      deviceId: DEVICE, runtimeId: '88888888-8888-4888-8888-888888888888', profileId: PROFILE, journal,
    });
    await restarted.ready();
    expect(nextApi.status).toHaveBeenCalledWith(PROFILE, REQUEST);
    expect(restarted.snapshot().task).toMatchObject({
      request_id: REQUEST, phase: 'interrupted', result: { partial_output: true },
    });
    expect(nextApi.exportRange).not.toHaveBeenCalled();
    restarted.dispose();
  });

  it('keeps choices per profile, allows explicit reset, and caps the current profile at 512', async () => {
    const owner = controller();
    await owner.ready();
    const choices: UserRangeSelection[] = [
      { kind: 'event', event_id: EVENT },
      { kind: 'timeblock', block_id: BLOCK },
    ];
    for (const choice of choices) await owner.toggleSelection(choice);
    await owner.switchProfile(OTHER_PROFILE);
    expect(owner.snapshot().selections).toEqual([]);
    await owner.switchProfile(PROFILE);
    expect(owner.snapshot().selections).toEqual(choices);
    await owner.resetSelections();
    for (let index = 1; index <= 513; index += 1) {
      await owner.toggleSelection({ kind: 'event', event_id: eventId(index) });
    }
    expect(owner.snapshot().selections).toHaveLength(512);
    expect(owner.snapshot().selections[511]).toEqual({ kind: 'event', event_id: eventId(512) });
  });

  it('writes a minimal scoped intent before Native submission and sends no content or paths', async () => {
    const { journal, values } = memoryJournal();
    const api = client();
    let intentAtSubmit: string | null = null;
    api.exportRange = vi.fn(async request => {
      intentAtSubmit = await journal.read(userRangeExportIntentKey(DEVICE));
      return saved(request);
    });
    const owner = controller(api, journal);
    await owner.ready();
    await owner.toggleSelection({ kind: 'event', event_id: EVENT });
    await owner.toggleSelection({ kind: 'timeblock', block_id: BLOCK });
    await owner.startExport();

    expect(intentAtSubmit).not.toBeNull();
    const intent = JSON.parse(intentAtSubmit!) as Record<string, unknown>;
    expect(Object.keys(intent).sort()).toEqual([
      'device_id', 'profile_id', 'request_id', 'runtime_id', 'selections', 'version',
    ]);
    expect(intent).toMatchObject({
      version: 1, device_id: DEVICE, runtime_id: RUNTIME, profile_id: PROFILE, request_id: REQUEST,
      selections: [
        { kind: 'event', event_id: EVENT },
        { kind: 'timeblock', block_id: BLOCK },
      ],
    });
    expect(JSON.stringify([...values.values()])).not.toMatch(/正文|content|file_name|path|token/i);
    expect(api.exportRange).toHaveBeenCalledWith({
      request_id: REQUEST, profile_id: PROFILE,
      selections: [{ kind: 'event', event_id: EVENT }, { kind: 'timeblock', block_id: BLOCK }],
    });
  });

  it('restores by querying the exact intent and treats a null status as unknown without resubmitting', async () => {
    const { journal } = memoryJournal();
    const intent = {
      version: 1, device_id: DEVICE, runtime_id: RUNTIME, profile_id: PROFILE,
      request_id: REQUEST, selections: [{ kind: 'event', event_id: EVENT }],
    };
    await journal.write(userRangeExportIntentKey(DEVICE), JSON.stringify(intent));
    const api = client();
    api.status = vi.fn(async () => null);
    const owner = controller(api, journal);

    await owner.ready();
    expect(api.status).toHaveBeenCalledWith(PROFILE, REQUEST);
    expect(api.exportRange).not.toHaveBeenCalled();
    expect(owner.snapshot().task).toMatchObject({ request_id: REQUEST, phase: 'unknown' });
    await owner.startExport();
    expect(api.exportRange).not.toHaveBeenCalled();
  });

  it('checks the same request after a lost reply and needs explicit confirmation for a new request', async () => {
    const api = client();
    api.exportRange = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockImplementationOnce(async request => saved(request));
    api.status = vi.fn(async () => null);
    let next = 0;
    const owner = controller(api, memoryJournal().journal, () => (++next === 1 ? REQUEST : '88888888-8888-4888-8888-888888888888'));
    await owner.ready();
    await owner.toggleSelection({ kind: 'event', event_id: EVENT });

    await owner.startExport();
    expect(api.exportRange).toHaveBeenCalledTimes(1);
    expect(api.status).toHaveBeenCalledWith(PROFILE, REQUEST);
    expect(owner.snapshot().task).toMatchObject({ request_id: REQUEST, phase: 'unknown' });
    await owner.startExport();
    expect(api.exportRange).toHaveBeenCalledTimes(1);

    await owner.confirmNewRequestAfterUnknown();
    expect(api.exportRange).toHaveBeenCalledTimes(2);
    expect(api.exportRange.mock.calls[1][0].request_id).not.toBe(REQUEST);
  });

  it('does not call Native if the minimal intent cannot be persisted', async () => {
    const { journal } = memoryJournal();
    const api = client();
    const owner = controller(api, journal);
    await owner.ready();
    await owner.toggleSelection({ kind: 'event', event_id: EVENT });
    vi.mocked(journal.write).mockRejectedValueOnce(new Error('local journal unavailable'));

    await owner.startExport().catch(() => {});
    expect(api.exportRange).not.toHaveBeenCalled();
  });

  it('does not treat accepted cancellation as saved and preserves partial and content completeness separately', async () => {
    const api = client();
    const response = deferred<UserRangeExportResult>();
    api.exportRange = vi.fn(() => response.promise);
    const owner = controller(api);
    await owner.ready();
    await owner.toggleSelection({ kind: 'event', event_id: EVENT });
    const pending = owner.startExport();
    await vi.waitFor(() => expect(api.exportRange).toHaveBeenCalledTimes(1));
    const request = api.exportRange.mock.calls[0][0];

    await owner.requestCancel();
    expect(api.cancel).toHaveBeenCalledWith(REQUEST);
    expect(owner.snapshot().task?.phase).not.toBe('saved');
    expect(owner.snapshot().task?.result).toBeNull();
    response.resolve({ ...saved(request), content_complete: false, partial_output: true });
    await pending;
    expect(owner.snapshot().task?.result).toMatchObject({
      phase: 'saved', content_complete: false, partial_output: true,
      archive_byte_length: 8, archive_sha256: 'a'.repeat(64),
    });
  });

  it('does not read a request intent from another device', async () => {
    const { journal } = memoryJournal();
    const intent = {
      version: 1, device_id: DEVICE, runtime_id: RUNTIME, profile_id: PROFILE,
      request_id: REQUEST, selections: [{ kind: 'event', event_id: EVENT }],
    };
    await journal.write(userRangeExportIntentKey(DEVICE), JSON.stringify(intent));
    const api = client();
    const owner = new UserRangeExportStateController(api, {
      deviceId: OTHER_DEVICE, runtimeId: NEXT_RUNTIME, profileId: PROFILE, journal,
    });

    await owner.ready();
    expect(journal.read).toHaveBeenCalledWith(userRangeExportIntentKey(OTHER_DEVICE));
    expect(journal.read).not.toHaveBeenCalledWith(userRangeExportIntentKey(DEVICE));
    expect(api.status).not.toHaveBeenCalled();
    expect(api.exportRange).not.toHaveBeenCalled();
    expect(owner.snapshot().task).toBeNull();
    owner.dispose();
  });

  it('ignores a late status result from the previous Native runtime', async () => {
    const { journal } = memoryJournal();
    const delayedStatus = deferred<UserRangeExportStatus | null>();
    const previousApi = client();
    previousApi.exportRange = vi.fn(async () => { throw new Error('process ended while picker was open'); });
    previousApi.status = vi.fn(() => delayedStatus.promise);
    const previous = controller(previousApi, journal);
    await previous.ready();
    await previous.toggleSelection({ kind: 'event', event_id: EVENT });
    const pending = previous.startExport();
    await vi.waitFor(() => expect(previousApi.status).toHaveBeenCalledWith(PROFILE, REQUEST));
    expect(previous.snapshot().task?.phase).toBe('unknown');
    previous.dispose();

    const restartedApi = client();
    restartedApi.status = vi.fn(async () => ({ request_id: REQUEST, profile_id: PROFILE, phase: 'interrupted', result: null }));
    const restarted = new UserRangeExportStateController(restartedApi, {
      deviceId: DEVICE, runtimeId: NEXT_RUNTIME, profileId: PROFILE, journal,
    });
    await restarted.ready();
    expect(restarted.snapshot().task).toMatchObject({ request_id: REQUEST, phase: 'interrupted' });
    const recoveredTask = restarted.snapshot().task;

    delayedStatus.resolve({
      request_id: REQUEST, profile_id: PROFILE, phase: 'saved',
      result: saved({ request_id: REQUEST, profile_id: PROFILE, selections: [{ kind: 'event', event_id: EVENT }] }),
    });
    await pending;
    expect(previous.snapshot().task?.phase).toBe('unknown');
    expect(restarted.snapshot().task).toBe(recoveredTask);
    expect(restartedApi.exportRange).not.toHaveBeenCalled();
    restarted.dispose();
  });
});
