/**
 * QuotaMonitor Settings Module
 *
 * Manages quota-related configuration:
 * - quota-monitor-enabled: localStorage (boolean)
 * - quota-minimax-api-key: runtime config store (sensitive string)
 * - quota-warning-threshold: runtime config store (u32 number)
 */

import { createConfigModule } from './config-factory';
import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUOTA_MONITOR_ENABLED_KEY = 'exomind:quotaMonitorEnabled';
const QUOTA_MINIMAX_API_KEY_KEY = 'exomind:minimaxApiKey';
const QUOTA_WARNING_THRESHOLD_KEY = 'exomind:quotaWarningThreshold';

const QUOTA_ENABLED_EVENT = 'exomind:quota-monitor-enabled-changed';
const QUOTA_API_KEY_EVENT = 'exomind:quota-api-key-changed';

const DEFAULT_WARNING_THRESHOLD = 1000;

// ---------------------------------------------------------------------------
// quota-monitor-enabled (boolean, localStorage)
// ---------------------------------------------------------------------------

function normalizeBoolean(raw: string | null | undefined): boolean {
  return raw === 'true';
}

const quotaMonitorModule = createConfigModule<boolean>({
  storageKey: QUOTA_MONITOR_ENABLED_KEY,
  eventName: QUOTA_ENABLED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  persistMode: 'localStorage',
});

export function getQuotaMonitorEnabled(): boolean {
  return quotaMonitorModule.get();
}

export function setQuotaMonitorEnabled(enabled: boolean): void {
  quotaMonitorModule.set(enabled);
}

export function subscribeQuotaMonitorEnabledChanges(listener: (enabled: boolean) => void): () => void {
  return quotaMonitorModule.subscribe(listener);
}

// ---------------------------------------------------------------------------
// quota-minimax-api-key (sensitive string, runtime config store)
// ---------------------------------------------------------------------------

function normalizeApiKey(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function getMiniMaxApiKey(): string {
  return normalizeApiKey(getRuntimeConfigValueSync(QUOTA_MINIMAX_API_KEY_KEY));
}

export async function setMiniMaxApiKey(value: string): Promise<void> {
  const normalized = normalizeApiKey(value);
  if (!normalized) {
    // Clear the value by setting empty string — the runtime config store
    // will handle removing the key appropriately.
    setRuntimeConfigValue(QUOTA_MINIMAX_API_KEY_KEY, '', {
      sensitive: true,
      source: QUOTA_API_KEY_EVENT,
      sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
    });
  } else {
    setRuntimeConfigValue(QUOTA_MINIMAX_API_KEY_KEY, normalized, {
      sensitive: true,
      source: QUOTA_API_KEY_EVENT,
      sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
    });
  }
  // Dispatch change event for subscribers
  window.dispatchEvent(new CustomEvent<string>(QUOTA_API_KEY_EVENT, { detail: normalized }));
}

export function subscribeMiniMaxApiKeyChanges(listener: (value: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    listener(customEvent.detail);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== QUOTA_MINIMAX_API_KEY_KEY) return;
    listener(normalizeApiKey(event.newValue));
  };

  window.addEventListener(QUOTA_API_KEY_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(QUOTA_API_KEY_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorage);
  };
}

// ---------------------------------------------------------------------------
// quota-warning-threshold (number, runtime config store)
// ---------------------------------------------------------------------------

function normalizeThreshold(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_WARNING_THRESHOLD;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) return DEFAULT_WARNING_THRESHOLD;
  // Clamp to reasonable range
  return Math.max(0, Math.min(10000, parsed));
}

const quotaThresholdModule = createConfigModule<number>({
  storageKey: QUOTA_WARNING_THRESHOLD_KEY,
  eventName: 'exomind:quota-warning-threshold-changed',
  defaultValue: DEFAULT_WARNING_THRESHOLD,
  normalize: normalizeThreshold,
  persistMode: 'runtime-preferred',
});

export function getQuotaWarningThreshold(): number {
  return quotaThresholdModule.get();
}

export function setQuotaWarningThreshold(value: number): void {
  const clamped = Math.max(0, Math.min(10000, value));
  quotaThresholdModule.set(clamped);
}

export function subscribeQuotaWarningThresholdChanges(listener: (value: number) => void): () => void {
  return quotaThresholdModule.subscribe(listener);
}
