import {
  buildEventPermalink,
  buildEventRecordPath,
  EVENTLOG_RECORD_EVENT_QUERY_KEY,
  EVENTLOG_RECORD_LOCATE_QUERY_KEY,
} from '@/lib/eventlog/event-refs';

export const EVENTLOG_LAST_TAB_KEY = 'exomind:last-eventlog-tab';
export const EVENTLOG_TAB_VALUES = ['focus', 'record', 'today'] as const;
export const EVENTLOG_TAB_PATHS = {
  focus: '/eventlog',
  record: '/eventlog/record',
  today: '/eventlog/today',
} as const;

export type EventlogTabValue = (typeof EVENTLOG_TAB_VALUES)[number];
export interface EventlogRecordLocateTarget {
  eventId: string | null;
  shouldLocate: boolean;
}

export function normalizeEventlogTab(rawValue: string | null | undefined): EventlogTabValue {
  return EVENTLOG_TAB_VALUES.includes(rawValue as EventlogTabValue)
    ? rawValue as EventlogTabValue
    : 'focus';
}

function getSessionStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const sessionStorageLike = window.sessionStorage as Partial<Storage> | undefined;
  if (!sessionStorageLike) return null;
  if (typeof sessionStorageLike.getItem !== 'function') return null;
  if (typeof sessionStorageLike.setItem !== 'function') return null;
  return sessionStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

export function getEventlogLastTab(): EventlogTabValue {
  const storage = getSessionStorage();
  if (!storage) return 'focus';
  return normalizeEventlogTab(storage.getItem(EVENTLOG_LAST_TAB_KEY));
}

export function setEventlogLastTab(tab: string): EventlogTabValue {
  const normalized = normalizeEventlogTab(tab);
  const storage = getSessionStorage();
  if (!storage) return normalized;
  storage.setItem(EVENTLOG_LAST_TAB_KEY, normalized);
  return normalized;
}

export function resolveEventlogRestoreTab(search: string): EventlogTabValue | null {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const explicitTab = params.get('tab');
  if (EVENTLOG_TAB_VALUES.includes(explicitTab as EventlogTabValue)) {
    return null;
  }

  const saved = getEventlogLastTab();
  return saved === 'focus' ? null : saved;
}

export function resolveLegacyEventlogTabSearch(search: string): EventlogTabValue | null {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const explicitTab = params.get('tab');
  return EVENTLOG_TAB_VALUES.includes(explicitTab as EventlogTabValue)
    ? explicitTab as EventlogTabValue
    : null;
}

export function parseEventlogLocateSearch(search: string): EventlogRecordLocateTarget {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const rawEventId = params.get(EVENTLOG_RECORD_EVENT_QUERY_KEY)?.trim() ?? '';
  const rawLocate = params.get(EVENTLOG_RECORD_LOCATE_QUERY_KEY)?.trim().toLowerCase() ?? '';

  return {
    eventId: rawEventId.length > 0 ? rawEventId : null,
    shouldLocate: rawLocate === '1' || rawLocate === 'true' || rawLocate === 'yes',
  };
}

export function buildEventlogRecordLocatePath(eventId: string, locate = true): string {
  return buildEventRecordPath(eventId, locate);
}

export function buildEventlogRecordPermalink(eventId: string, origin?: string): string {
  return buildEventPermalink(eventId, origin);
}

export function getEventlogPathForTab(tab: string): string {
  return EVENTLOG_TAB_PATHS[normalizeEventlogTab(tab)];
}

export function resolveEventlogTabFromLocation(pathname: string, search = ''): EventlogTabValue {
  if (pathname === '/eventlog/record') {
    return 'record';
  }
  if (pathname === '/eventlog/today') {
    return 'today';
  }
  return resolveLegacyEventlogTabSearch(search) ?? 'focus';
}
