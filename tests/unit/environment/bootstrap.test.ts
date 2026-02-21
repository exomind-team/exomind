import { describe, expect, it } from 'vitest';
import { createRuntimeBootstrap, detectRuntime } from '@/lib/environment/bootstrap';

describe('environment bootstrap', () => {
  it('detectRuntime should fallback to web when no tauri marker exists', () => {
    const runtime = detectRuntime({});
    expect(runtime).toBe('web');
  });

  it('createRuntimeBootstrap should build web adapters for web runtime', () => {
    const result = createRuntimeBootstrap({ runtime: 'web' });

    expect(result.runtime).toBe('web');
    expect(result.storage.constructor.name).toBe('WebStorageAdapter');
    expect(result.eventlog.constructor.name).toBe('WebEventLogStorageAdapter');
  });

  it('createRuntimeBootstrap should use pouchdb eventlog adapter for tauri runtime', () => {
    const webResult = createRuntimeBootstrap({ runtime: 'web' });
    const tauriResult = createRuntimeBootstrap({ runtime: 'tauri' });

    expect(tauriResult.runtime).toBe('tauri');
    expect(tauriResult.storage.constructor.name).toBe('TauriStorageAdapter');
    expect(tauriResult.storage.constructor.name).not.toBe(webResult.storage.constructor.name);
    expect(tauriResult.eventlog.constructor.name).toBe('WebEventLogStorageAdapter');
    expect(tauriResult.eventlog.constructor.name).toBe(webResult.eventlog.constructor.name);
  });
});
