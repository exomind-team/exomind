import {
  DEFAULT_FOCUS_BGM_PRESET_ID,
  getFocusBgmPresetById,
  type FocusBgmPresetId,
} from '@/lib/media/focus-bgm-presets';

export const FOCUS_BGM_PREFERENCES_STORAGE_KEY = 'exomind:focusBgmPreferences';
export const FOCUS_BGM_PREFERENCES_CHANGED_EVENT = 'exomind:focus-bgm-preferences-changed';

export type FocusBgmSourceType = 'preset' | 'custom';
export type FocusBgmPlaybackMode = 'loop' | 'sequence';
export type FocusBgmStopBehavior = 'timer-end' | 'manual-end';

export interface FocusBgmTrack {
  path: string;
  name: string;
}

export interface FocusBgmPreferences {
  enabled: boolean;
  sourceType: FocusBgmSourceType;
  presetId: FocusBgmPresetId;
  customTracks: FocusBgmTrack[];
  playbackMode: FocusBgmPlaybackMode;
  stopBehavior: FocusBgmStopBehavior;
  volume: number;
}

const DEFAULT_FOCUS_BGM_PREFERENCES: FocusBgmPreferences = {
  enabled: false,
  sourceType: 'preset',
  presetId: DEFAULT_FOCUS_BGM_PRESET_ID,
  customTracks: [],
  playbackMode: 'loop',
  stopBehavior: 'manual-end',
  volume: 60,
};

function isFocusBgmSourceType(value: unknown): value is FocusBgmSourceType {
  return value === 'preset' || value === 'custom';
}

function isFocusBgmPlaybackMode(value: unknown): value is FocusBgmPlaybackMode {
  return value === 'loop' || value === 'sequence';
}

function isFocusBgmStopBehavior(value: unknown): value is FocusBgmStopBehavior {
  return value === 'timer-end' || value === 'manual-end';
}

function resolveTrackName(path: string, name: unknown): string {
  if (typeof name === 'string' && name.trim().length > 0) {
    return name.trim();
  }

  const normalizedPath = path.replace(/\\/g, '/');
  const leaf = normalizedPath.split('/').pop()?.trim();
  return leaf && leaf.length > 0 ? leaf : path.trim();
}

function normalizeTracks(value: unknown): FocusBgmTrack[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const record = entry as Partial<FocusBgmTrack>;
      if (typeof record.path !== 'string' || record.path.trim().length === 0) {
        return null;
      }

      const path = record.path.trim();
      return {
        path,
        name: resolveTrackName(path, record.name),
      } satisfies FocusBgmTrack;
    })
    .filter((entry): entry is FocusBgmTrack => entry !== null);
}

function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return DEFAULT_FOCUS_BGM_PREFERENCES.volume;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeFocusBgmPreferences(value: unknown): FocusBgmPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_FOCUS_BGM_PREFERENCES;
  }

  const record = value as Partial<FocusBgmPreferences>;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_FOCUS_BGM_PREFERENCES.enabled,
    sourceType: isFocusBgmSourceType(record.sourceType) ? record.sourceType : DEFAULT_FOCUS_BGM_PREFERENCES.sourceType,
    presetId: getFocusBgmPresetById(record.presetId).id,
    customTracks: normalizeTracks(record.customTracks),
    playbackMode: isFocusBgmPlaybackMode(record.playbackMode) ? record.playbackMode : DEFAULT_FOCUS_BGM_PREFERENCES.playbackMode,
    stopBehavior: isFocusBgmStopBehavior(record.stopBehavior) ? record.stopBehavior : DEFAULT_FOCUS_BGM_PREFERENCES.stopBehavior,
    volume: clampVolume(record.volume),
  };
}

export function getFocusBgmPreferences(): FocusBgmPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_FOCUS_BGM_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(FOCUS_BGM_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FOCUS_BGM_PREFERENCES;
    }

    return normalizeFocusBgmPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_FOCUS_BGM_PREFERENCES;
  }
}

export function setFocusBgmPreferences(preferences: FocusBgmPreferences): FocusBgmPreferences {
  if (typeof window === 'undefined') {
    return normalizeFocusBgmPreferences(preferences);
  }

  const normalized = normalizeFocusBgmPreferences(preferences);
  try {
    window.localStorage.setItem(
      FOCUS_BGM_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(new CustomEvent(FOCUS_BGM_PREFERENCES_CHANGED_EVENT, {
      detail: { value: normalized },
    }));
  } catch {
    // Ignore localStorage write failures（忽略本地存储失败）
  }

  return normalized;
}

export function updateFocusBgmPreferences(
  patch: Partial<FocusBgmPreferences>,
): FocusBgmPreferences {
  return setFocusBgmPreferences({
    ...getFocusBgmPreferences(),
    ...patch,
  });
}

export function subscribeFocusBgmPreferencesChanges(
  listener: (preferences: FocusBgmPreferences) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== FOCUS_BGM_PREFERENCES_STORAGE_KEY) {
      return;
    }

    listener(event.newValue ? normalizeFocusBgmPreferences(JSON.parse(event.newValue)) : DEFAULT_FOCUS_BGM_PREFERENCES);
  };

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ value?: unknown }>).detail;
    listener(normalizeFocusBgmPreferences(detail?.value));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(FOCUS_BGM_PREFERENCES_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(FOCUS_BGM_PREFERENCES_CHANGED_EVENT, handleCustomEvent);
  };
}
