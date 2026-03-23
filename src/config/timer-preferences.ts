import {
  DEFAULT_TIMER_END_SOUND_PRESET_ID,
  getTimerEndSoundPresetById,
  type TimerEndSoundPresetId,
} from '@/lib/media/timer-end-sounds';

export const TIMER_PREFERENCES_STORAGE_KEY = 'exomind:timerPreferences';
export const TIMER_PREFERENCES_CHANGED_EVENT = 'exomind:timer-preferences-changed';

export type CountdownEndMode = 'hard' | 'soft';

export type TimerPreferences = {
  countdownEndMode: CountdownEndMode;
  countdownEndSoundEnabled: boolean;
  countdownEndSoundPresetId: TimerEndSoundPresetId;
};

const DEFAULT_TIMER_PREFERENCES: TimerPreferences = {
  countdownEndMode: 'soft',
  countdownEndSoundEnabled: true,
  countdownEndSoundPresetId: DEFAULT_TIMER_END_SOUND_PRESET_ID,
};

function isCountdownEndMode(value: unknown): value is CountdownEndMode {
  return value === 'hard' || value === 'soft';
}

function normalizeTimerPreferences(value: unknown): TimerPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_TIMER_PREFERENCES;
  }

  const record = value as Partial<TimerPreferences>;
  return {
    countdownEndMode: isCountdownEndMode(record.countdownEndMode)
      ? record.countdownEndMode
      : DEFAULT_TIMER_PREFERENCES.countdownEndMode,
    countdownEndSoundEnabled:
      typeof record.countdownEndSoundEnabled === 'boolean'
        ? record.countdownEndSoundEnabled
        : DEFAULT_TIMER_PREFERENCES.countdownEndSoundEnabled,
    countdownEndSoundPresetId: getTimerEndSoundPresetById(
      record.countdownEndSoundPresetId,
    ).id,
  };
}

export function getTimerPreferences(): TimerPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_TIMER_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(TIMER_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TIMER_PREFERENCES;
    }
    return normalizeTimerPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_TIMER_PREFERENCES;
  }
}

export function setTimerPreferences(preferences: TimerPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    const normalized = normalizeTimerPreferences(preferences);
    window.localStorage.setItem(
      TIMER_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(
      new CustomEvent(TIMER_PREFERENCES_CHANGED_EVENT, {
        detail: { value: normalized },
      }),
    );
  } catch {
    // ignore localStorage write errors
  }
}

export function updateTimerPreferences(
  patch: Partial<TimerPreferences>,
): TimerPreferences {
  const merged = {
    ...getTimerPreferences(),
    ...patch,
  };
  const normalized = normalizeTimerPreferences(merged);
  setTimerPreferences(normalized);
  return normalized;
}

export function subscribeTimerPreferencesChanges(
  listener: (preferences: TimerPreferences) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== TIMER_PREFERENCES_STORAGE_KEY) return;
    listener(getTimerPreferences());
  };

  const handleCustomEvent = (event: Event) => {
    const detail = (
      event as CustomEvent<{ value?: unknown }>
    ).detail;
    listener(normalizeTimerPreferences(detail?.value));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(TIMER_PREFERENCES_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(
      TIMER_PREFERENCES_CHANGED_EVENT,
      handleCustomEvent,
    );
  };
}

