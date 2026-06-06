import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY,
  EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
  getRuntimeExternalAuthToken,
  getRuntimeExternalAddress,
  getEmbeddedRuntimeNetworkMode,
  getRuntimeTargetMode,
  getSelectedRuntimeTarget,
  rememberEmbeddedRuntimeStatus,
  resolveEmbeddedRuntimeBindHost,
  setEmbeddedRuntimeNetworkMode,
  setRuntimeExternalAuthToken,
  setRuntimeExternalAddress,
  setRuntimeTargetMode,
  subscribeRuntimeTargetChanges,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('runtime target config（Runtime 目标配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('defaults to embedded runtime port in web mode（Web 模式默认走内嵌 RT 端口）', () => {
    expect(getRuntimeTargetMode()).toBe('embedded');
    expect(getEmbeddedRuntimeNetworkMode()).toBe('local');
    expect(resolveEmbeddedRuntimeBindHost()).toBe('127.0.0.1');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'embedded',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
  });

  it('uses 127.0.0.1 loopback for tauri embedded target（Tauri embedded 目标应回落到 127.0.0.1）', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'embedded',
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
  });

  it('sanitizes cached embedded runtime status without selecting its stale port（清理缓存的内嵌 runtime 状态但不采用旧端口）', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    window.localStorage.setItem(
      EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
      JSON.stringify({
        host: '0.0.0.0',
        port: 4077,
        authSecret: 'embedded-secret',
      }),
    );

    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'embedded',
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
    expect(getSelectedRuntimeTarget().authToken).toBeUndefined();
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).not.toContain('"authSecret"');
  });

  it('normalizes tauri loopback runtime base URLs to 127.0.0.1（Tauri loopback Runtime URL 统一为 127.0.0.1）', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });

    expect(toRuntimeBaseUrl({ host: '127.0.0.1', port: 9124 })).toBe('http://127.0.0.1:9124');
    expect(toRuntimeBaseUrl({ host: '0.0.0.0', port: 9124 })).toBe('http://127.0.0.1:9124');
  });

  it('persists embedded runtime LAN bind mode（保存内嵌 Runtime 局域网监听模式）', () => {
    setEmbeddedRuntimeNetworkMode('lan');

    expect(getEmbeddedRuntimeNetworkMode()).toBe('lan');
    expect(resolveEmbeddedRuntimeBindHost()).toBe('0.0.0.0');
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY)).toBe('lan');
  });

  it('reads runtime-backed target settings before localStorage（优先读取 Runtime 中的运行时目标配置）', () => {
    window.localStorage.setItem('exomind:runtimeTargetMode', 'embedded');
    window.localStorage.setItem('exomind:embeddedRuntimeNetworkMode', 'local');
    window.localStorage.setItem('exomind:runtimeExternalAddress', '127.0.0.1:1949');
    __primeRuntimeConfigForTests({
      'exomind:runtimeTargetMode': 'external',
      'exomind:embeddedRuntimeNetworkMode': 'lan',
      'exomind:runtimeExternalAddress': '10.8.0.5:2999',
    });

    expect(getRuntimeTargetMode()).toBe('external');
    expect(getEmbeddedRuntimeNetworkMode()).toBe('lan');
    expect(getRuntimeExternalAddress()).toBe('10.8.0.5:2999');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '10.8.0.5',
      port: 2999,
    });
  });

  it('switches to external runtime with the embedded default port（切到外部默认使用内嵌端口）', () => {
    setRuntimeTargetMode('external');

    expect(getRuntimeTargetMode()).toBe('external');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '127.0.0.1',
      port: DEFAULT_EMBEDDED_RUNTIME_PORT,
    });
  });

  it('persists external address and emits changes（保存外部地址并发变更事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeTargetChanges(listener);

    setRuntimeExternalAddress('10.8.0.5:2999');
    setRuntimeTargetMode('external');

    expect(getRuntimeExternalAddress()).toBe('10.8.0.5:2999');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '10.8.0.5',
      port: 2999,
    });
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('includes external auth token in the selected runtime target（外部 Runtime 应携带鉴权 token）', () => {
    setRuntimeExternalAddress('192.168.1.48:9124');
    setRuntimeExternalAuthToken('Bearer external-admin-token');
    setRuntimeTargetMode('external');

    expect(getRuntimeExternalAuthToken()).toBe('external-admin-token');
    expect(getSelectedRuntimeTarget()).toMatchObject({
      mode: 'external',
      host: '192.168.1.48',
      port: 9124,
      authToken: 'external-admin-token',
    });
  });

  it('rejects invalid external address（拒绝非法 host:port）', () => {
    expect(() => setRuntimeExternalAddress('http://bad:1949/path')).toThrow();
    expect(() => setRuntimeExternalAddress('no-port')).toThrow();
    expect(() => setRuntimeExternalAddress('127.0.0.1:70000')).toThrow();
  });

  it('emits the remembered embedded runtime port after updating IPC cache（更新 IPC 缓存后再广播内嵌 Runtime 端口）', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    const listener = vi.fn();
    const unsubscribe = subscribeRuntimeTargetChanges(listener);

    rememberEmbeddedRuntimeStatus({
      host: '127.0.0.1',
      port: 48202,
      hostId: 'desktop-host',
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'embedded',
      host: '127.0.0.1',
      port: 48202,
    }));
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).toContain('"port":48202');

    unsubscribe();
  });
});
