import { BetaApiError, type BetaQuery } from './client';
import type { BetaTimelineItem, BetaTimelinePage } from './timeblocks-types';

export function mergeTimelineItems(previous: BetaTimelineItem[], incoming: BetaTimelineItem[]): BetaTimelineItem[] {
  const items = new Map(previous.map(item => [item.record.event_id, item]));
  for (const item of incoming) {
    const old = items.get(item.record.event_id);
    if (old && (old.kind !== item.kind || JSON.stringify(old.record) !== JSON.stringify(item.record))) {
      throw new BetaApiError('timeline_conflict', '记录与上次读取的内容不一致，已保留原显示，请查证后重试');
    }
    items.set(item.record.event_id, item);
  }
  return [...items.values()].sort((left, right) => right.record.local_seq - left.record.local_seq);
}

/** Reconcile the loaded window without dropping older pages. A large incoming
 * gap remains reachable by the existing older-page action, never marked done. */
export async function refreshTimelineWindow(
  read: (query: BetaQuery) => Promise<BetaTimelinePage>,
  previous: BetaTimelinePage | null,
  search: string,
): Promise<BetaTimelinePage> {
  const query = { limit: 100, ...(search ? { search } : {}) };
  const latest = await read(query);
  if (!previous) return latest;
  if (latest.highwater < previous.highwater) throw new BetaApiError('timeline_changed', '记录读取位置已变化，原显示已保留，请重新打开档案后查证');
  let page = latest;
  let incoming = latest.items;
  for (let count = 1; count < 16 && page.next_before !== null
      && (page.items[page.items.length - 1]?.record.local_seq ?? 0) > previous.highwater; count++) {
    page = await read({ ...query, before: page.next_before, through: latest.highwater });
    incoming = mergeTimelineItems(incoming, page.items);
  }
  const reachedOldWindow = page.next_before === null || (page.items[page.items.length - 1]?.record.local_seq ?? 0) <= previous.highwater;
  return {
    highwater: latest.highwater,
    items: mergeTimelineItems(previous.items, incoming),
    next_before: reachedOldWindow ? previous.next_before : page.next_before,
  };
}
