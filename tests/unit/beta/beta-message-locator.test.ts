import { describe, expect, it, vi } from 'vitest';
import type { BetaPage, BetaQuery } from '@/beta/client';
import type { BetaTimelineItem, BetaTimelinePage } from '@/beta/timeblocks-types';
import { MAX_BETA_MESSAGE_LOCATE_PAGES, locateBetaMessageReference } from '@/beta/beta-message-locator';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE = '44444444-4444-4444-8444-444444444444';
const EVENT = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';

function capture(localSeq: number, eventId = EVENT, profileId = PROFILE): BetaTimelineItem {
  return {
    kind: 'capture',
    record: {
      event_id: eventId,
      profile_id: profileId,
      device_id: DEVICE,
      author_id: DEVICE,
      author_kind: 'human',
      occurred_at_ms: localSeq,
      text: 'original body ' + localSeq,
      tags: [],
      digest: 'a'.repeat(64),
      local_seq: localSeq,
    },
  };
}

function typedFact(kind: 'timeblock' | 'summary/1' | 'agent_summary/1', localSeq = 23): BetaTimelineItem {
  return {
    kind,
    record: {
      event_id: EVENT,
      profile_id: PROFILE,
      device_id: DEVICE,
      local_seq: localSeq,
      source: { kind: 'human', author_id: DEVICE, owner_generation: null },
      parents: [],
      occurred_at_ms: localSeq,
      effective_at_ms: localSeq,
      clock: { epoch_id: DEVICE, elapsed_ms: 0 },
      payload: { kind: 'action', action: { kind: 'pause', block_id: DEVICE } },
      digest: 'a'.repeat(64),
    },
  } as unknown as BetaTimelineItem;
}

function fakeClient() {
  const eventsPage = vi.fn(async (_profileId: string, _query: BetaQuery): Promise<BetaPage> => ({
    items: [],
    next_before: null,
    highwater: 0,
  }));
  const timelinePage = vi.fn(async (_profileId: string, _query: BetaQuery): Promise<BetaTimelinePage> => ({
    items: [],
    next_before: null,
    highwater: 0,
  }));
  const timelineEvent = vi.fn(async (_profileId: string, _eventId: string): Promise<BetaTimelineItem | null> => null);
  return { eventsPage, timelinePage, timelineEvent };
}

describe('Beta message location', () => {
  it('uses the exact profile-scoped event reader before paging', async () => {
    const client = fakeClient();
    const target = capture(23);
    client.timelineEvent.mockResolvedValueOnce(target);

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 30,
    });

    expect(result).toMatchObject({ kind: 'found', item: target, source: 'event-id', pagesRead: 0, highwater: 30 });
    expect(client.timelineEvent).toHaveBeenCalledWith(PROFILE, EVENT);
    expect(client.timelinePage).not.toHaveBeenCalled();
  });

  it.each(['timeblock', 'summary/1', 'agent_summary/1'] as const)('matches %s through the existing profile/event identity', async kind => {
    const exactClient = fakeClient();
    const exactTarget = typedFact(kind);
    exactClient.timelineEvent.mockResolvedValueOnce(exactTarget);
    const exact = await locateBetaMessageReference({
      client: exactClient,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 30,
    });
    expect(exact).toMatchObject({ kind: 'found', item: exactTarget, source: 'event-id', pagesRead: 0, highwater: 30 });

    const loadedClient = fakeClient();
    const loadedTarget = typedFact(kind);
    const loaded = await locateBetaMessageReference({
      client: loadedClient,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 30,
      loadedItems: [loadedTarget],
    });
    expect(loaded).toMatchObject({ kind: 'found', item: loadedTarget, source: 'loaded', pagesRead: 0, highwater: 30 });
    expect(loadedClient.timelineEvent).not.toHaveBeenCalled();
  });

  it.each(['timeblock', 'summary/1', 'agent_summary/1'] as const)('finds %s through the existing bounded timeline pages', async kind => {
    const client = fakeClient();
    const target = typedFact(kind, 8);
    client.timelineEvent.mockResolvedValueOnce(null);
    client.timelinePage.mockResolvedValueOnce({ items: [target], next_before: null, highwater: 8 });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 8,
    });

    expect(result).toMatchObject({ kind: 'found', item: target, source: 'pages', pagesRead: 1, highwater: 8 });
    expect(client.timelinePage).toHaveBeenCalledWith(PROFILE, { limit: 100, through: 8 });
  });

  it('returns a loaded record without opening a second reader or shifting the snapshot', async () => {
    const client = fakeClient();
    const target = capture(23);

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 30,
      loadedItems: [capture(25, '55555555-5555-4555-8555-555555555555'), target],
    });

    expect(result).toMatchObject({ kind: 'found', item: target, source: 'loaded', pagesRead: 0, highwater: 30 });
    expect(client.timelineEvent).not.toHaveBeenCalled();
    expect(client.timelinePage).not.toHaveBeenCalled();
  });

  it('does not read or switch profiles when the reference belongs to another scope', async () => {
    const client = fakeClient();

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: OTHER_PROFILE, eventId: EVENT },
    });

    expect(result).toEqual({ kind: 'profile-mismatch', profileId: OTHER_PROFILE });
    expect(client.timelineEvent).not.toHaveBeenCalled();
    expect(client.timelinePage).not.toHaveBeenCalled();
    expect(client.eventsPage).not.toHaveBeenCalled();
  });

  it('falls back to bounded pages under the original highwater after an exact miss', async () => {
    const client = fakeClient();
    client.timelineEvent.mockResolvedValueOnce(null);
    client.timelinePage
      .mockResolvedValueOnce({ items: [capture(9, '55555555-5555-4555-8555-555555555555')], next_before: 9, highwater: 12 })
      .mockResolvedValueOnce({ items: [capture(8, EVENT)], next_before: 8, highwater: 12 });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 12,
    });

    expect(result).toMatchObject({ kind: 'found', item: capture(8), source: 'pages', pagesRead: 2, highwater: 12 });
    expect(client.timelinePage).toHaveBeenNthCalledWith(1, PROFILE, { limit: 100, through: 12 });
    expect(client.timelinePage).toHaveBeenNthCalledWith(2, PROFILE, { limit: 100, through: 12, before: 9 });
  });

  it('pins the first page highwater and reports an exhausted search honestly', async () => {
    const client = fakeClient();
    client.timelinePage.mockResolvedValueOnce({
      items: [capture(7, '55555555-5555-4555-8555-555555555555')],
      next_before: null,
      highwater: 7,
    });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
    });

    expect(result).toEqual({ kind: 'not-found', pagesRead: 1, highwater: 7, limitReached: false });
    expect(client.timelinePage).toHaveBeenCalledWith(PROFILE, { limit: 100 });
  });

  it('stops at the page cap and marks the result as incomplete', async () => {
    const client = fakeClient();
    let sequence = 500;
    client.timelinePage.mockImplementation(async (_profileId, _query) => {
      const localSeq = sequence--;
      return {
        items: [capture(localSeq, '55555555-5555-4555-8555-555555555555')],
        next_before: localSeq,
        highwater: 500,
      };
    });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 500,
    });

    expect(result).toEqual({
      kind: 'not-found',
      pagesRead: MAX_BETA_MESSAGE_LOCATE_PAGES,
      highwater: 500,
      limitReached: true,
    });
    expect(client.timelinePage).toHaveBeenCalledTimes(MAX_BETA_MESSAGE_LOCATE_PAGES);
  });

  it('discards a late exact-read result after cancellation or profile change', async () => {
    const client = fakeClient();
    let resolveRead: ((value: BetaTimelineItem | null) => void) | undefined;
    client.timelineEvent.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    let current = true;
    const pending = locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      isCurrent: () => current,
    });
    current = false;
    resolveRead?.(capture(23));

    await expect(pending).resolves.toEqual({ kind: 'cancelled' });
    expect(client.timelinePage).not.toHaveBeenCalled();
  });

  it('discards a late page after an abort signal is raised', async () => {
    const client = fakeClient();
    let resolvePage: ((page: BetaTimelinePage) => void) | undefined;
    client.timelinePage.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
    const controller = new AbortController();
    const pending = locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      signal: controller.signal,
    });
    controller.abort();
    resolvePage?.({ items: [capture(23)], next_before: null, highwater: 23 });

    await expect(pending).resolves.toEqual({ kind: 'cancelled' });
  });

  it('keeps read errors recoverable and rejects a changed page highwater', async () => {
    const failed = fakeClient();
    failed.timelineEvent.mockResolvedValueOnce(null);
    failed.timelinePage.mockRejectedValueOnce({ code: 'storage_error', message: 'history read failed' });
    const failure = await locateBetaMessageReference({
      client: failed,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 12,
    });
    expect(failure).toMatchObject({ kind: 'failed', message: 'history read failed', retryable: true });

    const changed = fakeClient();
    changed.timelineEvent.mockResolvedValueOnce(null);
    changed.timelinePage.mockResolvedValueOnce({ items: [], next_before: null, highwater: 13 });
    const inconsistent = await locateBetaMessageReference({
      client: changed,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
      highwater: 12,
    });
    expect(inconsistent).toMatchObject({ kind: 'failed', code: 'inconsistent_snapshot' });
  });

  it('rejects a page that leaks a same-ID event from another profile', async () => {
    const client = fakeClient();
    client.timelineEvent.mockResolvedValueOnce(null);
    client.timelinePage.mockResolvedValueOnce({
      items: [capture(1, EVENT, OTHER_PROFILE)],
      next_before: null,
      highwater: 1,
    });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
    });

    expect(result).toMatchObject({ kind: 'failed', code: 'inconsistent_snapshot' });
  });

  it('uses capture paging when a typed timeline reader is unavailable', async () => {
    const client = fakeClient();
    delete (client as Partial<typeof client>).timelinePage;
    client.timelineEvent.mockResolvedValueOnce(null);
    client.eventsPage.mockResolvedValueOnce({
      items: [{
        event_id: EVENT,
        profile_id: PROFILE,
        device_id: DEVICE,
        author_id: DEVICE,
        author_kind: 'human',
        occurred_at_ms: 1,
        text: 'message body',
        tags: [],
        digest: 'b'.repeat(64),
        local_seq: 1,
      }],
      next_before: null,
      highwater: 1,
    });

    const result = await locateBetaMessageReference({
      client,
      currentProfileId: PROFILE,
      reference: { profileId: PROFILE, eventId: EVENT },
    });

    expect(result).toMatchObject({ kind: 'found', source: 'pages', pagesRead: 1, item: { kind: 'capture' } });
    expect(client.eventsPage).toHaveBeenCalledWith(PROFILE, { limit: 100 });
  });
});
