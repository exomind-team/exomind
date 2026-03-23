export const NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY = 'exomind:nowWorkbenchOverlayEnabled';
export const NOW_WORKBENCH_OVERLAY_ENABLED_CHANGED_EVENT = 'exomind:now-workbench-overlay-enabled-changed';
export const NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY = 'exomind:nowWorkbenchOverlayPosition';
export const NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT = 'exomind:now-workbench-overlay-position-changed';

export const DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED = true;

export interface NowWorkbenchOverlayPosition {
  x: number;
  y: number;
}

const WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD = -30000;

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function normalizeBoolean(rawValue: string | null | undefined, fallback: boolean): boolean {
  if (rawValue == null) {
    return fallback;
  }
  return rawValue === 'true';
}

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function normalizePosition(rawValue: unknown): NowWorkbenchOverlayPosition | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const candidate = rawValue as Record<string, unknown>;
  const x = normalizeCoordinate(candidate.x);
  const y = normalizeCoordinate(candidate.y);
  if (x == null || y == null) {
    return null;
  }

  // Windows may report hidden/minimized helper windows at (-32000, -32000).
  // Persisting that sentinel would strand the overlay off-screen on next launch.
  if (
    x <= WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD
    && y <= WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD
  ) {
    return null;
  }

  return { x, y };
}

function subscribeBooleanPreference(
  changedEvent: string,
  storageKey: string,
  fallback: () => boolean,
  listener: (value: boolean) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    if (detail && typeof detail.value === 'boolean') {
      listener(detail.value);
      return;
    }

    listener(fallback());
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== storageKey) {
      return;
    }
    listener(normalizeBoolean(event.newValue, fallback()));
  };

  window.addEventListener(changedEvent, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(changedEvent, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

function subscribePositionPreference(
  changedEvent: string,
  storageKey: string,
  fallback: () => NowWorkbenchOverlayPosition | null,
  listener: (value: NowWorkbenchOverlayPosition | null) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    const normalized = normalizePosition(detail?.value);
    listener(normalized ?? fallback());
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== storageKey) {
      return;
    }

    if (typeof event.newValue !== 'string') {
      listener(fallback());
      return;
    }

    try {
      listener(normalizePosition(JSON.parse(event.newValue)) ?? fallback());
    } catch {
      listener(fallback());
    }
  };

  window.addEventListener(changedEvent, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(changedEvent, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function getNowWorkbenchOverlayEnabled(): boolean {
  const storage = getStorage();
  if (!storage) return DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED;

  try {
    return normalizeBoolean(
      storage.getItem(NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY),
      DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED,
    );
  } catch {
    return DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED;
  }
}

export function setNowWorkbenchOverlayEnabled(value: boolean): boolean {
  const normalizedValue = Boolean(value);
  const storage = getStorage();
  if (!storage) return normalizedValue;

  try {
    storage.setItem(NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(new CustomEvent(
      NOW_WORKBENCH_OVERLAY_ENABLED_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeNowWorkbenchOverlayEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return subscribeBooleanPreference(
    NOW_WORKBENCH_OVERLAY_ENABLED_CHANGED_EVENT,
    NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY,
    getNowWorkbenchOverlayEnabled,
    listener,
  );
}

export function getNowWorkbenchOverlayPosition(): NowWorkbenchOverlayPosition | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const rawValue = storage.getItem(NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    return normalizePosition(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function setNowWorkbenchOverlayPosition(
  value: NowWorkbenchOverlayPosition,
): NowWorkbenchOverlayPosition | null {
  const normalizedValue = normalizePosition(value);
  const storage = getStorage();
  if (!storage || !normalizedValue) return normalizedValue;

  try {
    storage.setItem(
      NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY,
      JSON.stringify(normalizedValue),
    );
    window.dispatchEvent(new CustomEvent(
      NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeNowWorkbenchOverlayPositionChanges(
  listener: (value: NowWorkbenchOverlayPosition | null) => void,
): () => void {
  return subscribePositionPreference(
    NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT,
    NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY,
    getNowWorkbenchOverlayPosition,
    listener,
  );
}
