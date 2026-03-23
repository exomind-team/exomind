import { vi } from 'vitest';
import '@testing-library/jest-dom';
import { mkdirSync } from 'node:fs';

// Mock scrollIntoView (jsdom 不支持)
Element.prototype.scrollIntoView = vi.fn();

function ensureLocalStorage() {
  const storage = window.localStorage as Partial<Storage> | undefined;
  const hasApis = storage
    && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function'
    && typeof storage.clear === 'function'
    && typeof storage.key === 'function';

  if (hasApis) return;

  const backingStore = new Map<string, string>();
  const localStorageShim: Storage = {
    getItem: (key: string) => (backingStore.has(key) ? backingStore.get(key)! : null),
    setItem: (key: string, value: string) => {
      backingStore.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      backingStore.delete(String(key));
    },
    clear: () => {
      backingStore.clear();
    },
    key: (index: number) => Array.from(backingStore.keys())[index] ?? null,
    get length() {
      return backingStore.size;
    },
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageShim,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageShim,
    configurable: true,
  });
}

ensureLocalStorage();

function ensurePouchDbTestDirs() {
  const dirs = [
    '.tmp/pouchdb-event-storage/',
    '.tmp/pouchdb-event-storage/a/',
    '.tmp/pouchdb-event-storage/b/',
    '.tmp/pouchdb-active-block/',
  ];

  dirs.forEach((dir) => {
    mkdirSync(dir, { recursive: true });
  });
}

ensurePouchDbTestDirs();
