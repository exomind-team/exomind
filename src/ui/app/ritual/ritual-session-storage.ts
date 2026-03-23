import {
  createEmptyRitualSession,
  type RitualSession,
} from './ritual-session';

const RITUAL_SESSION_STORAGE_KEY = 'exomind:ritual-session';

function getLocalStorageLike(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }

  const storage = window.localStorage as Partial<Storage>;
  if (
    typeof storage.getItem !== 'function'
    || typeof storage.setItem !== 'function'
    || typeof storage.removeItem !== 'function'
  ) {
    return null;
  }

  return storage as Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function getTodayRitualDayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function loadRitualSession(): RitualSession {
  const storage = getLocalStorageLike();
  const fallback = createEmptyRitualSession(getTodayRitualDayKey());
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(RITUAL_SESSION_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<RitualSession>;
    if (parsed.dayKey !== getTodayRitualDayKey()) {
      return fallback;
    }

    return {
      dayKey: parsed.dayKey ?? fallback.dayKey,
      bootedAt: parsed.bootedAt ?? null,
      selectedPlanId: parsed.selectedPlanId ?? null,
      mainTaskCompletedAt: parsed.mainTaskCompletedAt ?? null,
      shutdownCompletedAt: parsed.shutdownCompletedAt ?? null,
    };
  } catch {
    return fallback;
  }
}

export function saveRitualSession(session: RitualSession): void {
  const storage = getLocalStorageLike();
  if (!storage) {
    return;
  }

  storage.setItem(RITUAL_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearRitualSession(): void {
  const storage = getLocalStorageLike();
  storage?.removeItem(RITUAL_SESSION_STORAGE_KEY);
}
