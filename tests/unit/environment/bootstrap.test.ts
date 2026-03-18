import { describe, expect, it } from 'vitest';
import { createRuntimeBootstrap, detectRuntime } from '@/lib/environment/bootstrap';

describe('environment bootstrap', () => {
  it('detectRuntime should fallback to web when no tauri marker exists', () => {
    const runtime = detectRuntime({});
    expect(runtime).toBe('web');
  });

  it('createRuntimeBootstrap should build web adapters for web runtime', () => {
    const result = createRuntimeBootstrap({ runtime: 'web', useMockData: false });

    expect(result.runtime).toBe('web');
    expect(result.clipboard.constructor.name).toBe('WebClipboardAdapter');
    expect(result.storage.constructor.name).toBe('WebStorageAdapter');
    expect(result.eventlog.constructor.name).toBe('WebEventLogStorageAdapter');
    expect(result.task.constructor.name).toBe('TaskRtAdapter');
    expect(result.me.constructor.name).toBe('MeWebAdapter');
    expect(result.agent.constructor.name).toBe('AgentWebAdapter');
  });

  it('createRuntimeBootstrap should use RT adapters for tauri runtime by default', () => {
    const webResult = createRuntimeBootstrap({ runtime: 'web', useMockData: false });
    const tauriResult = createRuntimeBootstrap({ runtime: 'tauri', useMockData: false });

    expect(tauriResult.runtime).toBe('tauri');
    expect(tauriResult.clipboard.constructor.name).toBe('TauriClipboardAdapter');
    expect(tauriResult.clipboard.constructor.name).not.toBe(webResult.clipboard.constructor.name);
    expect(tauriResult.storage.constructor.name).toBe('TauriStorageAdapter');
    expect(tauriResult.storage.constructor.name).not.toBe(webResult.storage.constructor.name);
    expect(tauriResult.eventlog.constructor.name).toBe('EventLogRtAdapter');
    expect(tauriResult.eventlog.constructor.name).not.toBe(webResult.eventlog.constructor.name);
    expect(tauriResult.task.constructor.name).toBe('TaskRtAdapter');
    expect(tauriResult.me.constructor.name).toBe('MeWebAdapter');
    expect(tauriResult.agent.constructor.name).toBe('AgentWebAdapter');
  });

  it('createRuntimeBootstrap should use mock task adapter when mock flag is enabled', () => {
    const result = createRuntimeBootstrap({ runtime: 'web', useMockData: true });
    expect(result.task.constructor.name).toBe('TaskMockAdapter');
    expect(result.me.constructor.name).toBe('MeMockAdapter');
    expect(result.agent.constructor.name).toBe('AgentMockAdapter');
  });
});
