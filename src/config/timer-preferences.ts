import { createConfigModule } from './config-factory';
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

function parseStoredTimerPreferences(rawValue: string | null | undefined): TimerPreferences {
  if (!rawValue) {
    return DEFAULT_TIMER_PREFERENCES;
  }
  try {
    return normalizeTimerPreferences(JSON.parse(rawValue));
  } catch {
    return DEFAULT_TIMER_PREFERENCES;
  }
}

const timerPreferencesModule = createConfigModule<TimerPreferences>({
  storageKey: TIMER_PREFERENCES_STORAGE_KEY,
  eventName: TIMER_PREFERENCES_CHANGED_EVENT,
  defaultValue: DEFAULT_TIMER_PREFERENCES,
  normalize: parseStoredTimerPreferences,
  serialize: (value) => JSON.stringify(normalizeTimerPreferences(value)),
  persistMode: 'runtime-preferred',
});

export function getTimerPreferences(): TimerPreferences {
  return timerPreferencesModule.get();
}

export function setTimerPreferences(preferences: TimerPreferences): void {
  timerPreferencesModule.set(preferences);
}

export function updateTimerPreferences(
  patch: Partial<TimerPreferences>,
): TimerPreferences {
  const merged = {
    ...getTimerPreferences(),
    ...patch,
  };
  return timerPreferencesModule.set(merged);
}

export function subscribeTimerPreferencesChanges(
  listener: (preferences: TimerPreferences) => void,
): () => void {
  return timerPreferencesModule.subscribe(listener);
}
