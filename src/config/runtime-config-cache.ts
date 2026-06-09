import {
  bootstrapRuntimeConfigTransport,
  clearRuntimeConfigTransport,
  deleteRuntimeConfigValue as deleteRuntimeConfigValueRemote,
  isRuntimeConfigTransportDisabledError,
  writeRuntimeConfigValue as writeRuntimeConfigValueRemote,
  __resetRuntimeConfigAdapterForTests,
} from './runtime-config-adapter';
import type {
  RuntimeConfigEntryRecord,
  RuntimeConfigWriteOptions,
} from './runtime-config-types';

type PendingRuntimeMutation = {
  kind: 'set';
  value: string;
  options: RuntimeConfigWriteOptions;
  version: number;
} | {
  kind: 'remove';
  version: number;
};

type RuntimeConfigCacheState = {
  bootstrapped: boolean;
  bootstrapSuspended: boolean;
  runtimeEnabled: boolean;
  entries: Map<string, string>;
  suspendedEntries: Map<string, string>;
  persistedValues: Map<string, string | null>;
  pendingMutations: Map<string, PendingRuntimeMutation>;
  operationVersions: Map<string, number>;
  persistQueues: Map<string, Promise<void>>;
  bootstrapPromise: Promise<void> | null;
  bootstrapRetryTimer: number | null;
};

const BOOTSTRAP_RETRY_DELAY_MS = 1000;

const state: RuntimeConfigCacheState = {
  bootstrapped: false,
  bootstrapSuspended: false,
  runtimeEnabled: false,
  entries: new Map(),
  suspendedEntries: new Map(),
  persistedValues: new Map(),
  pendingMutations: new Map(),
  operationVersions: new Map(),
  persistQueues: new Map(),
  bootstrapPromise: null,
  bootstrapRetryTimer: null,
};

let runtimeStorageSyncHandler: ((event: StorageEvent) => void) | null = null;

function readLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn('[runtime-config] localStorage mirror read failed:', key, error);
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn('[runtime-config] localStorage mirror write failed:', key, error);
  }
}

function removeLocalStorageValue(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('[runtime-config] localStorage mirror remove failed:', key, error);
  }
}

function replacePersistedValues(entries: RuntimeConfigEntryRecord[]): void {
  state.persistedValues = new Map(entries.map((entry) => [entry.key, entry.value]));
}

function buildRuntimeEntries(entries: RuntimeConfigEntryRecord[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.key, entry.value]));
}

function readEffectiveValue(key: string): string | null {
  if (state.runtimeEnabled && state.entries.has(key)) {
    return state.entries.get(key) ?? null;
  }

  const pendingMutation = state.pendingMutations.get(key);
  if (pendingMutation?.kind === 'remove') {
    return null;
  }

  const localValue = readLocalStorageValue(key);
  if (localValue != null) {
    return localValue;
  }

  if (state.suspendedEntries.has(key)) {
    return state.suspendedEntries.get(key) ?? null;
  }

  return null;
}

function dispatchSyntheticStorageEvent(key: string, value: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: value,
      url: window.location?.href,
      storageArea: window.localStorage,
    }));
  } catch {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }
}

function notifyEffectiveValueChanges(
  previousValues: Map<string, string | null>,
  keys: Iterable<string>,
): void {
  for (const key of keys) {
    const previousValue = previousValues.get(key) ?? null;
    const nextValue = readEffectiveValue(key);
    if (previousValue === nextValue) {
      continue;
    }
    dispatchSyntheticStorageEvent(key, nextValue);
  }
}

function restoreLocalMirror(key: string, value: string | null): void {
  if (value == null) {
    removeLocalStorageValue(key);
    return;
  }

  writeLocalStorageValue(key, value);
}

function ensurePersistedBaseline(key: string): void {
  if (!state.persistedValues.has(key)) {
    state.persistedValues.set(key, readEffectiveValue(key));
  }
}

function nextOperationVersion(key: string): number {
  const nextVersion = (state.operationVersions.get(key) ?? 0) + 1;
  state.operationVersions.set(key, nextVersion);
  return nextVersion;
}

function isLatestOperation(key: string, version: number): boolean {
  return state.operationVersions.get(key) === version;
}

function getPersistedValue(key: string): string | null {
  if (state.persistedValues.has(key)) {
    return state.persistedValues.get(key) ?? null;
  }

  return null;
}

function enumerateLocalStorageKeys(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const keys = new Set<string>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) {
        keys.add(key);
      }
    }
  } catch {
    return [];
  }

  return [...keys];
}

function applyPendingMutations(entries: Map<string, string>): void {
  for (const [key, mutation] of state.pendingMutations.entries()) {
    if (mutation.kind === 'set') {
      entries.set(key, mutation.value);
      continue;
    }
    entries.delete(key);
  }
}

function clearPendingMutation(key: string, version: number): void {
  const mutation = state.pendingMutations.get(key);
  if (!mutation || mutation.version !== version) {
    return;
  }
  state.pendingMutations.delete(key);
}

function collectRuntimeConfigKeysByPrefixes(prefixes: readonly string[]): string[] {
  const keys = new Set<string>();
  const addKeys = (source: Iterable<string>) => {
    for (const key of source) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.add(key);
      }
    }
  };

  addKeys(state.entries.keys());
  addKeys(state.suspendedEntries.keys());
  addKeys(state.persistedValues.keys());
  addKeys(state.pendingMutations.keys());
  addKeys(enumerateLocalStorageKeys());

  return [...keys];
}

function queuePersistence(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = state.persistQueues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  state.persistQueues.set(key, next);
  void next.finally(() => {
    if (state.persistQueues.get(key) === next) {
      state.persistQueues.delete(key);
    }
  });
  return next;
}

function clearBootstrapRetryTimer(): void {
  if (state.bootstrapRetryTimer == null) {
    return;
  }

  window.clearTimeout(state.bootstrapRetryTimer);
  state.bootstrapRetryTimer = null;
}

function ensureRuntimeStorageSync(): void {
  if (typeof window === 'undefined' || runtimeStorageSyncHandler) {
    return;
  }

  runtimeStorageSyncHandler = (event: StorageEvent) => {
    const { key, newValue } = event;
    if (!key || state.pendingMutations.has(key)) {
      return;
    }
    if (event.storageArea && event.storageArea !== window.localStorage) {
      return;
    }

    const hasRuntimeEntry = state.entries.has(key);
    const hasSuspendedEntry = state.suspendedEntries.has(key);
    if (!hasRuntimeEntry && !hasSuspendedEntry) {
      return;
    }

    if (newValue == null) {
      if (hasRuntimeEntry) {
        state.entries.delete(key);
      }
      if (hasSuspendedEntry) {
        state.suspendedEntries.delete(key);
      }
      return;
    }

    if (hasRuntimeEntry) {
      state.entries.set(key, newValue);
    }
    if (hasSuspendedEntry) {
      state.suspendedEntries.set(key, newValue);
    }
  };

  window.addEventListener('storage', runtimeStorageSyncHandler, true);
}

function clearRuntimeStorageSync(): void {
  if (typeof window === 'undefined' || !runtimeStorageSyncHandler) {
    return;
  }

  window.removeEventListener('storage', runtimeStorageSyncHandler, true);
  runtimeStorageSyncHandler = null;
}

function scheduleBootstrapRetry(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (state.bootstrapRetryTimer != null || state.bootstrapped || state.bootstrapSuspended) {
    return;
  }

  state.bootstrapRetryTimer = window.setTimeout(() => {
    state.bootstrapRetryTimer = null;
    void bootstrapRuntimeConfig().catch(() => {});
  }, BOOTSTRAP_RETRY_DELAY_MS);
}

function persistRuntimeSet(
  key: string,
  value: string,
  options: RuntimeConfigWriteOptions,
  operationVersion: number,
): void {
  void queuePersistence(key, async () => {
    try {
      await writeRuntimeConfigValueRemote(key, value, options);
      state.persistedValues.set(key, value);
      clearPendingMutation(key, operationVersion);
    } catch (error) {
      if (!isLatestOperation(key, operationVersion)) {
        console.warn('[runtime-config-cache] stale failed runtime write ignored', error);
        return;
      }

      clearPendingMutation(key, operationVersion);
      const rollbackValue = getPersistedValue(key);
      if (rollbackValue == null) {
        state.entries.delete(key);
      } else {
        state.entries.set(key, rollbackValue);
      }
      restoreLocalMirror(key, rollbackValue);
      if (rollbackValue !== value) {
        dispatchSyntheticStorageEvent(key, rollbackValue);
      }
      console.warn('[runtime-config-cache] failed to persist runtime value, rolled back local mirror', error);
    }
  });
}

function persistRuntimeDelete(key: string, operationVersion: number): void {
  void queuePersistence(key, async () => {
    try {
      await deleteRuntimeConfigValueRemote(key);
      state.persistedValues.set(key, null);
      clearPendingMutation(key, operationVersion);
    } catch (error) {
      if (!isLatestOperation(key, operationVersion)) {
        console.warn('[runtime-config-cache] stale failed runtime delete ignored', error);
        return;
      }

      clearPendingMutation(key, operationVersion);
      const rollbackValue = getPersistedValue(key);
      if (rollbackValue == null) {
        state.entries.delete(key);
      } else {
        state.entries.set(key, rollbackValue);
      }
      restoreLocalMirror(key, rollbackValue);
      if (rollbackValue !== null) {
        dispatchSyntheticStorageEvent(key, rollbackValue);
      }
      console.warn('[runtime-config-cache] failed to delete runtime value, restored local mirror', error);
    }
  });
}

function replayPendingMutations(): void {
  for (const [key, mutation] of state.pendingMutations.entries()) {
    if (mutation.kind === 'set') {
      persistRuntimeSet(key, mutation.value, mutation.options, mutation.version);
      continue;
    }
    persistRuntimeDelete(key, mutation.version);
  }
}

export function suspendRuntimeConfigBootstrap(): void {
  clearBootstrapRetryTimer();
  clearRuntimeConfigTransport();
  state.bootstrapped = false;
  state.bootstrapSuspended = true;
  state.runtimeEnabled = false;
  state.suspendedEntries = new Map(state.entries);
  state.entries.clear();
}

export function resumeRuntimeConfigBootstrap(): void {
  if (!state.bootstrapSuspended && state.runtimeEnabled) {
    return;
  }

  state.bootstrapped = false;
  state.bootstrapSuspended = false;
  void bootstrapRuntimeConfig().catch(() => {});
}

export async function bootstrapRuntimeConfig(): Promise<void> {
  if (state.bootstrapped || state.bootstrapSuspended) {
    return;
  }
  if (state.bootstrapPromise) {
    return state.bootstrapPromise;
  }

  state.bootstrapPromise = (async () => {
    try {
      const payload = await bootstrapRuntimeConfigTransport();
      if (!payload) {
        state.runtimeEnabled = false;
        state.entries.clear();
        scheduleBootstrapRetry();
        return;
      }

      clearBootstrapRetryTimer();
      const previousValues = new Map<string, string | null>();
      const changedKeys = new Set<string>([
        ...state.entries.keys(),
        ...state.suspendedEntries.keys(),
        ...payload.entries.map((entry) => entry.key),
        ...state.pendingMutations.keys(),
      ]);
      for (const key of changedKeys) {
        previousValues.set(key, readEffectiveValue(key));
      }
      const nextEntries = buildRuntimeEntries(payload.entries);
      applyPendingMutations(nextEntries);
      state.bootstrapped = true;
      state.runtimeEnabled = true;
      state.bootstrapSuspended = false;
      state.entries = nextEntries;
      state.suspendedEntries.clear();
      replacePersistedValues(payload.entries);
      ensureRuntimeStorageSync();
      notifyEffectiveValueChanges(previousValues, changedKeys);
      replayPendingMutations();
    } catch (error) {
      if (isRuntimeConfigTransportDisabledError(error)) {
        suspendRuntimeConfigBootstrap();
        return;
      }

      state.runtimeEnabled = false;
      state.entries.clear();
      state.persistedValues.clear();
      scheduleBootstrapRetry();
      throw error;
    }
  })().finally(() => {
    state.bootstrapPromise = null;
  });

  return state.bootstrapPromise;
}

export function isRuntimeConfigEnabled(): boolean {
  return state.runtimeEnabled;
}

export function getRuntimeConfigValueSync(key: string): string | null {
  return readEffectiveValue(key);
}

export function setRuntimeConfigValue(
  key: string,
  value: string,
  options: RuntimeConfigWriteOptions = {},
): void {
  ensurePersistedBaseline(key);
  const operationVersion = nextOperationVersion(key);
  writeLocalStorageValue(key, value);
  if (!state.runtimeEnabled) {
    state.pendingMutations.set(key, {
      kind: 'set',
      value,
      options,
      version: operationVersion,
    });
    return;
  }

  state.pendingMutations.delete(key);
  state.entries.set(key, value);
  persistRuntimeSet(key, value, options, operationVersion);
}

export function removeRuntimeConfigValue(key: string): void {
  ensurePersistedBaseline(key);
  const operationVersion = nextOperationVersion(key);
  removeLocalStorageValue(key);
  if (!state.runtimeEnabled) {
    state.pendingMutations.set(key, {
      kind: 'remove',
      version: operationVersion,
    });
    return;
  }

  state.pendingMutations.delete(key);
  state.entries.delete(key);
  persistRuntimeDelete(key, operationVersion);
}

export function removeRuntimeConfigValuesByPrefixes(prefixes: readonly string[]): void {
  for (const key of collectRuntimeConfigKeysByPrefixes(prefixes)) {
    removeRuntimeConfigValue(key);
  }
}

export function __primeRuntimeConfigForTests(entries: Record<string, string>): void {
  state.bootstrapped = true;
  state.bootstrapSuspended = false;
  state.runtimeEnabled = true;
  state.entries = new Map(Object.entries(entries));
  state.suspendedEntries.clear();
  state.persistedValues = new Map(Object.entries(entries));
  state.pendingMutations.clear();
}

export function __resetRuntimeConfigCacheForTests(): void {
  clearRuntimeStorageSync();
  clearBootstrapRetryTimer();
  state.bootstrapped = false;
  state.bootstrapSuspended = false;
  state.runtimeEnabled = false;
  state.entries.clear();
  state.suspendedEntries.clear();
  state.persistedValues.clear();
  state.pendingMutations.clear();
  state.operationVersions.clear();
  state.persistQueues.clear();
  state.bootstrapPromise = null;
  state.bootstrapRetryTimer = null;
  __resetRuntimeConfigAdapterForTests();
}
