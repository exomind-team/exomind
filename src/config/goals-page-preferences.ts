import {
  readRuntimeBackedValue,
  writeRuntimeBackedValue,
} from './runtime-preference-storage';

export type GoalsPageMode = 'browse' | 'edit';

export const GOALS_PAGE_MODE_STORAGE_KEY = 'exomind:goals-mode';
export const GOALS_PAGE_SHOW_CANCELLED_STORAGE_KEY = 'exomind:goals-show-cancelled';
export const GOALS_PAGE_GUIDE_HIDDEN_STORAGE_KEY = 'exomind:goals-guide-hidden';
export const GOALS_PAGE_MODE_CHANGED_EVENT = 'exomind:goals-mode-changed';
export const GOALS_PAGE_SHOW_CANCELLED_CHANGED_EVENT = 'exomind:goals-show-cancelled-changed';
export const GOALS_PAGE_GUIDE_HIDDEN_CHANGED_EVENT = 'exomind:goals-guide-hidden-changed';

function normalizeBoolean(rawValue: string | null, fallback: boolean): boolean {
  if (rawValue == null) {
    return fallback;
  }

  return rawValue === 'true';
}

export function getGoalsPageMode(): GoalsPageMode {
  return readRuntimeBackedValue(GOALS_PAGE_MODE_STORAGE_KEY) === 'edit' ? 'edit' : 'browse';
}

export function setGoalsPageMode(mode: GoalsPageMode): GoalsPageMode {
  const normalized = mode === 'edit' ? 'edit' : 'browse';
  writeRuntimeBackedValue(
    GOALS_PAGE_MODE_STORAGE_KEY,
    normalized,
    GOALS_PAGE_MODE_CHANGED_EVENT,
  );
  return normalized;
}

export function getGoalsPageShowCancelled(): boolean {
  return normalizeBoolean(readRuntimeBackedValue(GOALS_PAGE_SHOW_CANCELLED_STORAGE_KEY), false);
}

export function setGoalsPageShowCancelled(showCancelled: boolean): boolean {
  const normalized = Boolean(showCancelled);
  writeRuntimeBackedValue(
    GOALS_PAGE_SHOW_CANCELLED_STORAGE_KEY,
    String(normalized),
    GOALS_PAGE_SHOW_CANCELLED_CHANGED_EVENT,
  );
  return normalized;
}

export function getGoalsPageGuideHidden(): boolean {
  return normalizeBoolean(readRuntimeBackedValue(GOALS_PAGE_GUIDE_HIDDEN_STORAGE_KEY), false);
}

export function setGoalsPageGuideHidden(hidden: boolean): boolean {
  const normalized = Boolean(hidden);
  writeRuntimeBackedValue(
    GOALS_PAGE_GUIDE_HIDDEN_STORAGE_KEY,
    String(normalized),
    GOALS_PAGE_GUIDE_HIDDEN_CHANGED_EVENT,
  );
  return normalized;
}
