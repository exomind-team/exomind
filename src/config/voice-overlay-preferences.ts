export const VOICE_OVERLAY_OPACITY_STORAGE_KEY = 'exomind:voiceOverlayOpacity';
export const VOICE_OVERLAY_OPACITY_CHANGED_EVENT = 'exomind:voice-overlay-opacity-changed';

export const DEFAULT_VOICE_OVERLAY_OPACITY = 62;
export const MIN_VOICE_OVERLAY_OPACITY = 32;
export const MAX_VOICE_OVERLAY_OPACITY = 92;

function clampOverlayOpacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOICE_OVERLAY_OPACITY;
  }

  return Math.min(
    MAX_VOICE_OVERLAY_OPACITY,
    Math.max(MIN_VOICE_OVERLAY_OPACITY, Math.round(value)),
  );
}

export function getVoiceOverlayOpacity(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_VOICE_OVERLAY_OPACITY;
  }

  try {
    const rawValue = window.localStorage.getItem(VOICE_OVERLAY_OPACITY_STORAGE_KEY);
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

  if (typeof window === 'undefined') {
    return normalizedValue;
  }

  try {
    window.localStorage.setItem(VOICE_OVERLAY_OPACITY_STORAGE_KEY, String(normalizedValue));
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
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    if (detail && typeof detail.value === 'number') {
      listener(clampOverlayOpacity(detail.value));
      return;
    }

    listener(getVoiceOverlayOpacity());
  };

  window.addEventListener(VOICE_OVERLAY_OPACITY_CHANGED_EVENT, handler);
  return () => window.removeEventListener(VOICE_OVERLAY_OPACITY_CHANGED_EVENT, handler);
}
