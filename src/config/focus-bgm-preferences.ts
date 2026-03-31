import { createConfigModule } from './config-factory';
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
  return focusBgmPreferencesModule.get();
}

function parseStoredFocusBgmPreferences(rawValue: string | null | undefined): FocusBgmPreferences {
  if (!rawValue) {
    return DEFAULT_FOCUS_BGM_PREFERENCES;
  }
  try {
    return normalizeFocusBgmPreferences(JSON.parse(rawValue));
  } catch {
    return DEFAULT_FOCUS_BGM_PREFERENCES;
  }
}

const focusBgmPreferencesModule = createConfigModule<FocusBgmPreferences>({
  storageKey: FOCUS_BGM_PREFERENCES_STORAGE_KEY,
  eventName: FOCUS_BGM_PREFERENCES_CHANGED_EVENT,
  defaultValue: DEFAULT_FOCUS_BGM_PREFERENCES,
  normalize: parseStoredFocusBgmPreferences,
  serialize: (value) => JSON.stringify(normalizeFocusBgmPreferences(value)),
  persistMode: 'runtime-preferred',
});

export function setFocusBgmPreferences(preferences: FocusBgmPreferences): FocusBgmPreferences {
  return focusBgmPreferencesModule.set(preferences);
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
  return focusBgmPreferencesModule.subscribe(listener);
}
