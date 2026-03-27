import {
  bootstrapRuntimeConfigTransport,
  deleteRuntimeConfigValue as deleteRuntimeConfigValueRemote,
  writeRuntimeConfigValue as writeRuntimeConfigValueRemote,
  __resetRuntimeConfigAdapterForTests,
} from './runtime-config-adapter';
import type {
  RuntimeConfigEntryRecord,
  RuntimeConfigWriteOptions,
} from './runtime-config-types';

type RuntimeConfigCacheState = {
  bootstrapped: boolean;
  runtimeEnabled: boolean;
  entries: Map<string, string>;
  bootstrapPromise: Promise<void> | null;
  bootstrapRetryTimer: number | null;
};

const BOOTSTRAP_RETRY_DELAY_MS = 1000;

const state: RuntimeConfigCacheState = {
  bootstrapped: false,
  runtimeEnabled: false,
  entries: new Map(),
  bootstrapPromise: null,
  bootstrapRetryTimer: null,
};

function readLocalStorageValue(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore local mirror failures（忽略本地镜像写入失败）
  }
}

function removeLocalStorageValue(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore local mirror removal failures（忽略本地镜像删除失败）
  }
}

function replaceRuntimeEntries(entries: RuntimeConfigEntryRecord[]): void {
  state.entries = new Map(entries.map((entry) => [entry.key, entry.value]));
}

function clearBootstrapRetryTimer(): void {
  if (state.bootstrapRetryTimer == null) {
    return;
  }

  window.clearTimeout(state.bootstrapRetryTimer);
  state.bootstrapRetryTimer = null;
}

function scheduleBootstrapRetry(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (state.bootstrapRetryTimer != null || state.bootstrapped) {
    return;
  }

  state.bootstrapRetryTimer = window.setTimeout(() => {
    state.bootstrapRetryTimer = null;
    void bootstrapRuntimeConfig().catch(() => {});
  }, BOOTSTRAP_RETRY_DELAY_MS);
}

export async function bootstrapRuntimeConfig(): Promise<void> {
  if (state.bootstrapped) {
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
      state.bootstrapped = true;
      state.runtimeEnabled = true;
      replaceRuntimeEntries(payload.entries);
    } catch (error) {
      state.runtimeEnabled = false;
      state.entries.clear();
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
  if (state.runtimeEnabled && state.entries.has(key)) {
    return state.entries.get(key) ?? null;
  }

  return readLocalStorageValue(key);
}

export function setRuntimeConfigValue(
  key: string,
  value: string,
  options: RuntimeConfigWriteOptions = {},
): void {
  writeLocalStorageValue(key, value);
  if (!state.runtimeEnabled) {
    return;
  }

  state.entries.set(key, value);
  void writeRuntimeConfigValueRemote(key, value, options).catch(() => {});
}

export function removeRuntimeConfigValue(key: string): void {
  removeLocalStorageValue(key);
  if (!state.runtimeEnabled) {
    return;
  }

  state.entries.delete(key);
  void deleteRuntimeConfigValueRemote(key).catch(() => {});
}

export function __primeRuntimeConfigForTests(entries: Record<string, string>): void {
  state.bootstrapped = true;
  state.runtimeEnabled = true;
  state.entries = new Map(Object.entries(entries));
}

export function __resetRuntimeConfigCacheForTests(): void {
  clearBootstrapRetryTimer();
  state.bootstrapped = false;
  state.runtimeEnabled = false;
  state.entries.clear();
  state.bootstrapPromise = null;
  state.bootstrapRetryTimer = null;
  __resetRuntimeConfigAdapterForTests();
}
