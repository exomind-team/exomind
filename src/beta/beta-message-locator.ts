import type { BetaClient, BetaEvent, BetaPage, BetaQuery } from './client';
import type { BetaMessageReferenceIdentity } from './message-references';
import { buildBetaMessageReferenceUri } from './message-references';
import type { BetaTimelineItem, BetaTimelinePage } from './timeblocks-types';

export const MAX_BETA_MESSAGE_LOCATE_PAGES = 16;
export const BETA_MESSAGE_LOCATE_PAGE_SIZE = 100;

export type BetaMessageLocateClient =
  Pick<BetaClient, 'eventsPage'>
  & Partial<Pick<BetaClient, 'timelineEvent' | 'timelinePage'>>;

export interface LocateBetaMessageReferenceOptions {
  client: BetaMessageLocateClient;
  currentProfileId: string;
  reference: BetaMessageReferenceIdentity;
  highwater?: number;
  loadedItems?: readonly BetaTimelineItem[];
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

export type BetaMessageLocateResult =
  | {
      kind: 'found';
      item: BetaTimelineItem;
      source: 'loaded' | 'event-id' | 'pages';
      pagesRead: number;
      highwater: number | null;
    }
  | { kind: 'profile-mismatch'; profileId: string }
  | { kind: 'not-found'; pagesRead: number; highwater: number; limitReached: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: string; message: string; retryable: boolean };

interface LocateFailure {
  code: string;
  message: string;
  retryable: boolean;
}

function errorInfo(error: unknown): LocateFailure {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'message_location_failed',
      message: typeof candidate.message === 'string' && candidate.message.length > 0
        ? candidate.message
        : '原文暂不能读取；草稿和当前阅读位置已保留，请重试。',
      retryable: true,
    };
  }
  return {
    code: 'message_location_failed',
    message: typeof error === 'string' && error.length > 0
      ? error
      : '原文暂不能读取；草稿和当前阅读位置已保留，请重试。',
    retryable: true,
  };
}

function current(options: LocateBetaMessageReferenceOptions): boolean {
  return options.signal?.aborted !== true && (options.isCurrent?.() ?? true);
}

function isCapture(item: BetaTimelineItem): item is Extract<BetaTimelineItem, { kind: 'capture' }> {
  return item.kind === 'capture';
}

function matchingCapture(
  item: BetaTimelineItem,
  reference: BetaMessageReferenceIdentity,
): BetaTimelineItem | null {
  if (item.record.event_id !== reference.eventId) return null;
  if (!isCapture(item) || item.record.profile_id !== reference.profileId) return null;
  return item;
}

function findLoadedItem(
  items: readonly BetaTimelineItem[] | undefined,
  reference: BetaMessageReferenceIdentity,
): { item: BetaTimelineItem | null; conflict: boolean } {
  for (const item of items ?? []) {
    if (item.record.event_id !== reference.eventId) continue;
    const match = matchingCapture(item, reference);
    return match ? { item: match, conflict: false } : { item: null, conflict: true };
  }
  return { item: null, conflict: false };
}

function failed(code: string, message: string, retryable = false): BetaMessageLocateResult {
  return { kind: 'failed', code, message, retryable };
}

function isUnsupportedExactRead(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'unsupported_summaries';
}

function validatePage(
  page: BetaTimelinePage,
  profileId: string,
  expectedHighwater: number | undefined,
  previousBefore: number | undefined,
): string | null {
  if (!Number.isSafeInteger(page.highwater) || page.highwater < 0) return '历史页的 highwater 无效。';
  if (expectedHighwater !== undefined && page.highwater !== expectedHighwater) return '历史快照已变化；原阅读位置已保留，请重新定位。';
  if (!Array.isArray(page.items) || page.items.length > BETA_MESSAGE_LOCATE_PAGE_SIZE) return '历史页超出读取上限。';
  let previousSequence = previousBefore ?? Number.MAX_SAFE_INTEGER;
  for (const item of page.items) {
    const record = item.record;
    if (record.profile_id !== profileId) return '历史页返回了其他档案的记录，已停止定位。';
    if (!Number.isSafeInteger(record.local_seq) || record.local_seq <= 0
      || record.local_seq >= previousSequence || record.local_seq > page.highwater) {
      return '历史页顺序与快照不一致，已停止定位。';
    }
    previousSequence = record.local_seq;
  }
  if (page.next_before !== null) {
    if (!Number.isSafeInteger(page.next_before) || page.next_before <= 0) return '历史页游标无效。';
    if (previousBefore !== undefined && page.next_before >= previousBefore) return '历史页游标没有向更早记录推进。';
    if (page.items.length === 0 || previousSequence !== page.next_before) {
      return '历史页游标与最后一条记录不匹配。';
    }
  }
  return null;
}

async function readTimelinePage(
  client: BetaMessageLocateClient,
  profileId: string,
  query: BetaQuery,
): Promise<BetaTimelinePage> {
  if (client.timelinePage) return client.timelinePage(profileId, query);
  const page: BetaPage = await client.eventsPage(profileId, query);
  return { ...page, items: page.items.map((record: BetaEvent) => ({ kind: 'capture' as const, record })) };
}

export async function locateBetaMessageReference(
  options: LocateBetaMessageReferenceOptions,
): Promise<BetaMessageLocateResult> {
  const { client, currentProfileId, reference } = options;
  try {
    buildBetaMessageReferenceUri(reference);
    buildBetaMessageReferenceUri({ profileId: currentProfileId, eventId: reference.eventId });
  } catch {
    return failed('invalid_reference', '引用身份无效，未读取任何档案数据。');
  }

  if (currentProfileId !== reference.profileId) {
    return { kind: 'profile-mismatch', profileId: reference.profileId };
  }
  if (options.highwater !== undefined
    && (!Number.isSafeInteger(options.highwater) || options.highwater < 0)) {
    return failed('invalid_snapshot', '当前历史快照无效，原阅读位置已保留。');
  }

  if (!current(options)) return { kind: 'cancelled' };

  const loaded = findLoadedItem(options.loadedItems, reference);
  if (loaded.conflict) {
    return failed('inconsistent_source', '已加载记录与引用身份不一致，未替换当前历史。');
  }
  if (loaded.item) {
    return {
      kind: 'found',
      item: loaded.item,
      source: 'loaded',
      pagesRead: 0,
      highwater: options.highwater ?? null,
    };
  }

  if (client.timelineEvent) {
    try {
      const item = await client.timelineEvent(reference.profileId, reference.eventId);
      if (!current(options)) return { kind: 'cancelled' };
      if (item) {
        const match = matchingCapture(item, reference);
        if (!match) return failed('inconsistent_source', '精确来源与档案或消息身份不一致；草稿和阅读位置已保留。');
        return {
          kind: 'found',
          item: match,
          source: 'event-id',
          pagesRead: 0,
          highwater: options.highwater ?? null,
        };
      }
    } catch (error) {
      if (!current(options)) return { kind: 'cancelled' };
      if (!isUnsupportedExactRead(error)) {
        const info = errorInfo(error);
        return { kind: 'failed', ...info };
      }
    }
  }

  let highwater = options.highwater;
  let before: number | undefined;
  for (let pageIndex = 0; pageIndex < MAX_BETA_MESSAGE_LOCATE_PAGES; pageIndex += 1) {
    if (!current(options)) return { kind: 'cancelled' };
    const query: BetaQuery = {
      limit: BETA_MESSAGE_LOCATE_PAGE_SIZE,
      ...(highwater === undefined ? {} : { through: highwater }),
      ...(before === undefined ? {} : { before }),
    };

    let page: BetaTimelinePage;
    try {
      page = await readTimelinePage(client, reference.profileId, query);
    } catch (error) {
      if (!current(options)) return { kind: 'cancelled' };
      const info = errorInfo(error);
      return { kind: 'failed', ...info };
    }
    if (!current(options)) return { kind: 'cancelled' };

    if (highwater === undefined) highwater = page.highwater;
    const pageProblem = validatePage(page, reference.profileId, highwater, before);
    if (pageProblem) return failed('inconsistent_snapshot', pageProblem, true);

    for (const item of page.items) {
      if (item.record.event_id !== reference.eventId) continue;
      const match = matchingCapture(item, reference);
      if (!match) return failed('inconsistent_source', '历史页中的来源与引用档案或消息身份不一致。', true);
      return {
        kind: 'found',
        item: match,
        source: 'pages',
        pagesRead: pageIndex + 1,
        highwater,
      };
    }

    if (page.next_before === null) {
      return { kind: 'not-found', pagesRead: pageIndex + 1, highwater, limitReached: false };
    }
    before = page.next_before;
  }

  return {
    kind: 'not-found',
    pagesRead: MAX_BETA_MESSAGE_LOCATE_PAGES,
    highwater: highwater ?? 0,
    limitReached: true,
  };
}
