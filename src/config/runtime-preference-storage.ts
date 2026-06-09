import {
  getRuntimeConfigValueSync,
  removeRuntimeConfigValue,
  setRuntimeConfigValue,
} from './runtime-config-cache';

export function readRuntimeBackedValue(key: string): string | null {
  try {
    return getRuntimeConfigValueSync(key);
  } catch {
    return null;
  }
}

export function writeRuntimeBackedValue(key: string, value: string, source: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    setRuntimeConfigValue(key, value, {
      source,
      sourceOrigin: window.location?.origin,
    });
  } catch {
    // Ignore Runtime / local mirror write failures（忽略 Runtime / 本地镜像写入失败）
  }
}

export function removeRuntimeBackedValue(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    removeRuntimeConfigValue(key);
  } catch {
    // Ignore Runtime / local mirror remove failures（忽略 Runtime / 本地镜像删除失败）
  }
}
