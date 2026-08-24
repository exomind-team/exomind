import { createConfigModule } from './config-factory';
import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

export const NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY = 'exomind:nowWorkbenchOverlayEnabled';
export const NOW_WORKBENCH_OVERLAY_ENABLED_CHANGED_EVENT = 'exomind:now-workbench-overlay-enabled-changed';
export const NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY = 'exomind:nowWorkbenchOverlayPosition';
export const NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT = 'exomind:now-workbench-overlay-position-changed';

export const DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED = true;

export interface NowWorkbenchOverlayPosition {
  x: number;
  y: number;
}

interface StoredNowWorkbenchOverlayPosition extends NowWorkbenchOverlayPosition {
  displaySignature: string;
}

const WINDOWS_HIDDEN_WINDOW_COORDINATE_THRESHOLD = -30000;

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

function resolveDisplaySignature(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const width = window.screen?.availWidth || window.screen?.width;
  const height = window.screen?.availHeight || window.screen?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) {
    return null;
  }

  return `${Math.round(width)}x${Math.round(height)}`;
}

function normalizeStoredPosition(
  rawValue: unknown,
): StoredNowWorkbenchOverlayPosition | null {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const candidate = rawValue as Record<string, unknown>;
  const normalized = normalizePosition(candidate);
  const displaySignature = typeof candidate.displaySignature === 'string'
    ? candidate.displaySignature.trim()
    : '';
  const currentDisplaySignature = resolveDisplaySignature();
  if (!normalized || !displaySignature || !currentDisplaySignature) {
    return null;
  }
  if (displaySignature !== currentDisplaySignature) {
    return null;
  }

  return {
    ...normalized,
    displaySignature,
  };
}

function parseStoredPosition(rawValue: string | null | undefined): NowWorkbenchOverlayPosition | null {
  if (!rawValue) {
    return null;
  }

  try {
    const normalized = normalizeStoredPosition(JSON.parse(rawValue));
    if (!normalized) {
      return null;
    }
    return {
      x: normalized.x,
      y: normalized.y,
    };
  } catch {
    return null;
  }
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

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<NowWorkbenchOverlayPosition | null>;
    listener(normalizePosition(customEvent.detail) ?? fallback());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) {
      return;
    }

    listener(parseStoredPosition(event.newValue) ?? fallback());
  };

  window.addEventListener(changedEvent, handleCustomEvent);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(changedEvent, handleCustomEvent);
    window.removeEventListener('storage', handleStorage);
  };
}

const enabledModule = createConfigModule<boolean>({
  storageKey: NOW_WORKBENCH_OVERLAY_ENABLED_STORAGE_KEY,
  eventName: NOW_WORKBENCH_OVERLAY_ENABLED_CHANGED_EVENT,
  defaultValue: DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED,
  normalize: (rawValue) => normalizeBoolean(rawValue, DEFAULT_NOW_WORKBENCH_OVERLAY_ENABLED),
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getNowWorkbenchOverlayEnabled(): boolean {
  return enabledModule.get();
}

export function setNowWorkbenchOverlayEnabled(value: boolean): boolean {
  return enabledModule.set(value);
}

export function subscribeNowWorkbenchOverlayEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return enabledModule.subscribe(listener);
}

export function getNowWorkbenchOverlayPosition(): NowWorkbenchOverlayPosition | null {
  return parseStoredPosition(getRuntimeConfigValueSync(NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY));
}

export function setNowWorkbenchOverlayPosition(
  value: NowWorkbenchOverlayPosition,
): NowWorkbenchOverlayPosition | null {
  const normalizedValue = normalizePosition(value);
  if (!normalizedValue) return normalizedValue;
  const displaySignature = resolveDisplaySignature();
  if (!displaySignature) {
    return normalizedValue;
  }
  if (typeof window === 'undefined') {
    return normalizedValue;
  }

  try {
    const storedValue: StoredNowWorkbenchOverlayPosition = {
      ...normalizedValue,
      displaySignature,
    };
    setRuntimeConfigValue(
      NOW_WORKBENCH_OVERLAY_POSITION_STORAGE_KEY,
      JSON.stringify(storedValue),
      {
        source: NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT,
        sourceOrigin: window.location?.origin,
      },
    );
    window.dispatchEvent(new CustomEvent<NowWorkbenchOverlayPosition>(
      NOW_WORKBENCH_OVERLAY_POSITION_CHANGED_EVENT,
      { detail: normalizedValue },
    ));
  } catch {
    // Ignore runtime/local mirror write errors（忽略 Runtime / 本地镜像写入失败）
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
