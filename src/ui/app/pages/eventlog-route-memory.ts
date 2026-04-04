export const EVENTLOG_LAST_TAB_KEY = 'exomind:last-eventlog-tab';
export const EVENTLOG_TAB_VALUES = ['focus', 'record', 'today'] as const;
export const EVENTLOG_TAB_PATHS = {
  focus: '/eventlog',
  record: '/eventlog/record',
  today: '/eventlog/today',
} as const;

export type EventlogTabValue = (typeof EVENTLOG_TAB_VALUES)[number];

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
