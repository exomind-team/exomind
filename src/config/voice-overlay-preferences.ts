export const VOICE_OVERLAY_OPACITY_STORAGE_KEY = 'exomind:voiceOverlayOpacity';
export const VOICE_OVERLAY_OPACITY_CHANGED_EVENT = 'exomind:voice-overlay-opacity-changed';
export const VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY = 'exomind:voiceOverlayShowDiagnostics';
export const VOICE_OVERLAY_SHOW_DIAGNOSTICS_CHANGED_EVENT = 'exomind:voice-overlay-show-diagnostics-changed';
export const VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY = 'exomind:voiceOverlayTranscriptLines';
export const VOICE_OVERLAY_TRANSCRIPT_LINES_CHANGED_EVENT = 'exomind:voice-overlay-transcript-lines-changed';
export const VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY = 'exomind:voiceOverlayBottomOffset';
export const VOICE_OVERLAY_BOTTOM_OFFSET_CHANGED_EVENT = 'exomind:voice-overlay-bottom-offset-changed';

export const DEFAULT_VOICE_OVERLAY_OPACITY = 62;
export const MIN_VOICE_OVERLAY_OPACITY = 32;
export const MAX_VOICE_OVERLAY_OPACITY = 92;
export const DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS = false;
export const DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES = 3;
export const MIN_VOICE_OVERLAY_TRANSCRIPT_LINES = 1;
export const MAX_VOICE_OVERLAY_TRANSCRIPT_LINES = 5;
export const DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET = 56;
export const MIN_VOICE_OVERLAY_BOTTOM_OFFSET = 24;
export const MAX_VOICE_OVERLAY_BOTTOM_OFFSET = 160;

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function clampOverlayOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_OPACITY;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_OPACITY,
    Math.max(MIN_VOICE_OVERLAY_OPACITY, Math.round(value)),
  );
}

function normalizeBoolean(rawValue: string | null | undefined, fallback: boolean): boolean {
  if (rawValue == null) {
    return fallback;
  }
  return rawValue === 'true';
}

function clampOverlayTranscriptLines(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_TRANSCRIPT_LINES,
    Math.max(MIN_VOICE_OVERLAY_TRANSCRIPT_LINES, Math.round(value)),
  );
}

function clampOverlayBottomOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_BOTTOM_OFFSET,
    Math.max(MIN_VOICE_OVERLAY_BOTTOM_OFFSET, Math.round(value)),
  );
}

function subscribeNumericPreference(
  changedEvent: string,
  storageKey: string,
  fallback: () => number,
  clamp: (value: number) => number,
  listener: (value: number) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    if (detail && typeof detail.value === 'number') {
      listener(clamp(detail.value));
      return;
    }

    listener(fallback());
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== storageKey) {
      return;
    }
    if (typeof event.newValue === 'string') {
      listener(clamp(Number.parseInt(event.newValue, 10)));
      return;
    }
    listener(fallback());
  };

  window.addEventListener(changedEvent, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(changedEvent, handler);
    window.removeEventListener('storage', storageHandler);
  };
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

export function getVoiceOverlayOpacity(): number {
  const storage = getStorage();
  if (!storage) return DEFAULT_VOICE_OVERLAY_OPACITY;
  try {
    const rawValue = storage.getItem(VOICE_OVERLAY_OPACITY_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_VOICE_OVERLAY_OPACITY;
    }

    return clampOverlayOpacity(Number.parseInt(rawValue, 10));
  } catch {
    return DEFAULT_VOICE_OVERLAY_OPACITY;
  }
}

export function setVoiceOverlayOpacity(value: number): number {
  const normalizedValue = clampOverlayOpacity(value);
  const storage = getStorage();
  if (!storage) return normalizedValue;

  try {
    storage.setItem(VOICE_OVERLAY_OPACITY_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(
      new CustomEvent(VOICE_OVERLAY_OPACITY_CHANGED_EVENT, {
        detail: { value: normalizedValue },
      }),
    );
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeVoiceOverlayOpacityChanges(
  listener: (value: number) => void,
): () => void {
  return subscribeNumericPreference(
    VOICE_OVERLAY_OPACITY_CHANGED_EVENT,
    VOICE_OVERLAY_OPACITY_STORAGE_KEY,
    getVoiceOverlayOpacity,
    clampOverlayOpacity,
    listener,
  );
}

export function getVoiceOverlayShowDiagnostics(): boolean {
  const storage = getStorage();
  if (!storage) return DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS;

  try {
    return normalizeBoolean(
      storage.getItem(VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY),
      DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS,
    );
  } catch {
    return DEFAULT_VOICE_OVERLAY_SHOW_DIAGNOSTICS;
  }
}

export function setVoiceOverlayShowDiagnostics(value: boolean): boolean {
  const normalizedValue = Boolean(value);
  const storage = getStorage();
  if (!storage) return normalizedValue;

  try {
    storage.setItem(VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(new CustomEvent(
      VOICE_OVERLAY_SHOW_DIAGNOSTICS_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeVoiceOverlayShowDiagnosticsChanges(
  listener: (value: boolean) => void,
): () => void {
  return subscribeBooleanPreference(
    VOICE_OVERLAY_SHOW_DIAGNOSTICS_CHANGED_EVENT,
    VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY,
    getVoiceOverlayShowDiagnostics,
    listener,
  );
}

export function getVoiceOverlayTranscriptLines(): number {
  const storage = getStorage();
  if (!storage) return DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES;

  try {
    const rawValue = storage.getItem(VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES;
    }

    return clampOverlayTranscriptLines(Number.parseInt(rawValue, 10));
  } catch {
    return DEFAULT_VOICE_OVERLAY_TRANSCRIPT_LINES;
  }
}

export function setVoiceOverlayTranscriptLines(value: number): number {
  const normalizedValue = clampOverlayTranscriptLines(value);
  const storage = getStorage();
  if (!storage) return normalizedValue;

  try {
    storage.setItem(VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(new CustomEvent(
      VOICE_OVERLAY_TRANSCRIPT_LINES_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeVoiceOverlayTranscriptLinesChanges(
  listener: (value: number) => void,
): () => void {
  return subscribeNumericPreference(
    VOICE_OVERLAY_TRANSCRIPT_LINES_CHANGED_EVENT,
    VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY,
    getVoiceOverlayTranscriptLines,
    clampOverlayTranscriptLines,
    listener,
  );
}

export function getVoiceOverlayBottomOffset(): number {
  const storage = getStorage();
  if (!storage) return DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;

  try {
    const rawValue = storage.getItem(VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
    }

    return clampOverlayBottomOffset(Number.parseInt(rawValue, 10));
  } catch {
    return DEFAULT_VOICE_OVERLAY_BOTTOM_OFFSET;
  }
}

export function setVoiceOverlayBottomOffset(value: number): number {
  const normalizedValue = clampOverlayBottomOffset(value);
  const storage = getStorage();
  if (!storage) return normalizedValue;

  try {
    storage.setItem(VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY, String(normalizedValue));
    window.dispatchEvent(new CustomEvent(
      VOICE_OVERLAY_BOTTOM_OFFSET_CHANGED_EVENT,
      { detail: { value: normalizedValue } },
    ));
  } catch {
    // ignore localStorage write errors
  }

  return normalizedValue;
}

export function subscribeVoiceOverlayBottomOffsetChanges(
  listener: (value: number) => void,
): () => void {
  return subscribeNumericPreference(
    VOICE_OVERLAY_BOTTOM_OFFSET_CHANGED_EVENT,
    VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY,
    getVoiceOverlayBottomOffset,
    clampOverlayBottomOffset,
    listener,
  );
}
